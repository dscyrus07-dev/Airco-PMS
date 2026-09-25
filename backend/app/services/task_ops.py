"""TaskOpsService — operational read models over the task domain.

Today's Tasks = "what work is supposed to happen today" — a union of
generated task instances AND scheduled template occurrences that haven't
been generated yet (pending_generation). Task History = only actual
generated instances. These are different queries on purpose — never
collapsed into one concept.
"""

import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.structure import Room, Zone
from app.models.task import Task
from app.models.template import TemplateGeneration, WorkTemplate
from app.models.user import User, UserRole
from app.services.structure import StructureService, ValidationErr
from app.services.template import TemplateService, compute_next_run

IST = ZoneInfo("Asia/Kolkata")


def _today_bounds(tz: ZoneInfo = IST):
    now_local = datetime.now(tz)
    day_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    return day_start.astimezone(timezone.utc), (
        day_start + timedelta(days=1)
    ).astimezone(timezone.utc), now_local.date()


class TaskOpsService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.structure = StructureService(session)
        self.templates = TemplateService(session)

    async def _property(self, user: User, property_id: uuid.UUID | None):
        """Employees/managers are pinned to their property; super admins must
        pass property_uid explicitly (property-scoped read)."""
        from app.models.property import Property
        from app.services.structure import NotFoundErr
        pid = property_id if user.role == UserRole.SUPER_ADMIN else user.property_id
        if not pid:
            raise ValidationErr("property_uid is required."
                                if user.role == UserRole.SUPER_ADMIN
                                else "User has no property.")
        prop = await self.session.get(Property, pid)
        if prop is None or (user.role == UserRole.SUPER_ADMIN
                            and prop.company_id != user.company_id):
            raise NotFoundErr("Property not found.")
        return prop

    # ------------------------------------------------------------------
    # TODAY — generated tasks + pending occurrences
    # ------------------------------------------------------------------

    async def today(self, user: User, property_id: uuid.UUID | None) -> dict:
        prop = await self._property(user, property_id)
        start_utc, end_utc, today_d = _today_bounds()
        today_iso = today_d.isoformat()
        is_employee = user.role == UserRole.EMPLOYEE

        # ---- generated tasks due today (or created today) --------------
        q = (
            select(Task)
            .where(
                Task.property_id == prop.id,
                or_(
                    Task.due_date.like(f"{today_iso}%"),
                    Task.created_at >= start_utc,
                ),
            )
        )
        if is_employee:
            q = q.where(Task.employee_id == user.employee_id)
        res = await self.session.execute(q.order_by(Task.due_date))
        tasks = list(res.unique().scalars())

        # map generated template items by occurrence key — bounded to today:
        # occurrence keys start with the ISO timestamp, so a lexical range
        # filter keeps this from scanning the entire ledger history
        lo, hi = start_utc.isoformat(), end_utc.isoformat()
        gen_by_key: dict[tuple, Task] = {}
        res = await self.session.execute(
            select(TemplateGeneration).join(
                WorkTemplate, TemplateGeneration.template_id == WorkTemplate.id
            ).where(
                WorkTemplate.property_id == prop.id,
                TemplateGeneration.occurrence_key >= lo,
                TemplateGeneration.occurrence_key < hi,
            )
        )
        ledger = {g.occurrence_key: g for g in res.scalars()}
        task_by_id = {t.id: t for t in tasks}
        # tasks generated earlier but due today are in `tasks`; also pull
        # tasks by ledger ticket_id so a task generated yesterday for today
        # still shows under its occurrence
        gen_task_ids = {g.ticket_id for g in ledger.values() if g.ticket_kind == "task"}
        missing = gen_task_ids - set(task_by_id)
        if missing:
            res = await self.session.execute(
                select(Task).where(Task.id.in_(missing))
            )
            for t in res.unique().scalars():
                task_by_id[t.id] = t
        for g in ledger.values():
            if g.ticket_id in task_by_id:
                gen_by_key[(g.template_id, g.occurrence_key)] = task_by_id[g.ticket_id]

        # ---- pending occurrences from active templates -----------------
        items: list[dict] = []
        res = await self.session.execute(
            select(WorkTemplate).where(
                WorkTemplate.property_id == prop.id,
                WorkTemplate.status == "active",
            )
        )
        active = list(res.scalars())
        for t in active:
            occurrences = self._today_occurrences(t, start_utc, end_utc)
            if not occurrences:
                continue
            targets = await self.templates._expand_targets(t)
            for occ in occurrences:
                for tgt in targets[:100]:
                    key = f"{occ.isoformat()}|{tgt['key']}"
                    gen_task = gen_by_key.get((t.id, key))
                    if is_employee and (not gen_task or
                                        gen_task.employee_id != user.employee_id):
                        continue  # employees see only their own generated work
                    items.append(self._occurrence_item(t, tgt, occ, key, gen_task))

        # ---- manual/one-time generated tasks (not from templates) ------
        for t in tasks:
            if t.template_id:
                continue  # already represented via its occurrence row
            items.append(self._task_item(t, source="manual"))

        items.sort(key=lambda x: (x["scheduled_at"] or "", x["title"]))
        return {"date": today_iso, "summary": self._summary(items), "items": items}

    def _today_occurrences(self, t: WorkTemplate,
                           start_utc: datetime, end_utc: datetime) -> list[datetime]:
        """All of a template's occurrences inside today (e.g. hourly → many)."""
        out: list[datetime] = []
        nxt = compute_next_run(t.schedule or {}, start_utc - timedelta(seconds=1))
        while nxt and nxt < end_utc and len(out) < 50:
            out.append(nxt)
            nxt = compute_next_run(t.schedule or {}, nxt)
        return out

    def _occurrence_item(self, t: WorkTemplate, tgt: dict, occ: datetime,
                         key: str, gen_task: Task | None) -> dict:
        base = {
            "occurrence_key": key,
            "template_uid": str(t.id),
            "template_name": t.name,
            "template_version": t.version,
            "title": t.name,
            "source": "template",
            "priority": t.priority,
            "scheduled_at": occ.isoformat(),
            "zone_name": tgt.get("zone_name"),
            "target_label": tgt.get("label"),
            "room_number": tgt.get("room_number"),
        }
        if gen_task is not None:
            return {**base, "item_type": "task", "generation_state": "generated",
                    **self._task_fields(gen_task)}
        return {
            **base,
            "item_type": "occurrence",
            "generation_state": "pending_generation",
            "work_status": None,
            "task_uid": None,
            "ticket_number": None,
            "assignee": None,
            "assignment_mode": (t.assignment or {}).get("mode", "automatic"),
            "allocation_method": (t.assignment or {}).get("method"),
        }

    def _task_fields(self, t: Task) -> dict:
        return {
            "task_uid": str(t.id),
            "ticket_number": t.ticket_number,
            "work_status": t.status,
            "assignee": t.assigned_to_name,
            "allocation_method": t.allocation_method,
        }

    def _task_item(self, t: Task, source: str) -> dict:
        return {
            "item_type": "task",
            "occurrence_key": None,
            "template_uid": str(t.template_id) if t.template_id else None,
            "template_name": None,
            "template_version": t.template_version,
            "title": t.title,
            "source": source,
            "priority": t.priority,
            "scheduled_at": t.due_date,
            "zone_name": None,
            "target_label": (f"Room {t.room_number}" if t.room_number
                             else t.dorm_name),
            "room_number": t.room_number or t.dorm_name,
            "generation_state": "generated",
            **self._task_fields(t),
        }

    def _summary(self, items: list[dict]) -> dict:
        s = {
            "total_planned": len(items), "generated": 0, "pending_generation": 0,
            "assigned": 0, "in_progress": 0, "completed": 0, "overdue": 0,
            "unassigned": 0,
        }
        for i in items:
            if i["generation_state"] == "generated":
                s["generated"] += 1
            else:
                s["pending_generation"] += 1
            ws = i.get("work_status")
            if ws in ("assigned",):
                s["assigned"] += 1
            elif ws == "in_progress":
                s["in_progress"] += 1
            elif ws in ("completed", "submitted"):
                s["completed"] += 1
            elif ws == "overdue":
                s["overdue"] += 1
            elif ws in ("pending", "unassigned"):
                s["unassigned"] += 1
        return s

    # ------------------------------------------------------------------
    # PENDING CHECK — employee submissions awaiting Property Manager review
    # ------------------------------------------------------------------

    async def pending_check(self, user: User, property_id: uuid.UUID | None) -> dict:
        """Tasks in 'submitted' + maintenance tickets in 'resolved' — both
        are the PENDING_CHECK state for their ticket type. Each item carries
        the submission evidence so the reviewer can decide without opening
        the full ticket."""
        from app.models.maintenance import (
            MaintenanceTicket, MaintenanceTicketAttachment,
            MaintenanceTicketEvent,
        )
        from app.models.task import TaskHistoryEvent
        from sqlalchemy.orm import selectinload

        prop = await self._property(user, property_id)

        res = await self.session.execute(
            select(Task)
            .options(selectinload(Task.history))
            .where(Task.property_id == prop.id, Task.status == "submitted")
            .order_by(Task.submitted_at)
        )
        items: list[dict] = []
        for t in res.unique().scalars():
            sub = next((e for e in reversed(t.history)
                        if e.type == "submitted"), None)
            items.append({
                "kind": "task",
                "uid": str(t.id),
                "ticket_number": t.ticket_number,
                "title": t.title,
                "priority": t.priority,
                "status": t.status,
                "room_uid": str(t.room_id) if t.room_id else None,
                "room_number": t.room_number or t.dorm_name,
                "dorm_uid": str(t.dorm_id) if t.dorm_id else None,
                "dorm_name": t.dorm_name,
                "bed_uids": list(t.bed_ids) if t.bed_ids else None,
                "employee": t.assigned_to_name,
                "submitted_at": t.submitted_at.isoformat() if t.submitted_at else None,
                "note": sub.note if sub else None,
                "photo_urls": sub.photos if sub and sub.photos else [],
            })

        res = await self.session.execute(
            select(MaintenanceTicket)
            .options(
                selectinload(MaintenanceTicket.events),
                selectinload(MaintenanceTicket.attachments),
            )
            .where(MaintenanceTicket.property_id == prop.id,
                   MaintenanceTicket.status == "resolved")
            .order_by(MaintenanceTicket.resolved_at)
        )
        for t in res.scalars():
            photos = [a.url for a in t.attachments if a.kind == "resolution"]
            items.append({
                "kind": "maintenance",
                "uid": str(t.id),
                "ticket_number": t.ticket_number,
                "title": f"{t.maintenance_type}: {t.issue}",
                "priority": t.priority,
                "status": t.status,
                "room_uid": str(t.room_id) if t.room_id else None,
                "room_number": t.room_number or t.dorm_name,
                "employee": t.assigned_to_name,
                "submitted_at": t.resolved_at.isoformat() if t.resolved_at else None,
                "note": t.resolution_notes,
                "photo_urls": photos,
            })

        items.sort(key=lambda x: x["submitted_at"] or "")
        return {"count": len(items), "items": items}

    # ------------------------------------------------------------------
    # Generate a single occurrence on demand ("Generate Now")
    # ------------------------------------------------------------------

    async def generate_occurrence(self, user: User, template_id: uuid.UUID,
                                  occurrence_key: str) -> Task:
        t = await self.templates._get_template(user, template_id)
        if t.status != "active":
            raise ValidationErr("Only active templates can generate work.")
        targets = await self.templates._expand_targets(t)
        # occurrence_key = '<iso>|<target_key>' — find the matching target
        occ_iso, _, target_key = occurrence_key.partition("|")
        tgt = next((x for x in targets if x["key"] == target_key), None)
        if tgt is None:
            raise ValidationErr("Occurrence target no longer exists.")
        try:
            occurrence = datetime.fromisoformat(occ_iso)
        except ValueError:
            raise ValidationErr("Invalid occurrence key.")

        # delegate to the shared generation path — allocates + writes ledger
        created = await self.templates._generate_for_target(t, tgt, occurrence)
        if created is None:
            raise ValidationErr("This occurrence was already generated.")
        await self.session.commit()
        # reload with history eagerly loaded for serialization
        from app.services.task import TaskService
        return await TaskService(self.session)._get_task(user, created.id)

    # ------------------------------------------------------------------
    # HISTORY — every generated task instance (not just today's)
    # ------------------------------------------------------------------

    async def history(self, user: User, *,
                      property_id: uuid.UUID | None = None,
                      date_from=None, date_to=None,
                      zone_id=None, room_id=None, employee_id=None,
                      status=None, priority=None, task_type=None,
                      source=None, template_id=None, search=None,
                      page=1, page_size=50) -> dict:
        prop = await self._property(user, property_id)
        q = (
            select(Task)
            .where(Task.property_id == prop.id)
        )
        if user.role == UserRole.EMPLOYEE:
            q = q.where(Task.employee_id == user.employee_id)
        if date_from:
            q = q.where(Task.created_at >= date_from)
        if date_to:
            q = q.where(Task.created_at < date_to + timedelta(days=1))
        if zone_id:
            q = q.where(Task.zone_id == zone_id)
        if room_id:
            q = q.where(Task.room_id == room_id)
        if employee_id:
            q = q.where(Task.employee_id == employee_id)
        if status:
            q = q.where(Task.status == status)
        if priority:
            q = q.where(Task.priority == priority)
        if task_type:
            q = q.where(Task.task_type == task_type)
        if template_id:
            q = q.where(Task.template_id == template_id)
        if source == "template":
            q = q.where(Task.template_id.is_not(None))
        elif source in ("manual", "one_time"):
            q = q.where(Task.template_id.is_(None))
        if search:
            like = f"%{search.lower()}%"
            q = q.where(or_(
                func.lower(Task.title).like(like),
                func.lower(Task.ticket_number).like(like),
                func.lower(Task.assigned_to_name).like(like),
                func.lower(Task.room_number).like(like),
            ))

        count_q = select(func.count()).select_from(q.subquery())
        total = (await self.session.execute(count_q)).scalar_one()
        res = await self.session.execute(
            q.order_by(Task.created_at.desc())
            .offset((page - 1) * page_size).limit(page_size)
        )
        tasks = list(res.unique().scalars())

        # batch-resolve zone names
        zone_ids = {t.zone_id for t in tasks if t.zone_id}
        zmap = {}
        if zone_ids:
            res = await self.session.execute(
                select(Zone).where(Zone.id.in_(zone_ids))
            )
            zmap = {z.id: z.name for z in res.scalars()}

        items = [{
            "task_uid": str(t.id),
            "ticket_number": t.ticket_number,
            "title": t.title,
            "task_type": t.task_type,
            "room_number": t.room_number or t.dorm_name,
            "zone_name": zmap.get(t.zone_id),
            "assigned_to": t.assigned_to_name,
            "generated_at": t.created_at.isoformat() if t.created_at else None,
            "scheduled_for": t.due_date,
            "status": t.status,
            "priority": t.priority,
            "source": "template" if t.template_id else ("recurring" if t.recurrence else "manual"),
            "template_uid": str(t.template_id) if t.template_id else None,
            "template_version": t.template_version,
            "allocation_method": t.allocation_method,
        } for t in tasks]
        return {
            "items": items,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": max(1, (total + page_size - 1) // page_size),
            },
        }
