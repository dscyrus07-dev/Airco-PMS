"""WorkAllocationService — zone-based persistent round-robin allocation.

One allocation step selects one employee from the FINAL eligible zone or
area pool. The pointer is derived from committed allocation history scoped
by location + work type; zone state rows and area rows are locked with
SELECT … FOR UPDATE so concurrent batches can't land on the same slot.
Manual reassignment never touches the pointer.

Called by both MaintenanceService and TaskService — the algorithm is not
duplicated.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.employee import Employee, employee_is_assignable
from app.models.structure import Area, Zone
from app.models.user import User
from app.models.work_allocation import (
    WorkAllocationBatch,
    WorkAllocationHistory,
    ZoneAllocationState,
)

logger = get_logger(__name__)


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


# Structured department eligibility is decided before zone/area scoping.
# The production values are full department names; matching on these stable
# terms also accepts compatible variants such as "Cleaning" or "Engineering".
WORK_TYPE_DEPARTMENTS = {
    "cleaning": ("housekeeping", "cleanliness", "cleaning"),
    "housekeeping": ("housekeeping", "cleanliness", "cleaning"),
    "maintenance": ("maintenance", "engineering"),
    # task | operations | inspection | checklist | other → ungated:
    # no department map means every department is eligible for the work.
}


def eligible_departments(work_type: str | None) -> tuple[str, ...]:
    return WORK_TYPE_DEPARTMENTS.get((work_type or "").strip().lower(), ())


def infer_task_work_type(*, title: str | None = None,
                         template_type: str | None = None,
                         allocation_work_type: str | None = None) -> str:
    """Resolve the domain work kind used by allocation.

    `task_type` stores lifecycle shape (fixed/repetitive/automated), not the
    operating department. Template and allocation provenance are preferred;
    the title fallback keeps previously generated Cleaning/Checkout rows on
    the housekeeping eligibility path.
    """
    kind = (template_type or allocation_work_type or "").strip().lower()
    if kind in WORK_TYPE_DEPARTMENTS:
        return kind
    normalized = (title or "").strip().lower()
    if normalized.startswith(("cleaning", "checkout cleaning", "clean ")):
        return "cleaning"
    return "maintenance" if kind == "maintenance" else "task"


@dataclass
class AllocationResult:
    batch: WorkAllocationBatch
    employee: Employee | None
    method: str          # round_robin | none
    reason: str | None   # None | no_eligible_employee | no_zone
    level: str | None
    zone_employee_count: int
    area_employee_count: int
    pool_employees: list[Employee]
    previous_index: int | None
    selected_index: int | None
    next_index: int | None


class WorkAllocationService:
    def __init__(self, session: AsyncSession):
        self.session = session

    # ------------------------------------------------------------------
    # Eligibility — ZONE STAFF first, then AREA STAFF covering that zone.
    # Active, on-property, not on leave, not the property manager account
    # (they orchestrate; they don't take tickets). Cleaning/maintenance work
    # is additionally gated by the structured department eligibility map.
    # ------------------------------------------------------------------

    @staticmethod
    def employee_matches_work_type(employee: Employee, work_type: str | None) -> bool:
        departments = eligible_departments(work_type)
        if not departments:
            return True
        department = (employee.department or "").lower()
        return any(term in department for term in departments)

    async def employee_for_assignment(
        self, employee_id: uuid.UUID, property_id: uuid.UUID,
        *, work_type: str | None = None,
    ) -> Employee:
        """Resolve an explicit assignee under the central eligibility rules."""
        from app.services.structure import ValidationErr

        res = await self.session.execute(
            select(Employee).where(
                Employee.id == employee_id,
                Employee.property_id == property_id,
            )
        )
        emp = res.scalar_one_or_none()
        if emp is None:
            raise ValidationErr("Employee not found in this property.",
                                field="employee_uid")
        if not employee_is_assignable(emp):
            raise ValidationErr(
                "Employee is not active and cannot be assigned new work.",
                field="employee_uid",
            )
        if work_type and not self.employee_matches_work_type(emp, work_type):
            raise ValidationErr(
                "Employee department is not eligible for this task type.",
                field="employee_uid",
            )
        return emp

    async def _employee_pool(
        self, property_id: uuid.UUID, *scope,
        manager_employee_id=None, departments: tuple[str, ...] = (),
    ) -> list[Employee]:
        filters = [
            Employee.property_id == property_id,
            *scope,
            func.lower(Employee.status) == "active",
            Employee.leave_status.is_(False),
        ]
        if departments:
            filters.append(or_(*(
                Employee.department.ilike(f"%{term}%")
                for term in departments
            )))
        res = await self.session.execute(
            select(Employee)
            .where(*filters)
            .order_by(Employee.created_at, Employee.id)
        )
        employees = list(res.scalars())
        if manager_employee_id:
            employees = [e for e in employees if e.id != manager_employee_id]
        return employees

    async def eligible_employees(
        self, property_id: uuid.UUID, zone_id: uuid.UUID | None,
        area_id: uuid.UUID | None = None, manager_employee_id=None,
        departments: tuple[str, ...] = (),
    ) -> tuple[list[Employee], str | None]:
        """Combined eligible pool — ALWAYS zone + covering-area, deduplicated.

        Area-level assignees ("Entire <Floor>" staff) cover every zone in
        their floor, so the pool never collapses to a single tier: a zone
        with zero direct staff still has the floor pool, and a busy zone
        is relieved by floor staff even when it has its own employees.

        level: 'zone+area' | 'zone' | 'area' | None (transparency only —
        the pool itself is always the union).
        """
        zone_pool, area_pool, pool, level = await self._eligible_pools(
            property_id, zone_id, area_id=area_id,
            manager_employee_id=manager_employee_id, departments=departments,
        )
        return pool, level

    async def _eligible_pools(
        self, property_id: uuid.UUID, zone_id: uuid.UUID | None,
        area_id: uuid.UUID | None = None, manager_employee_id=None,
        departments: tuple[str, ...] = (),
    ) -> tuple[list[Employee], list[Employee], list[Employee], str | None]:
        """Zone pool + covering-area pool + deduplicated union + level.

        Single fetch of each pool — callers that need the raw tier lists
        (allocation transparency counters) must use this so the same
        employee sets are never queried twice in one operation."""
        zone = await self.session.get(Zone, zone_id) if zone_id else None
        cover_area = (
            zone.area_id if zone is not None and zone.area_id is not None
            else area_id
        )

        zone_pool = (
            await self._employee_pool(
                property_id, Employee.zone_id == zone_id,
                manager_employee_id=manager_employee_id,
                departments=departments,
            )
            if zone_id is not None else []
        )
        if cover_area is not None and zone_id is None:
            # AREA-LEVEL task — pool = area-wide staff UNION the staff of
            # every zone inside the area (single query via zone subselect).
            area_pool = await self._employee_pool(
                property_id,
                or_(
                    Employee.area_id == cover_area,
                    Employee.zone_id.in_(
                        select(Zone.id).where(Zone.area_id == cover_area)
                    ),
                ),
                manager_employee_id=manager_employee_id,
                departments=departments,
            )
        else:
            area_pool = (
                await self._employee_pool(
                    property_id, Employee.area_id == cover_area,
                    manager_employee_id=manager_employee_id,
                    departments=departments,
                )
                if cover_area is not None else []
            )

        seen: set[uuid.UUID] = set()
        pool: list[Employee] = []
        for employee in [*zone_pool, *area_pool]:
            if employee.id not in seen:
                seen.add(employee.id)
                pool.append(employee)
        # Unified ordering — coverage determines eligibility, never
        # priority. Concatenating zone-first would bias every tie and the
        # cold-start rotation toward zone staff, so the merged pool is
        # re-sorted by the same scope-agnostic key each pool uses.
        pool.sort(key=lambda e: (
            e.created_at.replace(tzinfo=None) if e.created_at
            else datetime.min.replace(tzinfo=None),
            e.id,
        ))
        level = (
            "zone+area" if zone_pool and area_pool
            else "zone" if zone_pool
            else "area" if area_pool
            else None
        )
        return zone_pool, area_pool, pool, level

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
                async with self.session.begin_nested():
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

    async def _active_workloads(
        self, property_id: uuid.UUID, employee_ids: list[uuid.UUID],
    ) -> dict[uuid.UUID, int]:
        """Live open-task count per employee — queried fresh on every
        allocation, so consecutive allocations always see the latest
        workload. Counts only non-terminal statuses (pending / assigned /
        in_progress / submitted / reopened / overdue)."""
        from app.models.maintenance import MaintenanceTicket
        from app.models.task import Task
        loads = {eid: 0 for eid in employee_ids}
        if not employee_ids:
            return loads
        # Production sessions run with autoflush disabled — flush explicitly
        # so tasks created earlier in THIS transaction (bulk generation,
        # multi-fixture assignment) count toward the workload immediately.
        await self.session.flush()
        res = await self.session.execute(
            select(Task.employee_id, func.count())
            .where(
                Task.property_id == property_id,
                Task.employee_id.in_(employee_ids),
                Task.status.notin_(
                    ("completed", "cancelled", "scheduled")
                ),
            )
            .group_by(Task.employee_id)
        )
        for eid, count in res.all():
            loads[eid] = count
        # Open maintenance tickets are assigned work too — an employee
        # carrying three unresolved tickets is not "idle" just because the
        # work lives in the ticket table.
        res = await self.session.execute(
            select(MaintenanceTicket.assigned_to, func.count())
            .where(
                MaintenanceTicket.property_id == property_id,
                MaintenanceTicket.assigned_to.in_(employee_ids),
                MaintenanceTicket.status.notin_(
                    ("resolved", "closed", "cancelled")
                ),
            )
            .group_by(MaintenanceTicket.assigned_to)
        )
        for eid, count in res.all():
            loads[eid] += count
        return loads

    async def _locked_area(self, area_id: uuid.UUID) -> None:
        """Serialize area fallback allocations without needing a new table.

        Locking the existing Area row (SELECT … FOR UPDATE) makes concurrent
        transactions wait until the previous task's allocation history is
        committed, so every worker sees a fresh pointer for that pool.
        """
        await self.session.execute(
            select(Area.id).where(Area.id == area_id).with_for_update()
        )

    async def _fair_pick(
        self, property_id: uuid.UUID, eligible: list[Employee],
        *, work_type: str, pool_level: str,
        zone_id=None, area_id=None, area_name=None,
    ):
        """WORKLOAD-FIRST + rotation over ONE unified pool. Shared by
        zone/area/property/people allocations — returns
        (employee, previous_index, selected_index, next_index)."""
        loads = await self._active_workloads(
            property_id, [e.id for e in eligible]
        )
        min_load = min(loads[e.id] for e in eligible)
        candidates = {e.id for e in eligible if loads[e.id] == min_load}
        candidate_positions = [
            i for i, e in enumerate(eligible) if e.id in candidates
        ]
        last_employee_id = await self._last_rotation_employee(
            property_id,
            [e for e in eligible if e.id in candidates],
            work_type=work_type, pool_level=pool_level,
            zone_id=zone_id, area_id=area_id, area_name=area_name,
        )
        previous_index = next(
            (i for i, candidate in enumerate(eligible)
             if candidate.id == last_employee_id),
            None,
        )
        after = [
            i for i in candidate_positions
            if previous_index is not None and i > previous_index
        ]
        selected_index = after[0] if after else candidate_positions[0]
        employee = eligible[selected_index]
        next_index = candidate_positions[
            (candidate_positions.index(selected_index) + 1)
            % len(candidate_positions)
        ]
        return employee, previous_index, selected_index, next_index

    async def allocate_people(
        self,
        user: User | None,
        *,
        property_id: uuid.UUID,
        employees: list[Employee],
        work_type: str,
        company_id: uuid.UUID | None = None,
        actor_name: str | None = None,
        pool_label: str | None = None,
    ) -> AllocationResult:
        """People-oriented allocation (Operations/other) — the caller
        supplies the pool (named employees, team, or department members);
        this applies work-type gating + dedupe + fair pick. No zone/area
        semantics are involved."""
        departments = eligible_departments(work_type)
        seen: set[uuid.UUID] = set()
        eligible: list[Employee] = []
        for e in employees:
            if e.id in seen or e.property_id != property_id:
                continue
            if not employee_is_assignable(e):
                continue
            if departments and not self.employee_matches_work_type(
                    e, work_type):
                continue
            seen.add(e.id)
            eligible.append(e)
        eligible.sort(key=lambda e: (
            e.created_at.replace(tzinfo=None) if e.created_at
            else datetime.min.replace(tzinfo=None), e.id))

        employee = None
        method, reason = "round_robin", None
        previous_index = selected_index = next_index = None
        if not eligible:
            method, reason = "none", "no_eligible_employee"
        else:
            await self._locked_property(property_id)
            employee, previous_index, selected_index, next_index = \
                await self._fair_pick(
                    property_id, eligible,
                    work_type=work_type, pool_level="property",
                )
        batch = WorkAllocationBatch(
            batch_number=await next_batch_number(self.session),
            company_id=user.company_id if user else company_id,
            property_id=property_id,
            zone_id=None,
            zone_name=pool_label or "People pool",
            employee_id=employee.id if employee else None,
            employee_name=employee.name if employee else None,
            work_type=work_type,
            allocation_status="auto_assigned" if employee else "unassigned",
            created_by=user.id if user else None,
            created_by_name=user.name if user else actor_name,
        )
        self.session.add(batch)
        await self.session.flush()
        logger.info(
            "People allocation %s: work_type=%s pool=%s size=%d -> %s",
            batch.batch_number, work_type, pool_label or "-",
            len(eligible),
            employee.name if employee else f"UNASSIGNED ({reason})",
        )
        return AllocationResult(
            batch=batch, employee=employee, method=method, reason=reason,
            level="people", zone_employee_count=0,
            area_employee_count=0, pool_employees=eligible,
            previous_index=previous_index, selected_index=selected_index,
            next_index=next_index,
        )

    async def _locked_property(self, property_id: uuid.UUID) -> None:
        """Serialize property-level allocations — same row-lock pattern as
        `_locked_area`, one level up. Keeps the property-wide rotation
        deterministic under concurrent generation."""
        from app.models.property import Property
        await self.session.execute(
            select(Property.id).where(Property.id == property_id)
            .with_for_update()
        )

    async def _last_rotation_employee(
        self, property_id: uuid.UUID, eligible: list[Employee], *,
        work_type: str, pool_level: str, zone_id=None, area_id=None,
        area_name=None,
    ):
        """Last auto-assigned employee in THIS work-type pool.

        Department-specific work keeps independent rotation positions: a
        maintenance allocation must not consume a slot in the housekeeping
        pool, and vice versa.
        """
        filters = [
            WorkAllocationHistory.property_id == property_id,
            WorkAllocationHistory.employee_id.in_([e.id for e in eligible]),
            WorkAllocationHistory.allocation_method == "round_robin",
            WorkAllocationBatch.work_type == work_type,
        ]
        if pool_level == "zone":
            filters.append(WorkAllocationHistory.zone_id == zone_id)
        elif pool_level == "property":
            # property-level pool — rotation history is the whole
            # property for this work type; no zone/area scoping
            pass
        else:
            area_zone_ids = select(Zone.id).where(Zone.area_id == area_id)
            area_scope = WorkAllocationHistory.zone_id.in_(area_zone_ids)
            if area_name:
                area_scope = or_(
                    area_scope,
                    (WorkAllocationHistory.zone_id.is_(None)
                     & (WorkAllocationBatch.zone_name == area_name)),
                )
            filters.append(area_scope)
        res = await self.session.execute(
            select(WorkAllocationHistory.employee_id)
            .join(
                WorkAllocationBatch,
                WorkAllocationBatch.id == WorkAllocationHistory.batch_id,
            )
            .where(*filters)
            .order_by(WorkAllocationBatch.batch_number.desc())
            .limit(1)
        )
        return res.scalar_one_or_none()

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
        previous_index = selected_index = next_index = None
        departments = eligible_departments(work_type)
        pool_level: str | None = None
        if zone_id is not None:
            zone = await self.session.get(Zone, zone_id)
            if zone is not None and zone.area_id is not None:
                area_id = zone.area_id
        if area_id is not None and area_name is None:
            area = await self.session.get(Area, area_id)
            area_name = area.name if area else None

        eligible: list[Employee] = []
        zone_pool: list[Employee] = []
        area_pool: list[Employee] = []
        state = None
        if zone_id is None and area_id is None:
            # PROPERTY-LEVEL task — no zone/area required. The eligible
            # pool is every in-scope employee of the property; allocation
            # still runs the same workload-first rotation.
            pool_level = "property"
            eligible = await self._employee_pool(
                property_id,
                manager_employee_id=manager_employee_id,
                departments=departments,
            )
            if not eligible:
                method, reason = "none", "no_eligible_employee"
            else:
                await self._locked_property(property_id)
        else:
            zone_pool, area_pool, eligible, pool_level = \
                await self._eligible_pools(
                    property_id, zone_id, area_id=area_id,
                    manager_employee_id=manager_employee_id,
                    departments=departments,
                )
            if not eligible:
                method, reason = "none", "no_eligible_employee"
            elif zone_id is not None:
                # Serialize concurrent allocations on the existing zone
                # state row — the combined pool's rotation for this zone.
                state = await self._locked_state(property_id, zone_id)
            else:
                # Area rows already exist in the current schema — locking
                # the row serializes this area+work-type pool safely.
                await self._locked_area(area_id)

        if eligible:
            employee, previous_index, selected_index, next_index = \
                await self._fair_pick(
                    property_id, eligible,
                    work_type=work_type, pool_level=pool_level or "zone",
                    zone_id=zone_id, area_id=area_id, area_name=area_name,
                )
            if state is not None:
                state.last_assigned_employee_id = employee.id
                state.last_assigned_at = datetime.now(timezone.utc)
                state.version += 1
        if zone_id is None and zone_name is None:
            zone_name = area_name

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
        pool_names = ", ".join(
            f"{employee_.name} ({employee_.id})" for employee_ in eligible
        ) or "-"
        logger.info(
            "Allocation %s: work_type=%s zone=%s area=%s pool=%s "
            "candidates=[%s] previous_pointer=%s selected_pointer=%s "
            "next_pointer=%s -> %s (%s%s)",
            batch.batch_number, work_type,
            zone_name or "-", area_name or "-", pool_level or "-", pool_names,
            previous_index if previous_index is not None else "-",
            selected_index if selected_index is not None else "-",
            next_index if next_index is not None else "-",
            employee.name if employee else "UNASSIGNED",
            method, f" reason={reason}" if reason else "",
        )
        return AllocationResult(
            batch=batch, employee=employee, method=method, reason=reason,
            level=pool_level, zone_employee_count=len(zone_pool),
            area_employee_count=len(area_pool), pool_employees=eligible,
            previous_index=previous_index, selected_index=selected_index,
            next_index=next_index,
        )

    def log_task_allocation(
        self, result: AllocationResult, *, task_id, room=None, dorm=None,
        washroom=None, zone=None, area=None,
    ) -> None:
        pool_names = ", ".join(
            f"{employee.name} ({employee.id})"
            for employee in result.pool_employees
        ) or "-"
        logger.info(
            "Task allocation | task_id=%s type=%s room=%s dorm=%s "
            "Washroom=%s Zone=%s Area=%s | Zone employees=%d "
            "Area employees=%d | level=%s pool=[%s] previous_pointer=%s "
            "selected=%s selected_pointer=%s next_pointer=%s",
            task_id, result.batch.work_type, room or "-", dorm or "-",
            washroom or "-", zone or "-", area or "-",
            result.zone_employee_count,
            result.area_employee_count, (result.level or "none").upper(),
            pool_names,
            result.previous_index if result.previous_index is not None else "-",
            result.employee.name if result.employee else "UNASSIGNED",
            result.selected_index if result.selected_index is not None else "-",
            result.next_index if result.next_index is not None else "-",
        )

    # ------------------------------------------------------------------
    # Audit row per ticket
    # ------------------------------------------------------------------

    async def record(
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
        # Production sessions run with autoflush disabled. Persist the audit
        # row inside the transaction now so the NEXT allocation can see this
        # pointer before the request-level commit.
        await self.session.flush()
