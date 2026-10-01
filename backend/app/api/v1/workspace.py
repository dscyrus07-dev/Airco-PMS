"""
Workspace read endpoints — the collections the frontend's `loadWorkspace`
fetches on sign-in. All scoped to the caller's company (super_admin) or
assigned property (property_manager/employee).
"""

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.exceptions import AppError
from app.dependencies.auth import (
    get_current_user,
    require_employee,
    require_property_manager,
    require_super_admin,
)
from app.models.user import User, UserRole
from app.repositories.workspace import WorkspaceRepository
from app.schemas import workspace as ws
from app.schemas.property import PropertyCreateRequest, PropertyUpdateRequest
from app.schemas.maintenance import (
    MaintenanceActionRequest,
    MaintenanceAssignRequest,
    MaintenanceCreateRequest,
    MaintenanceDisapproveRequest,
    MaintenanceResolveRequest,
    MaintenanceUpdateRequest,
    ticket_out,
)
from app.schemas.structure import (
    AllocationRequest,
    AreaCreateRequest,
    AreaUpdateRequest,
    BulkUnitStatusRequest,
    CheckInRequest,
    DormBulkCreateRequest,
    DormCreateRequest,
    DormUpdateRequest,
    EmployeeAllocationRequest,
    EmployeeCreateRequest,
    EmployeeUpdateRequest,
    EmployeeZoneAssignRequest,
    CompanyUpdateRequest,
    RoomBulkCreateRequest,
    RoomBulkDeleteRequest,
    RoomCreateRequest,
    RoomUpdateRequest,
    TaskActionRequest,
    TaskCompleteRequest,
    TaskCreateRequest,
    TaskReassignRequest,
    TaskRejectRequest,
    TaskSubmitRequest,
    TaskUpdateRequest,
    ResourceTransitionRequest,
    WashroomBulkCreateRequest,
    WashroomCreateRequest,
    WashroomFixtureUpdateRequest,
    WashroomUpdateRequest,
    ZoneCreateRequest,
    ZoneUpdateRequest,
)
from app.services.employee import EmployeeService
from app.services.maintenance import MaintenanceService
from app.services.property import PropertyService
from app.services.structure import StructureService
from app.services.task import TaskService

router = APIRouter(tags=["workspace"])


