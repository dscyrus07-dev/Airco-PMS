"""
Work allocation batches — grouped ticket creation.

POST /work-batches creates N tickets as ONE allocation operation:
tickets are grouped by their resolved zone (rooms → room.zone_id, beds →
dorm.zone_id, dorms → dorm.zone_id — resolved server-side, never trusted
from the payload), one round-robin employee is picked per zone, and every
ticket in that zone's batch lands on that employee. The pointer advances
once per zone batch, never per ticket.
"""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies.auth import get_current_user, require_property_manager
from app.models.maintenance import MaintenanceTicket
from app.models.task import Task
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
    user: User = Staff,
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
            maintenance_type=item.maintenance_type or "",
            issue=item.issue or "",
            description=item.description,
            priority=item.priority,
            due_date=item.due_date,
            attachment_urls=item.attachment_urls,
        )
        room, dorm, bed = await svc._resolve_target(prop, req)
        zone_id = (room.zone_id if room else dorm.zone_id) if (room or dorm) else None
        resolved.append({"req": req, "zone_id": zone_id})

    # Phase 2 — group by zone, allocate ONE employee per zone group
    by_zone: dict[uuid.UUID | None, list[dict]] = {}
    for r in resolved:
        by_zone.setdefault(r["zone_id"], []).append(r)

    from app.models.structure import Zone

    out_batches: list[dict] = []
    for zone_id, items in by_zone.items():
        zname = None
        if zone_id:
            res = await session.execute(select(Zone).where(Zone.id == zone_id))
            z = res.scalar_one_or_none()
            zname = z.name if z else None
        result = await alloc.allocate(
            user,
            property_id=prop.id,
            zone_id=zone_id,
            zone_name=zname,
            work_type="maintenance",
            manager_employee_id=prop.manager_employee_id,
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
        .options(selectinload(Task.history))
    )
    tickets += [task_out(t) for t in res.scalars()]
    return tickets
