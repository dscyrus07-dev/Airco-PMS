"""TaskService — CRUD + lifecycle + repetitive-series generation."""

import uuid
from datetime import datetime, time as dtime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.employee import Employee
from app.models.structure import Room, Zone
from app.models.task import Task, TaskHistoryEvent
from app.models.user import User, UserRole
from app.schemas.structure import (
    TaskCompleteRequest,
    TaskCreateRequest,
    TaskSubmitRequest,
    TaskUpdateRequest,
)
from app.services.structure import (
    ConflictErr,
    NotFoundErr,
    StructureService,
    ValidationErr,
)

# pending=open · assigned · in_progress · submitted (awaiting review)
# reopened (was rejected) · completed · cancelled · scheduled · overdue
TASK_STATUSES = {
    "pending", "assigned", "in_progress", "submitted", "reopened",
    "completed", "cancelled", "overdue", "scheduled",
}
TASK_TYPES = {"fixed", "repetitive", "automated"}
PRIORITIES = {"low", "medium", "high", "urgent", "critical"}
HOURLY = {"hourly": 1, "every_2_hours": 2, "every_6_hours": 6, "every_12_hours": 12}
DAILY = {"daily": 1, "weekly": 7, "monthly": 30, "quarterly": 90, "yearly": 365}

# due_date / due_time are stored as local wall-clock — the create modal sends
# a date input + time input with no timezone. Occurrence math therefore runs
# in naive IST (matching the template scheduler's DEFAULT_TZ) so a stored
# "20:00" stays "20:00" on the user's clock.
IST = ZoneInfo("Asia/Kolkata")


def _local_now() -> datetime:
    return datetime.now(IST).replace(tzinfo=None)


def _d(s):
    try:
        return datetime.fromisoformat(s).date()
    except (ValueError, TypeError):
        return None


def _hm(s, fallback):
    try:
        h, m = s.split(":")[:2]
        return dtime(int(h), int(m))
    except (ValueError, TypeError, AttributeError):
        return fallback


def _due_dt(task: Task) -> datetime | None:
    """Effective due moment of a task — due_date + due_time combined.

    due_date may be a bare date ('2026-09-23') or a full ISO timestamp
    (hourly occurrences). A bare date without due_time falls back to
    end-of-day so hourly series don't restart from midnight.
    """
    if not task.due_date:
        return None
    try:
        dt = datetime.fromisoformat(task.due_date)
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(IST).replace(tzinfo=None)
    if "T" not in task.due_date:
        dt = datetime.combine(
            dt.date(), _hm(task.due_time, dtime(23, 59))
        )
    return dt


