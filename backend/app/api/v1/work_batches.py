"""
Work allocation batches — grouped ticket creation.

POST /work-batches creates N tickets grouped by their resolved UNIT
(room → the room; bed → its dorm; dorm → the dorm — resolved server-side,
never trusted from the payload). All maintenance items belonging to one
room land on ONE employee; each unit advances the zone's persistent
round-robin pointer once, so a multi-room batch distributes A, B, C…
across rooms instead of stacking everything on one assignee.
"""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies.auth import get_current_user, require_property_manager
from app.models.maintenance import MaintenanceTicket
from app.models.task import Task, TaskCompletionSubmission
from app.models.user import User
from app.models.work_allocation import WorkAllocationBatch
from app.schemas.maintenance import MaintenanceCreateRequest, ticket_out
from app.schemas.workspace import task_out
from app.schemas.work_allocation import WorkBatchCreateRequest, batch_out
from app.services.maintenance import MaintenanceService
from app.services.structure import NotFoundErr, StructureService, ValidationErr
from app.services.work_allocation import WorkAllocationService

router = APIRouter()

Staff = Depends(require_property_manager)


@router.post("/work-batches", status_code=status.HTTP_201_CREATED)
async def create_work_batch(
    payload: WorkBatchCreateRequest,
    # Any authenticated user (incl. employees) may raise a batch — per-item
    # authorization runs inside MaintenanceService.create_ticket, which
    # rejects out-of-coverage employee targets with 403.
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    svc = MaintenanceService(session)
    structure = StructureService(session)
    alloc = WorkAllocationService(session)
    prop = await structure._property_for_write(user, payload.property_uid)

    # Phase 1 — validate every item and resolve its zone from the DB
    resolved: list[dict] = []
    for item in payload.tickets:
        if item.kind == "task":
            raise ValidationErr(
                "Task batching is not supported yet — submit maintenance "
                "tickets in a work batch.",
                field="kind",
            )
        req = MaintenanceCreateRequest(
            property_uid=payload.property_uid,
            room_uid=item.room_uid,
            dorm_uid=item.dorm_uid,
            bed_uid=item.bed_uid,
            washroom_uid=item.washroom_uid,
            washroom_fixture_uid=item.washroom_fixture_uid,
            maintenance_type=item.maintenance_type or "",
            issue=item.issue or "",
            description=item.description,
            priority=item.priority,
            due_date=item.due_date,
            attachment_urls=item.attachment_urls,
        )
        room, dorm, bed, washroom, _fixture = await svc._resolve_target(prop, req)
        from app.services.task_location import resolve_task_location
        location = await resolve_task_location(
            session, property_id=prop.id,
            room_id=room.id if room else None,
            dorm_id=dorm.id if dorm else None,
            bed_id=bed.id if bed else None,
            washroom_id=washroom.id if washroom else None,
        )
        # allocation unit = the physical unit: a room, or the dorm that owns
        # the bed. Same unit → same employee; different units rotate.
        unit = (
            room.id if room else
            washroom.id if washroom else
            dorm.id if dorm else
            (bed.dorm_id if bed else None)
        )
        resolved.append({
            "req": req, "zone_id": location.zone_id,
            "area_id": location.area_id,
            "area_name": location.area.name if location.area else None,
            "unit": unit,
        })

    # Phase 2 — group by unit, allocate ONE employee per unit group.
    # All of a room's maintenance items share one assignee; the round-robin
    # pointer advances once per unit so multi-room batches spread fairly.
    by_unit: dict[tuple, list[dict]] = {}
    for r in resolved:
        by_unit.setdefault((r["zone_id"], r["unit"]), []).append(r)

    from app.models.structure import Zone

    out_batches: list[dict] = []
    zone_names: dict[uuid.UUID | None, str | None] = {}
    for (zone_id, _unit), items in by_unit.items():
        zname = zone_names.get(zone_id)
        if zone_id and zname is None:
            res = await session.execute(select(Zone).where(Zone.id == zone_id))
            z = res.scalar_one_or_none()
            zname = zone_names[zone_id] = z.name if z else None
        result = await alloc.allocate(
            user,
            property_id=prop.id,
            zone_id=zone_id,
            zone_name=zname,
            work_type="maintenance",
            manager_employee_id=prop.manager_employee_id,
            area_id=items[0]["area_id"],
            area_name=items[0]["area_name"],
        )
        tickets = []
        for it in items:
            t = await svc.create_ticket(
                user, it["req"], allocation=result, commit=False
            )
            tickets.append(ticket_out(t))
        out_batches.append(batch_out(result.batch, tickets))

    await session.commit()
    return {"batches": out_batches, "total": len(out_batches)}


@router.get("/work-batches/{batch_id}")
async def get_work_batch(
    batch_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    res = await session.execute(
        select(WorkAllocationBatch).where(WorkAllocationBatch.id == batch_id)
    )
    batch = res.scalar_one_or_none()
    if batch is None:
        raise NotFoundErr("Batch not found.")
    await StructureService(session)._property_for_write(user, batch.property_id)

    tickets = await _batch_tickets(session, batch.id)
    return batch_out(batch, tickets)


@router.get("/properties/{property_id}/work-batches")
async def list_work_batches(
    property_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    await StructureService(session)._property_for_write(user, property_id)
    res = await session.execute(
        select(WorkAllocationBatch)
        .where(WorkAllocationBatch.property_id == property_id)
        .order_by(WorkAllocationBatch.created_at.desc())
        .limit(100)
    )
    batches = list(res.scalars())
    return {
        "items": [
            batch_out(b, await _batch_tickets(session, b.id)) for b in batches
        ],
        "total": len(batches),
    }


async def _batch_tickets(session: AsyncSession, batch_id: uuid.UUID) -> list[dict]:
    from sqlalchemy.orm import selectinload

    res = await session.execute(
        select(MaintenanceTicket)
        .where(MaintenanceTicket.allocation_batch_id == batch_id)
        .options(
            selectinload(MaintenanceTicket.events),
            selectinload(MaintenanceTicket.attachments),
        )
    )
    tickets = [ticket_out(t) for t in res.scalars()]
    res = await session.execute(
        select(Task)
        .where(Task.allocation_batch_id == batch_id)
        .options(
            selectinload(Task.history),
            selectinload(Task.completion_images),
            selectinload(Task.completion_submissions)
            .selectinload(TaskCompletionSubmission.images),
        )
    )
    tickets += [task_out(t) for t in res.scalars()]
    return tickets
