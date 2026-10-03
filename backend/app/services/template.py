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

from app.core.logging import get_logger

from app.models.company import Company
from app.models.employee import Employee, employee_is_assignable
from app.models.maintenance import MaintenanceTicket
from app.models.occupancy import Occupancy
from app.models.structure import Area, Bed, Dorm, Room, Washroom, Zone
from app.models.task import Task, TaskCompletionSubmission, TaskHistoryEvent
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
from app.services.rollover import (
    RolloverService,
    operational_day_key,
    parse_day_start,
)
from app.services.structure import (
    ConflictErr,
    NotFoundErr,
    StructureService,
    ValidationErr,
)
from app.services.task import PRIORITIES, TaskService
from app.services.work_allocation import (
    WorkAllocationService,
    infer_task_work_type,
)

DEFAULT_TZ = "Asia/Kolkata"
logger = get_logger("app.template")
RELATIVE_WEEKS = {"first": 0, "second": 1, "third": 2, "fourth": 3, "last": -1}


def _tz(schedule: dict) -> ZoneInfo:
    # Single-timezone product: every schedule is interpreted in IST. Any
    # `timezone` value stored in a template config is ignored by design.
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
    if after.tzinfo is None:
        after = after.replace(tzinfo=timezone.utc)  # sqlite round-trip
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

    if freq in ("hourly", "minutes"):
        # every N hours/minutes inside a daily window
        # [start_time, window_end] — e.g. minutes×30 → 10:00,10:30,11:00…
        win_start = _parse_hm(schedule.get("start_time"), dtime(0, 0))
        win_end = _parse_hm(schedule.get("end_time") or schedule.get("window_end"),
                            dtime(23, 59))
        step = (timedelta(hours=every) if freq == "hourly"
                else timedelta(minutes=every))
        for day_off in range(0, 380):
            d = cursor + timedelta(days=day_off)
            t = datetime.combine(d, win_start, tzinfo=tz)
            end = datetime.combine(d, win_end, tzinfo=tz)
            while t <= end:
                if ok(t):
                    return t.astimezone(timezone.utc)
                t += step
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
        # Per-instance structure snapshots — _expand_targets used to issue a
        # serial query per target/zone/dorm/bed (N+1s); against a remote DB
        # each RTT is ~300-400ms, so one prefetch of the property structure
        # (4 queries, cached per request/tick) replaces dozens of round trips.
        # Keyed BY PROPERTY — the global scheduler tick iterates templates
        # across properties, and a single cached snapshot would make every
        # later property expand against the first one's structure.
        self._struct: dict[uuid.UUID, dict] = {}

    async def _structure(self, pid: uuid.UUID) -> dict:
        if self._struct.get(pid) is None:
            zones = (await self.session.execute(
                select(Zone).where(Zone.property_id == pid))).scalars().all()
            rooms = (await self.session.execute(
                select(Room).where(Room.property_id == pid))).scalars().all()
            dorms = (await self.session.execute(
                select(Dorm).where(Dorm.property_id == pid))).scalars().all()
            washrooms = (await self.session.execute(
                select(Washroom).where(Washroom.property_id == pid))
            ).scalars().all()
            dorm_ids = [d.id for d in dorms]
            beds = (await self.session.execute(
                select(Bed).where(Bed.dorm_id.in_(dorm_ids)))).scalars().all() \
                if dorm_ids else []
            st = {
                "zones": {z.id: z for z in zones},
                "rooms": rooms,
                "dorms": dorms,
                "washrooms": washrooms,
                "dorm_beds": {d.id: [b for b in beds if b.dorm_id == d.id]
                              for d in dorms},
                "by_id": {
                    "room": {r.id: r for r in rooms},
                    "dorm": {d.id: d for d in dorms},
                    "washroom": {w.id: w for w in washrooms},
                    "bed": {b.id: b for b in beds},
                    "area": {},
                },
            }
            areas = (await self.session.execute(
                select(Area).where(Area.property_id == pid))).scalars().all()
            st["areas"] = {a.id: a for a in areas}
            st["by_id"]["area"] = st["areas"]
            # Open occupancies — one grouped read; powers occupied_only
            # location filters (e.g. "clean every occupied room daily").
            occs = (await self.session.execute(
                select(Occupancy.room_id, Occupancy.bed_id)
                .where(
                    Occupancy.property_id == pid,
                    Occupancy.checked_out_at.is_(None),
                )
            )).all()
            st["occupied_rooms"] = {o.room_id for o in occs if o.room_id}
            st["occupied_beds"] = {o.bed_id for o in occs if o.bed_id}
            # Dorm occupancy is DERIVED from bed occupancy (the domain has
            # no dorm-level occupancy rows) — a dorm counts as occupied
            # while at least one of its beds holds an open occupancy.
            st["occupied_dorms"] = {
                b.dorm_id for b in beds
                if b.id in st["occupied_beds"]
            }
            self._struct[pid] = st
        return self._struct[pid]

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
        loc = payload_data.get("location") or {}
        occ = loc.get("occupancy")
        if occ is not None and occ not in ("all", "occupied", "unoccupied"):
            raise ValidationErr(
                "occupancy must be all|occupied|unoccupied.",
                field="location.occupancy")
        # Occupancy only exists on rooms/beds (dorms derive from beds) —
        # a washroom-only condition can never express it.
        has_occupancy_filter = occ in ("occupied", "unoccupied") \
            or bool(loc.get("occupied_only"))
        if has_occupancy_filter:
            target = loc.get("target")
            scope = loc.get("scope", "property")
            washroom_only = (
                target == "washrooms"
                or scope == "washrooms"
            )
            if washroom_only:
                raise ValidationErr(
                    "Washrooms have no occupancy axis — occupancy "
                    "conditions apply to rooms, dorm beds and dorms.",
                    field="location.occupancy")
        # beds-in-dorms is the only target a dorm scope accepts
        if loc.get("scope") == "dorms" and \
                loc.get("target") not in (None, "dorms", "beds"):
            raise ValidationErr(
                "A dorm scope can only target dorms or their beds.",
                field="location.target")
        # people-oriented assignment modes — validate required payloads
        assign = payload_data.get("assignment") or {}
        a_mode = assign.get("mode")
        if a_mode == "employees" and not (assign.get("employee_uids") or []):
            raise ValidationErr(
                "Pick at least one employee.", field="assignment.employee_uids")
        if a_mode == "department" and not (assign.get("department") or "").strip():
            raise ValidationErr(
                "Pick a department.", field="assignment.department")
        if a_mode == "team" and not (assign.get("team") or "").strip():
            raise ValidationErr(
                "Pick a team.", field="assignment.team")

    async def _check_refs(
        self, prop_id: uuid.UUID, assignment: dict, location: dict,
        *, work_type: str | None = None,
    ):
        async def exists(model, id_, label):
            if id_ is None:
                return
            res = await self.session.execute(
                select(model).where(model.id == id_, model.property_id == prop_id)
            )
            if res.scalar_one_or_none() is None:
                raise ValidationErr(f"{label} not found in this property.")

        allocs = WorkAllocationService(self.session)
        employee_uid = assignment.get("employee_uid")
        supervisor_uid = assignment.get("supervisor_uid")
        if employee_uid:
            await allocs.employee_for_assignment(
                uuid.UUID(str(employee_uid)), prop_id, work_type=work_type
            )
        if supervisor_uid:
            await allocs.employee_for_assignment(
                uuid.UUID(str(supervisor_uid)), prop_id
            )
        if location.get("zone_uid"):
            await exists(Zone, uuid.UUID(str(location["zone_uid"])), "Zone")
        if location.get("area_uid"):
            await exists(Area, uuid.UUID(str(location["area_uid"])), "Area")
        for key, model, label in (("room_uids", Room, "Room"),
                                  ("dorm_uids", Dorm, "Dorm"),
                                  ("washroom_uids", Washroom, "Washroom"),
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
        await self._check_refs(
            prop.id, data["assignment"], data["location"],
            work_type=infer_task_work_type(template_type=data["template_type"]),
        )

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
            assignment=_assign_out(data["assignment"]),
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
                work_type=infer_task_work_type(
                    template_type=data.get("template_type") or t.template_type
                ),
            )
        simple = ("name", "template_type", "description", "category",
                  "priority", "duration_minutes", "status", "assignment",
                  "schedule", "checklist", "verification", "overdue",
                  "notifications")
        for k in simple:
            if k in data:
                setattr(t, k, _assign_out(data[k]) if k == "assignment" else data[k])
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
            .options(
                selectinload(Task.history),
                selectinload(Task.completion_images),
                selectinload(Task.completion_submissions)
                .selectinload(TaskCompletionSubmission.images),
            )
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

    async def run_due(
        self,
        now: datetime | None = None,
        *,
        company_id: uuid.UUID | None = None,
        property_id: uuid.UUID | None = None,
    ) -> dict:
        """Generate work for every active template whose run is due.

        Catch-up policy: only the LATEST due occurrence is materialized —
        when the scheduler missed multiple slots (downtime), superseded
        occurrences are skipped without rows and `next_run_at` advances
        straight to the newest due slot, which then gets its full
        validity window. A restarted server never dumps a backlog of
        instantly-expired stale tasks. Previously live instances are
        still expired at their own `expires_at` by the sweep — downtime
        never extends a task's validity.

        The scheduler calls this unscoped (global tick); the API endpoint
        passes the caller's tenant scope so a manual trigger can only fire
        generation for the caller's own company/property.
        """
        now = now or datetime.now(timezone.utc)
        q = select(WorkTemplate).where(
            WorkTemplate.status == "active",
            WorkTemplate.next_run_at.is_not(None),
            WorkTemplate.next_run_at <= now,
        )
        if property_id is not None:
            q = q.where(WorkTemplate.property_id == property_id)
        elif company_id is not None:
            q = q.where(WorkTemplate.company_id == company_id)
        res = await self.session.execute(q)
        stats = {"templates": 0, "generated": 0, "skipped": 0}
        for t in res.scalars():
            stats["templates"] += 1
            # Collapse missed slots: find the LATEST due occurrence —
            # every superseded slot is skipped, none of them materialize
            # (no tasks, no ledger rows). The cursor is only advanced
            # AFTER successful generation, so a failed run retries the
            # occurrence next tick instead of losing it.
            occurrence = t.next_run_at or now
            nxt = compute_next_run(t.schedule, occurrence)
            while nxt is not None and nxt <= now:
                occurrence, nxt = nxt, compute_next_run(t.schedule, nxt)
            try:
                # Insurance for direct calls (manual API trigger) that
                # bypass the ordered tick: expire this template's own
                # due instances so a still-open predecessor can't block
                # its successor through uq_tasks_open_room_title.
                await RolloverService(self.session).expire_due(
                    now, template_id=t.id, include_windowless=True)
                created = await self._generate(
                    t, now, occurrence=occurrence)
                stats["generated"] += created
            except IntegrityError:
                logger.warning(
                    "Template %s (%s) skipped — ledger conflict", t.name, t.id
                )
                await self.session.rollback()
                stats["skipped"] += 1
                continue
            except Exception:
                logger.exception(
                    "Template %s (%s) generation failed", t.name, t.id
                )
                await self.session.rollback()
                stats["skipped"] += 1
                continue
            t.last_run_at = occurrence
            t.next_run_at = nxt
            try:
                await self.session.commit()
            except IntegrityError:
                # ledger unique hit — another worker already generated this
                await self.session.rollback()
                stats["skipped"] += 1
                stats["generated"] -= created
            except Exception:
                # Never silently swallow — a failed generation must be
                # visible in the log or the scheduler retry loop looks
                # like healthy no-op ticks.
                logger.exception(
                    "Template generation failed for %s (%s)", t.name, t.id
                )
                await self.session.rollback()
                stats["skipped"] += 1
                stats["generated"] -= created
        return stats

    async def _generate(self, t: WorkTemplate, now: datetime,
                        *, occurrence: datetime | None = None) -> int:
        occurrence = occurrence or t.next_run_at or now
        # Validity window: each instance lives until the NEXT scheduled
        # boundary (None when the schedule is exhausted — the final
        # occurrence then falls back to the daily rollover like any
        # other task). Computed from the recurrence interval, never
        # hardcoded.
        expires = compute_next_run(t.schedule, occurrence)
        cres = await self.session.execute(
            select(Company.operational_day_start)
            .where(Company.id == t.company_id)
        )
        op_key = operational_day_key(
            occurrence.astimezone(_tz(t.schedule or {})),
            parse_day_start(cres.scalar_one_or_none()),
        )
        targets = await self._expand_targets(t)
        if not targets:
            return 0
        is_maint = t.template_type == "maintenance"

        # Resolve every target's zone/area from the prefetched structure
        # snapshot — zero extra queries regardless of unit count.
        st = await self._structure(t.property_id)
        for tgt in targets:
            loc = self._snap_location(st, t.property_id, tgt)
            tgt["zone_id"] = loc.zone_id
            tgt["area_id"] = loc.area_id
            tgt["zone_name"] = loc.zone.name if loc.zone else None
            tgt["area_name"] = loc.area.name if loc.area else None
            tgt["_loc"] = loc

        # Idempotency prechecks, batched — ONE query each for the whole
        # expansion instead of one per unit:
        #  1. ledger: this occurrence already generated for the target
        #  2. uq_tasks_open_room_title: an open task already covers this
        #     (property, room, title) — skip BEFORE allocating so a covered
        #     unit doesn't burn an allocation batch or rotation slot.
        for tgt in targets:
            tgt["_occ_key"] = f"{occurrence.isoformat()}|{tgt['key']}"
        done = await self._generated_keys(
            t.id, [tg["_occ_key"] for tg in targets]
        )
        targets = [tg for tg in targets if tg["_occ_key"] not in done]
        if not targets:
            return 0
        if not is_maint:
            covered = await self._open_task_rooms(
                t, [tg["room_id"] for tg in targets if tg.get("room_id")]
            )
            targets = [
                tg for tg in targets
                if not tg.get("room_id") or tg["room_id"] not in covered
            ]
            if not targets:
                return 0

        # group by UNIT (room/dorm/bed — zone/area/property targets keep
        # their own key) → ONE allocation batch per unit per occurrence.
        # All of one room's items land on one employee; each unit advances
        # its ZONE's round-robin pointer so work distributes fairly inside
        # the zone — never into a global property pool.
        by_unit: dict = {}
        for tgt in targets:
            unit = (tgt.get("room_id") or tgt.get("dorm_id")
                    or tgt.get("washroom_id") or tgt.get("bed_id")
                    or tgt["key"])
            by_unit.setdefault((tgt["zone_id"], unit), []).append(tgt)

        logger.info(
            "Template %s occurrence %s: matched %d targets across %d units",
            t.name, occurrence.isoformat(), len(targets), len(by_unit),
        )

        from app.models.property import Property
        prop = await self.session.get(Property, t.property_id)
        a_mode = (t.assignment or {}).get("mode", "automatic")
        allocs: dict = {}
        if a_mode == "automatic":
            # ONE batched pass — each unit allocated inside its own zone's
            # pool (zone staff ∪ covering-area fallback), workload-balanced.
            allocs = await self.alloc.allocate_units(
                None,
                property_id=t.property_id,
                units=[
                    {
                        "key": ukey, "zone_id": ukey[0],
                        "zone_name": items[0].get("zone_name"),
                        "area_id": items[0].get("area_id"),
                        "area_name": items[0].get("area_name"),
                    }
                    for ukey, items in by_unit.items()
                ],
                work_type=infer_task_work_type(
                    template_type=t.template_type),
                manager_employee_id=(
                    prop.manager_employee_id if prop else None),
                company_id=t.company_id,
                actor_name="Scheduler",
            )
        people: list[Employee] | None = None
        count = 0
        for ukey, items in by_unit.items():
            alloc = None
            if a_mode in ("employees", "team", "department"):
                # people-oriented assignment — one pool per unit group,
                # no zone/area semantics
                if people is None:
                    people = await self._people_pool(t)
                alloc = await self.alloc.allocate_people(
                    None,
                    property_id=t.property_id,
                    employees=people,
                    work_type=infer_task_work_type(
                        template_type=t.template_type),
                    company_id=t.company_id,
                    actor_name="Scheduler",
                    pool_label=self._people_label(t),
                )
            elif a_mode == "automatic":
                alloc = allocs.get(ukey)
            for tgt in items:
                row = await self._generate_for_target(
                    t, tgt, occurrence, alloc=alloc, is_maint=is_maint,
                    location=tgt["_loc"], ledger_checked=True,
                    expires_at=expires, op_key=op_key,
                )
                if row is not None:
                    count += 1
        return count

    def _snap_location(self, st: dict, property_id: uuid.UUID,
                       tgt: dict):
        """resolve_task_location against the prefetched structure snapshot —
        same zone/area derivation, zero queries."""
        from app.services.task_location import TaskLocation
        room = st["by_id"]["room"].get(tgt.get("room_id"))
        dorm = st["by_id"]["dorm"].get(tgt.get("dorm_id"))
        wash = st["by_id"]["washroom"].get(tgt.get("washroom_id"))
        if dorm is None and tgt.get("bed_id"):
            bed = st["by_id"]["bed"].get(tgt["bed_id"])
            dorm = st["by_id"]["dorm"].get(bed.dorm_id) if bed else None
        zone_id = (
            room.zone_id if room is not None
            else dorm.zone_id if dorm is not None
            else wash.zone_id if wash is not None
            else tgt.get("zone_id")
        )
        zone = st["zones"].get(zone_id) if zone_id else None
        unit_area_id = (
            room.area_id if room is not None
            else dorm.area_id if dorm is not None
            else wash.area_id if wash is not None
            else tgt.get("area_id")
        )
        area_id = (
            zone.area_id if zone and zone.area_id else unit_area_id
        )
        area = st["areas"].get(area_id) if area_id else None
        return TaskLocation(
            property_id=property_id,
            area_id=area_id, zone_id=zone_id,
            room_id=room.id if room else tgt.get("room_id"),
            dorm_id=dorm.id if dorm else tgt.get("dorm_id"),
            washroom_id=wash.id if wash else tgt.get("washroom_id"),
            room=room, dorm=dorm, washroom=wash, zone=zone, area=area,
        )

    async def _generate_for_target(self, t: WorkTemplate, tgt: dict,
                                   occurrence: datetime, *,
                                   alloc=None, is_maint: bool | None = None,
                                   location=None,
                                   ledger_checked: bool = False,
                                   expires_at=None,
                                   op_key: str | None = None):
        """Generate a single work item for one target at one occurrence.

        Idempotent via the ledger — returns None when the occurrence was
        already generated. `alloc` lets the batch path share ONE allocation
        per zone; the on-demand path allocates per call. The batch path
        also passes a snapshot-resolved `location` and `ledger_checked` so
        neither is re-queried per unit."""
        from app.models.property import Property
        is_maint = (t.template_type == "maintenance"
                    if is_maint is None else is_maint)
        # Canonical occurrence key — always UTC so '...+05:30' and
        # '...+00:00' spellings of the same instant can't fork the ledger.
        if occurrence.tzinfo is None:
            occurrence = occurrence.replace(tzinfo=timezone.utc)
        occurrence = occurrence.astimezone(timezone.utc)
        key = f"{occurrence.isoformat()}|{tgt['key']}"
        if not ledger_checked and await self._already_generated(t.id, key):
            return None

        if location is None:
            from app.services.task_location import resolve_task_location
            location = await resolve_task_location(
                self.session, property_id=t.property_id,
                room_id=tgt.get("room_id"), dorm_id=tgt.get("dorm_id"),
                bed_id=tgt.get("bed_id"), washroom_id=tgt.get("washroom_id"),
                zone_id=tgt.get("zone_id"),
                area_id=tgt.get("area_id"),
            )
            tgt["zone_id"] = location.zone_id
            tgt["area_id"] = location.area_id
            tgt["zone_name"] = location.zone.name if location.zone else None

        if alloc is None and (t.assignment or {}).get("mode") in (
                "employees", "team", "department"):
            people = await self._people_pool(t)
            alloc = await self.alloc.allocate_people(
                None,
                property_id=t.property_id,
                employees=people,
                work_type=infer_task_work_type(template_type=t.template_type),
                company_id=t.company_id,
                actor_name="Scheduler",
                pool_label=self._people_label(t),
            )
        if alloc is None and t.assignment.get("mode") == "automatic":
            prop = await self.session.get(Property, t.property_id)
            alloc = await self.alloc.allocate(
                None,
                property_id=t.property_id,
                zone_id=tgt["zone_id"],
                zone_name=tgt.get("zone_name"),
                work_type=infer_task_work_type(template_type=t.template_type),
                manager_employee_id=prop.manager_employee_id if prop else None,
                company_id=t.company_id,
                actor_name="Scheduler",
                area_id=tgt.get("area_id"),
                area_name=tgt.get("zone_name") if tgt["zone_id"] is None else None,
            )

        if is_maint:
            num = await next_ticket_number(self.session, "maintenance")
            row = await self._make_ticket(t, tgt, alloc, num)
        else:
            num = await next_ticket_number(self.session, "task")
            row = await self._make_task(t, tgt, alloc, num, occurrence,
                                        expires_at=expires_at,
                                        op_key=op_key)
        # Snapshot strings BEFORE the flush — if the savepoint path fails the
        # session expires ORM attrs and a lazy reload here would re-raise.
        tname, tlabel = t.name, tgt["label"]
        try:
            # begin_nested() must run BEFORE the row is added: entering the
            # context eagerly flushes pending objects, so an add()ed row would
            # INSERT outside the savepoint and poison the outer transaction.
            async with self.session.begin_nested():  # SAVEPOINT — one dup
                self.session.add(row)
                await self.session.flush()           # can't kill the batch
        except IntegrityError:
            # uq_tasks_open_room_title race — a concurrent generation or
            # manual task claimed the same (property, room, title) slot
            # between the pre-check and this insert. Skip just this target.
            logger.info(
                "Template %s occurrence %s skipped — duplicate open task "
                "for target %s", tname, key, tlabel,
            )
            return None
        if is_maint:
            # ONE ticket-creation pipeline: a blocking maintenance ticket
            # always flags its target through the state engine — scheduler-
            # generated tickets are no exception.
            from app.services.maintenance import MaintenanceService
            await MaintenanceService(self.session).flag_ticket_resource(
                row, user=None
            )
        else:
            row._resolved_area_id = location.area_id
            occ_dt = occurrence
            if occ_dt.tzinfo is None:
                occ_dt = occ_dt.replace(tzinfo=timezone.utc)
            self.session.add(TaskHistoryEvent(
                task_id=row.id, type="auto_generated",
                actor_name="Template Scheduler",
                note=(
                    f"Generated for the "
                    f"{occ_dt.astimezone(_tz(t.schedule or {})).strftime('%Y-%m-%d %H:%M')} "
                    f"occurrence of template '{t.name}'"
                ),
            ))
        if alloc:
            self.alloc.log_task_allocation(
                alloc, task_id=row.id, room=location.room_label,
                dorm=location.dorm_label, washroom=location.washroom_label,
                zone=location.zone.name if location.zone else None,
                area=location.area.name if location.area else None,
            )
        self.session.add(TemplateGeneration(
            template_id=t.id, occurrence_key=key,
            ticket_kind="maintenance" if is_maint else "task",
            ticket_id=row.id, ticket_number=num,
            target_label=tgt["label"],
        ))
        await self.alloc.record(
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

    async def _open_task_rooms(self, t: WorkTemplate,
                               room_ids: list) -> set:
        """Batched uq_tasks_open_room_title precheck — the room ids already
        covered by an open task with this title. ONE query per run instead
        of one per unit."""
        if not room_ids:
            return set()
        res = await self.session.execute(
            select(Task.room_id)
            .where(
                Task.property_id == t.property_id,
                Task.room_id.in_(room_ids),
                Task.title == t.name,
                Task.status.notin_(("completed", "cancelled", "abandoned")),
            )
        )
        return set(res.scalars())

    async def _generated_keys(self, template_id: uuid.UUID,
                              keys: list[str]) -> set:
        """Batched ledger check — the occurrence keys already generated for
        this template. ONE query per run instead of one per target."""
        if not keys:
            return set()
        res = await self.session.execute(
            select(TemplateGeneration.occurrence_key).where(
                TemplateGeneration.template_id == template_id,
                TemplateGeneration.occurrence_key.in_(keys),
            )
        )
        return set(res.scalars())

    async def _open_task_exists(self, t: WorkTemplate, tgt: dict) -> bool:
        """An open (non-completed/cancelled) task already covers this
        (property, room, title) — generating another would violate
        uq_tasks_open_room_title. Room-scoped task items only."""
        if not tgt.get("room_id"):
            return False
        res = await self.session.execute(
            select(Task.id)
            .where(
                Task.property_id == t.property_id,
                Task.room_id == tgt["room_id"],
                Task.title == t.name,
                Task.status.notin_(("completed", "cancelled", "abandoned")),
            )
            .limit(1)
        )
        return res.scalar_one_or_none() is not None

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
        return {"individual": "template_direct", "team": "team",
                "employees": "people_pool", "department": "department_pool"
                }.get(mode, mode)

    def _people_label(self, t: WorkTemplate) -> str | None:
        a = t.assignment or {}
        mode = a.get("mode")
        if mode == "employees":
            return f"{len(a.get('employee_uids') or [])} named employees"
        if mode == "team":
            return f"team:{a.get('team')}"
        if mode == "department":
            return f"dept:{a.get('department')}"
        return None

    async def _people_pool(self, t: WorkTemplate) -> list[Employee]:
        """Resolve the people-oriented pool for employees/team/department
        assignment modes — ONE grouped query per mode, never N+1."""
        a = t.assignment or {}
        mode = a.get("mode")
        if mode == "employees":
            ids = [uuid.UUID(str(u)) for u in (a.get("employee_uids") or [])]
            if not ids:
                return []
            res = await self.session.execute(
                select(Employee).where(
                    Employee.property_id == t.property_id,
                    Employee.id.in_(ids),
                )
            )
            return list(res.scalars())
        name = a.get("team") if mode == "team" else (
            a.get("department") if mode == "department" else None)
        if not name:
            return []
        res = await self.session.execute(
            select(Employee).where(
                Employee.property_id == t.property_id,
                Employee.department.ilike(f"%{name}%"),
            )
        )
        return list(res.scalars())

    async def _direct_assignee(self, t: WorkTemplate) -> Employee | None:
        uid = (t.assignment or {}).get("employee_uid")
        if not uid:
            return None
        emp = await self.session.get(Employee, uuid.UUID(str(uid)))
        work_type = infer_task_work_type(template_type=t.template_type)
        if (
            emp is None
            or emp.property_id != t.property_id
            or not employee_is_assignable(emp)
            or not WorkAllocationService.employee_matches_work_type(
                emp, work_type
            )
        ):
            return None
        return emp

    async def _make_task(self, t, tgt, alloc, num, occurrence, *,
                         expires_at=None, op_key: str | None = None) -> Task:
        emp_id, emp_name = None, None
        status_, amethod, areason = "pending", self._assign_method(t), None
        if alloc and alloc.employee:
            emp_id, emp_name = alloc.employee.id, alloc.employee.name
            status_, amethod = "assigned", alloc.method
        elif alloc:
            areason = alloc.reason
        else:
            direct = await self._direct_assignee(t)
            if direct:
                emp_id, emp_name = direct.id, direct.name
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
            if sup and sup.property_id == t.property_id and employee_is_assignable(sup):
                sup_name = sup.name
            else:
                sup_uid = None
        return Task(
            ticket_number=num, property_id=t.property_id,
            zone_id=tgt["zone_id"], area_id=tgt.get("area_id"),
            room_id=tgt.get("room_id"),
            room_number=tgt.get("room_number"),
            dorm_id=tgt.get("dorm_id"), dorm_name=tgt.get("dorm_name"),
            bed_ids=[str(tgt["bed_id"])] if tgt.get("bed_id") else None,
            washroom_id=tgt.get("washroom_id"),
            washroom_name=tgt.get("washroom_name"),
            supervisor_id=sup_uid, supervisor_name=sup_name,
            employee_id=emp_id, assigned_to_name=emp_name,
            title=t.name, description=t.description,
            task_type="fixed", work_type=t.template_type, origin="template",
            status=status_, priority=t.priority,
            due_date=due, due_time=(t.schedule or {}).get("time"),
            start_time=(t.schedule or {}).get("start_time"),
            created_by_name="Template Scheduler",
            template_id=t.id, template_version=t.version,
            scheduled_for=occurrence, expires_at=expires_at,
            operational_date=op_key,
            allocation_batch_id=alloc.batch.id if alloc else None,
            allocation_status="auto_assigned" if emp_id else "unassigned",
            allocation_method=amethod, allocation_reason=areason,
        )

    async def _make_ticket(self, t, tgt, alloc, num) -> MaintenanceTicket:
        emp_id, emp_name = None, None
        status_, amethod, areason = "open", self._assign_method(t), None
        if alloc and alloc.employee:
            emp_id, emp_name = alloc.employee.id, alloc.employee.name
            status_, amethod = "assigned", alloc.method
        elif alloc:
            areason = alloc.reason
        else:
            direct = await self._direct_assignee(t)
            if direct:
                emp_id, emp_name = direct.id, direct.name
                status_ = "assigned"
            elif (t.assignment or {}).get("mode") == "team":
                areason = f"team:{t.assignment.get('team')}"
        return MaintenanceTicket(
            ticket_number=num, company_id=t.company_id, property_id=t.property_id,
            room_id=tgt.get("room_id"), room_number=tgt.get("room_number"),
            dorm_id=tgt.get("dorm_id"), dorm_name=tgt.get("dorm_name"),
            bed_id=tgt.get("bed_id"), bed_number=tgt.get("bed_number"),
            washroom_id=tgt.get("washroom_id"),
            washroom_name=tgt.get("washroom_name"),
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

        # A uid-scope whose uid is blank (or whose unit was deleted) widens
        # to the whole property — never emit a phantom zone/area target.
        if scope == "zone" and _uid(loc.get("zone_uid")) not in st["zones"]:
            scope = "property"
        if scope == "area" and _uid(loc.get("area_uid")) not in st["areas"]:
            scope = "property"

        # occupancy condition — ALL | OCCUPIED | UNOCCUPIED, resolved
        # against the CURRENT open-occupancy rows (rooms/beds direct;
        # dorms derive from their beds). `occupied_only` is a legacy alias.
        occupancy = loc.get("occupancy")
        if occupancy is None and loc.get("occupied_only"):
            occupancy = "occupied"
        occ_rooms = st.get("occupied_rooms") or set()
        occ_beds = st.get("occupied_beds") or set()
        occ_dorms = st.get("occupied_dorms") or set()

        def keep_room(r) -> bool:
            if occupancy == "occupied":
                return r.id in occ_rooms
            if occupancy == "unoccupied":
                return r.id not in occ_rooms
            return True

        def keep_bed(b) -> bool:
            if occupancy == "occupied":
                return b.id in occ_beds
            if occupancy == "unoccupied":
                return b.id not in occ_beds
            return True

        def keep_dorm(d) -> bool:
            if occupancy == "occupied":
                return d.id in occ_dorms
            if occupancy == "unoccupied":
                return d.id not in occ_dorms
            return True

        def zn(zid):
            z = st["zones"].get(zid)
            return z.name if z else None

        if scope == "zone":
            zid = _uid(loc.get("zone_uid"))
            target = loc.get("target") or "units"
            zname = zn(zid)
            if target == "common_area":
                # common-area work is per-zone — one task for everything
                # shared (corridors, café, pool washroom…) not per unit
                return [{"key": f"zone:{zid}", "zone_id": zid,
                         "zone_name": zname,
                         "label": f"{zname} common area" if zname
                                  else "Common area"}]
            if target in ("rooms", "units", "rooms_beds"):
                for r in st["rooms"]:
                    if r.zone_id != zid or not keep_room(r):
                        continue
                    out.append({"key": f"room:{r.id}", "zone_id": zid, "zone_name": zname,
                                "room_id": r.id, "room_number": r.room_number,
                                "label": r.room_number})
            if target in ("dorms", "units", "beds", "rooms_beds"):
                for d in st["dorms"]:
                    if d.zone_id != zid or (target == "dorms" and not keep_dorm(d)):
                        continue
                    if target == "dorms":
                        out.append({"key": f"dorm:{d.id}", "zone_id": zid,
                                    "zone_name": zname, "dorm_id": d.id,
                                    "dorm_name": d.name, "label": d.name})
                    else:
                        for b in st["dorm_beds"].get(d.id, []):
                            if not keep_bed(b):
                                continue
                            out.append({"key": f"bed:{b.id}", "zone_id": zid,
                                        "zone_name": zname, "dorm_id": d.id,
                                        "dorm_name": d.name, "bed_id": b.id,
                                        "bed_number": b.bed_number,
                                        "label": f"{d.name} · {b.bed_number}"})
            if target in ("washrooms", "units"):
                for w in st["washrooms"]:
                    if w.zone_id != zid:
                        continue
                    out.append({
                        "key": f"washroom:{w.id}", "zone_id": zid,
                        "zone_name": zname, "washroom_id": w.id,
                        "washroom_name": w.name, "label": w.name,
                    })
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

            if target == "common_area":
                for z in sorted(area_zones, key=lambda z: z.name or ""):
                    out.append({"key": f"zone:{z.id}", "zone_id": z.id,
                                "zone_name": z.name,
                                "label": f"{z.name} common area"})
                if not out:
                    a = st["areas"].get(aid)
                    out.append({"key": f"area:{aid}", "zone_id": None,
                                "area_id": aid,
                                "zone_name": a.name if a else None,
                                "label": f"{a.name} common area" if a
                                         else "Common area"})
                return out

            def in_area(u) -> bool:
                return u.area_id == aid or u.zone_id in zone_ids

            if target in ("rooms", "units", "rooms_beds"):
                for r in st["rooms"]:
                    if not in_area(r) or not keep_room(r):
                        continue
                    out.append({"key": f"room:{r.id}", "zone_id": r.zone_id,
                                "zone_name": zn(r.zone_id),
                                "room_id": r.id, "room_number": r.room_number,
                                "label": r.room_number})
            if target in ("dorms", "units", "beds", "rooms_beds"):
                for d in st["dorms"]:
                    if not in_area(d) or (target == "dorms" and not keep_dorm(d)):
                        continue
                    if target == "dorms":
                        out.append({"key": f"dorm:{d.id}", "zone_id": d.zone_id,
                                    "zone_name": zn(d.zone_id),
                                    "dorm_id": d.id, "dorm_name": d.name,
                                    "label": d.name})
                    else:
                        for b in st["dorm_beds"].get(d.id, []):
                            if not keep_bed(b):
                                continue
                            out.append({"key": f"bed:{b.id}",
                                        "zone_id": d.zone_id,
                                        "zone_name": zn(d.zone_id),
                                        "dorm_id": d.id, "dorm_name": d.name,
                                        "bed_id": b.id,
                                        "bed_number": b.bed_number,
                                        "label": f"{d.name} · {b.bed_number}"})
            if target in ("washrooms", "units"):
                for w in st["washrooms"]:
                    if not in_area(w):
                        continue
                    out.append({
                        "key": f"washroom:{w.id}", "zone_id": w.zone_id,
                        "zone_name": zn(w.zone_id), "washroom_id": w.id,
                        "washroom_name": w.name, "label": w.name,
                    })
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
                if r and keep_room(r):
                    out.append({"key": f"room:{r.id}", "zone_id": r.zone_id,
                                "zone_name": zn(r.zone_id),
                                "room_id": r.id, "room_number": r.room_number,
                                "label": r.room_number})
            return out

        if scope == "dorms":
            if loc.get("target") == "beds":
                # dorm-bed condition scoped to specific dorms — expand to
                # the beds inside them (occupancy filter applies)
                for did in loc.get("dorm_uids") or []:
                    d = st["by_id"]["dorm"].get(_uid(did))
                    if not d:
                        continue
                    for b in st["dorm_beds"].get(d.id, []):
                        if not keep_bed(b):
                            continue
                        out.append({"key": f"bed:{b.id}",
                                    "zone_id": d.zone_id,
                                    "zone_name": zn(d.zone_id),
                                    "dorm_id": d.id, "dorm_name": d.name,
                                    "bed_id": b.id, "bed_number": b.bed_number,
                                    "label": f"{d.name} · {b.bed_number}"})
                return out
            for did in loc.get("dorm_uids") or []:
                d = st["by_id"]["dorm"].get(_uid(did))
                if d and keep_dorm(d):
                    out.append({"key": f"dorm:{d.id}", "zone_id": d.zone_id,
                                "zone_name": zn(d.zone_id),
                                "dorm_id": d.id, "dorm_name": d.name,
                                "label": d.name})
            return out

        if scope == "washrooms":
            for wid in loc.get("washroom_uids") or []:
                w = st["by_id"]["washroom"].get(_uid(wid))
                if w:
                    out.append({
                        "key": f"washroom:{w.id}", "zone_id": w.zone_id,
                        "zone_name": zn(w.zone_id), "washroom_id": w.id,
                        "washroom_name": w.name, "label": w.name,
                    })
            return out

        if scope == "beds":
            for bid in loc.get("bed_uids") or []:
                b = st["by_id"]["bed"].get(_uid(bid))
                if b and keep_bed(b):
                    d = st["by_id"]["dorm"].get(b.dorm_id)
                    out.append({"key": f"bed:{b.id}",
                                "zone_id": d.zone_id if d else None,
                                "zone_name": zn(d.zone_id) if d else None,
                                "dorm_id": b.dorm_id,
                                "dorm_name": d.name if d else None,
                                "bed_id": b.id, "bed_number": b.bed_number,
                                "label": f"{d.name if d else ''} · {b.bed_number}"})
            return out

        if scope == "units":
            # explicit mixed pick — specific rooms + specific beds
            for rid in loc.get("room_uids") or []:
                r = st["by_id"]["room"].get(_uid(rid))
                if r and keep_room(r):
                    out.append({"key": f"room:{r.id}", "zone_id": r.zone_id,
                                "zone_name": zn(r.zone_id),
                                "room_id": r.id, "room_number": r.room_number,
                                "label": r.room_number})
            for bid in loc.get("bed_uids") or []:
                b = st["by_id"]["bed"].get(_uid(bid))
                if b and keep_bed(b):
                    d = st["by_id"]["dorm"].get(b.dorm_id)
                    out.append({"key": f"bed:{b.id}",
                                "zone_id": d.zone_id if d else None,
                                "zone_name": zn(d.zone_id) if d else None,
                                "dorm_id": b.dorm_id,
                                "dorm_name": d.name if d else None,
                                "bed_id": b.id, "bed_number": b.bed_number,
                                "label": f"{d.name if d else ''} · {b.bed_number}"})
            return out

        # property scope — honor an explicit `target` to expand across the
        # whole property (e.g. all occupied rooms → one task each); without
        # a target it stays a single property-level task.
        target = loc.get("target")
        if target in (None, "none") and occupancy in ("occupied", "unoccupied"):
            # Legacy condition templates saved before `target` existed —
            # an occupancy filter only makes sense over units, so expand to
            # rooms instead of collapsing into ONE property-wide task handed
            # to a single employee.
            target = "rooms"
        if target == "common_area":
            # One task per zone — the zone is the unit of common-area work.
            for z in sorted(st["zones"].values(), key=lambda z: z.name or ""):
                out.append({"key": f"zone:{z.id}", "zone_id": z.id,
                            "zone_name": z.name,
                            "label": f"{z.name} common area"})
            if not out:
                out.append({"key": f"property:{pid}", "zone_id": None,
                            "zone_name": None, "label": "Common area"})
            return out
        if target in ("rooms", "units", "rooms_beds"):
            for r in st["rooms"]:
                if not keep_room(r):
                    continue
                out.append({"key": f"room:{r.id}", "zone_id": r.zone_id,
                            "zone_name": zn(r.zone_id),
                            "room_id": r.id, "room_number": r.room_number,
                            "label": r.room_number})
        if target in ("dorms", "units", "beds", "rooms_beds"):
            for d in st["dorms"]:
                if target == "dorms" and not keep_dorm(d):
                    continue
                if target == "dorms":
                    out.append({"key": f"dorm:{d.id}", "zone_id": d.zone_id,
                                "zone_name": zn(d.zone_id),
                                "dorm_id": d.id, "dorm_name": d.name,
                                "label": d.name})
                else:
                    for b in st["dorm_beds"].get(d.id, []):
                        if not keep_bed(b):
                            continue
                        out.append({"key": f"bed:{b.id}",
                                    "zone_id": d.zone_id,
                                    "zone_name": zn(d.zone_id),
                                    "dorm_id": d.id, "dorm_name": d.name,
                                    "bed_id": b.id, "bed_number": b.bed_number,
                                    "label": f"{d.name} · {b.bed_number}"})
        if target in ("washrooms", "units"):
            for w in st["washrooms"]:
                out.append({
                    "key": f"washroom:{w.id}", "zone_id": w.zone_id,
                    "zone_name": zn(w.zone_id), "washroom_id": w.id,
                    "washroom_name": w.name, "label": w.name,
                })
        if target is not None:
            # an explicit target that expands to nothing (e.g. no occupied
            # rooms today) means no work — never fall back to a property task
            return out
        return [{"key": f"property:{pid}", "zone_id": None, "zone_name": None,
                 "label": "Entire property"}]


def _uid(v) -> uuid.UUID | None:
    return uuid.UUID(str(v)) if v else None


def _assign_out(assignment: dict) -> dict:
    """Normalize UUID objects inside the assignment dict for JSONB storage."""
    out = dict(assignment)
    for k in ("employee_uid", "supervisor_uid"):
        if out.get(k):
            out[k] = str(out[k])
    if out.get("employee_uids"):
        out["employee_uids"] = [str(u) for u in out["employee_uids"]]
    return out


def _loc_out(loc: dict) -> dict:
    """Normalize UUID objects inside the location dict for JSONB storage."""
    out = dict(loc)
    for k in ("zone_uid", "area_uid"):
        if out.get(k):
            out[k] = str(out[k])
    for k in ("room_uids", "dorm_uids", "bed_uids", "washroom_uids"):
        out[k] = [str(u) for u in (out.get(k) or [])]
    return out
