import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee


class EmployeeRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(
        self,
        *,
        company_id: uuid.UUID,
        property_id: uuid.UUID,
        name: str,
        email: str,
        phone: str | None = None,
        username: str | None = None,
        job_title: str | None = None,
        department: str | None = None,
        zone_id: uuid.UUID | None = None,
        salary: str | None = None,
        shift: str | None = None,
        start_date: str | None = None,
    ) -> Employee:
        employee = Employee(
            company_id=company_id,
            property_id=property_id,
            zone_id=zone_id,
            name=name,
            email=email,
            phone=phone,
            username=username,
            job_title=job_title,
            department=department,
            salary=salary,
            shift=shift,
            start_date=start_date,
            status="Active",
        )
        self.session.add(employee)
        await self.session.flush()
        return employee
