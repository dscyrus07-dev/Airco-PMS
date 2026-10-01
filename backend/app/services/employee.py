"""EmployeeService — staff records, login credentials, zone allocation."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, slugify_username
from app.models.allocation import AllocationEvent
from app.models.employee import (
    EMPLOYEE_STATUS_ACTIVE,
    EMPLOYEE_STATUS_DEACTIVATED,
    Employee,
    employee_is_assignable,
)
from app.models.maintenance import MaintenanceTicket, MaintenanceTicketEvent
from app.models.property import Property
from app.models.structure import Zone
from app.models.task import Task, TaskHistoryEvent
from app.models.user import User, UserRole
from app.models.work_allocation import WorkAllocationBatch
from app.repositories.user import UserRepository
from app.schemas.structure import (
    EmployeeCreateRequest,
    EmployeeUpdateRequest,
)
from app.services.audit import AuditService
from app.services.auth import EmailAlreadyExists, UsernameTaken
from app.services.structure import ConflictErr, NotFoundErr, StructureService, ValidationErr

AVATAR_COLORS = ["#386641", "#6A994E", "#A7C957", "#BC4749", "#8C867C", "#4A6FA5"]


class EmployeeService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.users = UserRepository(session)
        self.structure = StructureService(session)
        self.audit = AuditService(session)

    async def _get_employee(self, user: User, employee_id: uuid.UUID) -> Employee:
        res = await self.session.execute(
            select(Employee).where(Employee.id == employee_id)
        )
        emp = res.scalar_one_or_none()
        if emp is None:
            raise NotFoundErr()
        await self.structure._property_for_write(user, emp.property_id)
        return emp

    async def _zone_or_none(self, zone_id, property_id):
        if zone_id is None:
            return None
        res = await self.session.execute(
            select(Zone).where(Zone.id == zone_id, Zone.property_id == property_id)
        )
        if res.scalar_one_or_none() is None:
            raise ValidationErr("Zone not found in this property.", field="zone_uid")
        return zone_id

    async def _area_or_none(self, area_id, property_id):
        if area_id is None:
            return None
        from app.models.structure import Area
        res = await self.session.execute(
            select(Area).where(Area.id == area_id, Area.property_id == property_id)
        )
        if res.scalar_one_or_none() is None:
            raise ValidationErr("Area not found in this property.", field="area_uid")
        return area_id

    async def _unique_username(self, seed: str) -> str:
        base = slugify_username(seed)
        candidate, n = base, 1
        while await self.users.username_exists(candidate):
            n += 1
            candidate = f"{base}.{n}"
        return candidate

    async def create_employee(self, user: User, payload: EmployeeCreateRequest) -> Employee:
        prop = await self.structure._property_for_write(user, payload.property_uid)
        zone_id = await self._zone_or_none(payload.zone_uid, prop.id)

        email = payload.email.strip().lower()
        if await self.users.get_by_email(email):
            raise EmailAlreadyExists(field="email")
        if payload.username:
            username = payload.username.strip().lower()
            if await self.users.username_exists(username):
                raise UsernameTaken(field="username")
        else:
            seed = payload.name.strip() or email.split("@")[0]
            username = await self._unique_username(seed)

        res = await self.session.execute(select(func.count(Employee.id)))
        avatar = AVATAR_COLORS[(res.scalar() or 0) % len(AVATAR_COLORS)]

        try:
            emp = Employee(
                company_id=prop.company_id,
                property_id=prop.id,
                zone_id=zone_id,
                name=payload.name.strip(),
                email=email,
                phone=payload.phone,
                username=username,
                job_title=payload.job_title.strip(),
                department=payload.department,
                salary=payload.salary,
                shift=payload.shift,
                start_date=payload.start_date,
                avatar_color=avatar,
                status="Active",
            )
            self.session.add(emp)
            await self.session.flush()

            await self.users.create(
                company_id=prop.company_id,
                name=emp.name,
                email=email,
                username=username,
                password_hash=hash_password(payload.password),
                phone_number=payload.phone,
                role=UserRole.EMPLOYEE,
                property_id=prop.id,
                employee_id=emp.id,
                zone_id=zone_id,
                job_title=emp.job_title,
            )
            if zone_id:
                self.session.add(AllocationEvent(
                    entity_type="employee", entity_id=emp.id, property_id=prop.id,
                    to_zone_id=zone_id, actor_user_id=user.id, actor_name=user.name,
                ))
            self.audit.record(
                user, entity_type="employee", entity_id=emp.id,
                entity_name=emp.name, action="employee_created",
                property_id=prop.id,
                detail={"department": emp.department, "job_title": emp.job_title},
            )
            await self.session.commit()
            return emp
        except IntegrityError as exc:
            await self.session.rollback()
            msg = str(exc.orig).lower() if exc.orig else ""
            if "username" in msg:
                raise UsernameTaken(field="username") from exc
            raise EmailAlreadyExists(field="email") from exc

    async def update_employee(
        self, user: User, employee_id: uuid.UUID, payload: EmployeeUpdateRequest
    ) -> Employee:
        emp = await self._get_employee(user, employee_id)
        data = payload.model_dump(exclude_unset=True)
        if "status" in data:
            raise ValidationErr(
                "Use the deactivate or reactivate endpoint to change staff status.",
                field="status",
            )
        if "zone_uid" in data:
            await self.assign_zone(user, employee_id, data.pop("zone_uid"))
            await self.session.refresh(emp)
        if "email" in data and data["email"]:
            data["email"] = data["email"].strip().lower()
            existing = await self.users.get_by_email(data["email"])
            if existing and existing.employee_id != emp.id:
                raise EmailAlreadyExists(field="email")
        for k, v in data.items():
            setattr(emp, k, v)
        self.audit.record(
            user, entity_type="employee", entity_id=emp.id,
            entity_name=emp.name, action="employee_updated",
            property_id=emp.property_id,
            detail={"fields": sorted(data)},
        )
        await self.session.commit()
        return emp

    async def assign_zone(
        self, user: User, employee_id: uuid.UUID, zone_uid: uuid.UUID | None
    ) -> Employee:
        return await self.assign(user, employee_id, zone_uid=zone_uid)

    async def assign(
        self, user: User, employee_id: uuid.UUID, *,
        zone_uid: uuid.UUID | None = None,
        area_uid: uuid.UUID | None = None,
    ) -> Employee:
        """Assign an employee to a zone, to a whole area, or to neither.

        Area and zone assignment are mutually exclusive — an area assignee
        is eligible for work in every zone inside that area.
        """
        emp = await self._get_employee(user, employee_id)
        if (zone_uid is not None or area_uid is not None) and not employee_is_assignable(emp):
            raise ValidationErr(
                "Inactive or deactivated staff cannot be assigned to a zone or area.",
                field="employee_uid",
            )
        if area_uid is not None:
            area_id = await self._area_or_none(area_uid, emp.property_id)
            zone_id = None
        else:
            area_id = None
            zone_id = await self._zone_or_none(zone_uid, emp.property_id)
        if emp.zone_id == zone_id and emp.area_id == area_id:
            return emp
        from_zone, from_area = emp.zone_id, emp.area_id
        emp.zone_id, emp.area_id = zone_id, area_id
        # keep the linked login account in sync
        res = await self.session.execute(
            select(User).where(User.employee_id == emp.id)
        )
        for u in res.scalars():
            u.zone_id = zone_id
        self.session.add(AllocationEvent(
            entity_type="employee", entity_id=emp.id, property_id=emp.property_id,
            from_zone_id=from_zone, to_zone_id=zone_id,
            from_area_id=from_area, to_area_id=area_id,
            actor_user_id=user.id, actor_name=user.name,
        ))
        self.audit.record(
            user, entity_type="employee", entity_id=emp.id,
            entity_name=emp.name, action="employee_assignment_changed",
            property_id=emp.property_id,
            detail={
                "from_zone_id": str(from_zone) if from_zone else None,
                "to_zone_id": str(zone_id) if zone_id else None,
                "from_area_id": str(from_area) if from_area else None,
                "to_area_id": str(area_id) if area_id else None,
            },
        )
        await self.session.commit()
        return emp

    async def _linked_users(self, employee_id: uuid.UUID) -> list[User]:
        res = await self.session.execute(
            select(User).where(User.employee_id == employee_id)
        )
        return list(res.scalars())

    async def deactivate(self, user: User, employee_id: uuid.UUID) -> Employee:
        """Pause the staff account without deleting employment/work history."""
        emp = await self._get_employee(user, employee_id)
        if emp.status.lower() != "deactivated":
            emp.status = EMPLOYEE_STATUS_DEACTIVATED
            emp.deactivated_at = datetime.now(timezone.utc)
            emp.reactivated_at = None
            for linked in await self._linked_users(emp.id):
                linked.is_active = False
            self.audit.record(
                user, entity_type="employee", entity_id=emp.id,
                entity_name=emp.name, action="employee_deactivated",
                property_id=emp.property_id,
            )
            await self.session.commit()
        return emp

    async def reactivate(self, user: User, employee_id: uuid.UUID) -> Employee:
        """Restore eligibility without auto-restoring a zone or task."""
        emp = await self._get_employee(user, employee_id)
        if emp.status.lower() == "active" and not emp.leave_status:
            return emp
        from_zone, from_area = emp.zone_id, emp.area_id
        emp.status = EMPLOYEE_STATUS_ACTIVE
        emp.leave_status = False
        emp.reactivated_at = datetime.now(timezone.utc)
        emp.zone_id = None
        emp.area_id = None
        for linked in await self._linked_users(emp.id):
            linked.is_active = True
            linked.zone_id = None
        self.audit.record(
            user, entity_type="employee", entity_id=emp.id,
            entity_name=emp.name, action="employee_activated",
            property_id=emp.property_id,
        )
        if from_zone or from_area:
            self.session.add(AllocationEvent(
                entity_type="employee", entity_id=emp.id, property_id=emp.property_id,
                from_zone_id=from_zone, from_area_id=from_area,
                to_zone_id=None, to_area_id=None,
                actor_user_id=user.id, actor_name=user.name,
            ))
        await self.session.commit()
        return emp

    async def delete_employee(self, user: User, employee_id: uuid.UUID) -> None:
        """Permanently delete the employee/login while preserving work history."""
        emp = await self._get_employee(user, employee_id)

        prop = await self.session.get(Property, emp.property_id)
        if prop and prop.manager_employee_id == emp.id:
            prop.manager_employee_id = None  # name/email stay as snapshots

        # Open work returns to the unassigned queue. Completed/cancelled rows
        # keep assigned_to_name/supervisor_name as the immutable display name.
        open_statuses = {
            "pending", "assigned", "in_progress", "submitted",
            "reopened", "overdue", "scheduled",
        }
        res = await self.session.execute(
            select(Task).where(Task.employee_id == emp.id)
        )
        for task in res.scalars():
            task.employee_id = None
            if task.status in open_statuses:
                task.assigned_to_name = None
                task.status = "pending"
                task.submitted_at = None
                task.allocation_status = "unassigned"
                task.allocation_method = None
                task.allocation_reason = "employee_deleted"
                self.session.add(TaskHistoryEvent(
                    task_id=task.id, type="employee_removed",
                    actor_name=user.name,
                    note=f"{emp.name} was deleted; task returned to the unassigned queue.",
                ))

        res = await self.session.execute(
            select(Task).where(Task.supervisor_id == emp.id)
        )
        for task in res.scalars():
            task.supervisor_id = None

        res = await self.session.execute(
            select(MaintenanceTicket).where(MaintenanceTicket.assigned_to == emp.id)
        )
        for ticket in res.scalars():
            ticket.assigned_to = None
            if ticket.status in {"open", "assigned", "in_progress", "on_hold"}:
                ticket.assigned_to_name = None
                ticket.status = "open"
                ticket.allocation_status = "unassigned"
                ticket.allocation_method = None
                ticket.allocation_reason = "employee_deleted"
                self.session.add(MaintenanceTicketEvent(
                    ticket_id=ticket.id, action="unassigned",
                    actor_name=user.name,
                    comment=f"{emp.name} was deleted; ticket returned to the unassigned queue.",
                ))

        res = await self.session.execute(
            select(WorkAllocationBatch).where(
                WorkAllocationBatch.employee_id == emp.id
            )
        )
        for batch in res.scalars():
            batch.employee_id = None  # employee_name remains for audit

        for linked in await self._linked_users(emp.id):
            await self.session.delete(linked)  # refresh tokens cascade
        self.audit.record(
            user, entity_type="employee", entity_id=emp.id,
            entity_name=emp.name, action="employee_deleted",
            property_id=emp.property_id,
        )
        await self.session.delete(emp)
        await self.session.commit()
