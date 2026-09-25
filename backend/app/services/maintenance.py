"""MaintenanceService — ticket lifecycle with room-status side effects.

Rules:
  create  → ticket OPEN + room.status='maintenance' in ONE transaction
  assign  → ASSIGNED, records event
  start   → IN_PROGRESS, records event
  resolve → RESOLVED + notes/photos — the resource stays blocked until
            the supervisor acknowledges (close)
  close   → CLOSED + resource → 'available' when nothing else blocks it
  cancel  → CANCELLED + room → 'available' (nothing happened)

Every transition appends a MaintenanceTicketEvent — the timeline is the
permanent record; the room status is derived state.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.employee import Employee
from app.models.maintenance import (
    MaintenanceTicket,
    MaintenanceTicketAttachment,
    MaintenanceTicketEvent,
)
from app.models.structure import Bed, Dorm, Room
from app.models.user import User, UserRole
from app.services.work_allocation import AllocationResult, WorkAllocationService
from app.schemas.maintenance import (
    MaintenanceCreateRequest,
    MaintenanceResolveRequest,
    MaintenanceUpdateRequest,
)
from app.services.structure import (
    ConflictErr,
    NotFoundErr,
    StructureService,
    ValidationErr,
)

ACTIVE_STATUSES = {"open", "assigned", "in_progress", "on_hold"}
PRIORITIES = {"low", "medium", "high", "critical"}


async def next_ticket_number(session: AsyncSession, kind: str) -> str:
    """Server-side ticket number via a PostgreSQL sequence.

    kind='maintenance' → MT-YYYY-NNNNN · kind='task' → TASK-YYYY-NNNNN
    SQLite (tests) falls back to a max-scan since sequences don't exist.
    """
    seq = "maintenance_ticket_seq" if kind == "maintenance" else "task_ticket_seq"
    prefix = "MT" if kind == "maintenance" else "TASK"
    year = datetime.now(timezone.utc).year
    try:
        res = await session.execute(text(f"SELECT nextval('{seq}')"))
        n = int(res.scalar_one())
    except Exception:
        from app.models.task import Task

        model = MaintenanceTicket if kind == "maintenance" else Task
        res = await session.execute(select(func.count()).select_from(model))
        n = int(res.scalar_one()) + 1
    return f"{prefix}-{year}-{n:05d}"


class MaintenanceService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.structure = StructureService(session)
        self.alloc = WorkAllocationService(session)

    # ------------------------------------------------------------------
    # Fetch helpers
    # ------------------------------------------------------------------

    async def _get_ticket(self, user: User, ticket_id: uuid.UUID) -> MaintenanceTicket:
        res = await self.session.execute(
            select(MaintenanceTicket)
            .where(MaintenanceTicket.id == ticket_id)
            .options(
                selectinload(MaintenanceTicket.events),
                selectinload(MaintenanceTicket.attachments),
            )
        )
        ticket = res.scalar_one_or_none()
        if ticket is None:
            raise NotFoundErr("Maintenance ticket not found.")
        await self.structure._property_for_write(user, ticket.property_id)
        return ticket

    def _event(self, ticket, action, user, comment=None):
        ev = MaintenanceTicketEvent(
            ticket_id=ticket.id, action=action,
            actor_name=user.name, comment=comment,
        )
        self.session.add(ev)
        # also populate the in-memory collection when it's already loaded —
        # fresh batch tickets serialize their timeline without a reload,
        # but never force a lazy load on unfetched relationships
        from sqlalchemy import inspect as sa_inspect
        if "events" not in sa_inspect(ticket).unloaded:
            ticket.events.append(ev)

    # ------------------------------------------------------------------
    # Create — ticket + room status in ONE transaction
    # ------------------------------------------------------------------

    async def _resolve_target(self, prop, payload: MaintenanceCreateRequest):
        """Validate + load the target. Returns (room, dorm, bed) — one is set."""
        targets = [t for t in (payload.room_uid, payload.dorm_uid, payload.bed_uid) if t]
        if len(targets) != 1:
            raise ValidationErr(
                "Provide exactly one of room_uid, dorm_uid or bed_uid.",
                field="room_uid",
            )
        room = dorm = bed = None
        if payload.room_uid:
            res = await self.session.execute(
                select(Room).where(
                    Room.id == payload.room_uid, Room.property_id == prop.id
                )
            )
            room = res.scalar_one_or_none()
            if room is None:
                raise ValidationErr("Room not found in this property.", field="room_uid")
        elif payload.dorm_uid:
            res = await self.session.execute(
                select(Dorm)
                .options(selectinload(Dorm.beds))
                .where(Dorm.id == payload.dorm_uid, Dorm.property_id == prop.id)
            )
            dorm = res.scalar_one_or_none()
            if dorm is None:
                raise ValidationErr("Dorm not found in this property.", field="dorm_uid")
        else:
            res = await self.session.execute(
                select(Bed).where(Bed.id == payload.bed_uid)
            )
            bed = res.scalar_one_or_none()
            if bed is None or bed.property_id != prop.id:
                raise ValidationErr("Bed not found in this property.", field="bed_uid")
            res = await self.session.execute(
                select(Dorm).options(selectinload(Dorm.beds)).where(Dorm.id == bed.dorm_id)
            )
            dorm = res.scalar_one_or_none()
        return room, dorm, bed

    async def create_ticket(
        self, user: User, payload: MaintenanceCreateRequest,
        allocation: AllocationResult | None = None, commit: bool = True,
    ) -> MaintenanceTicket:
        prop = await self.structure._property_for_write(user, payload.property_uid)
        room, dorm, bed = await self._resolve_target(prop, payload)

        if payload.priority not in PRIORITIES:
            raise ValidationErr("Invalid priority.", field="priority")

        # Zone resolved from the DATABASE at creation time — never trusted
        # from the request. Work-batches pass a shared `allocation` so every
        # ticket in the batch lands on the same employee.
        zone_id = (room.zone_id if room else dorm.zone_id) if (room or dorm) else None
        if allocation is None:
            from app.models.structure import Zone
            zname = None
            if zone_id:
                res = await self.session.execute(select(Zone).where(Zone.id == zone_id))
                z = res.scalar_one_or_none()
                zname = z.name if z else None
            allocation = await self.alloc.allocate(
                user,
                property_id=prop.id,
                zone_id=zone_id,
                zone_name=zname,
                work_type="maintenance",
                manager_employee_id=prop.manager_employee_id,
            )
        emp = allocation.employee

        ticket = MaintenanceTicket(
            ticket_number=await next_ticket_number(self.session, "maintenance"),
            company_id=prop.company_id,
            property_id=prop.id,
            room_id=room.id if room else None,
            room_number=room.room_number if room else None,
            dorm_id=dorm.id if dorm else None,
            dorm_name=dorm.name if dorm else None,
            bed_id=bed.id if bed else None,
            bed_number=bed.bed_number if bed else None,
            reported_by=user.id,
            reported_by_name=user.name,
            assigned_to=emp.id if emp else None,
            assigned_to_name=emp.name if emp else None,
            status="assigned" if emp else "open",
            zone_id=zone_id,
            allocation_batch_id=allocation.batch.id,
            allocation_status=allocation.batch.allocation_status,
            allocation_method=allocation.method,
            allocation_reason=allocation.reason,
            maintenance_type=payload.maintenance_type.strip().lower(),
            issue=payload.issue.strip(),
            description=(payload.description or "").strip() or None,
            priority=payload.priority,
            due_date=payload.due_date,
        )
        self.session.add(ticket)
        await self.session.flush()  # ticket.id available for children
        # mark the collections loaded-empty so ticket_out() can serialize a
        # fresh ticket without triggering async lazy loads (plain assignment
        # would emit a SELECT for delete-orphan bookkeeping)
        from sqlalchemy.orm import attributes as orm_attrs
        orm_attrs.set_committed_value(ticket, "events", [])
        orm_attrs.set_committed_value(ticket, "attachments", [])

        for url in payload.attachment_urls:
            ticket.attachments.append(MaintenanceTicketAttachment(
                ticket_id=ticket.id, url=url, kind="issue",
                file_name=url.rsplit("/", 1)[-1],
                uploaded_by_name=user.name,
            ))
        self._event(ticket, "created", user,
                    comment=f"{ticket.maintenance_type}: {ticket.issue}")
        if emp:
            self._event(ticket, "assigned", user,
                        comment=f"Auto-assigned to {emp.name} (zone round-robin)")
        self.alloc.record(
            property_id=prop.id, zone_id=zone_id, batch=allocation.batch,
            ticket_kind="maintenance", ticket_id=ticket.id,
            ticket_number=ticket.ticket_number,
            employee_id=emp.id if emp else None,
            employee_name=emp.name if emp else None,
            method=allocation.method, reason=allocation.reason,
            actor_name=user.name,
        )
        # populate server_default timestamps (events' created_at) so
        # commit=False callers serialize real times, not nulls
        await self.session.flush()

        # Flag the target — same transaction, both or neither
        if room is not None:
            room.status = "maintenance"
        elif bed is not None:
            bed.status = "maintenance"
        else:
            dorm.status = "maintenance"
            for b in dorm.beds:
                # occupied beds keep their guest; inactive bunks are retired
                # inventory — a dorm ticket doesn't resurrect them
                if b.status not in ("occupied", "inactive"):
                    b.status = "maintenance"
        if commit:
            await self.session.commit()
            return await self._get_ticket(user, ticket.id)
        return ticket

    # ------------------------------------------------------------------
    # List / get
    # ------------------------------------------------------------------

    async def list_tickets(
        self, user: User, *, property_id=None, room_id=None,
        status_=None, priority=None, assigned_to=None, search=None,
    ) -> list[MaintenanceTicket]:
        q = (
            select(MaintenanceTicket)
            .options(
                selectinload(MaintenanceTicket.events),
                selectinload(MaintenanceTicket.attachments),
            )
            .order_by(MaintenanceTicket.created_at.desc())
        )
        if user.role == UserRole.SUPER_ADMIN:
            q = q.where(MaintenanceTicket.company_id == user.company_id)
            if property_id:
                q = q.where(MaintenanceTicket.property_id == property_id)
        else:
            if not user.property_id:
                return []
            q = q.where(MaintenanceTicket.property_id == user.property_id)
            if user.role == UserRole.EMPLOYEE:
                # Employees only see tickets assigned to them (mirrors list_tasks)
                if not user.employee_id:
                    return []
                q = q.where(MaintenanceTicket.assigned_to == user.employee_id)
        if room_id:
            q = q.where(MaintenanceTicket.room_id == room_id)
        if status_:
            q = q.where(MaintenanceTicket.status == status_)
        if priority:
            q = q.where(MaintenanceTicket.priority == priority)
        if assigned_to:
            q = q.where(MaintenanceTicket.assigned_to == assigned_to)
        if search:
            like = f"%{search}%"
            q = q.where(
                MaintenanceTicket.ticket_number.ilike(like)
                | MaintenanceTicket.issue.ilike(like)
                | MaintenanceTicket.room_number.ilike(like)
            )
        res = await self.session.execute(q)
        return list(res.scalars())

    async def get_ticket(self, user: User, ticket_id: uuid.UUID):
        return await self._get_ticket(user, ticket_id)

    async def room_history(self, user: User, room_id: uuid.UUID):
        res = await self.session.execute(select(Room).where(Room.id == room_id))
        room = res.scalar_one_or_none()
        if room is None:
            raise NotFoundErr("Room not found.")
        await self.structure._property_for_write(user, room.property_id)
        res = await self.session.execute(
            select(MaintenanceTicket)
            .where(MaintenanceTicket.room_id == room_id)
            .options(
                selectinload(MaintenanceTicket.events),
                selectinload(MaintenanceTicket.attachments),
            )
            .order_by(MaintenanceTicket.created_at.desc())
        )
        return list(res.scalars())

    async def active_ticket_for_room(self, user: User, room_id: uuid.UUID):
        res = await self.session.execute(
            select(MaintenanceTicket)
            .where(
                MaintenanceTicket.room_id == room_id,
                MaintenanceTicket.status.in_(ACTIVE_STATUSES),
            )
            .options(
                selectinload(MaintenanceTicket.events),
                selectinload(MaintenanceTicket.attachments),
            )
            .order_by(MaintenanceTicket.created_at.desc())
            .limit(1)
        )
        return res.scalar_one_or_none()

    # ------------------------------------------------------------------
    # Update (fields) + status transitions
    # ------------------------------------------------------------------

    async def update_ticket(
        self, user: User, ticket_id: uuid.UUID, payload: MaintenanceUpdateRequest
    ) -> MaintenanceTicket:
        ticket = await self._get_ticket(user, ticket_id)
        if ticket.status in {"closed", "cancelled"}:
            raise ConflictErr("Closed or cancelled tickets cannot be edited.")

        data = payload.model_dump(exclude_unset=True)
        if "assigned_to" in data:
            emp_uid = data.pop("assigned_to")
            await self._assign_employee(user, ticket, emp_uid)
        if "priority" in data and data["priority"] not in PRIORITIES:
            raise ValidationErr("Invalid priority.", field="priority")

        new_status = data.pop("status", None)
        if new_status == "cancelled":
            ticket.status = "cancelled"
            self._event(ticket, "cancelled", user)
            await self._refresh_target(user, ticket, release_to="available")
        elif new_status is not None:
            raise ValidationErr(
                "Use the dedicated action endpoints to change ticket status.",
                field="status",
            )

        for k, v in data.items():
            setattr(ticket, k, v)
        self._event(ticket, "edited", user)
        await self.session.commit()
        return await self._get_ticket(user, ticket.id)

    # ------------------------------------------------------------------
    # Workflow actions
    # ------------------------------------------------------------------

    async def _assign_employee(self, user, ticket, employee_uid):
        # Manual reassignment — audited, but never touches the round-robin
        # pointer (manual overrides don't corrupt the sequence).
        prev_id, prev_name = ticket.assigned_to, ticket.assigned_to_name
        if employee_uid is None:
            ticket.assigned_to = None
            ticket.assigned_to_name = None
            ticket.status = "open"
            ticket.allocation_status = "unassigned"
            ticket.allocation_method = "manual"
            self._event(ticket, "assigned", user, comment="Unassigned")
            self.alloc.record(
                property_id=ticket.property_id, zone_id=ticket.zone_id, batch=None,
                ticket_kind="maintenance", ticket_id=ticket.id,
                ticket_number=ticket.ticket_number,
                employee_id=None, employee_name=None,
                previous_employee_id=prev_id, previous_employee_name=prev_name,
                method="manual", reason="unassigned", actor_name=user.name,
            )
            return
        res = await self.session.execute(
            select(Employee).where(
                Employee.id == employee_uid,
                Employee.property_id == ticket.property_id,
            )
        )
        emp = res.scalar_one_or_none()
        if emp is None:
            raise ValidationErr(
                "Employee not found in this property.", field="employee_uid"
            )
        ticket.assigned_to = emp.id
        ticket.assigned_to_name = emp.name
        ticket.status = "assigned"
        ticket.allocation_status = "manually_assigned"
        ticket.allocation_method = "reassign" if prev_id else "manual"
        ticket.allocation_reason = None
        self._event(ticket, "assigned", user, comment=f"Assigned to {emp.name}")
        self.alloc.record(
            property_id=ticket.property_id, zone_id=ticket.zone_id, batch=None,
            ticket_kind="maintenance", ticket_id=ticket.id,
            ticket_number=ticket.ticket_number,
            employee_id=emp.id, employee_name=emp.name,
            previous_employee_id=prev_id, previous_employee_name=prev_name,
            method=ticket.allocation_method, actor_name=user.name,
        )

    async def assign(self, user: User, ticket_id: uuid.UUID, employee_uid):
        ticket = await self._get_ticket(user, ticket_id)
        if ticket.status in {"resolved", "closed", "cancelled"}:
            raise ConflictErr(f"Cannot assign a {ticket.status} ticket.")
        await self._assign_employee(user, ticket, employee_uid)
        await self.session.commit()
        return await self._get_ticket(user, ticket.id)

    async def start(self, user: User, ticket_id: uuid.UUID):
        ticket = await self._get_ticket(user, ticket_id)
        if ticket.status not in {"open", "assigned", "on_hold"}:
            raise ConflictErr(f"Cannot start work on a {ticket.status} ticket.")
        ticket.status = "in_progress"
        self._event(ticket, "started", user)
        await self.session.commit()
        return await self._get_ticket(user, ticket.id)

    async def hold(self, user: User, ticket_id: uuid.UUID, note=None):
        ticket = await self._get_ticket(user, ticket_id)
        if ticket.status not in {"open", "assigned", "in_progress"}:
            raise ConflictErr(f"Cannot put a {ticket.status} ticket on hold.")
        ticket.status = "on_hold"
        self._event(ticket, "held", user, comment=note)
        await self.session.commit()
        return await self._get_ticket(user, ticket.id)

    async def _refresh_target(self, user, ticket, *, release_to: str):
        """Supervisor acknowledgement → re-derive the ticket's target status
        via the central ops service. Other blocking work on the same target
        keeps it unavailable; the transition is audited on this ticket."""
        from app.services.ops_status import OpsStatusService
        ops = OpsStatusService(self.session)

        def _audit(note: str) -> None:
            self._event(ticket, "room_status_changed", user, comment=note)

        trigger = f"maintenance {ticket.status} ({ticket.ticket_number})"
        await ops.refresh_room(
            ticket.room_id, release_to=release_to,
            actor_name=user.name, trigger=trigger, audit=_audit)
        await ops.refresh_bed(
            ticket.bed_id, release_to=release_to,
            actor_name=user.name, trigger=trigger, audit=_audit)
        await ops.refresh_dorm(
            ticket.dorm_id, release_to=release_to,
            actor_name=user.name, trigger=trigger, audit=_audit)

    async def resolve(
        self, user: User, ticket_id: uuid.UUID, payload: MaintenanceResolveRequest
    ) -> MaintenanceTicket:
        ticket = await self._get_ticket(user, ticket_id)
        if ticket.status in {"resolved", "closed", "cancelled"}:
            raise ConflictErr(f"Ticket is already {ticket.status}.")
        # Evidence gate — template-generated tickets follow the template's
        # verification config; manual tickets keep notes-only resolution.
        if ticket.template_id:
            from app.models.template import WorkTemplate
            tpl = await self.session.get(WorkTemplate, ticket.template_id)
            v = (tpl.verification or {}) if tpl else {}
            required = v.get("min_photos", 1) if v.get("photo_required") else 0
            if len(payload.photo_urls or []) < required:
                raise ValidationErr(
                    f"At least {required} resolution photo"
                    f"{'s are' if required > 1 else ' is'} required.",
                    field="photo_urls",
                )
        ticket.status = "resolved"
        ticket.resolved_at = datetime.now(timezone.utc)
        ticket.resolution_notes = payload.resolution_notes.strip()
        for url in payload.photo_urls:
            self.session.add(MaintenanceTicketAttachment(
                ticket_id=ticket.id, url=url, kind="resolution",
                file_name=url.rsplit("/", 1)[-1],
                uploaded_by_name=user.name,
            ))
        self._event(ticket, "resolved", user, comment=payload.resolution_notes.strip())
        # Employee completion does NOT release the resource — a "resolved"
        # ticket still blocks until the supervisor closes (acknowledges) it.
        await self.session.commit()
        return await self._get_ticket(user, ticket.id)

    async def disapprove(self, user: User, ticket_id: uuid.UUID, reason: str):
        """Property Manager disapproves a submitted resolution — returns the
        ticket to the employee for rework. The ticket stays blocking."""
        ticket = await self._get_ticket(user, ticket_id)
        if ticket.status != "resolved":
            raise ConflictErr(
                "Only resolved (pending-check) tickets can be disapproved."
            )
        ticket.status = "in_progress"
        ticket.resolved_at = None
        self._event(ticket, "disapproved", user, comment=reason)
        await self.session.commit()
        return await self._get_ticket(user, ticket.id)

    async def close(self, user: User, ticket_id: uuid.UUID):
        ticket = await self._get_ticket(user, ticket_id)
        if ticket.status == "closed":
            return ticket
        if ticket.status != "resolved":
            raise ConflictErr("Only resolved tickets can be closed.")
        ticket.status = "closed"
        ticket.closed_at = datetime.now(timezone.utc)
        self._event(ticket, "closed", user)
        # Supervisor acknowledgement — derive the target's status from any
        # remaining blocking work; a free target goes straight back to
        # 'available' once the PM approves the work.
        await self._refresh_target(user, ticket, release_to="available")
        await self.session.commit()
        return await self._get_ticket(user, ticket.id)
