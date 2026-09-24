"""
PropertyService — property creation includes atomic provisioning of the
Property Manager: Employee record + User login account (role
property_manager, scoped to the new property). One transaction — any
failure rolls back all three rows.
"""

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, slugify_username
from app.models.property import Property
from app.models.user import User, UserRole
from app.repositories.employee import EmployeeRepository
from app.repositories.user import UserRepository
from app.schemas.property import PropertyCreateRequest
from app.services.auth import EmailAlreadyExists, UsernameTaken


class PropertyService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.users = UserRepository(session)
        self.employees = EmployeeRepository(session)

    async def _next_property_code(self, company_id) -> str:
        res = await self.session.execute(
            select(func.count(Property.id)).where(Property.company_id == company_id)
        )
        return f"PROP-{(res.scalar() or 0) + 1:03d}"

    async def _unique_username(self, seed: str) -> str:
        """Auto-generate a unique username from the manager's name/email."""
        base = slugify_username(seed)
        candidate = base
        n = 1
        while await self.users.username_exists(candidate):
            n += 1
            candidate = f"{base}.{n}"
        return candidate

    async def create_property(
        self, current_user: User, payload: PropertyCreateRequest
    ) -> Property:
        manager = payload.manager

        if await self.users.get_by_email(manager.email):
            raise EmailAlreadyExists(field="email")

        # Username: explicit value → must be unique; blank → auto-generate
        # from the manager's name (fallback: email local part).
        if manager.username:
            if await self.users.username_exists(manager.username):
                raise UsernameTaken(field="username")
            username = manager.username
        else:
            seed = manager.name.strip() or manager.email.split("@")[0]
            username = await self._unique_username(seed)

        company_id = current_user.company_id
        code = await self._next_property_code(company_id)

        try:
            prop = Property(
                company_id=company_id,
                name=payload.name.strip(),
                code=code,
                location=payload.location.strip(),
                city=payload.city.strip(),
                state=payload.state.strip(),
                status="Active",
                manager_name=manager.name.strip(),
                manager_email=manager.email,
                manager_phone=manager.phone,
            )
            self.session.add(prop)
            await self.session.flush()

            # Manager's staff record — appears in the property's directory
            employee = await self.employees.create(
                company_id=company_id,
                property_id=prop.id,
                name=manager.name.strip(),
                email=manager.email,
                phone=manager.phone,
                username=username,
                job_title="Property Manager",
                department="Management",
            )

            # Manager's login account — scoped to this property forever
            await self.users.create(
                company_id=company_id,
                name=manager.name.strip(),
                email=manager.email,
                username=username,
                password_hash=hash_password(manager.password),
                phone_number=manager.phone,
                role=UserRole.PROPERTY_MANAGER,
                property_id=prop.id,
                employee_id=employee.id,
                job_title="Property Manager",
            )

            prop.manager_employee_id = employee.id
            await self.session.flush()
            await self.session.commit()
            return prop
        except IntegrityError as exc:
            await self.session.rollback()
            msg = str(exc.orig).lower() if exc.orig else ""
            if "username" in msg:
                raise UsernameTaken(field="username") from exc
            raise EmailAlreadyExists(field="email") from exc

    # ------------------------------------------------------------------

    async def _get_scoped(self, user: User, property_id) -> Property:
        from sqlalchemy import select as sa_select

        from app.services.structure import NotFoundErr

        res = await self.session.execute(
            sa_select(Property).where(Property.id == property_id)
        )
        prop = res.scalar_one_or_none()
        if prop is None:
            raise NotFoundErr("Property not found.")
        if user.role == UserRole.SUPER_ADMIN:
            if prop.company_id != user.company_id:
                raise NotFoundErr("Property not found.")
        elif user.property_id != prop.id:
            raise NotFoundErr("Property not found.")
        return prop

    async def update_property(
        self, user: User, property_id, payload
    ) -> Property:
        prop = await self._get_scoped(user, property_id)
        data = payload.model_dump(exclude_unset=True)
        for k, v in data.items():
            setattr(prop, k, v)
        await self.session.commit()
        return prop

    async def delete_property(self, user: User, property_id) -> None:
        """Cascade-delete the property and its structure; deactivate the
        users scoped to it (keep the user rows for audit)."""
        from sqlalchemy import select as sa_select

        prop = await self._get_scoped(user, property_id)
        res = await self.session.execute(
            sa_select(User).where(User.property_id == prop.id)
        )
        for u in res.scalars():
            u.is_active = False
        await self.session.delete(prop)
        await self.session.commit()
