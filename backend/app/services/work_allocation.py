"""WorkAllocationService — zone-based persistent round-robin allocation.

One zone + one allocation batch = one employee. The pointer lives in
`zone_allocation_state` and is advanced with SELECT … FOR UPDATE so
concurrent batches can't land on the same slot. Manual reassignment never
touches the pointer.

Called by both MaintenanceService and TaskService — the algorithm is not
duplicated.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.structure import Zone
from app.models.user import User
from app.models.work_allocation import (
    WorkAllocationBatch,
    WorkAllocationHistory,
    ZoneAllocationState,
)


async def next_batch_number(session: AsyncSession) -> str:
    """WB-YYYY-NNNNN via a PostgreSQL sequence; max-scan fallback on SQLite."""
    year = datetime.now(timezone.utc).year
    try:
        res = await session.execute(text("SELECT nextval('work_batch_seq')"))
        n = int(res.scalar_one())
    except Exception:
        res = await session.execute(
            select(func.count()).select_from(WorkAllocationBatch)
        )
        n = int(res.scalar_one()) + 1
    return f"WB-{year}-{n:05d}"


@dataclass
class AllocationResult:
    batch: WorkAllocationBatch
    employee: Employee | None
    method: str          # round_robin | none
    reason: str | None   # None | no_eligible_employee | no_zone


class WorkAllocationService:
    def __init__(self, session: AsyncSession):
        self.session = session

    # ------------------------------------------------------------------
    # Eligibility — active, on-property, in-zone, not on leave, not the
    # property manager account (they orchestrate; they don't take tickets)
    # ------------------------------------------------------------------

    async def eligible_employees(
        self, property_id: uuid.UUID, zone_id: uuid.UUID | None,
        area_id: uuid.UUID | None = None, manager_employee_id=None
    ) -> list[Employee]:
        # zone-level assignees PLUS area-level assignees covering this zone;
        # a zone-less target scopes straight to the area pool
        scope = []
        if zone_id is not None:
            zone = await self.session.get(Zone, zone_id)
            scope.append(Employee.zone_id == zone_id)
            if zone is not None and zone.area_id is not None:
                scope.append(Employee.area_id == zone.area_id)
        elif area_id is not None:
            scope.append(Employee.area_id == area_id)
        else:
            return []
        res = await self.session.execute(
            select(Employee)
            .where(
                Employee.property_id == property_id,
                or_(*scope),
                func.lower(Employee.status) == "active",
                Employee.leave_status.is_(False),
            )
            .order_by(Employee.created_at, Employee.id)
        )
        employees = list(res.scalars())
        if manager_employee_id:
            employees = [e for e in employees if e.id != manager_employee_id]
        return employees

    # ------------------------------------------------------------------
    # The locked round-robin step — call ONCE per batch, never per ticket
    # ------------------------------------------------------------------

    async def _locked_state(
        self, property_id: uuid.UUID, zone_id: uuid.UUID
    ) -> ZoneAllocationState:
        """Get-or-create the zone pointer row and lock it for this txn."""
        res = await self.session.execute(
            select(ZoneAllocationState)
            .where(ZoneAllocationState.zone_id == zone_id)
            .with_for_update()
        )
        state = res.scalar_one_or_none()
        if state is None:
            state = ZoneAllocationState(property_id=property_id, zone_id=zone_id)
            self.session.add(state)
            try:
                await self.session.flush()
            except IntegrityError:
                # Concurrent creator won — roll back the savepoint and lock theirs
                res = await self.session.execute(
                    select(ZoneAllocationState)
                    .where(ZoneAllocationState.zone_id == zone_id)
                    .with_for_update()
                )
                state = res.scalar_one()
        return state

    async def allocate(
        self,
        user: User | None,
        *,
        property_id: uuid.UUID,
        zone_id: uuid.UUID | None,
        zone_name: str | None = None,
        work_type: str,
        manager_employee_id: uuid.UUID | None = None,
        company_id: uuid.UUID | None = None,
        actor_name: str | None = None,
        area_id: uuid.UUID | None = None,
        area_name: str | None = None,
    ) -> AllocationResult:
        """Create one allocation batch and pick ONE employee for a zone.

        With no zone (or no eligible employees) the batch is still created —
        tickets land UNASSIGNED with a reason instead of being randomly
        scattered across other zones. An area_id scopes the pick to the
        area-level assignee pool when the target has no zone.
        """
        employee: Employee | None = None
        method, reason = "round_robin", None

        if zone_id is None and area_id is None:
            method, reason = "none", "no_zone"
        elif zone_id is None:
            # area-scoped target with no zone — rotate the area pool off the
            # last zone-less allocation so repeated runs distribute fairly
            eligible = await self.eligible_employees(
                property_id, None, area_id, manager_employee_id
            )
            if not eligible:
                method, reason = "none", "no_eligible_employee"
            else:
                res = await self.session.execute(
                    select(WorkAllocationHistory)
                    .where(
                        WorkAllocationHistory.property_id == property_id,
                        WorkAllocationHistory.zone_id.is_(None),
                        WorkAllocationHistory.employee_id.is_not(None),
                    )
                    .order_by(WorkAllocationHistory.created_at.desc())
                )
                last = res.scalars().first()
                employee = eligible[0]
                if last:
                    for i, e in enumerate(eligible):
                        if e.id == last.employee_id:
                            employee = eligible[(i + 1) % len(eligible)]
                            break
            if zone_name is None:
                zone_name = area_name
        else:
            eligible = await self.eligible_employees(
                property_id, zone_id, manager_employee_id=manager_employee_id
            )
            if not eligible:
                method, reason = "none", "no_eligible_employee"
            else:
                # Lock + read pointer, choose next, advance — all under FOR UPDATE
                state = await self._locked_state(property_id, zone_id)
                employee = eligible[0]
                if state.last_assigned_employee_id:
                    for i, e in enumerate(eligible):
                        if e.id == state.last_assigned_employee_id:
                            employee = eligible[(i + 1) % len(eligible)]
                            break
                    # last assignee no longer eligible → employee stays [0]
                state.last_assigned_employee_id = employee.id
                state.last_assigned_at = datetime.now(timezone.utc)
                state.version += 1

        batch = WorkAllocationBatch(
            batch_number=await next_batch_number(self.session),
            company_id=user.company_id if user else company_id,
            property_id=property_id,
            zone_id=zone_id,
            zone_name=zone_name,
            employee_id=employee.id if employee else None,
            employee_name=employee.name if employee else None,
            work_type=work_type,
            allocation_status="auto_assigned" if employee else "unassigned",
            allocation_reason=reason,
            created_by=user.id if user else None,
            created_by_name=user.name if user else actor_name,
        )
        self.session.add(batch)
        await self.session.flush()  # batch.id available for tickets/history
        return AllocationResult(batch=batch, employee=employee,
                                method=method, reason=reason)

    # ------------------------------------------------------------------
    # Audit row per ticket
    # ------------------------------------------------------------------

    def record(
        self,
        *,
        property_id: uuid.UUID,
        zone_id: uuid.UUID | None,
        batch: WorkAllocationBatch | None,
        ticket_kind: str,
        ticket_id: uuid.UUID,
        ticket_number: str | None,
        employee_id: uuid.UUID | None,
        employee_name: str | None,
        method: str,
        reason: str | None = None,
        actor_name: str | None = None,
        previous_employee_id: uuid.UUID | None = None,
        previous_employee_name: str | None = None,
    ) -> None:
        self.session.add(WorkAllocationHistory(
            property_id=property_id,
            zone_id=zone_id,
            batch_id=batch.id if batch else None,
            batch_number=batch.batch_number if batch else None,
            ticket_kind=ticket_kind,
            ticket_id=ticket_id,
            ticket_number=ticket_number,
            employee_id=employee_id,
            employee_name=employee_name,
            previous_employee_id=previous_employee_id,
            previous_employee_name=previous_employee_name,
            allocation_method=method,
            reason=reason,
            actor_name=actor_name,
        ))
