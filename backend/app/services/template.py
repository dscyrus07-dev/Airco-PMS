"""TemplateService + template scheduler.

The template defines WHAT / WHERE / WHO / WHEN. The scheduler expands the
location rule live (so new rooms in a zone join automatically), groups
targets by zone, hands each group to WorkAllocationService (the shared
round-robin engine — never a second allocator), and stamps every generated
item with template_id + template_version. Idempotency comes from the
unique (template_id, occurrence_key) ledger row.
"""

import uuid
from datetime import datetime, time as dtime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.maintenance import MaintenanceTicket
from app.models.structure import Area, Bed, Dorm, Room, Zone
from app.models.task import Task
from app.models.template import (
    TEMPLATE_STATUSES,
    TEMPLATE_TYPES,
    TemplateGeneration,
    WorkTemplate,
    WorkTemplateVersion,
)
from app.models.user import User
from app.schemas.template import TemplateCreateRequest, TemplateUpdateRequest
from app.services.maintenance import next_ticket_number
from app.services.structure import (
    ConflictErr,
    NotFoundErr,
    StructureService,
    ValidationErr,
)
from app.services.task import PRIORITIES, TaskService
from app.services.work_allocation import WorkAllocationService

DEFAULT_TZ = "Asia/Kolkata"
RELATIVE_WEEKS = {"first": 0, "second": 1, "third": 2, "fourth": 3, "last": -1}


def _tz(schedule: dict) -> ZoneInfo:
    try:
        return ZoneInfo(schedule.get("timezone") or DEFAULT_TZ)
    except Exception:
        return ZoneInfo(DEFAULT_TZ)


def _parse_hm(value: str | None, default: dtime) -> dtime:
    try:
        h, m = (value or "").split(":")[:2]
        return dtime(int(h), int(m))
    except Exception:
        return default


def compute_next_run(schedule: dict, after: datetime,
                     allow_past: bool = False) -> datetime | None:
    """Next scheduled occurrence (UTC) strictly after `after`, honoring
    start_date/end_date. Returns None when nothing is scheduled.

    allow_past is used only at activation time: a one-time schedule dated in
    the past means "due now". The advance path (after=last occurrence) never
    allows past, so one-time templates terminate after their single run."""
    if not schedule:
        return None
    tz = _tz(schedule)
    now_local = after.astimezone(tz)
    start_d = None
    if schedule.get("start_date"):
        try:
            start_d = datetime.fromisoformat(schedule["start_date"]).date()
        except ValueError:
            pass
    end_d = None
    if schedule.get("end_date"):
        try:
            end_d = datetime.fromisoformat(schedule["end_date"]).date()
        except ValueError:
            pass

    def ok(dt_local: datetime) -> bool:
        return (
            dt_local > now_local
            and (start_d is None or dt_local.date() >= start_d)
            and (end_d is None or dt_local.date() <= end_d)
        )

    def out(dt_local: datetime) -> datetime | None:
        return dt_local.astimezone(timezone.utc) if ok(dt_local) else None

    if schedule.get("kind") != "recurring":
        if not schedule.get("date"):
            return None
        t = _parse_hm(schedule.get("time"), dtime(9, 0))
        try:
            d = datetime.fromisoformat(schedule["date"]).date()
        except ValueError:
            return None
        # a past-dated one-time schedule is simply "due now" at activation —
        # generates on the next tick instead of being silently dead
        dt = datetime.combine(d, t, tzinfo=tz)
        if (start_d is None or d >= start_d) and (end_d is None or d <= end_d):
            if dt > now_local or allow_past:
                return dt.astimezone(timezone.utc)
        return None

    freq = schedule.get("frequency") or "daily"
    every = max(int(schedule.get("every") or 1), 1)
    time_of_day = _parse_hm(schedule.get("time") or schedule.get("start_time"),
                            dtime(10, 0))
    cursor = (start_d or now_local.date())

    if freq == "hourly":
        # every N hours inside a daily window [start_time, window_end]
        win_start = _parse_hm(schedule.get("start_time"), dtime(0, 0))
        win_end = _parse_hm(schedule.get("end_time") or schedule.get("window_end"),
                            dtime(23, 59))
        for day_off in range(0, 380):
            d = cursor + timedelta(days=day_off)
            t = datetime.combine(d, win_start, tzinfo=tz)
            end = datetime.combine(d, win_end, tzinfo=tz)
            while t <= end:
                if ok(t):
                    return t.astimezone(timezone.utc)
                t += timedelta(hours=every)
        return None

    for day_off in range(0, 3660):
        d = cursor + timedelta(days=day_off)
        if end_d and d > end_d:
            return None
        if freq == "daily":
            if (d - cursor).days % every == 0:
                r = out(datetime.combine(d, time_of_day, tzinfo=tz))
                if r:
                    return r
        elif freq == "weekly":
            days = set(schedule.get("weekdays") or [])
            if d.weekday() in days:
                r = out(datetime.combine(d, time_of_day, tzinfo=tz))
                if r:
                    return r
        elif freq == "monthly":
            hit = False
            if schedule.get("day_of_month"):
                hit = d.day == min(int(schedule["day_of_month"]), 28) or (
                    int(schedule["day_of_month"]) > 28
                    and (d + timedelta(days=1)).day == 1 and d.day >= 28
                )
            elif schedule.get("relative_week") and schedule.get("relative_weekday") is not None:
                wd = int(schedule["relative_weekday"])
                rw = schedule["relative_week"]
                if d.weekday() == wd:
                    ordinals = [
                        dd for dd in range(1, 32)
                        if _safe_date(d.year, d.month, dd)
                        and _safe_date(d.year, d.month, dd).weekday() == wd
                    ]
                    idx = RELATIVE_WEEKS.get(rw, 0)
                    hit = ordinals and d.day == ordinals[idx]
            if hit:
                r = out(datetime.combine(d, time_of_day, tzinfo=tz))
                if r:
                    return r
        elif freq == "custom":
            unit = schedule.get("custom_unit") or "days"
            delta_days = {"days": every, "weeks": every * 7,
                          "months": every * 30}.get(unit, every)
            if (d - cursor).days % delta_days == 0:
                r = out(datetime.combine(d, time_of_day, tzinfo=tz))
                if r:
                    return r
        else:
            return None
    return None


