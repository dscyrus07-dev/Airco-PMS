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
        data = payload.model_dump(exclude_unset=True, exclude={"manager"})
        for k, v in data.items():
            setattr(prop, k, v)
        if payload.manager is not None:
            await self._apply_manager_update(prop, payload.manager)
        await self.session.commit()
        return prop

    async def _manager_account(self, employee_id) -> User | None:
        from sqlalchemy import select as sa_select

        res = await self.session.execute(
            sa_select(User).where(User.employee_id == employee_id)
        )
        return res.scalars().first()

    async def _pm_accounts(self, prop: Property) -> list[User]:
        from sqlalchemy import select as sa_select

        res = await self.session.execute(
            sa_select(User).where(
                User.property_id == prop.id,
                User.role == UserRole.PROPERTY_MANAGER,
            )
        )
        return list(res.scalars())

    async def _apply_manager_update(self, prop: Property, mgr) -> None:
        """Reassign the manager to an existing employee and/or update the
        manager's login email/password. The previous manager's account is
        demoted to the employee role (kept for audit — never deleted)."""
        from app.models.employee import Employee, employee_is_assignable
        from app.services.structure import NotFoundErr, ValidationErr
        from sqlalchemy import select as sa_select

        reassigning = mgr.employee_uid is not None
        if reassigning:
            res = await self.session.execute(
                sa_select(Employee).where(Employee.id == mgr.employee_uid)
            )
            emp = res.scalar_one_or_none()
            if emp is None or emp.property_id != prop.id:
                raise NotFoundErr("Employee not found in this property.")
            if not employee_is_assignable(emp):
                raise ValidationErr(
                    "Inactive or deactivated staff cannot be assigned as property manager."
                )

            if emp.id != prop.manager_employee_id:
                for u in await self._pm_accounts(prop):
                    u.role = UserRole.EMPLOYEE
                prop.manager_employee_id = emp.id
                prop.manager_name = emp.name
                prop.manager_email = emp.email
                prop.manager_phone = emp.phone
        else:
            # Resolve the current manager's employee row; if the link is
            # unset/dangling, repair it via the property's PM login account.
            emp = None
            if prop.manager_employee_id is not None:
                res = await self.session.execute(
                    sa_select(Employee).where(
                        Employee.id == prop.manager_employee_id
                    )
                )
                emp = res.scalar_one_or_none()
            if emp is None:
                for account in await self._pm_accounts(prop):
                    if account.employee_id is not None:
                        res = await self.session.execute(
                            sa_select(Employee).where(
                                Employee.id == account.employee_id
                            )
                        )
                        emp = res.scalar_one_or_none()
                        if emp is not None:
                            prop.manager_employee_id = emp.id
                            prop.manager_name = emp.name
                            prop.manager_email = emp.email
                            prop.manager_phone = emp.phone
                            break
            if emp is None:
                # No manager record at all — provision a fresh manager
                # (Employee row + login account) from the supplied
                # credentials. Contact details can be completed later by
                # the manager once they log in.
                if not mgr.email or not mgr.password:
                    raise ValidationErr(
                        "No manager record found — enter the manager's "
                        "email and a password to create their account, "
                        "or select an employee."
                    )
                if await self.users.get_by_email(mgr.email):
                    raise EmailAlreadyExists(field="manager.email")
                username = await self._unique_username(
                    mgr.email.split("@")[0]
                )
                name = (
                    prop.manager_name.strip()
                    if prop.manager_name and prop.manager_name.strip()
                    else mgr.email.split("@")[0]
                )
                emp = await self.employees.create(
                    company_id=prop.company_id,
                    property_id=prop.id,
                    name=name,
                    email=mgr.email,
                    phone=prop.manager_phone,
                    username=username,
                    job_title="Property Manager",
                    department="Management",
                )
                await self.users.create(
                    company_id=prop.company_id,
                    name=name,
                    email=mgr.email,
                    username=username,
                    password_hash=hash_password(mgr.password),
                    phone_number=emp.phone,
                    role=UserRole.PROPERTY_MANAGER,
                    property_id=prop.id,
                    employee_id=emp.id,
                    job_title="Property Manager",
                )
                prop.manager_employee_id = emp.id
                prop.manager_email = mgr.email
                return

        account = await self._manager_account(emp.id)
        if account is None and not reassigning:
            # Legacy data: PM account exists on the property but isn't linked
            # to the employee record — adopt and re-link it.
            for u in await self._pm_accounts(prop):
                if u.email.lower() == emp.email.lower() or account is None:
                    account = u
                if u.email.lower() == emp.email.lower():
                    break
            if account is not None:
                account.employee_id = emp.id
        if account is None:
            if not mgr.password:
                raise ValidationErr(
                    "Selected employee has no login account — "
                    "set a password to create one."
                )
            email = mgr.email or emp.email
            if await self.users.get_by_email(email):
                raise EmailAlreadyExists(field="manager.email")
            username = emp.username or await self._unique_username(
                emp.name.strip() or email.split("@")[0]
            )
            account = await self.users.create(
                company_id=prop.company_id,
                name=emp.name,
                email=email,
                username=username,
                password_hash=hash_password(mgr.password),
                phone_number=emp.phone,
                role=UserRole.PROPERTY_MANAGER,
                property_id=prop.id,
                employee_id=emp.id,
                job_title=emp.job_title or "Property Manager",
            )
        elif reassigning:
            account.role = UserRole.PROPERTY_MANAGER
            account.property_id = prop.id
            account.employee_id = emp.id

        if mgr.email and mgr.email != account.email:
            existing = await self.users.get_by_email(mgr.email)
            if existing is not None and existing.id != account.id:
                raise EmailAlreadyExists(field="manager.email")
            account.email = mgr.email
            emp.email = mgr.email
            prop.manager_email = mgr.email

        if mgr.password:
            account.password_hash = hash_password(mgr.password)

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