def next_occurrence(task: Task, after: datetime) -> datetime | None:
    """Smallest scheduled occurrence strictly after `after` (naive IST).

    The occurrence grid is anchored at the task's due moment and steps by
    the recurrence interval — hourly schedules honor the optional daily
    window; daily+ schedules step whole days at start_time (midnight when
    unset). Returns None once the recurrence end date is passed.
    """
    after = after.replace(tzinfo=None)
    start_d = _d(task.recurrence_start_date)
    end_d = _d(task.recurrence_end_date)  # None → runs forever
    wstart = _hm(task.start_time, dtime(8, 0))
    wend = _hm(task.recurrence_window_end, None)
    base = _due_dt(task)

    if task.recurrence in HOURLY:
        hours = HOURLY[task.recurrence]
        nxt = (base or after) + timedelta(hours=hours)
        if wend is None and nxt <= after:
            # continuous grid — jump straight to the first slot after `after`
            # instead of stepping through a long-missed chain one by one
            k = int((after - nxt).total_seconds() // (hours * 3600)) + 1
            nxt += timedelta(hours=hours * k)
        for _ in range(20000):
            if wend and nxt.time() > wend:
                # past today's window → resume tomorrow at start_time
                nxt = datetime.combine(nxt.date() + timedelta(days=1), wstart)
                continue
            if start_d and nxt.date() < start_d:
                nxt = datetime.combine(start_d, wstart)
                continue
            if end_d and nxt.date() > end_d:
                return None
            if nxt > after:
                return nxt
            nxt += timedelta(hours=hours)
        return None

    days = DAILY.get(task.recurrence) or task.recurrence_interval_days or 1
    next_d = (base.date() if base else after.date()) + timedelta(days=days)
    anchor = _hm(task.start_time, dtime(0, 0))
    for _ in range(3660):
        if start_d and next_d < start_d:
            next_d = start_d
        if end_d and next_d > end_d:
            return None
        if datetime.combine(next_d, anchor) > after:
            return datetime.combine(next_d, anchor)
        next_d += timedelta(days=days)
    return None


def _occurrence_due_string(task: Task, occ: datetime) -> str:
    """Stored due_date for an occurrence — ISO timestamp when a clock time
    is meaningful (hourly / explicit start_time), bare date otherwise."""
    if task.recurrence in HOURLY or task.start_time:
        return occ.isoformat()
    return occ.date().isoformat()


class TaskService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.structure = StructureService(session)
        from app.services.work_allocation import WorkAllocationService
        self.alloc = WorkAllocationService(session)

    async def _get_task(self, user: User, task_id: uuid.UUID) -> Task:
        res = await self.session.execute(
            select(Task)
            .where(Task.id == task_id)
            .options(selectinload(Task.history))
            .execution_options(populate_existing=True)
        )
        task = res.scalar_one_or_none()
        if task is None:
            raise NotFoundErr()
        await self.structure._property_for_write(user, task.property_id)
        return task

    def _require_assignee(self, user: User, task: Task) -> None:
        """Employees may only act on tasks assigned to them."""
        if user.role == UserRole.EMPLOYEE and task.employee_id != user.employee_id:
            from app.dependencies.auth import Forbidden

            raise Forbidden()

    async def _employee_or_none(self, employee_id, property_id):
        if employee_id is None:
            return None, None
        res = await self.session.execute(
            select(Employee).where(
                Employee.id == employee_id, Employee.property_id == property_id
            )
        )
        emp = res.scalar_one_or_none()
        if emp is None:
            raise ValidationErr("Employee not found in this property.",
                                field="employee_uid")
        return emp.id, emp.name

    async def _zone_or_none(self, zone_id, property_id):
        if zone_id is None:
            return None
        res = await self.session.execute(
            select(Zone).where(Zone.id == zone_id, Zone.property_id == property_id)
        )
        if res.scalar_one_or_none() is None:
            raise ValidationErr("Zone not found in this property.", field="zone_uid")
        return zone_id

    async def _room_or_none(self, room_id, property_id):
        if room_id is None:
            return None, None
        res = await self.session.execute(
            select(Room).where(Room.id == room_id, Room.property_id == property_id)
        )
        room = res.scalar_one_or_none()
        if room is None:
            raise ValidationErr("Room not found in this property.", field="room_uid")
        return room.id, room.room_number

    def _history(self, task, type_, user, note=None, photos=None):
        self.session.add(TaskHistoryEvent(
            task_id=task.id, type=type_, actor_name=user.name,
            note=note, photos=photos or [],
        ))

    # ------------------------------------------------------------------

    async def create_task(self, user: User, payload: TaskCreateRequest) -> Task:
        prop = await self.structure._property_for_write(user, payload.property_uid)
        if payload.task_type not in TASK_TYPES:
            raise ValidationErr("Invalid task_type.", field="task_type")
        if payload.priority and payload.priority not in PRIORITIES:
            raise ValidationErr("Invalid priority.", field="priority")
        emp_id, emp_name = await self._employee_or_none(
            payload.employee_uid, prop.id
        )
        sup_id, sup_name = await self._employee_or_none(
            payload.supervisor_uid, prop.id
        )
        zone_id = await self._zone_or_none(payload.zone_uid, prop.id)
        room_id, room_number = await self._room_or_none(payload.room_uid, prop.id)
        rule = payload.automation_rule.model_dump() if payload.automation_rule else None
        if rule and rule.get("scope_zone_uid"):
            rule["scope_zone_uid"] = str(rule["scope_zone_uid"])
        if rule and rule.get("assign_to_uid"):
            rule["assign_to_uid"] = str(rule["assign_to_uid"])

        # Zone comes from the room's CURRENT zone when a room is given —
        # the backend owns allocation, never the request payload.
        if zone_id is None and room_id:
            res = await self.session.execute(select(Room).where(Room.id == room_id))
            room = res.scalar_one()
            zone_id = room.zone_id

        # No explicit assignee → zone round-robin picks one (fixed tasks only;
        # automated/repetitive templates stay templates until triggered).
        auto_alloc = None
        if emp_id is None and payload.task_type == "fixed" and zone_id:
            zname = None
            res = await self.session.execute(select(Zone).where(Zone.id == zone_id))
            z = res.scalar_one_or_none()
            zname = z.name if z else None
            auto_alloc = await self.alloc.allocate(
                user, property_id=prop.id, zone_id=zone_id, zone_name=zname,
                work_type="task", manager_employee_id=prop.manager_employee_id,
            )
            if auto_alloc.employee:
                emp_id = auto_alloc.employee.id
                emp_name = auto_alloc.employee.name

        from app.services.maintenance import next_ticket_number

        task = Task(
            property_id=prop.id,
            ticket_number=await next_ticket_number(self.session, "task"),
            zone_id=zone_id,
            room_id=room_id,
            room_number=room_number,
            supervisor_id=sup_id,
            supervisor_name=sup_name,
            employee_id=emp_id,
            assigned_to_name=emp_name,
            title=payload.title.strip(),
            description=payload.description,
            task_type=payload.task_type,
            # automated rules are templates — scheduled until triggered;
            # a task with an assignee starts 'assigned', otherwise 'pending' (open)
            status=(
                "scheduled" if payload.task_type == "automated"
                else "assigned" if emp_id else "pending"
            ),
            priority=payload.priority or "medium",
            due_date=payload.due_date,
            due_time=payload.due_time,
            start_time=payload.start_time,
            recurrence_start_date=payload.recurrence_start_date,
            recurrence_end_date=payload.recurrence_end_date,
            recurrence_window_end=payload.recurrence_window_end,
            created_by_name=user.name,
            recurrence=payload.recurrence,
            recurrence_interval_days=payload.recurrence_interval_days,
            automation_rule=rule,
            allocation_batch_id=auto_alloc.batch.id if auto_alloc else None,
            allocation_status=(
                "auto_assigned" if auto_alloc and emp_id
                else "manually_assigned" if emp_id
                else "unassigned"
            ),
            allocation_method=(
                auto_alloc.method if auto_alloc else "manual" if emp_id else None
            ),
            allocation_reason=auto_alloc.reason if auto_alloc else None,
        )
        self.session.add(task)
        await self.session.flush()
        if task.task_type == "repetitive":
            task.series_id = task.id  # self-rooted series
        self._history(task, "allocated", user,
                      note=(f"Auto-assigned to {emp_name} (zone round-robin)"
                            if auto_alloc and emp_name
                            else f"Assigned to {emp_name}" if emp_name else "Created"))
        if emp_id or auto_alloc:
            self.alloc.record(
                property_id=prop.id, zone_id=zone_id,
                batch=auto_alloc.batch if auto_alloc else None,
                ticket_kind="task", ticket_id=task.id,
                ticket_number=task.ticket_number,
                employee_id=emp_id, employee_name=emp_name,
                method=auto_alloc.method if auto_alloc else "manual",
                reason=auto_alloc.reason if auto_alloc else None,
                actor_name=user.name,
            )
        await self.session.commit()
        return await self._get_task(user, task.id)

    async def update_task(
        self, user: User, task_id: uuid.UUID, payload: TaskUpdateRequest
    ) -> Task:
        task = await self._get_task(user, task_id)
        data = payload.model_dump(exclude_unset=True)
        if "employee_uid" in data:
            emp_id, emp_name = await self._employee_or_none(
                data.pop("employee_uid"), task.property_id
            )
            if emp_id != task.employee_id:
                prev_id, prev_name = task.employee_id, task.assigned_to_name
                task.employee_id = emp_id
                task.assigned_to_name = emp_name
                task.allocation_status = "manually_assigned" if emp_id else "unassigned"
                task.allocation_method = "reassign" if prev_id else "manual"
                task.allocation_reason = None
                self._history(task, "reassigned", user,
                              note=f"Reassigned to {emp_name or 'unassigned'}")
                # Audited — but the round-robin pointer is never touched
                self.alloc.record(
                    property_id=task.property_id, zone_id=task.zone_id, batch=None,
                    ticket_kind="task", ticket_id=task.id,
                    ticket_number=task.ticket_number,
                    employee_id=emp_id, employee_name=emp_name,
                    previous_employee_id=prev_id, previous_employee_name=prev_name,
                    method=task.allocation_method, actor_name=user.name,
                )
        if "supervisor_uid" in data:
            sup_id, sup_name = await self._employee_or_none(
                data.pop("supervisor_uid"), task.property_id
            )
            task.supervisor_id = sup_id
            task.supervisor_name = sup_name
        if "room_uid" in data:
            task.room_id, task.room_number = await self._room_or_none(
                data.pop("room_uid"), task.property_id
            )
        if "zone_uid" in data:
            task.zone_id = await self._zone_or_none(
                data.pop("zone_uid"), task.property_id
            )
        if "automation_rule" in data and data["automation_rule"]:
            rule = data["automation_rule"]
            data["automation_rule"] = {
                **rule,
                "scope_zone_uid": str(rule["scope_zone_uid"]) if rule.get("scope_zone_uid") else None,
                "assign_to_uid": str(rule["assign_to_uid"]) if rule.get("assign_to_uid") else None,
            }
        for k, v in data.items():
            setattr(task, k, v)
        self._history(task, "edited", user)
        await self.session.commit()
        return await self._get_task(user, task.id)

    async def delete_task(self, user: User, task_id: uuid.UUID) -> None:
        task = await self._get_task(user, task_id)
        await self.session.delete(task)
        await self.session.commit()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start_task(self, user: User, task_id: uuid.UUID) -> Task:
        task = await self._get_task(user, task_id)
        self._require_assignee(user, task)
        if task.status == "completed":
            raise ConflictErr("Task is already completed.")
        task.status = "in_progress"
        self._history(task, "started", user)
        await self.session.commit()
        return await self._get_task(user, task.id)

    async def complete_task(
        self, user: User, task_id: uuid.UUID, payload: TaskCompleteRequest
    ) -> dict:
        task = await self._get_task(user, task_id)
        self._require_assignee(user, task)
        if user.role == UserRole.EMPLOYEE:
            # Employee completion must pass through the review gate —
            # /submit → PENDING_CHECK → Property Manager approval.
            from app.dependencies.auth import Forbidden
            raise Forbidden(
                "Employees submit work for approval; direct completion "
                "requires a manager."
            )
        if not payload.photo_urls:
            raise ValidationErr(
                "At least one photo is required to complete a task.",
                field="photo_urls",
            )
        task.status = "completed"
        self._history(task, "completed", user, note=payload.note,
                      photos=payload.photo_urls)

        # Staff completing directly counts as supervisor acknowledgement —
        # the resource derives its status now. An employee's completion does
        # NOT release the room: a supervisor still has to approve (approve
        # accepts 'completed' tasks that still hold a blocked resource).
        if task.room_id and user.role != UserRole.EMPLOYEE:
            await self._refresh_room(task, user, "approved via complete")

        generated = None
        if task.recurrence and task.task_type == "repetitive":
            generated = await self._next_instance(user, task)
        await self.session.commit()
        result = {"task": await self._get_task(user, task.id)}
        if generated:
            result["generated_task"] = await self._get_task(user, generated.id)
        return result

    async def _next_instance(self, user: User, task: Task) -> Task | None:
        """Create the next occurrence of a repetitive task on completion.

        The occurrence is rolled forward past `now` — completing a stale
        task spawns the NEXT future slot, not an already-overdue instance.
        Returns None once the schedule is exhausted, or when the occurrence
        already exists in the series (scheduler may have spawned it first).
        """
        now = _local_now()
        base = _due_dt(task)
        occ = next_occurrence(task, max(base, now) if base else now)
        if occ is None:
            return None
        return await self._spawn_instance(
            task, _occurrence_due_string(task, occ), actor=user.name
        )

    async def _spawn_instance(
        self, task: Task, due: str, *, actor: str
    ) -> Task | None:
        """Clone `task` as the next series occurrence.

        Dedupes on (series, due) — completion and the scheduler sweep can
        race the same slot without producing two rows. Unassigned heads are
        handed to zone round-robin so generated work lands allocated.
        """
        series = task.series_id or task.id
        res = await self.session.execute(
            select(Task.id).where(
                or_(Task.series_id == series, Task.id == series),
                Task.due_date == due,
            )
        )
        if res.scalar_one_or_none() is not None:
            return None

        emp_id, emp_name = task.employee_id, task.assigned_to_name
        batch = None
        amethod = task.allocation_method
        areason = None
        if emp_id is None:
            # unassigned head → run the shared round-robin allocator so the
            # generated instance lands on an employee, not the open pool
            from app.models.property import Property
            prop = await self.session.get(Property, task.property_id)
            zname = None
            if task.zone_id:
                zn = await self.session.get(Zone, task.zone_id)
                zname = zn.name if zn else None
            alloc = await self.alloc.allocate(
                None,
                property_id=task.property_id,
                zone_id=task.zone_id,
                zone_name=zname,
                work_type="task",
                manager_employee_id=prop.manager_employee_id if prop else None,
                company_id=prop.company_id if prop else None,
                actor_name=actor,
            )
            batch = alloc.batch
            amethod, areason = alloc.method, alloc.reason
            if alloc.employee:
                emp_id, emp_name = alloc.employee.id, alloc.employee.name

        from app.services.maintenance import next_ticket_number

        new_task = Task(
            property_id=task.property_id,
            ticket_number=await next_ticket_number(self.session, "task"),
            zone_id=task.zone_id,
            room_id=task.room_id,
            room_number=task.room_number,
            supervisor_id=task.supervisor_id,
            supervisor_name=task.supervisor_name,
            employee_id=emp_id,
            assigned_to_name=emp_name,
            title=task.title,
            description=task.description,
            task_type="repetitive",
            status="assigned" if emp_id else "pending",
            priority=task.priority,
            due_date=due,
            due_time=task.due_time,
            start_time=task.start_time,
            recurrence_start_date=task.recurrence_start_date,
            recurrence_end_date=task.recurrence_end_date,
            recurrence_window_end=task.recurrence_window_end,
            created_by_name=task.created_by_name,
            recurrence=task.recurrence,
            recurrence_interval_days=task.recurrence_interval_days,
            series_id=series,
            allocation_batch_id=batch.id if batch else task.allocation_batch_id,
            allocation_status="auto_assigned" if batch and emp_id
                              else "manually_assigned" if emp_id else "unassigned",
            allocation_method=amethod,
            allocation_reason=areason,
        )
        self.session.add(new_task)
        await self.session.flush()
        self.session.add(TaskHistoryEvent(
            task_id=new_task.id, type="auto_generated",
            actor_name=task.created_by_name or actor,
            note=f"Generated from recurring task '{task.title}'",
        ))
        if emp_id or batch:
            self.alloc.record(
                property_id=task.property_id, zone_id=task.zone_id,
                batch=batch,
                ticket_kind="task", ticket_id=new_task.id,
                ticket_number=new_task.ticket_number,
                employee_id=emp_id, employee_name=emp_name,
                method=amethod or "manual", reason=areason,
                actor_name=actor,
            )
        return new_task

    async def run_due_repetitive(self, now: datetime | None = None) -> dict:
        """Advance every repetitive task series whose next slot has come due.

        Repetitive tasks recur on the clock — an unfinished instance does
        not stop the series (completion also spawns ahead, deduped via
        series_id + due). Only the LATEST missed slot is generated per
        series so a long-stalled chain doesn't dump a backlog.
        """
        now_l = (now or _local_now()).replace(tzinfo=None)
        res = await self.session.execute(
            select(Task).where(
                Task.task_type == "repetitive",
                Task.recurrence.is_not(None),
            )
        )
        series: dict[uuid.UUID, list[Task]] = {}
        for t in res.scalars():
            series.setdefault(t.series_id or t.id, []).append(t)

        stats = {"series": 0, "generated": 0}
        for members in series.values():
            head = max(members, key=lambda t: (t.due_date or "", t.created_at))
            if head.status == "cancelled":
                continue  # series deliberately stopped
            stats["series"] += 1
            anchor = _due_dt(head)
            if anchor is None:
                # no due moment at all — anchor the grid at creation time so
                # the series still ticks (first slot = created + interval)
                anchor = (head.created_at.astimezone(IST).replace(tzinfo=None)
                          if head.created_at else now_l)
            # latest occurrence slot that has come due on this series' grid
            occ = None
            o = next_occurrence(head, anchor)
            while o is not None and o <= now_l:
                occ = o
                o = next_occurrence(head, o)
            if occ is None:
                continue
            try:
                if await self._spawn_instance(
                    head, _occurrence_due_string(head, occ), actor="Scheduler"
                ):
                    stats["generated"] += 1
                await self.session.commit()
            except Exception:
                await self.session.rollback()
        return stats

    # ------------------------------------------------------------------
    # Ticket review workflow — submit / approve / reject / reopen
    # ------------------------------------------------------------------

    async def submit_task(
        self, user: User, task_id: uuid.UUID, payload: TaskSubmitRequest
    ) -> Task:
        """Employee submits work for supervisor review → 'submitted'
        (PENDING_CHECK — completion requires Property Manager approval)."""
        task = await self._get_task(user, task_id)
        self._require_assignee(user, task)
        if task.status in {"completed", "cancelled"}:
            raise ConflictErr(f"Task is already {task.status}.")

        # Evidence gate — template-generated work follows the template's
        # verification config; manual tasks mirror the UI rule (≥1 photo).
        required = 1
        if task.template_id:
            from app.models.template import WorkTemplate
            tpl = await self.session.get(WorkTemplate, task.template_id)
            v = (tpl.verification or {}) if tpl else {}
            required = v.get("min_photos", 1) if v.get("photo_required") else 0
        if len(payload.photo_urls or []) < required:
            raise ValidationErr(
                f"At least {required} completion photo"
                f"{'s are' if required > 1 else ' is'} required.",
                field="photo_urls",
            )
        task.status = "submitted"
        task.submitted_at = datetime.now(timezone.utc)
        self._history(task, "submitted", user, note=payload.note,
                      photos=payload.photo_urls)
        await self.session.commit()
        return await self._get_task(user, task.id)

    async def approve_task(self, user: User, task_id: uuid.UUID, note=None) -> dict:
        """Supervisor/manager approves a submitted task → 'completed'.

        This is the acknowledgement step — only here does the task's room
        re-derive its status (available only if no other blocking work
        remains). Employees cannot approve their own submissions.
        """
        task = await self._get_task(user, task_id)
        self._require_assignee(user, task)  # assigned employee can't self-approve
        already_completed = task.status == "completed"
        if already_completed:
            # the review already happened — only a still-blocked resource
            # (employee used /complete directly) can be acknowledged again
            res = await self.session.execute(
                select(Room.status).where(Room.id == task.room_id)
            ) if task.room_id else None
            room_status = res.scalar_one_or_none() if res else None
            if room_status not in {"cleaning", "maintenance"}:
                raise ConflictErr("Only submitted tasks can be approved.")
        elif task.status != "submitted":
            raise ConflictErr("Only submitted tasks can be approved.")
        if not already_completed:
            task.status = "completed"
            task.completed_at = datetime.now(timezone.utc)
        self._history(task, "approved", user, note=note)

        # Supervisor acknowledgement → the resource re-derives its status
        # from remaining blocking work (other tickets keep it unavailable).
        if task.room_id:
            await self._refresh_room(task, user, "supervisor approved")

        generated = None
        if not already_completed and task.recurrence \
                and task.task_type == "repetitive":
            generated = await self._next_instance(user, task)
        await self.session.commit()
        result = {"task": await self._get_task(user, task.id)}
        if generated:
            result["generated_task"] = await self._get_task(user, generated.id)
        return result

    async def reject_task(
        self, user: User, task_id: uuid.UUID, reason: str
    ) -> Task:
        """Supervisor rejects a submission → 'reopened' for the assignee."""
        task = await self._get_task(user, task_id)
        self._require_assignee(user, task)
        if task.status != "submitted":
            raise ConflictErr("Only submitted tasks can be rejected.")
        task.status = "reopened"
        task.submitted_at = None
        self._history(task, "rejected", user, note=reason)
        if task.room_id:
            await self._refresh_room(task, user, "work rejected — reopened")
        await self.session.commit()
        return await self._get_task(user, task.id)

    async def reopen_task(self, user: User, task_id: uuid.UUID, note=None) -> Task:
        """Manually reopen a completed/cancelled task."""
        task = await self._get_task(user, task_id)
        if task.status not in {"completed", "cancelled", "rejected"}:
            raise ConflictErr(f"Cannot reopen a {task.status} task.")
        task.status = "assigned" if task.employee_id else "pending"
        task.completed_at = None
        self._history(task, "reopened", user, note=note)
        if task.room_id:
            await self._refresh_room(task, user, "task reopened")
        await self.session.commit()
        return await self._get_task(user, task.id)

    async def request_redo(
        self, user: User, task_id: uuid.UUID, note: str | None
    ) -> Task:
        task = await self._get_task(user, task_id)
        self._require_assignee(user, task)
        task.status = "pending"
        self._history(task, "redo_requested", user, note=note)
        if task.room_id:
            await self._refresh_room(task, user, "redo requested")
        await self.session.commit()
        return await self._get_task(user, task.id)

    async def _refresh_room(self, task: Task, user: User, trigger: str) -> None:
        """Re-derive the task's room status via the central ops service and
        record the transition on this task's history."""
        from app.services.ops_status import OpsStatusService

        def _audit(note: str) -> None:
            task.history.append(TaskHistoryEvent(
                type="room_status_changed", actor_name=user.name, note=note,
            ))

        await OpsStatusService(self.session).refresh_room(
            task.room_id, release_to="available",
            actor_name=user.name,
            trigger=f"{trigger} ({task.ticket_number or task.title})",
            audit=_audit,
        )

    async def reassign(
        self, user: User, task_id: uuid.UUID, employee_uid: uuid.UUID | None
    ) -> Task:
        task = await self._get_task(user, task_id)
        emp_id, emp_name = await self._employee_or_none(employee_uid, task.property_id)
        task.employee_id = emp_id
        task.assigned_to_name = emp_name
        self._history(task, "reassigned", user,
                      note=f"Reassigned to {emp_name or 'unassigned'}")
        await self.session.commit()
        return await self._get_task(user, task.id)
