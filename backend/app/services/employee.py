"""EmployeeService — staff records, login credentials, zone allocation."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, slugify_username
from app.models.allocation import AllocationEvent
from app.models.employee import Employee
from app.models.structure import Zone
from app.models.task import Task
from app.models.user import User, UserRole
from app.repositories.user import UserRepository
from app.schemas.structure import (
    EmployeeCreateRequest,
    EmployeeUpdateRequest,
)
from app.services.auth import EmailAlreadyExists, UsernameTaken
from app.services.structure import ConflictErr, NotFoundErr, StructureService, ValidationErr

AVATAR_COLORS = ["#386641", "#6A994E", "#A7C957", "#BC4749", "#8C867C", "#4A6FA5"]


class EmployeeService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.users = UserRepository(session)
        self.structure = StructureService(session)

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
        await self.session.commit()
        return emp

    async def deactivate(self, user: User, employee_id: uuid.UUID) -> Employee:
        emp = await self._get_employee(user, employee_id)
        emp.status = "Inactive" if emp.status not in ("Inactive", "inactive") else "Active"
        res = await self.session.execute(
            select(User).where(User.employee_id == emp.id)
        )
        for u in res.scalars():
            u.is_active = emp.status.lower() == "active"
        await self.session.commit()
        return emp

    async def delete_employee(self, user: User, employee_id: uuid.UUID) -> None:
        emp = await self._get_employee(user, employee_id)
        # unassign open tasks — don't destroy task history
        res = await self.session.execute(
            select(Task).where(
                Task.employee_id == emp.id, Task.status.in_(["pending", "in_progress", "overdue", "scheduled"])
            )
        )
        for t in res.scalars():
            t.employee_id = None
            t.assigned_to_name = None
        res = await self.session.execute(
            select(User).where(User.employee_id == emp.id)
        )
        for u in res.scalars():
            u.is_active = False  # revoke access, keep the audit trail
        await self.session.delete(emp)
        await self.session.commit()
