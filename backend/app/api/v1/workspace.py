"""
Workspace read endpoints — the collections the frontend's `loadWorkspace`
fetches on sign-in. All scoped to the caller's company (super_admin) or
assigned property (property_manager/employee).
"""

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import AppError
from app.dependencies.auth import (
    get_current_user,
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
    MaintenanceResolveRequest,
    MaintenanceUpdateRequest,
    ticket_out,
)
from app.schemas.structure import (
    AllocationRequest,
    AreaCreateRequest,
    AreaUpdateRequest,
    BedStatusUpdateRequest,
    BulkUnitStatusRequest,
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
    res["items"] = [ws.room_out(r) for r in res["items"]]
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
    res["items"] = [ws.dorm_out(d) for d in res["items"]]
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
    )
    res["items"] = [ws.task_out(t) for t in res["items"]]
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
        employee_id=_uid(employee_uid),
        status=status_, priority=priority, task_type=task_type,
        source=source, template_id=_uid(template_uid), search=search,
        page=page, page_size=page_size,
    )


# ===========================================================================
# Mutations — staff only (super_admin / property_manager)
# ===========================================================================

Staff = Depends(require_property_manager)


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
    return ws.room_out(await StructureService(session).create_room(user, payload))


@router.post("/rooms/bulk", status_code=status.HTTP_201_CREATED)
async def bulk_create_rooms(
    payload: RoomBulkCreateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    res = await StructureService(session).bulk_create_rooms(user, payload)
    return {
        "created": [ws.room_out(r) for r in res["created"]],
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
    return ws.room_out(
        await StructureService(session).update_room(user, room_id, payload)
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
    return ws.room_out(room)


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
    return ws.dorm_out(await StructureService(session).create_dorm(user, payload))


@router.patch("/dorms/{dorm_id}")
async def update_dorm(
    dorm_id: uuid.UUID,
    payload: DormUpdateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.dorm_out(
        await StructureService(session).update_dorm(user, dorm_id, payload)
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
    return ws.dorm_out(dorm)


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
    return ws.dorm_out(await StructureService(session).dorm_checkout(user, dorm_id))


@router.post("/dorms/{dorm_id}/mark-cleaning")
async def dorm_mark_cleaning(
    dorm_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ws.dorm_out(
        await StructureService(session).dorm_mark_cleaning(user, dorm_id)
    )


@router.patch("/beds/{bed_id}/status")
async def update_bed_status(
    bed_id: uuid.UUID,
    payload: BedStatusUpdateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    dorm = await StructureService(session).update_bed_status(
        user, bed_id, payload.status, payload.guest_name
    )
    return ws.dorm_out(dorm)


@router.post("/units/bulk-status")
async def bulk_unit_status(
    payload: BulkUnitStatusRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    res = await StructureService(session).bulk_unit_status(user, payload)
    return {
        "rooms": [ws.room_out(r) for r in res["rooms"]],
        "dorms": [ws.dorm_out(d) for d in res["dorms"]],
        "generated_tasks": [ws.task_out(t) for t in res["generated_tasks"]],
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
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ticket_out(
        await MaintenanceService(session).create_ticket(user, payload)
    )


@router.get("/maintenance")
async def list_maintenance(
    property_uid: str | None = Query(default=None),
    room_uid: str | None = Query(default=None),
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


@router.post("/maintenance/{ticket_id}/close")
async def close_maintenance_ticket(
    ticket_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return ticket_out(await MaintenanceService(session).close(user, ticket_id))


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