class NotFound(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "NOT_FOUND"
    message = "The requested resource was not found."


def _uid(v: str | None) -> uuid.UUID | None:
    if not v:
        return None
    try:
        return uuid.UUID(v)
    except ValueError:
        raise NotFound()


@router.get("/properties")
async def list_properties(
    search: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    res = await WorkspaceRepository(session).list_properties(
        user, search=search, status=status_, page=page, limit=limit
    )
    res["items"] = [ws.property_out(p) for p in res["items"]]
    return res


@router.post("/properties", status_code=status.HTTP_201_CREATED)
async def create_property(
    payload: PropertyCreateRequest,
    user: User = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    """Create a property and its Property Manager account atomically."""
    prop = await PropertyService(session).create_property(user, payload)
    return ws.property_out(prop)


@router.get("/properties/{property_id}/reconciliation")
async def reconcile_resource_state(
    property_id: uuid.UUID,
    user: User = Depends(require_property_manager),
    session: AsyncSession = Depends(get_db),
):
    """Read-only integrity scan — reports orphan/contradictory resource
    states (spec §43/§44). It never repairs; corrections go through the
    transition API."""
    from app.services.reconciliation import reconcile_property

    prop = await StructureService(session)._property_for_write(
        user, property_id
    )
    findings = await reconcile_property(session, prop.id)
    return {"property_id": str(prop.id), "findings": findings}


@router.get("/properties/{property_id}")
async def get_property(
    property_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    prop = await WorkspaceRepository(session).get_property(user, property_id)
    if prop is None:
        raise NotFound("Property not found.")
    return ws.property_out(prop)


@router.get("/areas")
async def list_areas(
    property_uid: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    res = await WorkspaceRepository(session).list_areas(
        user, property_id=_uid(property_uid)
    )
    res["items"] = [ws.area_out(a) for a in res["items"]]
    return res


@router.get("/zones")
async def list_zones(
    property_uid: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    res = await WorkspaceRepository(session).list_zones(
        user, property_id=_uid(property_uid)
    )
    res["items"] = [ws.zone_out(z) for z in res["items"]]
    return res


@router.get("/rooms")
async def list_rooms(
    property_uid: str | None = Query(default=None),
    zone_uid: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    res = await WorkspaceRepository(session).list_rooms(
        user,
        property_id=_uid(property_uid),
        zone_id=_uid(zone_uid),
        status=status_,
        search=search,
    )
    res["items"] = await ws.rooms_payload(session, res["items"])
    return res


@router.get("/dorms")
async def list_dorms(
    property_uid: str | None = Query(default=None),
    zone_uid: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    res = await WorkspaceRepository(session).list_dorms(
        user, property_id=_uid(property_uid), zone_id=_uid(zone_uid)
    )
    res["items"] = await ws.dorms_payload(session, res["items"])
    return res


@router.get("/washrooms")
async def list_washrooms(
    property_uid: str | None = Query(default=None),
    zone_uid: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    res = await WorkspaceRepository(session).list_washrooms(
        user,
        property_id=_uid(property_uid),
        zone_id=_uid(zone_uid),
        status=status_,
        search=search,
    )
    res["items"] = [ws.washroom_out(w) for w in res["items"]]
    return res


@router.get("/employees")
async def list_employees(
    property_uid: str | None = Query(default=None),
    zone_uid: str | None = Query(default=None),
    department: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    res = await WorkspaceRepository(session).list_employees(
        user,
        property_id=_uid(property_uid),
        zone_id=_uid(zone_uid),
        department=department,
        status=status_,
        search=search,
    )
    res["items"] = [ws.employee_out(e) for e in res["items"]]
    return res


@router.get("/tasks")
async def list_tasks(
    property_uid: str | None = Query(default=None),
    zone_uid: str | None = Query(default=None),
    employee_uid: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    task_type: str | None = Query(default=None),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=500),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    res = await WorkspaceRepository(session).list_tasks(
        user,
        property_id=_uid(property_uid),
        zone_id=_uid(zone_uid),
        employee_id=_uid(employee_uid),
        status=status_,
        task_type=task_type,
        search=search,
        page=page,
        limit=limit,
    )
    tasks = res["items"]
    from app.models.structure import Dorm, Room, Washroom, Zone
    zone_ids = {t.zone_id for t in tasks if t.zone_id}
    room_ids = {t.room_id for t in tasks if t.room_id}
    dorm_ids = {t.dorm_id for t in tasks if t.dorm_id}
    washroom_ids = {t.washroom_id for t in tasks if t.washroom_id}
    zones = {
        z.id: z for z in (await session.execute(
            select(Zone).where(Zone.id.in_(zone_ids))
        )).scalars()
    } if zone_ids else {}
    rooms = {
        r.id: r for r in (await session.execute(
            select(Room).where(Room.id.in_(room_ids))
        )).scalars()
    } if room_ids else {}
    dorms = {
        d.id: d for d in (await session.execute(
            select(Dorm).where(Dorm.id.in_(dorm_ids))
        )).scalars()
    } if dorm_ids else {}
    washrooms = {
        w.id: w for w in (await session.execute(
            select(Washroom).where(Washroom.id.in_(washroom_ids))
        )).scalars()
    } if washroom_ids else {}
    for task in tasks:
        zone = zones.get(task.zone_id)
        unit = rooms.get(task.room_id) or dorms.get(task.dorm_id) \
            or washrooms.get(task.washroom_id)
        task._resolved_area_id = zone.area_id if zone and zone.area_id else (
            unit.area_id if unit else None
        )
    res["items"] = [ws.task_out(t) for t in tasks]
    return res


@router.get("/tasks/today")
async def tasks_today(
    property_uid: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Today's operational schedule — generated task instances PLUS
    scheduled template occurrences that haven't generated yet."""
    from app.services.task_ops import TaskOpsService
    return await TaskOpsService(session).today(user, _uid(property_uid))


@router.get("/tasks/history")
async def tasks_history(
    property_uid: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    zone_uid: str | None = Query(default=None),
    room_uid: str | None = Query(default=None),
    washroom_uid: str | None = Query(default=None),
    employee_uid: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    priority: str | None = Query(default=None),
    task_type: str | None = Query(default=None),
    source: str | None = Query(default=None),
    template_uid: str | None = Query(default=None),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Task History — every actual generated instance, with filters."""
    from app.services.task_ops import TaskOpsService
    from datetime import date as _date

    def _d(v):
        try:
            return _date.fromisoformat(v) if v else None
        except ValueError:
            return None

    return await TaskOpsService(session).history(
        user,
        property_id=_uid(property_uid),
        date_from=_d(date_from), date_to=_d(date_to),
        zone_id=_uid(zone_uid), room_id=_uid(room_uid),
        washroom_id=_uid(washroom_uid),
        employee_id=_uid(employee_uid),
        status=status_, priority=priority, task_type=task_type,
        source=source, template_id=_uid(template_uid), search=search,
        page=page, page_size=page_size,
    )


# ===========================================================================
# Mutations — staff only (super_admin / property_manager)
# ===========================================================================

Staff = Depends(require_property_manager)


@router.get("/tasks/pending-check")
async def tasks_pending_check(
    property_uid: str | None = Query(default=None),
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    """Pending Check — employee-submitted work awaiting PM review.
    Tasks in 'submitted' + maintenance tickets in 'resolved'."""
    from app.services.task_ops import TaskOpsService
    return await TaskOpsService(session).pending_check(user, _uid(property_uid))


# ------------------------------- Areas -----------------------------------

@router.post("/areas", status_code=status.HTTP_201_CREATED)
async def create_area(
    payload: AreaCreateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.area_out(await StructureService(session).create_area(user, payload))


@router.patch("/areas/{area_id}")
async def update_area(
    area_id: uuid.UUID,
    payload: AreaUpdateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.area_out(
        await StructureService(session).update_area(user, area_id, payload)
    )


@router.delete("/areas/{area_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_area(
    area_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    await StructureService(session).delete_area(user, area_id)


# ------------------------------- Zones -----------------------------------

@router.post("/zones", status_code=status.HTTP_201_CREATED)
async def create_zone(
    payload: ZoneCreateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.zone_out(await StructureService(session).create_zone(user, payload))


@router.patch("/zones/{zone_id}")
async def update_zone(
    zone_id: uuid.UUID,
    payload: ZoneUpdateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.zone_out(
        await StructureService(session).update_zone(user, zone_id, payload)
    )


@router.delete("/zones/{zone_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_zone(
    zone_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    await StructureService(session).delete_zone(user, zone_id)


# ------------------------------- Rooms -----------------------------------

@router.post("/rooms", status_code=status.HTTP_201_CREATED)
async def create_room(
    payload: RoomCreateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return await ws.room_payload(
        session, await StructureService(session).create_room(user, payload)
    )


@router.post("/rooms/bulk", status_code=status.HTTP_201_CREATED)
async def bulk_create_rooms(
    payload: RoomBulkCreateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    res = await StructureService(session).bulk_create_rooms(user, payload)
    return {
        "created": await ws.rooms_payload(session, res["created"]),
        "errors": res["errors"],
    }


@router.post("/rooms/bulk-delete")
async def bulk_delete_rooms(
    payload: RoomBulkDeleteRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return await StructureService(session).bulk_delete_rooms(user, payload)


@router.patch("/rooms/{room_id}")
async def update_room(
    room_id: uuid.UUID,
    payload: RoomUpdateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return await ws.room_payload(
        session,
        await StructureService(session).update_room(user, room_id, payload),
    )


@router.patch("/rooms/{room_id}/allocation")
async def allocate_room(
    room_id: uuid.UUID,
    payload: AllocationRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    from app.models.structure import Room

    room = await StructureService(session).allocate_unit(
        user, Room, room_id, payload.area_uid, payload.zone_uid
    )
    return await ws.room_payload(session, room)


@router.delete("/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(
    room_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    await StructureService(session).delete_room(user, room_id)


# ------------------------------- Dorms / Beds -----------------------------

@router.post("/dorms", status_code=status.HTTP_201_CREATED)
async def create_dorm(
    payload: DormCreateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return await ws.dorm_payload(
        session, await StructureService(session).create_dorm(user, payload)
    )


@router.post("/dorms/bulk", status_code=status.HTTP_201_CREATED)
async def bulk_create_dorms(
    payload: DormBulkCreateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    res = await StructureService(session).bulk_create_dorms(user, payload)
    return {
        "created": await ws.dorms_payload(session, res["created"]),
        "errors": res["errors"],
    }


@router.patch("/dorms/{dorm_id}")
async def update_dorm(
    dorm_id: uuid.UUID,
    payload: DormUpdateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return await ws.dorm_payload(
        session,
        await StructureService(session).update_dorm(user, dorm_id, payload),
    )


@router.patch("/dorms/{dorm_id}/allocation")
async def allocate_dorm(
    dorm_id: uuid.UUID,
    payload: AllocationRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    from app.models.structure import Dorm

    dorm = await StructureService(session).allocate_unit(
        user, Dorm, dorm_id, payload.area_uid, payload.zone_uid
    )
    return await ws.dorm_payload(session, dorm)


@router.delete("/dorms/{dorm_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dorm(
    dorm_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    await StructureService(session).delete_dorm(user, dorm_id)


@router.post("/dorms/{dorm_id}/checkout")
async def dorm_checkout(
    dorm_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    res = await StructureService(session).dorm_checkout(user, dorm_id)
    return {
        **await ws.dorm_payload(session, res["dorm"]),
        "generated_tasks": [ws.task_out(t) for t in res["generated"]],
    }


@router.post("/dorms/{dorm_id}/mark-cleaning")
async def dorm_mark_cleaning(
    dorm_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return await ws.dorm_payload(
        session,
        await StructureService(session).dorm_mark_cleaning(user, dorm_id),
    )


@router.post("/dorms/{dorm_id}/mark-cleaned")
async def dorm_mark_cleaned(
    dorm_id: uuid.UUID,
    user: User = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    return await ws.dorm_payload(
        session,
        await StructureService(session).dorm_mark_cleaned(user, dorm_id),
    )


# --- Occupancy commands — OCCUPIED is a business state backed by an
# `occupancies` row, never a raw status write (spec §11/§26) --------------

@router.post("/rooms/{room_id}/check-in")
async def room_check_in(
    room_id: uuid.UUID,
    payload: CheckInRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    from app.services.occupancy import OccupancyService
    room = await OccupancyService(session).check_in_room(
        user, room_id, payload.guest_name
    )
    return await ws.room_payload(session, room)


@router.post("/rooms/{room_id}/check-out")
async def room_check_out(
    room_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    from app.services.occupancy import OccupancyService
    res = await OccupancyService(session).check_out_room(user, room_id)
    return {
        **await ws.room_payload(session, res["room"]),
        "generated_tasks": [ws.task_out(t) for t in res["generated"]],
    }


@router.post("/beds/{bed_id}/check-in")
async def bed_check_in(
    bed_id: uuid.UUID,
    payload: CheckInRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    from app.services.occupancy import OccupancyService
    dorm = await OccupancyService(session).check_in_bed(
        user, bed_id, payload.guest_name
    )
    return await ws.dorm_payload(session, dorm)


@router.post("/beds/{bed_id}/check-out")
async def bed_check_out(
    bed_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    from app.services.occupancy import OccupancyService
    res = await OccupancyService(session).check_out_bed(user, bed_id)
    return {
        **await ws.dorm_payload(session, res["dorm"]),
        "generated_tasks": [ws.task_out(t) for t in res["generated"]],
    }


@router.post("/resources/{resource_type}/{resource_id}/transition")
async def resource_transition(
    resource_type: str,
    resource_id: uuid.UUID,
    payload: ResourceTransitionRequest,
    user: User = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    """Super Admin administrative transition — legal-transition validation
    applies; ADMIN_OVERRIDE events are recorded with the mandatory reason."""
    from app.domain.resource_events import SRC_ADMIN_OVERRIDE
    from app.models.property import Property
    from app.services.resource_state import ResourceStateService

    svc = ResourceStateService(session)
    row, prev, new = await svc.transition(
        resource_type, resource_id, payload.to, user=user,
        source=SRC_ADMIN_OVERRIDE, reason=payload.reason,
    )
    prop = await session.get(Property, row.property_id)
    if prop is None or prop.company_id != user.company_id:
        raise NotFound()
    await session.commit()
    return {
        "resource_type": resource_type,
        "resource_id": str(resource_id),
        "previous_state": prev,
        "new_state": new,
    }


@router.post("/resources/{resource_type}/{resource_id}/repair")
async def resource_repair(
    resource_type: str,
    resource_id: uuid.UUID,
    user: User = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    """Super Admin reconciliation-repair — rewrites the materialized
    status to the canonical projection (occupancy + blockers) with a
    `state_reconciliation` audit event. Never deletes occupancy, task or
    ticket records."""
    from app.models.property import Property
    from app.services.resource_state import ResourceStateService

    result = await ResourceStateService(session).repair(
        resource_type, resource_id, user=user,
    )
    await session.commit()
    return result


# ------------------------------- Washrooms --------------------------------

@router.post("/washrooms", status_code=status.HTTP_201_CREATED)
async def create_washroom(
    payload: WashroomCreateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.washroom_out(
        await StructureService(session).create_washroom(user, payload)
    )


@router.post("/washrooms/bulk", status_code=status.HTTP_201_CREATED)
async def bulk_create_washrooms(
    payload: WashroomBulkCreateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    res = await StructureService(session).bulk_create_washrooms(user, payload)
    return {
        "created": [ws.washroom_out(w) for w in res["created"]],
        "errors": res["errors"],
    }


@router.get("/washrooms/{washroom_id}")
async def get_washroom(
    washroom_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    from app.models.structure import Washroom

    washroom, _ = await StructureService(session)._get(
        Washroom, washroom_id, user,
        options=[selectinload(Washroom.fixtures)],
    )
    return ws.washroom_out(washroom)


@router.patch("/washrooms/{washroom_id}")
async def update_washroom(
    washroom_id: uuid.UUID,
    payload: WashroomUpdateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.washroom_out(
        await StructureService(session).update_washroom(
            user, washroom_id, payload
        )
    )


@router.patch("/washrooms/{washroom_id}/allocation")
async def allocate_washroom(
    washroom_id: uuid.UUID,
    payload: AllocationRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    washroom = await StructureService(session).allocate_washroom(
        user, washroom_id, payload.area_uid, payload.zone_uid
    )
    return ws.washroom_out(washroom)


@router.patch("/washrooms/{washroom_id}/fixtures/{fixture_id}")
async def update_washroom_fixture(
    washroom_id: uuid.UUID,
    fixture_id: uuid.UUID,
    payload: WashroomFixtureUpdateRequest,
    user: User = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    return ws.washroom_out(
        await StructureService(session).update_fixture(
            user, washroom_id, fixture_id, payload.status
        )
    )


@router.delete("/washrooms/{washroom_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_washroom(
    washroom_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    await StructureService(session).delete_washroom(user, washroom_id)


@router.post("/units/bulk-status")
async def bulk_unit_status(
    payload: BulkUnitStatusRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    res = await StructureService(session).bulk_unit_status(user, payload)
    return {
        "rooms": await ws.rooms_payload(session, res["rooms"]),
        "dorms": await ws.dorms_payload(session, res["dorms"]),
        "washrooms": [ws.washroom_out(w) for w in res["washrooms"]],
        "generated_tasks": [ws.task_out(t) for t in res["generated_tasks"]],
        "skipped_blocked": res["skipped_blocked"],
    }


# ------------------------------- Employees --------------------------------

@router.post("/employees", status_code=status.HTTP_201_CREATED)
async def create_employee(
    payload: EmployeeCreateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.employee_out(
        await EmployeeService(session).create_employee(user, payload)
    )


@router.patch("/employees/{employee_id}")
async def update_employee(
    employee_id: uuid.UUID,
    payload: EmployeeUpdateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.employee_out(
        await EmployeeService(session).update_employee(user, employee_id, payload)
    )


@router.patch("/employees/{employee_id}/zone")
async def assign_employee_zone(
    employee_id: uuid.UUID,
    payload: EmployeeZoneAssignRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.employee_out(
        await EmployeeService(session).assign(
            user, employee_id,
            zone_uid=payload.zone_uid, area_uid=payload.area_uid,
        )
    )


@router.patch("/employees/{employee_id}/allocation")
async def allocate_employee(
    employee_id: uuid.UUID,
    payload: EmployeeAllocationRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.employee_out(
        await EmployeeService(session).assign(
            user, employee_id,
            zone_uid=payload.zone_uid, area_uid=payload.area_uid,
        )
    )


@router.post("/employees/{employee_id}/deactivate")
async def deactivate_employee(
    employee_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.employee_out(
        await EmployeeService(session).deactivate(user, employee_id)
    )


@router.post("/employees/{employee_id}/reactivate")
async def reactivate_employee(
    employee_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.employee_out(
        await EmployeeService(session).reactivate(user, employee_id)
    )


@router.delete("/employees/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_employee(
    employee_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    await EmployeeService(session).delete_employee(user, employee_id)


# ------------------------------- Tasks ------------------------------------

@router.post("/tasks", status_code=status.HTTP_201_CREATED)
async def create_task(
    payload: TaskCreateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.task_out(await TaskService(session).create_task(user, payload))


@router.get("/tasks/{task_id}")
async def get_task(
    task_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Task detail — history, completion images and submissions eager-loaded.
    The list payload intentionally omits those collections; the Detail
    Drawer calls this endpoint when a task is opened."""
    return ws.task_out(await TaskService(session).get_task(user, task_id))


@router.patch("/tasks/{task_id}")
async def update_task(
    task_id: uuid.UUID,
    payload: TaskUpdateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.task_out(
        await TaskService(session).update_task(user, task_id, payload)
    )


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    await TaskService(session).delete_task(user, task_id)


@router.post("/tasks/{task_id}/start")
async def start_task(
    task_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    return ws.task_out(await TaskService(session).start_task(user, task_id))


@router.post("/tasks/{task_id}/complete")
async def complete_task(
    task_id: uuid.UUID,
    payload: TaskCompleteRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    res = await TaskService(session).complete_task(user, task_id, payload)
    out = {"task": ws.task_out(res["task"])}
    if res.get("generated_task"):
        out["generated_task"] = ws.task_out(res["generated_task"])
    return out


@router.post("/tasks/{task_id}/request-redo")
async def request_redo(
    task_id: uuid.UUID,
    payload: TaskActionRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    return ws.task_out(
        await TaskService(session).request_redo(user, task_id, payload.note)
    )


@router.patch("/tasks/{task_id}/assignee")
async def reassign_task(
    task_id: uuid.UUID,
    payload: TaskReassignRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.task_out(
        await TaskService(session).reassign(user, task_id, payload.employee_uid)
    )


# ------- Task ticket review workflow: submit → approve/reject → reopen -------

@router.post("/tasks/{task_id}/submit")
async def submit_task(
    task_id: uuid.UUID,
    payload: TaskSubmitRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    return ws.task_out(await TaskService(session).submit_task(user, task_id, payload))


@router.post("/tasks/{task_id}/approve")
async def approve_task(
    task_id: uuid.UUID,
    payload: TaskActionRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    res = await TaskService(session).approve_task(user, task_id, payload.note)
    out = {"task": ws.task_out(res["task"])}
    if res.get("generated_task"):
        out["generated_task"] = ws.task_out(res["generated_task"])
    return out


@router.post("/tasks/{task_id}/reject")
async def reject_task(
    task_id: uuid.UUID,
    payload: TaskRejectRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.task_out(
        await TaskService(session).reject_task(user, task_id, payload.reason)
    )


@router.delete("/tasks/{task_id}/completion-images/{image_id}")
async def delete_task_completion_image(
    task_id: uuid.UUID,
    image_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.task_out(
        await TaskService(session).delete_completion_image(user, task_id, image_id)
    )


@router.post("/tasks/{task_id}/reopen")
async def reopen_task(
    task_id: uuid.UUID,
    payload: TaskActionRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.task_out(
        await TaskService(session).reopen_task(user, task_id, payload.note)
    )


# ------------------------------- Maintenance tickets ------------------------

@router.post("/maintenance", status_code=status.HTTP_201_CREATED)
async def create_maintenance_ticket(
    payload: MaintenanceCreateRequest,
    user: User = Depends(require_employee),
    session: AsyncSession = Depends(get_db),
):
    """Managers/admins raise tickets anywhere; EMPLOYEE callers are
    restricted to locations inside their zone/area coverage — enforced
    in the service, not the frontend."""
    return ticket_out(
        await MaintenanceService(session).create_ticket(user, payload)
    )


@router.get("/maintenance/eligible-locations")
async def maintenance_eligible_locations(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Employee-facing: rooms/dorms inside the caller's zone/area coverage.
    Returns empty lists when the employee has no assignment — never a
    full-property fallback."""
    return await MaintenanceService(session).eligible_locations(user)


@router.get("/maintenance")
async def list_maintenance(
    property_uid: str | None = Query(default=None),
    room_uid: str | None = Query(default=None),
    washroom_uid: str | None = Query(default=None),
    assigned_to: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    priority: str | None = Query(default=None),
    search: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    tickets = await MaintenanceService(session).list_tickets(
        user,
        property_id=_uid(property_uid),
        room_id=_uid(room_uid),
        washroom_id=_uid(washroom_uid),
        assigned_to=_uid(assigned_to),
        status_=status_,
        priority=priority,
        search=search,
    )
    return {"items": [ticket_out(t) for t in tickets], "total": len(tickets)}


@router.get("/maintenance/{ticket_id}")
async def get_maintenance_ticket(
    ticket_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    return ticket_out(
        await MaintenanceService(session).get_ticket(user, ticket_id)
    )


@router.patch("/maintenance/{ticket_id}")
async def update_maintenance_ticket(
    ticket_id: uuid.UUID,
    payload: MaintenanceUpdateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ticket_out(
        await MaintenanceService(session).update_ticket(user, ticket_id, payload)
    )


@router.delete("/maintenance/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_maintenance_ticket(
    ticket_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    await MaintenanceService(session).delete_ticket(user, ticket_id)


@router.post("/maintenance/{ticket_id}/assign")
async def assign_maintenance_ticket(
    ticket_id: uuid.UUID,
    payload: MaintenanceAssignRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ticket_out(
        await MaintenanceService(session).assign(
            user, ticket_id, payload.employee_uid
        )
    )


@router.post("/maintenance/{ticket_id}/start")
async def start_maintenance_ticket(
    ticket_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    return ticket_out(await MaintenanceService(session).start(user, ticket_id))


@router.post("/maintenance/{ticket_id}/hold")
async def hold_maintenance_ticket(
    ticket_id: uuid.UUID,
    payload: MaintenanceActionRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ticket_out(
        await MaintenanceService(session).hold(user, ticket_id, payload.note)
    )


@router.post("/maintenance/{ticket_id}/resolve")
async def resolve_maintenance_ticket(
    ticket_id: uuid.UUID,
    payload: MaintenanceResolveRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    return ticket_out(
        await MaintenanceService(session).resolve(user, ticket_id, payload)
    )


@router.post("/maintenance/{ticket_id}/disapprove")
async def disapprove_maintenance_ticket(
    ticket_id: uuid.UUID,
    payload: MaintenanceDisapproveRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ticket_out(
        await MaintenanceService(session).disapprove(
            user, ticket_id, payload.reason
        )
    )


@router.post("/maintenance/{ticket_id}/close")
async def close_maintenance_ticket(
    ticket_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ticket_out(await MaintenanceService(session).close(user, ticket_id))


@router.get("/washrooms/{washroom_id}/maintenance")
async def washroom_maintenance_history(
    washroom_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    tickets = await MaintenanceService(session).washroom_history(
        user, washroom_id
    )
    return {"items": [ticket_out(t) for t in tickets], "total": len(tickets)}


@router.get("/rooms/{room_id}/maintenance")
async def room_maintenance_history(
    room_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    tickets = await MaintenanceService(session).room_history(user, room_id)
    return {"items": [ticket_out(t) for t in tickets], "total": len(tickets)}


# ------------------------------- Property update/delete --------------------

@router.patch("/properties/{property_id}")
async def update_property(
    property_id: uuid.UUID,
    payload: PropertyUpdateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.property_out(
        await PropertyService(session).update_property(user, property_id, payload)
    )


@router.delete("/properties/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_property(
    property_id: uuid.UUID,
    user: User = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    await PropertyService(session).delete_property(user, property_id)


# ------------------------------- Company -----------------------------------

@router.get("/companies/{company_id}")
async def get_company(
    company_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    if company_id != user.company_id:
        raise NotFound("Company not found.")
    from app.repositories.company import CompanyRepository
    from app.schemas.auth import company_to_out

    company = await CompanyRepository(session).get_by_id(company_id)
    if company is None:
        raise NotFound("Company not found.")
    return company_to_out(company)


@router.patch("/companies/{company_id}")
async def update_company(
    company_id: uuid.UUID,
    payload: CompanyUpdateRequest,
    user: User = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    if company_id != user.company_id:
        raise NotFound("Company not found.")
    from app.repositories.company import CompanyRepository
    from app.schemas.auth import company_to_out

    company = await CompanyRepository(session).get_by_id(company_id)
    if company is None:
        raise NotFound("Company not found.")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        data["company_name"] = data.pop("name")
    if "phone" in data:
        data["phone_number"] = data.pop("phone")
    for k, v in data.items():
        setattr(company, k, v)
    await session.commit()
    return company_to_out(company)