def _safe_date(y, m, day):
    from datetime import date
    try:
        return date(y, m, day)
    except ValueError:
        return None


class TemplateService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.structure = StructureService(session)
        self.alloc = WorkAllocationService(session)
        # Per-instance structure snapshot — _expand_targets used to issue a
        # serial query per target/zone/dorm/bed (N+1s); against a remote DB
        # each RTT is ~300-400ms, so one prefetch of the property structure
        # (4 queries, cached per request/tick) replaces dozens of round trips.
        self._struct: dict | None = None

    async def _structure(self, pid: uuid.UUID) -> dict:
        if self._struct is None:
            zones = (await self.session.execute(
                select(Zone).where(Zone.property_id == pid))).scalars().all()
            rooms = (await self.session.execute(
                select(Room).where(Room.property_id == pid))).scalars().all()
            dorms = (await self.session.execute(
                select(Dorm).where(Dorm.property_id == pid))).scalars().all()
            dorm_ids = [d.id for d in dorms]
            beds = (await self.session.execute(
                select(Bed).where(Bed.dorm_id.in_(dorm_ids)))).scalars().all() \
                if dorm_ids else []
            self._struct = {
                "zones": {z.id: z for z in zones},
                "rooms": rooms,
                "dorms": dorms,
                "dorm_beds": {d.id: [b for b in beds if b.dorm_id == d.id]
                              for d in dorms},
                "by_id": {
                    "room": {r.id: r for r in rooms},
                    "dorm": {d.id: d for d in dorms},
                    "bed": {b.id: b for b in beds},
                    "area": {},
                },
            }
            areas = (await self.session.execute(
                select(Area).where(Area.property_id == pid))).scalars().all()
            self._struct["areas"] = {a.id: a for a in areas}
            self._struct["by_id"]["area"] = self._struct["areas"]
        return self._struct

    # ------------------------------------------------------------------
    # Fetch / validation
    # ------------------------------------------------------------------

    async def _get_template(self, user: User, template_id: uuid.UUID) -> WorkTemplate:
        res = await self.session.execute(
            select(WorkTemplate).where(WorkTemplate.id == template_id)
        )
        t = res.scalar_one_or_none()
        if t is None:
            raise NotFoundErr("Template not found.")
        await self.structure._property_for_write(user, t.property_id)
        return t

    def _validate(self, payload_data: dict, is_update=False):
        ttype = payload_data.get("template_type")
        if ttype and ttype not in TEMPLATE_TYPES:
            raise ValidationErr("Invalid template type.", field="template_type")
        status_ = payload_data.get("status")
        if status_ and status_ not in TEMPLATE_STATUSES:
            raise ValidationErr("Invalid status.", field="status")
        prio = payload_data.get("priority")
        if prio and prio not in PRIORITIES:
            raise ValidationErr("Invalid priority.", field="priority")
        if not is_update and not payload_data.get("name"):
            raise ValidationErr("Template name is required.", field="name")

    async def _check_refs(self, prop_id: uuid.UUID, assignment: dict, location: dict):
        async def exists(model, id_, label):
            if id_ is None:
                return
            res = await self.session.execute(
                select(model).where(model.id == id_, model.property_id == prop_id)
            )
            if res.scalar_one_or_none() is None:
                raise ValidationErr(f"{label} not found in this property.")

        for uid in (assignment.get("employee_uid"), assignment.get("supervisor_uid")):
            if uid:
                await exists(Employee, uuid.UUID(str(uid)), "Employee")
        if location.get("zone_uid"):
            await exists(Zone, uuid.UUID(str(location["zone_uid"])), "Zone")
        if location.get("area_uid"):
            await exists(Area, uuid.UUID(str(location["area_uid"])), "Area")
        for key, model, label in (("room_uids", Room, "Room"),
                                  ("dorm_uids", Dorm, "Dorm"),
                                  ("bed_uids", Bed, "Bed")):
            for uid in location.get(key) or []:
                await exists(model, uuid.UUID(str(uid)), label)

    def _snapshot(self, t: WorkTemplate):
        self.session.add(WorkTemplateVersion(
            template_id=t.id, version=t.version, config={
                "name": t.name, "template_type": t.template_type,
                "description": t.description, "category": t.category,
                "priority": t.priority, "duration_minutes": t.duration_minutes,
                "assignment": t.assignment, "location": t.location,
                "schedule": t.schedule, "checklist": t.checklist,
                "verification": t.verification, "overdue": t.overdue,
                "notifications": t.notifications,
            },
        ))

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    async def create(self, user: User, payload: TemplateCreateRequest) -> WorkTemplate:
        prop = await self.structure._property_for_write(user, payload.property_uid)
        data = payload.model_dump()
        self._validate(data)
        await self._check_refs(prop.id, data["assignment"], data["location"])

        t = WorkTemplate(
            company_id=prop.company_id,
            property_id=prop.id,
            name=data["name"].strip(),
            template_type=data["template_type"],
            description=data.get("description"),
            category=data.get("category"),
            priority=data["priority"],
            duration_minutes=data.get("duration_minutes"),
            status=data["status"],
            assignment=data["assignment"],
            location=_loc_out(data["location"]),
            schedule=data["schedule"],
            checklist=data["checklist"],
            verification=data["verification"],
            overdue=data["overdue"],
            notifications=data["notifications"],
            created_by=user.id,
            created_by_name=user.name,
            next_run_at=(compute_next_run(data["schedule"],
                                          datetime.now(timezone.utc),
                                          allow_past=True)
                         if data["status"] == "active" else None),
        )
        self.session.add(t)
        await self.session.flush()
        self._snapshot(t)
        await self.session.commit()
        await self.session.refresh(t)
        return t

    async def update(self, user: User, template_id: uuid.UUID,
                     payload: TemplateUpdateRequest) -> WorkTemplate:
        t = await self._get_template(user, template_id)
        data = payload.model_dump(exclude_unset=True)
        self._validate(data, is_update=True)
        if "assignment" in data or "location" in data:
            await self._check_refs(
                t.property_id,
                data.get("assignment") or t.assignment,
                data.get("location") or t.location,
            )
        simple = ("name", "template_type", "description", "category",
                  "priority", "duration_minutes", "status", "assignment",
                  "schedule", "checklist", "verification", "overdue",
                  "notifications")
        for k in simple:
            if k in data:
                setattr(t, k, data[k])
        if "location" in data:
            t.location = _loc_out(data["location"])
        t.version += 1
        t.next_run_at = (compute_next_run(t.schedule, datetime.now(timezone.utc),
                                     allow_past=True)
                         if t.status == "active" else None)
        self._snapshot(t)
        await self.session.commit()
        await self.session.refresh(t)
        return t

    async def set_status(self, user: User, template_id: uuid.UUID,
                         status_: str) -> WorkTemplate:
        t = await self._get_template(user, template_id)
        if status_ not in TEMPLATE_STATUSES:
            raise ValidationErr("Invalid status.", field="status")
        t.status = status_
        t.next_run_at = (compute_next_run(t.schedule, datetime.now(timezone.utc),
                                     allow_past=True)
                         if status_ == "active" else None)
        await self.session.commit()
        await self.session.refresh(t)
        return t

    async def delete(self, user: User, template_id: uuid.UUID) -> None:
        t = await self._get_template(user, template_id)
        if t.status in {"active", "paused"}:
            raise ConflictErr("Pause or archive the template before deleting it.")
        await self.session.delete(t)
        await self.session.commit()

    async def duplicate(self, user: User, template_id: uuid.UUID) -> WorkTemplate:
        t = await self._get_template(user, template_id)
        copy = WorkTemplate(
            company_id=t.company_id, property_id=t.property_id,
            name=f"{t.name} (copy)", template_type=t.template_type,
            description=t.description, category=t.category,
            priority=t.priority, duration_minutes=t.duration_minutes,
            status="draft", assignment=t.assignment, location=t.location,
            schedule=t.schedule, checklist=t.checklist,
            verification=t.verification, overdue=t.overdue,
            notifications=t.notifications,
            created_by=user.id, created_by_name=user.name,
        )
        self.session.add(copy)
        await self.session.flush()
        self._snapshot(copy)
        await self.session.commit()
        await self.session.refresh(copy)
        return copy

    async def list_templates(self, user: User, property_id: uuid.UUID | None,
                             status_: str | None = None,
                             template_type: str | None = None,
                             category: str | None = None,
                             search: str | None = None) -> list[WorkTemplate]:
        q = select(WorkTemplate)
        if user.role.value == "super_admin":
            q = q.where(WorkTemplate.company_id == user.company_id)
        elif user.property_id:
            q = q.where(WorkTemplate.property_id == user.property_id)
        else:
            return []
        if property_id:
            q = q.where(WorkTemplate.property_id == property_id)
        if status_:
            q = q.where(WorkTemplate.status == status_)
        if template_type:
            q = q.where(WorkTemplate.template_type == template_type)
        if category:
            q = q.where(WorkTemplate.category == category)
        if search:
            q = q.where(func.lower(WorkTemplate.name).contains(search.lower()))
        res = await self.session.execute(q.order_by(WorkTemplate.created_at.desc()))
        return list(res.scalars())

    async def generated_work(self, user: User, template_id: uuid.UUID) -> dict:
        t = await self._get_template(user, template_id)
        from sqlalchemy.orm import selectinload
        res = await self.session.execute(
            select(Task).where(Task.template_id == t.id)
            .options(selectinload(Task.history))
            .order_by(Task.created_at.desc()).limit(100)
        )
        from app.schemas.workspace import task_out
        tasks = [task_out(x) for x in res.scalars()]
        res = await self.session.execute(
            select(MaintenanceTicket).where(MaintenanceTicket.template_id == t.id)
            .options(
                selectinload(MaintenanceTicket.events),
                selectinload(MaintenanceTicket.attachments),
            )
            .order_by(MaintenanceTicket.created_at.desc()).limit(100)
        )
        from app.schemas.maintenance import ticket_out
        tickets = [ticket_out(x) for x in res.scalars()]
        return {"tasks": tasks, "maintenance": tickets}

    async def history(self, user: User, template_id: uuid.UUID) -> list[dict]:
        t = await self._get_template(user, template_id)
        res = await self.session.execute(
            select(TemplateGeneration).where(TemplateGeneration.template_id == t.id)
            .order_by(TemplateGeneration.created_at.desc()).limit(200)
        )
        return [{
            "occurrence_key": g.occurrence_key,
            "ticket_kind": g.ticket_kind,
            "ticket_number": g.ticket_number,
            "target_label": g.target_label,
            "created_at": g.created_at.isoformat() if g.created_at else None,
        } for g in res.scalars()]

    # ------------------------------------------------------------------
    # Scheduler — expand targets, allocate per zone, stamp ledger
    # ------------------------------------------------------------------

    async def run_due(self, now: datetime | None = None) -> dict:
        """Generate work for every active template whose run is due.

        Only the latest missed occurrence is generated — a restarted server
        doesn't spam a backlog of stale daily tasks.
        """
        now = now or datetime.now(timezone.utc)
        res = await self.session.execute(
            select(WorkTemplate).where(
                WorkTemplate.status == "active",
                WorkTemplate.next_run_at.is_not(None),
                WorkTemplate.next_run_at <= now,
            )
        )
        stats = {"templates": 0, "generated": 0, "skipped": 0}
        for t in res.scalars():
            stats["templates"] += 1
            try:
                created = await self._generate(t, now)
                stats["generated"] += created
            except IntegrityError:
                await self.session.rollback()
                stats["skipped"] += 1
                continue
            except Exception:
                await self.session.rollback()
                stats["skipped"] += 1
                continue
            t.last_run_at = t.next_run_at or now
            t.next_run_at = compute_next_run(t.schedule, t.next_run_at or now)
            try:
                await self.session.commit()
            except IntegrityError:
                # ledger unique hit — another worker already generated this
                await self.session.rollback()
                stats["skipped"] += 1
                stats["generated"] -= created
        return stats

    async def _generate(self, t: WorkTemplate, now: datetime) -> int:
        occurrence = t.next_run_at or now
        targets = await self._expand_targets(t)
        if not targets:
            return 0

        # group by UNIT (room/dorm/bed — zone/area/property targets keep
        # their own key) → ONE allocation batch per unit per occurrence.
        # All of one room's items land on one employee; each unit advances
        # the zone's round-robin pointer so work distributes fairly.
        by_unit: dict = {}
        for tgt in targets:
            unit = (tgt.get("room_id") or tgt.get("dorm_id")
                    or tgt.get("bed_id") or tgt["key"])
            by_unit.setdefault((tgt["zone_id"], unit), []).append(tgt)

        from app.models.property import Property
        prop = await self.session.get(Property, t.property_id)
        count = 0
        is_maint = t.template_type == "maintenance"
        for (zone_id, _unit), items in by_unit.items():
            zname = items[0]["zone_name"]
            alloc = None
            if t.assignment.get("mode") == "automatic":
                alloc = await self.alloc.allocate(
                    None,
                    property_id=t.property_id,
                    zone_id=zone_id,
                    zone_name=zname,
                    work_type="maintenance" if is_maint else "task",
                    manager_employee_id=prop.manager_employee_id if prop else None,
                    company_id=t.company_id,
                    actor_name="Scheduler",
                    area_id=items[0].get("area_id"),
                    area_name=zname if zone_id is None else None,
                )
            for tgt in items:
                row = await self._generate_for_target(
                    t, tgt, occurrence, alloc=alloc, is_maint=is_maint
                )
                if row is not None:
                    count += 1
        return count

    async def _generate_for_target(self, t: WorkTemplate, tgt: dict,
                                   occurrence: datetime, *,
                                   alloc=None, is_maint: bool | None = None):
        """Generate a single work item for one target at one occurrence.

        Idempotent via the ledger — returns None when the occurrence was
        already generated. `alloc` lets the batch path share ONE allocation
        per zone; the on-demand path allocates per call."""
        from app.models.property import Property
        is_maint = (t.template_type == "maintenance"
                    if is_maint is None else is_maint)
        key = f"{occurrence.isoformat()}|{tgt['key']}"
        if await self._already_generated(t.id, key):
            return None

        if alloc is None and t.assignment.get("mode") == "automatic":
            prop = await self.session.get(Property, t.property_id)
            alloc = await self.alloc.allocate(
                None,
                property_id=t.property_id,
                zone_id=tgt["zone_id"],
                zone_name=tgt.get("zone_name"),
                work_type="maintenance" if is_maint else "task",
                manager_employee_id=prop.manager_employee_id if prop else None,
                company_id=t.company_id,
                actor_name="Scheduler",
                area_id=tgt.get("area_id"),
                area_name=tgt.get("zone_name") if tgt["zone_id"] is None else None,
            )

        if is_maint:
            num = await next_ticket_number(self.session, "maintenance")
            row = self._make_ticket(t, tgt, alloc, num)
        else:
            num = await next_ticket_number(self.session, "task")
            row = await self._make_task(t, tgt, alloc, num, occurrence)
        self.session.add(row)
        await self.session.flush()
        self.session.add(TemplateGeneration(
            template_id=t.id, occurrence_key=key,
            ticket_kind="maintenance" if is_maint else "task",
            ticket_id=row.id, ticket_number=num,
            target_label=tgt["label"],
        ))
        self.alloc.record(
            property_id=t.property_id, zone_id=tgt["zone_id"],
            batch=alloc.batch if alloc else None,
            ticket_kind="maintenance" if is_maint else "task",
            ticket_id=row.id, ticket_number=num,
            employee_id=row.assigned_to if is_maint else row.employee_id,
            employee_name=row.assigned_to_name,
            method=alloc.method if alloc else self._assign_method(t),
            reason=alloc.reason if alloc else None,
            actor_name="Scheduler",
        )
        t.generated_count += 1
        return row

    async def _already_generated(self, template_id: uuid.UUID, key: str) -> bool:
        res = await self.session.execute(
            select(TemplateGeneration.id).where(
                TemplateGeneration.template_id == template_id,
                TemplateGeneration.occurrence_key == key,
            )
        )
        return res.scalar_one_or_none() is not None

    def _assign_method(self, t: WorkTemplate) -> str:
        mode = (t.assignment or {}).get("mode", "automatic")
        return {"individual": "template_direct", "team": "team"}.get(mode, mode)

    def _direct_assignee(self, t: WorkTemplate):
        uid = (t.assignment or {}).get("employee_uid")
        return uuid.UUID(str(uid)) if uid else None

    async def _make_task(self, t, tgt, alloc, num, occurrence) -> Task:
        emp_id, emp_name = None, None
        status_, amethod, areason = "pending", self._assign_method(t), None
        if alloc and alloc.employee:
            emp_id, emp_name = alloc.employee.id, alloc.employee.name
            status_, amethod = "assigned", alloc.method
        elif alloc:
            areason = alloc.reason
        else:
            direct = self._direct_assignee(t)
            if direct:
                emp_id = direct
                status_ = "assigned"
            elif (t.assignment or {}).get("mode") == "team":
                areason = f"team:{t.assignment.get('team')}"
        due = occurrence.isoformat()
        if t.duration_minutes:
            due = (occurrence + timedelta(minutes=t.duration_minutes)).isoformat()
        sup_uid = _uid((t.assignment or {}).get("supervisor_uid"))
        sup_name = None
        if sup_uid:
            sup = await self.session.get(Employee, sup_uid)
            sup_name = sup.name if sup else None
        return Task(
            ticket_number=num, property_id=t.property_id,
            zone_id=tgt["zone_id"], room_id=tgt.get("room_id"),
            room_number=tgt.get("room_number"),
            supervisor_id=sup_uid, supervisor_name=sup_name,
            employee_id=emp_id, assigned_to_name=emp_name,
            title=t.name, description=t.description,
            task_type="fixed", status=status_, priority=t.priority,
            due_date=due, due_time=(t.schedule or {}).get("time"),
            start_time=(t.schedule or {}).get("start_time"),
            created_by_name="Template Scheduler",
            template_id=t.id, template_version=t.version,
            allocation_batch_id=alloc.batch.id if alloc else None,
            allocation_status="auto_assigned" if emp_id else "unassigned",
            allocation_method=amethod, allocation_reason=areason,
        )

    def _make_ticket(self, t, tgt, alloc, num) -> MaintenanceTicket:
        emp_id, emp_name = None, None
        status_, amethod, areason = "open", self._assign_method(t), None
        if alloc and alloc.employee:
            emp_id, emp_name = alloc.employee.id, alloc.employee.name
            status_, amethod = "assigned", alloc.method
        elif alloc:
            areason = alloc.reason
        else:
            direct = self._direct_assignee(t)
            if direct:
                emp_id, status_ = direct, "assigned"
            elif (t.assignment or {}).get("mode") == "team":
                areason = f"team:{t.assignment.get('team')}"
        return MaintenanceTicket(
            ticket_number=num, company_id=t.company_id, property_id=t.property_id,
            room_id=tgt.get("room_id"), room_number=tgt.get("room_number"),
            dorm_id=tgt.get("dorm_id"), dorm_name=tgt.get("dorm_name"),
            bed_id=tgt.get("bed_id"), bed_number=tgt.get("bed_number"),
            reported_by_name="Template Scheduler",
            maintenance_type=t.category or t.template_type,
            issue=t.name, description=t.description, priority=t.priority,
            status=status_, assigned_to=emp_id, assigned_to_name=emp_name,
            zone_id=tgt["zone_id"],
            allocation_batch_id=alloc.batch.id if alloc else None,
            allocation_status="auto_assigned" if emp_id else "unassigned",
            allocation_method=amethod, allocation_reason=areason,
            template_id=t.id, template_version=t.version,
        )

    async def _expand_targets(self, t: WorkTemplate) -> list[dict]:
        """Resolve the location rule against CURRENT structure — dynamic
        scopes ('all rooms in Zone B') pick up newly added units. Reads from
        the per-instance structure snapshot (one prefetch per request/tick),
        not one query per target."""
        loc = t.location or {}
        scope = loc.get("scope", "property")
        pid = t.property_id
        out: list[dict] = []
        st = await self._structure(pid)

        def zn(zid):
            z = st["zones"].get(zid)
            return z.name if z else None

        if scope == "zone":
            zid = _uid(loc.get("zone_uid"))
            target = loc.get("target") or "units"
            zname = zn(zid)
            if target in ("rooms", "units"):
                for r in st["rooms"]:
                    if r.zone_id != zid:
                        continue
                    out.append({"key": f"room:{r.id}", "zone_id": zid, "zone_name": zname,
                                "room_id": r.id, "room_number": r.room_number,
                                "label": f"Room {r.room_number}"})
            if target in ("dorms", "units", "beds"):
                for d in st["dorms"]:
                    if d.zone_id != zid:
                        continue
                    if target == "dorms":
                        out.append({"key": f"dorm:{d.id}", "zone_id": zid,
                                    "zone_name": zname, "dorm_id": d.id,
                                    "dorm_name": d.name, "label": d.name})
                    else:
                        for b in st["dorm_beds"].get(d.id, []):
                            out.append({"key": f"bed:{b.id}", "zone_id": zid,
                                        "zone_name": zname, "dorm_id": d.id,
                                        "dorm_name": d.name, "bed_id": b.id,
                                        "bed_number": b.bed_number,
                                        "label": f"{d.name} · {b.bed_number}"})
            if not out:
                out.append({"key": f"zone:{zid}", "zone_id": zid, "zone_name": zname,
                            "label": zname or "Zone"})
            return out

        if scope == "area":
            aid = _uid(loc.get("area_uid"))
            target = loc.get("target") or "units"
            # units inside the area — directly (unit.area_id) or via their zone
            area_zones = [z for z in st["zones"].values() if z.area_id == aid]
            zone_ids = {z.id for z in area_zones}

            def in_area(u) -> bool:
                return u.area_id == aid or u.zone_id in zone_ids

            if target in ("rooms", "units"):
                for r in st["rooms"]:
                    if not in_area(r):
                        continue
                    out.append({"key": f"room:{r.id}", "zone_id": r.zone_id,
                                "zone_name": zn(r.zone_id),
                                "room_id": r.id, "room_number": r.room_number,
                                "label": f"Room {r.room_number}"})
            if target in ("dorms", "units", "beds"):
                for d in st["dorms"]:
                    if not in_area(d):
                        continue
                    if target == "dorms":
                        out.append({"key": f"dorm:{d.id}", "zone_id": d.zone_id,
                                    "zone_name": zn(d.zone_id),
                                    "dorm_id": d.id, "dorm_name": d.name,
                                    "label": d.name})
                    else:
                        for b in st["dorm_beds"].get(d.id, []):
                            out.append({"key": f"bed:{b.id}",
                                        "zone_id": d.zone_id,
                                        "zone_name": zn(d.zone_id),
                                        "dorm_id": d.id, "dorm_name": d.name,
                                        "bed_id": b.id,
                                        "bed_number": b.bed_number,
                                        "label": f"{d.name} · {b.bed_number}"})
            if not out and area_zones:
                # area has zones but no units — one zone-level target per zone
                # so allocation still lands (zone staff + area staff are both
                # eligible through the zone pool)
                for z in area_zones:
                    out.append({"key": f"zone:{z.id}", "zone_id": z.id,
                                "zone_name": z.name, "label": z.name})
            if not out:
                a = st["areas"].get(aid)
                out.append({"key": f"area:{aid}", "zone_id": None,
                            "area_id": aid,
                            "zone_name": a.name if a else None,
                            "label": a.name if a else "Area"})
            return out

        if scope == "rooms":
            for rid in loc.get("room_uids") or []:
                r = st["by_id"]["room"].get(_uid(rid))
                if r:
                    out.append({"key": f"room:{r.id}", "zone_id": r.zone_id,
                                "zone_name": zn(r.zone_id),
                                "room_id": r.id, "room_number": r.room_number,
                                "label": f"Room {r.room_number}"})
            return out

        if scope == "dorms":
            for did in loc.get("dorm_uids") or []:
                d = st["by_id"]["dorm"].get(_uid(did))
                if d:
                    out.append({"key": f"dorm:{d.id}", "zone_id": d.zone_id,
                                "zone_name": zn(d.zone_id),
                                "dorm_id": d.id, "dorm_name": d.name,
                                "label": d.name})
            return out

        if scope == "beds":
            for bid in loc.get("bed_uids") or []:
                b = st["by_id"]["bed"].get(_uid(bid))
                if b:
                    d = st["by_id"]["dorm"].get(b.dorm_id)
                    out.append({"key": f"bed:{b.id}",
                                "zone_id": d.zone_id if d else None,
                                "zone_name": zn(d.zone_id) if d else None,
                                "dorm_id": b.dorm_id,
                                "dorm_name": d.name if d else None,
                                "bed_id": b.id, "bed_number": b.bed_number,
                                "label": f"{d.name if d else ''} · {b.bed_number}"})
            return out

        # property scope → one property-level item per zone? No — a single
        # property-level task (zone None → assignment rules still apply)
        return [{"key": f"property:{pid}", "zone_id": None, "zone_name": None,
                 "label": "Entire property"}]


def _uid(v) -> uuid.UUID | None:
    return uuid.UUID(str(v)) if v else None


def _loc_out(loc: dict) -> dict:
    """Normalize UUID objects inside the location dict for JSONB storage."""
    out = dict(loc)
    for k in ("zone_uid", "area_uid"):
        if out.get(k):
            out[k] = str(out[k])
    for k in ("room_uids", "dorm_uids", "bed_uids"):
        out[k] = [str(u) for u in (out.get(k) or [])]
    return out
