"""Read-only resource-state reconciliation (spec §43/§44).

Detects — never repairs — integrity contradictions in BOTH directions:

    CLEANING    without active work            (orphan_cleaning)
    MAINTENANCE without an open ticket         (orphan_maintenance)
    OCCUPIED    without an open occupancy      (orphan_occupied)
    open occupancy + status == 'available'     (occupancy_status_conflict)
    open occupancy + cleaning/maintenance      (occupied_under_work — info)
    blocking ticket + status != maintenance    (unflagged_ticket)
    started task + status not work-flagged     (unflagged_task)
    any status outside the canonical set       (invalid_state)

Returns a list of findings for administrative review. It deliberately does
NOT rewrite state — an authorized correction goes through
ResourceStateService.repair() (POST /resources/{type}/{id}/repair), which
rewrites only the materialized projection and never deletes work or
occupancy records.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.resource_states import (
    BED_STATUSES,
    BLOCKING_MAINTENANCE,
    BLOCKING_TASK,
    DORM_STATUSES,
    FIXTURE_STATUSES,
    ROOM_STATUSES,
    WASHROOM_STATUSES,
)
from app.models.maintenance import MaintenanceTicket
from app.models.occupancy import Occupancy
from app.models.structure import (
    Bed,
    Dorm,
    Room,
    Washroom,
    WashroomFixture,
)
from app.models.task import Task

# A task only flags its resource once work actually begins — queued
# (pending/assigned/scheduled) work legitimately leaves the unit free.
_STARTED_TASK = {"in_progress", "submitted", "reopened"}


async def _open_occupancy_for(session, *, room_id=None, bed_id=None) -> bool:
    cond = (
        Occupancy.room_id == room_id if room_id
        else Occupancy.bed_id == bed_id
    )
    res = await session.execute(
        select(Occupancy.id).where(cond, Occupancy.checked_out_at.is_(None))
        .limit(1)
    )
    return res.scalar_one_or_none() is not None


async def _dorm_open_occupancy(session, dorm_id) -> bool:
    res = await session.execute(
        select(Occupancy.id).where(
            Occupancy.bed_id.in_(
                select(Bed.id).where(Bed.dorm_id == dorm_id).scalar_subquery()
            ),
            Occupancy.checked_out_at.is_(None),
        ).limit(1)
    )
    return res.scalar_one_or_none() is not None


async def reconcile_property(
    session: AsyncSession, property_id: uuid.UUID
) -> list[dict]:
    findings: list[dict] = []

    def flag(rtype, rid, label, status, issue, detail,
             severity="conflict", recommended_action="repair",
             has_open_occupancy=None):
        findings.append({
            "resource_type": rtype,
            "resource_id": str(rid),
            "label": label,
            "status": status,
            "issue": issue,
            "severity": severity,
            "recommended_action": recommended_action,
            "has_open_occupancy": has_open_occupancy,
            "detail": detail,
        })

    async def task_blocker(kind, rid, dorm_id=None, statuses=None):
        statuses = statuses or BLOCKING_TASK
        if kind == "room":
            q = select(Task.id).where(
                Task.room_id == rid, Task.status.in_(statuses))
        elif kind == "washroom":
            q = select(Task.id).where(
                Task.washroom_id == rid, Task.status.in_(statuses))
        elif kind == "dorm":
            q = select(Task.id).where(
                Task.dorm_id == rid, Task.status.in_(statuses))
        else:  # bed — dorm task covering it
            res = await session.execute(
                select(Task.bed_ids).where(
                    Task.dorm_id == dorm_id, Task.status.in_(statuses))
            )
            return any(not ids or str(rid) in ids for ids in res.scalars())
        res = await session.execute(q.limit(1))
        return res.scalar_one_or_none() is not None

    async def ticket_blocker(kind, rid, dorm_id=None, washroom_id=None):
        q = select(MaintenanceTicket.id).where(
            MaintenanceTicket.status.in_(BLOCKING_MAINTENANCE))
        if kind == "room":
            q = q.where(MaintenanceTicket.room_id == rid)
        elif kind == "dorm":
            q = q.where(MaintenanceTicket.dorm_id == rid,
                        MaintenanceTicket.bed_id.is_(None))
        elif kind == "bed":
            q = q.where(
                (MaintenanceTicket.bed_id == rid)
                | ((MaintenanceTicket.dorm_id == dorm_id)
                   & MaintenanceTicket.bed_id.is_(None)))
        elif kind == "bed_own":   # bed-level ticket only (not dorm-wide)
            q = q.where(MaintenanceTicket.bed_id == rid)
        elif kind == "washroom":
            q = q.where(MaintenanceTicket.washroom_id == rid)
        else:  # fixture
            q = q.where(MaintenanceTicket.washroom_fixture_id == rid)
        res = await session.execute(q.limit(1))
        return res.scalar_one_or_none() is not None

    # --- rooms -----------------------------------------------------------
    res = await session.execute(
        select(Room).where(Room.property_id == property_id))
    for r in res.scalars():
        if r.status not in ROOM_STATUSES:
            flag("room", r.id, r.room_number, r.status, "invalid_state",
                 f"'{r.status}' is not a canonical room status",
                 severity="error")
            continue
        open_occ = await _open_occupancy_for(session, room_id=r.id)
        if r.status == "occupied":
            if not open_occ:
                flag("room", r.id, r.room_number, r.status,
                     "orphan_occupied", "occupied with no open occupancy",
                     has_open_occupancy=False)
        elif open_occ:
            if r.status == "available":
                flag("room", r.id, r.room_number, r.status,
                     "occupancy_status_conflict",
                     "available while an occupancy record is still open",
                     recommended_action="restore_occupied_projection",
                     has_open_occupancy=True)
            else:
                # cleaning/maintenance + open occupancy is the LEGAL
                # two-axis projection — reported for observability only
                flag("room", r.id, r.room_number, r.status,
                     "occupied_under_work",
                     "open occupancy while work blocks the unit",
                     severity="info", recommended_action="none",
                     has_open_occupancy=True)
        if r.status != "maintenance" \
                and await ticket_blocker("room", r.id):
            flag("room", r.id, r.room_number, r.status,
                 "unflagged_ticket",
                 "blocking maintenance ticket but unit is not maintenance")
        if r.status not in ("cleaning", "maintenance") \
                and await task_blocker("room", r.id,
                                       statuses=_STARTED_TASK):
            flag("room", r.id, r.room_number, r.status,
                 "unflagged_task",
                 "started task but unit is not cleaning/maintenance")

    # --- dorms + beds ------------------------------------------------------
    res = await session.execute(
        select(Dorm).where(Dorm.property_id == property_id))
    for d in res.scalars():
        if d.status not in DORM_STATUSES:
            flag("dorm", d.id, d.name, d.status, "invalid_state",
                 f"'{d.status}' is not a canonical dorm status",
                 severity="error")
            continue
        dorm_occ = await _dorm_open_occupancy(session, d.id)
        if d.status == "occupied":
            if not dorm_occ:
                flag("dorm", d.id, d.name, d.status, "orphan_occupied",
                     "occupied with no open bed occupancy",
                     has_open_occupancy=False)
        elif dorm_occ and d.is_active:
            if d.status == "available":
                flag("dorm", d.id, d.name, d.status,
                     "occupancy_status_conflict",
                     "available while a bed occupancy is still open",
                     recommended_action="restore_occupied_projection",
                     has_open_occupancy=True)
            else:
                flag("dorm", d.id, d.name, d.status, "occupied_under_work",
                     "open bed occupancy while work blocks the dorm",
                     severity="info", recommended_action="none",
                     has_open_occupancy=True)
        if d.status != "maintenance" \
                and await ticket_blocker("dorm", d.id):
            flag("dorm", d.id, d.name, d.status, "unflagged_ticket",
                 "blocking dorm ticket but dorm is not maintenance")
        if d.status not in ("cleaning", "maintenance") \
                and await task_blocker("dorm", d.id,
                                       statuses=_STARTED_TASK):
            flag("dorm", d.id, d.name, d.status, "unflagged_task",
                 "started dorm task but dorm is not cleaning/maintenance")

    res = await session.execute(
        select(Bed).join(Dorm, Bed.dorm_id == Dorm.id)
        .where(Dorm.property_id == property_id))
    for b in res.scalars():
        if b.status not in BED_STATUSES:
            flag("bed", b.id, b.bed_number, b.status, "invalid_state",
                 f"'{b.status}' is not a canonical bed status",
                 severity="error")
            continue
        open_occ = await _open_occupancy_for(session, bed_id=b.id)
        if b.status == "occupied":
            if not open_occ:
                flag("bed", b.id, b.bed_number, b.status, "orphan_occupied",
                     "occupied with no open occupancy")
        elif open_occ and b.status != "inactive":
            if b.status == "available":
                flag("bed", b.id, b.bed_number, b.status,
                     "occupancy_status_conflict",
                     "available while an occupancy record is still open",
                     recommended_action="restore_occupied_projection",
                     has_open_occupancy=True)
            else:
                flag("bed", b.id, b.bed_number, b.status,
                     "occupied_under_work",
                     "open occupancy while work blocks the bed",
                     severity="info", recommended_action="none",
                     has_open_occupancy=True)
        # a bed-LEVEL ticket must flag the bed even when occupied; a
        # dorm-wide ticket legitimately skips occupied/inactive beds
        if b.status != "maintenance":
            if await ticket_blocker("bed_own", b.id) or (
                b.status not in ("occupied", "inactive")
                and await ticket_blocker("dorm", b.dorm_id)
            ):
                flag("bed", b.id, b.bed_number, b.status,
                     "unflagged_ticket",
                     "blocking maintenance ticket but bed is not "
                     "maintenance")
        if b.status not in ("cleaning", "maintenance", "inactive") \
                and await task_blocker("bed", b.id, dorm_id=b.dorm_id,
                                       statuses=_STARTED_TASK):
            flag("bed", b.id, b.bed_number, b.status, "unflagged_task",
                 "started covering task but bed is not "
                 "cleaning/maintenance")

    # --- washrooms ---------------------------------------------------------
    res = await session.execute(
        select(Washroom).where(Washroom.property_id == property_id))
    for w in res.scalars():
        if w.status not in WASHROOM_STATUSES:
            flag("washroom", w.id, w.name, w.status, "invalid_state",
                 f"'{w.status}' is not a canonical washroom status",
                 severity="error")
            continue
        if w.status == "cleaning":
            if not await task_blocker("washroom", w.id):
                flag("washroom", w.id, w.name, w.status, "orphan_cleaning",
                     "cleaning with no active work")
        elif w.status == "maintenance":
            if not await ticket_blocker("washroom", w.id):
                flag("washroom", w.id, w.name, w.status,
                     "orphan_maintenance", "maintenance with no open ticket")
        if w.status != "maintenance" \
                and await ticket_blocker("washroom", w.id):
            flag("washroom", w.id, w.name, w.status, "unflagged_ticket",
                 "blocking ticket but washroom is not maintenance")
        if w.status not in ("cleaning", "maintenance", "inactive") \
                and await task_blocker("washroom", w.id,
                                       statuses=_STARTED_TASK):
            flag("washroom", w.id, w.name, w.status, "unflagged_task",
                 "started task but washroom is not cleaning/maintenance")

    # --- fixtures ------------------------------------------------------------
    res = await session.execute(
        select(WashroomFixture).join(
            Washroom, WashroomFixture.washroom_id == Washroom.id)
        .where(Washroom.property_id == property_id))
    for f in res.scalars():
        if f.status not in FIXTURE_STATUSES:
            flag("fixture", f.id, f"{f.fixture_type} {f.fixture_number}",
                 f.status, "invalid_state",
                 f"'{f.status}' is not a canonical fixture status",
                 severity="error")
        elif f.status == "maintenance":
            if not await ticket_blocker("fixture", f.id):
                flag("fixture", f.id, f"{f.fixture_type} {f.fixture_number}",
                     f.status, "orphan_maintenance",
                     "fixture in maintenance with no open ticket")
        if f.status == "operational" \
                and await ticket_blocker("fixture", f.id):
            flag("fixture", f.id, f"{f.fixture_type} {f.fixture_number}",
                 f.status, "unflagged_ticket",
                 "blocking ticket but fixture is operational")

    return findings
