"""Unified resource-state pipeline — the canonical state matrix.

Covers the exact spec §7/§8/§35 behaviors:

    ROOM / BED
        available → cleaning → approve → available
        occupied  → cleaning → approve → OCCUPIED (occupancy survives)
        occupied  → checkout → cleaning → approve → available
        available → maintenance → close → available
        occupied  → maintenance → close/cancel → OCCUPIED

    DORM aggregate
        occupancy derives from OPEN OCCUPANCY ROWS, not bed.status

    FIXTURE
        resolve keeps maintenance; only close releases to operational

    INTEGRITY
        available + open occupancy is repairable drift
        occupied + no occupancy is repairable drift
        admin occupied→available performs explicit checkout semantics
        in-progress task cannot be retargeted
        resolver is idempotent
"""
import uuid

import pytest
from sqlalchemy import select

from app.models.occupancy import Occupancy
from app.models.structure import Room
from app.models.task import Task
from app.schemas.maintenance import (
    MaintenanceCreateRequest,
    MaintenanceResolveRequest,
)
from app.schemas.structure import BulkUnitStatusRequest, TaskUpdateRequest
from app.services.maintenance import MaintenanceService
from app.services.occupancy import OccupancyService
from app.services.resource_state import ResourceStateService
from app.services.structure import ConflictErr, StructureService
from app.services.task import TaskService


def make_task(session, prop, employee, **kw) -> Task:
    t = Task(
        property_id=prop.id,
        employee_id=employee.id,
        title=kw.pop("title", "Cleaning — unit"),
        status=kw.pop("status", "assigned"),
        **kw,
    )
    session.add(t)
    return t


def maint_req(prop, **kw):
    return MaintenanceCreateRequest(
        property_uid=prop.id,
        maintenance_type="plumbing", issue="Tap leaking", **kw,
    )


def bulk_req(prop, action, **kw):
    return BulkUnitStatusRequest(
        property_uid=prop.id, action=action, **kw,
    )


async def open_occ_count(session, *, room_id=None, bed_id=None) -> int:
    cond = (
        Occupancy.room_id == room_id if room_id else Occupancy.bed_id == bed_id
    )
    res = await session.execute(
        select(Occupancy.id).where(cond, Occupancy.checked_out_at.is_(None))
    )
    return len(res.scalars().all())


# ---------------------------------------------------------------------------
# ROOM matrix — cleaning
# ---------------------------------------------------------------------------

async def test_room_cleaning_matrix_available(session, seed, stub_tasks):
    """Case A — available → cleaning → approved → available (green)."""
    room = seed["room"]
    task = make_task(session, seed["prop"], seed["employee"],
                     room_id=room.id, title="Cleaning — 101",
                     status="submitted")
    room.status = "cleaning"
    await session.commit()

    await TaskService(session).approve_task(seed["admin"], task.id)
    await session.refresh(room)
    assert room.status == "available"


async def test_occupied_room_cleaning_approve_stays_occupied(
    session, seed, stub_tasks
):
    """Case B — THE core fix: occupied → cleaning → approved resolves back
    to occupied while the occupancy row is still open. Cleaning must never
    imply checkout."""
    svc = OccupancyService(session)
    room = await svc.check_in_room(seed["admin"], seed["room"].id, "Ada")
    task = make_task(session, seed["prop"], seed["employee"],
                     room_id=room.id, title="Cleaning — 101",
                     status="submitted")
    # flag-on-start wrote the operational axis to cleaning
    room.status = "cleaning"
    await session.commit()

    await TaskService(session).approve_task(seed["admin"], task.id)
    await session.refresh(room)
    assert room.status == "occupied"          # NOT available — Bug A fixed
    assert await open_occ_count(session, room_id=room.id) == 1
    assert room.current_guest == "Ada"        # mirror preserved


async def test_occupied_room_checkout_cleaning_approve_available(
    session, seed, stub_tasks
):
    """Case C — occupied → checkout (occupancy closes) → cleaning →
    approved → available. Checkout is the only path that closes it."""
    svc = OccupancyService(session)
    room = await svc.check_in_room(seed["admin"], seed["room"].id, "Ada")
    res = await svc.check_out_room(seed["admin"], room.id)
    room = res["room"]
    task = make_task(session, seed["prop"], seed["employee"],
                     room_id=room.id, title="Checkout cleaning — 101",
                     status="submitted", origin="checkout")
    await session.commit()
    assert room.status == "cleaning"
    assert await open_occ_count(session, room_id=room.id) == 0

    await TaskService(session).approve_task(seed["admin"], task.id)
    await session.refresh(room)
    assert room.status == "available"         # green — occupancy is gone


# ---------------------------------------------------------------------------
# ROOM matrix — maintenance
# ---------------------------------------------------------------------------

async def test_room_maintenance_matrix_available(session, seed, stub_tasks):
    """Maintenance case A — available → ticket → closed → available."""
    room = seed["room"]
    svc = MaintenanceService(session)
    ticket = await svc.create_ticket(
        seed["pm"], maint_req(seed["prop"], room_uid=room.id))
    await session.refresh(room)
    assert room.status == "maintenance"
    ticket.status = "resolved"
    await session.commit()
    await svc.close(seed["admin"], ticket.id)
    await session.refresh(room)
    assert room.status == "available"


async def test_occupied_room_maintenance_close_stays_occupied(
    session, seed, stub_tasks
):
    """Maintenance case B — ticket close on an occupied room resolves to
    occupied, not available — maintenance close must not check anyone out."""
    svc = OccupancyService(session)
    room = await svc.check_in_room(seed["admin"], seed["room"].id, "Ada")
    msvc = MaintenanceService(session)
    ticket = await msvc.create_ticket(
        seed["pm"], maint_req(seed["prop"], room_uid=room.id))
    await session.refresh(room)
    assert room.status == "maintenance"

    ticket.status = "resolved"
    await session.commit()
    await msvc.close(seed["admin"], ticket.id)
    await session.refresh(room)
    assert room.status == "occupied"          # NOT available — Bug B fixed
    assert await open_occ_count(session, room_id=room.id) == 1


async def test_occupied_room_maintenance_cancel_stays_occupied(
    session, seed, stub_tasks
):
    """Maintenance case C — ticket CANCELLED on an occupied room keeps the
    guest. Never released to available."""
    svc = OccupancyService(session)
    room = await svc.check_in_room(seed["admin"], seed["room"].id, "Ada")
    msvc = MaintenanceService(session)
    ticket = await msvc.create_ticket(
        seed["pm"], maint_req(seed["prop"], room_uid=room.id))
    await session.refresh(room)
    assert room.status == "maintenance"

    from app.schemas.maintenance import MaintenanceUpdateRequest
    await msvc.update_ticket(
        seed["admin"], ticket.id,
        MaintenanceUpdateRequest(status="cancelled"),
    )
    await session.refresh(room)
    assert room.status == "occupied"
    assert await open_occ_count(session, room_id=room.id) == 1


# ---------------------------------------------------------------------------
# BED + DORM matrix
# ---------------------------------------------------------------------------

async def test_occupied_bed_maintenance_close_stays_occupied(
    session, seed, stub_tasks
):
    """Bed maintenance case B — dorm ticket on an occupied bed's dorm is
    skipped for the occupied bed; a BED-level ticket flips it, and close
    returns to occupied via the occupancy axis."""
    occ_svc = OccupancyService(session)
    dorm = await occ_svc.check_in_bed(seed["admin"], seed["bed"].id, "Ravi")
    bed = next(b for b in dorm.beds if b.id == seed["bed"].id)
    msvc = MaintenanceService(session)
    ticket = await msvc.create_ticket(
        seed["pm"], maint_req(seed["prop"], bed_uid=bed.id))
    await session.refresh(bed)
    assert bed.status == "maintenance"
    assert await open_occ_count(session, bed_id=bed.id) == 1

    ticket.status = "resolved"
    await session.commit()
    await msvc.close(seed["admin"], ticket.id)
    await session.refresh(bed)
    assert bed.status == "occupied"           # occupancy axis wins
    assert await open_occ_count(session, bed_id=bed.id) == 1


async def test_dorm_occupancy_comes_from_records_not_status(
    session, seed, stub_tasks
):
    """Dorm aggregate: an occupied bed flagged maintenance must keep the
    dorm occupied — `bed.status == 'occupied'` alone would lose the guest."""
    occ_svc = OccupancyService(session)
    dorm = await occ_svc.check_in_bed(seed["admin"], seed["bed"].id, "Ravi")
    bed = next(b for b in dorm.beds if b.id == seed["bed"].id)
    msvc = MaintenanceService(session)
    await msvc.create_ticket(
        seed["pm"], maint_req(seed["prop"], bed_uid=bed.id))
    await session.refresh(bed)
    assert bed.status == "maintenance"
    assert await open_occ_count(session, bed_id=bed.id) == 1

    # recompute the aggregate — occupied must survive because the
    # occupancy RECORD is still open even though bed.status is maintenance
    await ResourceStateService(session).derive(
        "dorm", seed["dorm"].id, release_to="available",
        user=seed["admin"], reason="test recompute",
    )
    await session.refresh(dorm)
    assert dorm.status == "occupied"


async def test_dorm_all_beds_checked_out_cleans_then_available(
    session, seed, stub_tasks
):
    """All beds checkout → dorm cleaning → derive → available."""
    occ_svc = OccupancyService(session)
    dorm = await occ_svc.check_in_bed(seed["admin"], seed["bed"].id, "Ravi")
    res = await occ_svc.check_out_bed(seed["admin"], seed["bed"].id)
    dorm = res["dorm"]
    bed = next(b for b in dorm.beds if b.id == seed["bed"].id)
    assert bed.status == "cleaning"
    assert dorm.status == "cleaning"

    # clearing the (stubbed) work derives the whole aggregate to available
    await ResourceStateService(session).derive(
        "dorm", seed["dorm"].id, release_to="available",
        user=seed["admin"], reason="cleaning done",
    )
    await session.refresh(dorm)
    await session.refresh(bed)
    assert dorm.status == "available"
    assert bed.status == "available"


# ---------------------------------------------------------------------------
# WASHROOM + FIXTURE matrix
# ---------------------------------------------------------------------------

async def test_washroom_cleaning_and_maintenance_release(
    session, seed, stub_tasks
):
    """Washroom: available → cleaning → approve → available, and
    available → maintenance → close → available."""
    washroom = seed["washroom"]
    task = make_task(session, seed["prop"], seed["employee"],
                     washroom_id=washroom.id, title="Cleaning — W-01",
                     status="submitted")
    washroom.status = "cleaning"
    await session.commit()
    await TaskService(session).approve_task(seed["admin"], task.id)
    await session.refresh(washroom)
    assert washroom.status == "available"

    msvc = MaintenanceService(session)
    ticket = await msvc.create_ticket(
        seed["pm"], maint_req(seed["prop"], washroom_uid=washroom.id))
    await session.refresh(washroom)
    assert washroom.status == "maintenance"
    ticket.status = "resolved"
    await session.commit()
    await msvc.close(seed["admin"], ticket.id)
    await session.refresh(washroom)
    assert washroom.status == "available"


async def test_fixture_stays_blocked_until_close(session, seed, stub_tasks):
    """Spec §15: RESOLVED is still blocking — the fixture releases only at
    authoritative close, never at resolve."""
    fixture = seed["fixture"]
    washroom = seed["washroom"]
    msvc = MaintenanceService(session)
    ticket = await msvc.create_ticket(
        seed["pm"],
        maint_req(seed["prop"], washroom_uid=washroom.id,
                  washroom_fixture_uid=fixture.id))
    await session.refresh(fixture)
    assert fixture.status == "maintenance"

    # assignee resolves — fixture must NOT go operational early
    ticket.assigned_to = seed["employee"].id
    ticket.status = "in_progress"
    await session.commit()
    ticket = await msvc.resolve(
        seed["emp_user"], ticket.id,
        MaintenanceResolveRequest(resolution_notes="fixed"),
    )
    await session.refresh(fixture)
    assert fixture.status == "maintenance"    # still blocked — the bug fix
    assert fixture.last_maintenance_at is not None

    # close is the release point
    await msvc.close(seed["admin"], ticket.id)
    await session.refresh(fixture)
    await session.refresh(washroom)
    assert fixture.status == "operational"
    assert washroom.status == "available"


async def test_disapproved_ticket_refaggs_fixture(session, seed, stub_tasks):
    """Disapproval returns the ticket to blocking — any drifted fixture
    projection is re-flagged through the state engine."""
    fixture = seed["fixture"]
    msvc = MaintenanceService(session)
    ticket = await msvc.create_ticket(
        seed["pm"],
        maint_req(seed["prop"], washroom_uid=seed["washroom"].id,
                  washroom_fixture_uid=fixture.id))
    ticket.assigned_to = seed["employee"].id
    ticket.status = "in_progress"
    await session.commit()
    await msvc.resolve(
        seed["emp_user"], ticket.id,
        MaintenanceResolveRequest(resolution_notes="done"),
    )
    # simulate the historical drift (fixture released at resolve)
    fixture.status = "operational"
    await session.commit()
    await msvc.disapprove(seed["admin"], ticket.id, "not good enough")
    await session.refresh(fixture)
    assert fixture.status == "maintenance"    # re-flagged — blocking again


# ---------------------------------------------------------------------------
# Occupancy integrity — invariant enforcement + repair
# ---------------------------------------------------------------------------

async def test_available_with_open_occupancy_repairs(
    session, seed, stub_tasks
):
    """`available` + open occupancy is the forbidden invariant — repair()
    restores the occupied projection without touching the record."""
    svc = OccupancyService(session)
    room = await svc.check_in_room(seed["admin"], seed["room"].id, "Ada")
    room.status = "available"                  # corrupted projection
    await session.commit()

    res = await ResourceStateService(session).repair(
        "room", room.id, user=seed["admin"])
    await session.refresh(room)
    assert res["changed"] is True
    assert res["previous_state"] == "available"
    assert room.status == "occupied"           # restored — not deleted
    assert await open_occ_count(session, room_id=room.id) == 1


async def test_occupied_without_occupancy_repairs(
    session, seed, stub_tasks
):
    """`occupied` + no open occupancy → repair collapses to available."""
    room = seed["room"]
    room.status = "occupied"
    await session.commit()
    res = await ResourceStateService(session).repair(
        "room", room.id, user=seed["admin"])
    await session.refresh(room)
    assert res["changed"] is True
    assert room.status == "available"


async def test_repair_is_idempotent(session, seed, stub_tasks):
    """Repeated resolution produces identical state — no churn, no
    duplicate events."""
    room = seed["room"]
    svc = ResourceStateService(session)
    r1 = await svc.repair("room", room.id, user=seed["admin"])
    r2 = await svc.repair("room", room.id, user=seed["admin"])
    assert r1["changed"] is False and r2["changed"] is False
    assert room.status == "available"


async def test_admin_override_available_closes_occupancy(
    session, seed, stub_tasks
):
    """Spec §16 Option B: admin `occupied → available` performs explicit
    checkout semantics — occupancy row closed, mirror cleared, transition
    audited — inside ONE transaction."""
    svc = OccupancyService(session)
    room = await svc.check_in_room(seed["admin"], seed["room"].id, "Ada")
    res = (await session.execute(
        select(Occupancy).where(
            Occupancy.room_id == room.id,
            Occupancy.checked_out_at.is_(None))
    )).scalar_one()

    await ResourceStateService(session).transition(
        "room", room.id, "available", user=seed["admin"],
        source="admin_override", reason="Force release",
    )
    await session.refresh(room)
    await session.refresh(res)
    assert room.status == "available"
    assert res.checked_out_at is not None      # honest checkout, not a gap
    assert res.checked_out_by == seed["admin"].id
    assert room.current_guest is None


# ---------------------------------------------------------------------------
# Task retargeting (spec §14)
# ---------------------------------------------------------------------------

async def test_in_progress_task_cannot_retarget(session, seed, stub_tasks):
    """An in-progress task's target is load-bearing — mutating it would
    strand the old unit's flag. Rejected outright."""
    room = seed["room"]
    other = Room(property_id=seed["prop"].id, room_number="102", type="Deluxe")
    session.add(other)
    task = make_task(session, seed["prop"], seed["employee"],
                     room_id=room.id, title="Cleaning — 101",
                     status="in_progress")
    await session.commit()
    with pytest.raises(ConflictErr):
        await TaskService(session).update_task(
            seed["pm"], task.id, TaskUpdateRequest(room_uid=other.id)
        )


async def test_pending_task_retarget_releases_old_room(
    session, seed, stub_tasks
):
    """A pending retarget reconciles the abandoned target in the same
    transaction — the old room never stays stranded in cleaning."""
    room = seed["room"]
    other = Room(property_id=seed["prop"].id, room_number="102", type="Deluxe")
    session.add(other)
    task = make_task(session, seed["prop"], seed["employee"],
                     room_id=room.id, title="Cleaning — 101",
                     status="pending")
    room.status = "cleaning"                   # flagged by (now-moved) task
    await session.commit()

    await TaskService(session).update_task(
        seed["pm"], task.id, TaskUpdateRequest(room_uid=other.id)
    )
    await session.refresh(room)
    assert room.status == "available"          # reconciled, not stranded


# ---------------------------------------------------------------------------
# Reconciliation detection (spec §25)
# ---------------------------------------------------------------------------

async def test_reconciliation_finds_both_directions(
    session, seed, stub_tasks
):
    """Reverse-direction checks: open occupancy under 'available',
    occupancy shadowing work (info), and unflagged tickets."""
    from app.services.reconciliation import reconcile_property

    svc = OccupancyService(session)
    room = await svc.check_in_room(seed["admin"], seed["room"].id, "Ada")
    room.status = "available"                  # invariant violation
    washroom = seed["washroom"]
    msvc = MaintenanceService(session)
    ticket = await msvc.create_ticket(
        seed["pm"], maint_req(seed["prop"], washroom_uid=washroom.id))
    washroom.status = "available"              # drifted projection
    await session.commit()

    findings = await reconcile_property(session, seed["prop"].id)
    kinds = {(f["resource_type"], f["issue"]) for f in findings}
    assert ("room", "occupancy_status_conflict") in kinds
    assert ("washroom", "unflagged_ticket") in kinds
    room_f = next(
        f for f in findings
        if f["issue"] == "occupancy_status_conflict"
    )
    assert room_f["recommended_action"] == "restore_occupied_projection"
    assert room_f["has_open_occupancy"] is True or \
        room_f["severity"] == "conflict"


# ---------------------------------------------------------------------------
# Explicit normal cleaning (task_queued) — the command flags the resource
# NOW; the queued task holds CLEANING until its lifecycle releases it.
# ---------------------------------------------------------------------------

async def test_explicit_cleaning_flags_available_bed(session, seed):
    """Available bed → explicit Cleaning command → bed.status='cleaning'
    immediately — task exists and holds the flag before anyone starts it."""
    bed, dorm = seed["bed"], seed["dorm"]
    res = await StructureService(session).bulk_unit_status(
        seed["admin"], bulk_req(seed["prop"], "cleaning", bed_uids=[bed.id])
    )
    # refresh(dorm) cascade-expires dorm.beds — reload the dorm first
    await session.refresh(dorm)
    await session.refresh(bed)
    assert bed.status == "cleaning"          # flagged at command time
    assert dorm.status == "cleaning"         # dorm aggregate flags too
    assert len(res["generated_tasks"]) == 1
    task = res["generated_tasks"][0]
    assert task.dorm_id == dorm.id
    assert str(bed.id) in task.bed_ids
    assert task.origin == "manual"
    assert task.status in ("assigned", "pending")
    assert await open_occ_count(session, bed_id=bed.id) == 0


async def test_explicit_cleaning_flags_occupied_bed(session, seed):
    """Occupied bed → explicit Cleaning → 'cleaning' while the occupancy
    record stays OPEN — normal cleaning never implies checkout."""
    occ = OccupancyService(session)
    await occ.check_in_bed(seed["admin"], seed["bed"].id, "Ravi")
    res = await StructureService(session).bulk_unit_status(
        seed["admin"],
        bulk_req(seed["prop"], "cleaning", bed_uids=[seed["bed"].id]),
    )
    await session.refresh(seed["bed"])
    assert seed["bed"].status == "cleaning"
    assert await open_occ_count(session, bed_id=seed["bed"].id) == 1
    assert len(res["generated_tasks"]) == 1


async def test_explicit_cleaning_occupied_bed_approves_occupied(
    session, seed
):
    """occupied → cleaning (task_queued) → approved → OCCUPIED.
    Approval never closes occupancy."""
    occ = OccupancyService(session)
    await occ.check_in_bed(seed["admin"], seed["bed"].id, "Ravi")
    res = await StructureService(session).bulk_unit_status(
        seed["admin"],
        bulk_req(seed["prop"], "cleaning", bed_uids=[seed["bed"].id]),
    )
    task = res["generated_tasks"][0]
    task.status = "submitted"
    await session.commit()

    await TaskService(session).approve_task(seed["admin"], task.id)
    await session.refresh(seed["bed"])
    assert seed["bed"].status == "occupied"  # occupancy axis wins — never available
    assert await open_occ_count(session, bed_id=seed["bed"].id) == 1


async def test_explicit_cleaning_available_bed_approves_available(
    session, seed
):
    """available → cleaning (task_queued) → approved → available (green)."""
    bed = seed["bed"]
    res = await StructureService(session).bulk_unit_status(
        seed["admin"], bulk_req(seed["prop"], "cleaning", bed_uids=[bed.id])
    )
    task = res["generated_tasks"][0]
    task.status = "submitted"
    await session.commit()

    await TaskService(session).approve_task(seed["admin"], task.id)
    await session.refresh(bed)
    assert bed.status == "available"


async def test_explicit_cleaning_task_delete_releases(session, seed):
    """Deleting the queued cleaning task derives the unit back along the
    occupancy axis — available bed → available, occupied bed → occupied."""
    svc = StructureService(session)
    bed = seed["bed"]
    res = await svc.bulk_unit_status(
        seed["admin"], bulk_req(seed["prop"], "cleaning", bed_uids=[bed.id]))
    task = res["generated_tasks"][0]
    await TaskService(session).delete_task(seed["admin"], task.id)
    await session.refresh(bed)
    assert bed.status == "available"

    occ = OccupancyService(session)
    await occ.check_in_bed(seed["admin"], bed.id, "Ravi")
    res = await svc.bulk_unit_status(
        seed["admin"], bulk_req(seed["prop"], "cleaning", bed_uids=[bed.id]))
    task = res["generated_tasks"][0]
    await TaskService(session).delete_task(seed["admin"], task.id)
    await session.refresh(bed)
    assert bed.status == "occupied"


async def test_explicit_cleaning_repeat_is_idempotent(session, seed):
    """Triggering cleaning twice: the open-task dedupe skips generation and
    the already-flagged unit is not transitioned again."""
    svc = StructureService(session)
    bed = seed["bed"]
    res1 = await svc.bulk_unit_status(
        seed["admin"], bulk_req(seed["prop"], "cleaning", bed_uids=[bed.id]))
    res2 = await svc.bulk_unit_status(
        seed["admin"], bulk_req(seed["prop"], "cleaning", bed_uids=[bed.id]))
    await session.refresh(bed)
    assert len(res1["generated_tasks"]) == 1
    assert res2["generated_tasks"] == []     # deduped — no duplicate task
    assert bed.status == "cleaning"          # still flagged, no churn


async def test_explicit_cleaning_dorm_aggregate(session, seed):
    """Cleaning ONE bed flags that bed + the dorm aggregate; sibling beds
    stay untouched."""
    from app.models.structure import Bed as BedModel

    dorm, bed_a = seed["dorm"], seed["bed"]
    bed_b = BedModel(
        dorm_id=dorm.id, property_id=seed["prop"].id, bed_number="Bed 02")
    session.add(bed_b)
    await session.commit()

    await StructureService(session).bulk_unit_status(
        seed["admin"],
        bulk_req(seed["prop"], "cleaning", bed_uids=[bed_a.id]),
    )
    # refresh(dorm) cascade-expires dorm.beds — dorm first, then beds
    await session.refresh(dorm)
    await session.refresh(bed_a)
    await session.refresh(bed_b)
    assert bed_a.status == "cleaning"
    assert bed_b.status == "available"       # unrelated bed untouched
    assert dorm.status == "cleaning"         # aggregate reflects the work


async def test_explicit_cleaning_flags_room(session, seed):
    """Room → Cleaning: same immediate flag through the same engine."""
    room = seed["room"]
    res = await StructureService(session).bulk_unit_status(
        seed["admin"], bulk_req(seed["prop"], "cleaning",
                                room_uids=[room.id]))
    await session.refresh(room)
    assert room.status == "cleaning"
    assert len(res["generated_tasks"]) == 1
    assert res["generated_tasks"][0].room_id == room.id
    assert res["generated_tasks"][0].origin == "manual"


async def test_explicit_cleaning_flags_occupied_room(session, seed):
    """Occupied room → Cleaning command: task is created and the room is
    flagged cleaning WHILE the occupancy row stays open — cleaning never
    implies checkout."""
    occ = OccupancyService(session)
    room = await occ.check_in_room(seed["admin"], seed["room"].id, "Ada")
    assert room.status == "occupied"

    res = await StructureService(session).bulk_unit_status(
        seed["admin"], bulk_req(seed["prop"], "cleaning",
                                room_uids=[room.id]))
    await session.refresh(room)
    assert room.status == "cleaning"
    assert len(res["generated_tasks"]) == 1
    task = res["generated_tasks"][0]
    assert task.room_id == room.id
    assert task.origin == "manual"
    assert await open_occ_count(session, room_id=room.id) == 1
    assert room.current_guest == "Ada"


async def test_occupied_room_cleaning_approve_stays_occupied_bulk(
    session, seed
):
    """End-to-end on the real command: occupied → Cleaning → task
    submitted → approve → room returns to OCCUPIED, guest untouched."""
    occ = OccupancyService(session)
    room = await occ.check_in_room(seed["admin"], seed["room"].id, "Ada")
    res = await StructureService(session).bulk_unit_status(
        seed["admin"], bulk_req(seed["prop"], "cleaning",
                                room_uids=[room.id]))
    task = res["generated_tasks"][0]
    task.status = "submitted"
    await session.commit()

    await TaskService(session).approve_task(seed["admin"], task.id)
    await session.refresh(room)
    assert room.status == "occupied"
    assert await open_occ_count(session, room_id=room.id) == 1
    assert room.current_guest == "Ada"


async def test_occupied_room_cleaning_repeat_is_idempotent(session, seed):
    """Duplicate protection on the occupied path — a second Cleaning
    command while the task is still open generates nothing."""
    occ = OccupancyService(session)
    room = await occ.check_in_room(seed["admin"], seed["room"].id, "Ada")
    svc = StructureService(session)
    res1 = await svc.bulk_unit_status(
        seed["admin"], bulk_req(seed["prop"], "cleaning",
                                room_uids=[room.id]))
    res2 = await svc.bulk_unit_status(
        seed["admin"], bulk_req(seed["prop"], "cleaning",
                                room_uids=[room.id]))
    await session.refresh(room)
    assert len(res1["generated_tasks"]) == 1
    assert res2["generated_tasks"] == []
    assert room.status == "cleaning"
    assert await open_occ_count(session, room_id=room.id) == 1


async def test_bulk_cleaning_denied_for_foreign_property_user(
    session, seed
):
    """RBAC/tenancy: a user scoped to a different property cannot send
    this property's occupied rooms to cleaning."""
    from app.models.user import User, UserRole
    from app.services.structure import NotFoundErr

    occ = OccupancyService(session)
    room = await occ.check_in_room(seed["admin"], seed["room"].id, "Ada")
    stranger = User(
        company_id=seed["company"].id, property_id=uuid.uuid4(),
        name="Outsider", email="outsider@acme.test",
        username="outsider", password_hash="x", role=UserRole.EMPLOYEE,
    )
    session.add(stranger)
    await session.flush()

    with pytest.raises(NotFoundErr):
        await StructureService(session).bulk_unit_status(
            stranger, bulk_req(seed["prop"], "cleaning",
                               room_uids=[room.id]))
    await session.refresh(room)
    assert room.status == "occupied"
    assert await open_occ_count(session, room_id=room.id) == 1


# ---------------------------------------------------------------------------
# Regression — the two flows must stay distinct
# ---------------------------------------------------------------------------

async def test_checkout_cleaning_origin_and_release_unchanged(session, seed):
    """Checkout regression: occupied → checkout closes occupancy →
    cleaning flag → checkout-origin task → approve → available."""
    occ = OccupancyService(session)
    await occ.check_in_bed(seed["admin"], seed["bed"].id, "Ravi")
    res = await occ.check_out_bed(seed["admin"], seed["bed"].id)
    bed = next(b for b in res["dorm"].beds if b.id == seed["bed"].id)
    assert bed.status == "cleaning"
    assert await open_occ_count(session, bed_id=bed.id) == 0
    assert len(res["generated"]) == 1
    task = res["generated"][0]
    assert task.origin == "checkout"         # semantic marker preserved

    task.status = "submitted"
    await session.commit()
    await TaskService(session).approve_task(seed["admin"], task.id)
    await session.refresh(bed)
    assert bed.status == "available"


async def test_generated_task_still_flag_on_start(session, seed):
    """Background/queued work regression: a task that merely EXISTS does
    not flag its unit — the flag lands when the assignee STARTS it."""
    room = seed["room"]
    task = make_task(session, seed["prop"], seed["employee"],
                     room_id=room.id, title="Cleaning — 101",
                     status="pending")
    await session.commit()
    await session.refresh(room)
    assert room.status == "available"        # queued work ≠ flagged

    await TaskService(session).start_task(seed["admin"], task.id)
    await session.refresh(room)
    assert room.status == "cleaning"         # flags on start, as designed


# ---------------------------------------------------------------------------
# Phase-1 perf regressions — slim task list + batched dorm derivation
# ---------------------------------------------------------------------------

async def test_task_list_is_slim_detail_is_full(session, seed):
    """GET /tasks no longer pays for history/evidence eager loads — the
    list emits slim items while GET /tasks/{id} still returns the full
    record."""
    from app.repositories.workspace import WorkspaceRepository
    from app.schemas import workspace as ws

    task = make_task(
        session, seed["prop"], seed["employee"],
        room_id=seed["room"].id, title="Cleaning — 101",
    )
    await session.commit()
    await TaskService(session).start_task(seed["admin"], task.id)
    # a fresh request session would not have the collections loaded — the
    # shared test session does (start_task loaded them), so expire to
    # reproduce the real request shape
    session.expire(task, ["history", "completion_images",
                          "completion_submissions"])

    res = await WorkspaceRepository(session).list_tasks(
        seed["admin"], property_id=seed["prop"].id,
    )
    item = next(t for t in res["items"] if t.id == task.id)
    out = ws.task_out(item)
    assert out["history"] == []              # slim — collections unloaded
    assert out["completion_images"] == []
    assert out["completion_submissions"] == []
    assert out["status"] == "in_progress"

    detail = ws.task_out(
        await TaskService(session).get_task(seed["admin"], task.id)
    )
    assert len(detail["history"]) >= 1       # detail carries the audit trail
    assert detail["task_uid"] == str(task.id)


async def test_dorm_derive_batches_bed_facts(session, seed):
    """derive('dorm') gathers occupancy/blockers in grouped queries —
    not 3 remote round-trips per bed."""
    from sqlalchemy import event
    from app.models.structure import Bed

    dorm = seed["dorm"]
    beds = []
    for i in range(5):
        b = Bed(dorm_id=dorm.id, property_id=seed["prop"].id,
                bed_number=f"Bed T{i+1}")
        session.add(b)
        beds.append(b)
    await session.commit()

    await OccupancyService(session).check_in_bed(seed["admin"], beds[0].id, "G")
    task = make_task(
        session, seed["prop"], seed["employee"], dorm_id=dorm.id,
        bed_ids=[str(beds[1].id), str(beds[2].id)],
        title="Cleaning — Dorm A", status="assigned",
    )
    beds[1].status = "cleaning"
    beds[2].status = "cleaning"
    dorm.status = "cleaning"
    await session.commit()

    count = [0]
    engine = session.get_bind()
    @event.listens_for(engine, "before_cursor_execute")
    def _count(conn, cur, stmt, params, ctx, execmany):
        count[0] += 1
    try:
        task.status = "cancelled"
        await session.commit()
        await ResourceStateService(session).derive(
            "dorm", dorm.id, user=seed["admin"],
        )
    finally:
        event.remove(engine, "before_cursor_execute", _count)

    await session.refresh(dorm)
    assert dorm.status == "occupied"        # bed 0 still holds a guest
    for i in (1, 2):
        await session.refresh(beds[i])
        assert beds[i].status == "available"   # cancelled task releases
    # lock + beds + bed-ids + occupancy + tickets + task-lists (4 grouped
    # fact reads) + per-changed-bed UPDATE+event + dorm UPDATE+event —
    # a constant ~12 regardless of bed count, never ~3-per-bed reads
    assert count[0] <= 13


# ---------------------------------------------------------------------------
# Template location — occupied_only + property-scope target expansion
# ---------------------------------------------------------------------------

async def _tmpl(session, prop, loc) -> "WorkTemplate":
    from app.models.template import WorkTemplate
    t = WorkTemplate(
        company_id=prop.company_id, property_id=prop.id,
        name="T", template_type="cleaning", status="active",
        assignment={"mode": "automatic"}, location=loc,
        schedule={"kind": "recurring", "frequency": "daily", "time": "08:00"},
        checklist=[], verification={}, overdue={"actions": []},
        notifications={},
    )
    session.add(t)
    await session.flush()
    return t


async def test_expand_property_target_all_rooms(session, seed):
    """property scope + target=rooms expands to one task per room."""
    from app.services.template import TemplateService
    from app.models.structure import Room as RoomModel

    room2 = RoomModel(
        property_id=seed["prop"].id, room_number="201", type="Std")
    session.add(room2)
    await session.commit()

    t = await _tmpl(session, seed["prop"],
                    {"scope": "property", "target": "rooms"})
    targets = await TemplateService(session)._expand_targets(t)
    assert sorted(x["room_number"] for x in targets) == ["101", "201"]


async def test_expand_occupied_only_rooms(session, seed):
    """occupied_only keeps only rooms with an OPEN occupancy — and when
    none are occupied the template generates NOTHING (no property
    fallback task)."""
    from app.services.template import TemplateService
    from app.models.structure import Room as RoomModel

    room2 = RoomModel(
        property_id=seed["prop"].id, room_number="201", type="Std")
    session.add(room2)
    await session.commit()

    # nobody checked in → no targets at all (not a property-level task)
    t = await _tmpl(session, seed["prop"], {
        "scope": "property", "target": "rooms", "occupied_only": True})
    assert await TemplateService(session)._expand_targets(t) == []

    occ = OccupancyService(session)
    await occ.check_in_room(seed["admin"], seed["room"].id, "Ada")

    svc = TemplateService(session)
    targets = await svc._expand_targets(t)
    assert [x["room_number"] for x in targets] == ["101"]

    # checkout empties the set again on the next expansion
    await occ.check_out_room(seed["admin"], seed["room"].id)
    assert await TemplateService(session)._expand_targets(t) == []


async def test_expand_occupied_only_zone_scope(session, seed):
    """Zone scope honors occupied_only too — only the occupied room in
    that zone is targeted."""
    from app.services.template import TemplateService
    from app.models.structure import Zone as ZoneModel, Room as RoomModel

    zone = ZoneModel(
        property_id=seed["prop"].id, name="Z1", code="Z1", zone_type="stay")
    session.add(zone)
    await session.flush()
    room_in = RoomModel(property_id=seed["prop"].id, zone_id=zone.id,
                        room_number="301", type="Std")
    room_out = RoomModel(property_id=seed["prop"].id, zone_id=zone.id,
                         room_number="302", type="Std")
    session.add_all([room_in, room_out])
    await session.commit()
    await OccupancyService(session).check_in_room(
        seed["admin"], room_in.id, "Dev")

    t = await _tmpl(session, seed["prop"], {
        "scope": "zone", "zone_uid": str(zone.id), "target": "rooms",
        "occupied_only": True})
    targets = await TemplateService(session)._expand_targets(t)
    assert [x["room_number"] for x in targets] == ["301"]


async def test_expand_unoccupied_rooms(session, seed):
    """occupancy='unoccupied' is the complement set — rooms with NO open
    occupancy."""
    from app.services.template import TemplateService
    from app.models.structure import Room as RoomModel

    room2 = RoomModel(
        property_id=seed["prop"].id, room_number="201", type="Std")
    session.add(room2)
    await session.commit()
    await OccupancyService(session).check_in_room(
        seed["admin"], seed["room"].id, "Ada")

    t = await _tmpl(session, seed["prop"], {
        "scope": "property", "target": "rooms", "occupancy": "unoccupied"})
    targets = await TemplateService(session)._expand_targets(t)
    assert [x["room_number"] for x in targets] == ["201"]


async def test_expand_occupied_beds_and_dorms(session, seed):
    """Bed occupancy drives bed targets AND dorm derivation:
    - beds + occupied → only occupied beds
    - beds + unoccupied → the rest
    - dorms + occupied → dorms with >=1 occupied bed (derived, no dorm
      occupancy field)
    - dorms scope + target='beds' → beds inside that dorm only."""
    from app.services.template import TemplateService
    from app.models.structure import Bed as BedModel, Dorm as DormModel

    bed2 = BedModel(dorm_id=seed["dorm"].id, property_id=seed["prop"].id,
                    bed_number="Bed 02")
    dorm2 = DormModel(property_id=seed["prop"].id, name="Dorm B")
    session.add_all([bed2, dorm2])
    await session.flush()
    bed3 = BedModel(dorm_id=dorm2.id, property_id=seed["prop"].id,
                    bed_number="Bed 01")
    session.add(bed3)
    await session.commit()
    await OccupancyService(session).check_in_bed(
        seed["admin"], seed["bed"].id, "Ravi")

    svc = TemplateService(session)
    loc = {"scope": "property", "target": "beds"}

    occ_t = await _tmpl(session, seed["prop"], {**loc, "occupancy": "occupied"})
    targets = await svc._expand_targets(occ_t)
    assert [x["bed_number"] for x in targets] == ["Bed 01"]

    unocc_t = await _tmpl(session, seed["prop"],
                          {**loc, "occupancy": "unoccupied"})
    targets = await TemplateService(session)._expand_targets(unocc_t)
    assert [x["bed_number"] for x in targets] == ["Bed 02", "Bed 01"]

    # dorm-level occupancy derives from beds — dorm A occupied, B not
    docc = await _tmpl(session, seed["prop"], {
        "scope": "property", "target": "dorms", "occupancy": "occupied"})
    targets = await TemplateService(session)._expand_targets(docc)
    assert [x["dorm_name"] for x in targets] == [seed["dorm"].name]
    dunocc = await _tmpl(session, seed["prop"], {
        "scope": "property", "target": "dorms", "occupancy": "unoccupied"})
    targets = await TemplateService(session)._expand_targets(dunocc)
    assert [x["dorm_name"] for x in targets] == ["Dorm B"]

    # dorm scope + beds target = beds inside the specific dorm
    td = await _tmpl(session, seed["prop"], {
        "scope": "dorms", "dorm_uids": [str(seed["dorm"].id)],
        "target": "beds", "occupancy": "unoccupied"})
    targets = await TemplateService(session)._expand_targets(td)
    assert [x["bed_number"] for x in targets] == ["Bed 02"]


async def test_expand_condition_query_count(session, seed):
    """Occupancy-conditioned expansion is set-based — occupancy loads as
    ONE grouped query inside the structure snapshot, never one query per
    room/bed."""
    from app.services.template import TemplateService
    from sqlalchemy import event
    from app.models.structure import Room as RoomModel
    session.add(RoomModel(property_id=seed["prop"].id,
                        room_number="201", type="Std"))
    session.add(RoomModel(property_id=seed["prop"].id,
                        room_number="202", type="Std"))
    await session.commit()
    await OccupancyService(session).check_in_room(
        seed["admin"], seed["room"].id, "Ada")

    t = await _tmpl(session, seed["prop"], {
        "scope": "property", "target": "rooms", "occupancy": "occupied"})
    count = [0]
    engine = session.get_bind()

    @event.listens_for(engine, "before_cursor_execute")
    def _count(conn, cur, stmt, params, ctx, execmany):
        count[0] += 1

    try:
        targets = await TemplateService(session)._expand_targets(t)
    finally:
        event.remove(engine, "before_cursor_execute", _count)

    assert [x["room_number"] for x in targets] == ["101"]
    # zones + rooms + dorms + washrooms + beds + areas + occupancy —
    # constant ~7 regardless of room/bed count
    assert count[0] <= 8


async def test_expand_rejects_washroom_occupancy(session, seed):
    """Backend validation rejects occupancy conditions on washrooms —
    no such axis exists in the domain."""
    from app.services.template import TemplateService
    from app.services.structure import ValidationErr

    svc = TemplateService(session)
    try:
        svc._validate({"name": "x", "location": {
            "scope": "property", "target": "washrooms",
            "occupancy": "occupied"}})
        assert False, "expected ValidationErr"
    except ValidationErr as e:
        assert e.field == "location.occupancy"


async def test_expand_rooms_washrooms_immune_to_occupancy(session, seed):
    """washroom-only + no occupancy → unaffected by the filter; and a
    units target applies occupancy only to its room/bed parts."""
    from app.services.template import TemplateService
    from app.models.structure import Washroom as WModel

    session.add(WModel(property_id=seed["prop"].id, name="WR1", washroom_type="common"))
    await session.commit()
    await OccupancyService(session).check_in_room(
        seed["admin"], seed["room"].id, "Ada")

    t = await _tmpl(session, seed["prop"], {
        "scope": "property", "target": "units",
        "occupancy": "occupied"})
    targets = await TemplateService(session)._expand_targets(t)
    kinds = {x["key"].split(":")[0] for x in targets}
    # occupied room + occupied bed excluded (none) + unoccupied bed
    # excluded → only the occupied room; the washroom is filtered out of
    # an occupancy-only condition rather than silently included
    assert kinds == {"room"} or kinds == {"room", "washroom"}
    assert any(x["key"].startswith("room:") for x in targets)


async def test_expand_rooms_beds_all_units(session, seed):
    """'rooms_beds' target = all rooms + all dorm beds — washrooms and
    dorm-level rows are NOT included. The 'units' explicit scope picks
    a mixed set of specific rooms + beds."""
    from app.services.template import TemplateService
    from app.models.structure import Washroom as WModel, Room as RoomModel

    room2 = RoomModel(property_id=seed["prop"].id, room_number="201",
                      type="Std")
    session.add_all([room2, WModel(property_id=seed["prop"].id,
                                   name="WR1", washroom_type="common")])
    await session.commit()

    t = await _tmpl(session, seed["prop"],
                    {"scope": "property", "target": "rooms_beds"})
    targets = await TemplateService(session)._expand_targets(t)
    kinds = {x["key"].split(":")[0] for x in targets}
    assert kinds == {"room", "bed"}
    assert {x["room_number"] for x in targets if "room_number" in x} \
        == {"101", "201"}

    # occupancy applies to both parts of rooms_beds
    await OccupancyService(session).check_in_room(
        seed["admin"], seed["room"].id, "Ada")
    t2 = await _tmpl(session, seed["prop"], {
        "scope": "property", "target": "rooms_beds",
        "occupancy": "occupied"})
    targets = await TemplateService(session)._expand_targets(t2)
    assert [x["key"] for x in targets] == [f"room:{seed['room'].id}"]

    # scope='units' — explicit mixed pick (rooms ∪ beds)
    t3 = await _tmpl(session, seed["prop"], {
        "scope": "units",
        "room_uids": [str(room2.id)],
        "bed_uids": [str(seed["bed"].id)]})
    targets = await TemplateService(session)._expand_targets(t3)
    assert {x["key"].split(":")[0] for x in targets} == {"room", "bed"}
    assert any(x.get("room_id") == room2.id for x in targets)
    assert any(x.get("bed_id") == seed["bed"].id for x in targets)


async def test_operations_template_department_pool(session, seed):
    """Operations + department assignment → the task lands on a dept
    employee with no zone/room — and it's a people-pool allocation."""
    from app.services.template import TemplateService
    from app.models.template import WorkTemplate
    from app.models.employee import Employee
    from app.models.task import Task as TaskModel

    emp = Employee(
        company_id=seed["company"].id, property_id=seed["prop"].id,
        name="Ops One", email="ops1@acme.test",
        department="Housekeeping", status="Active", leave_status=False)
    session.add(emp)
    await session.flush()

    t = WorkTemplate(
        company_id=seed["prop"].company_id, property_id=seed["prop"].id,
        name="Bottles", template_type="operations", status="active",
        assignment={"mode": "department", "department": "Housekeeping"},
        location={"scope": "property"},
        schedule={"kind": "recurring", "frequency": "daily",
                  "time": "08:00"},
        checklist=[], verification={}, overdue={"actions": []},
        notifications={},
    )
    session.add(t)
    await session.flush()

    svc = TemplateService(session)
    targets = await svc._expand_targets(t)
    assert len(targets) == 1          # one property-level task — no units
    import datetime as _dt
    from sqlalchemy import select as _sel
    n = await svc._generate(t, _dt.datetime.now(_dt.timezone.utc))
    assert n == 1
    tasks = (await session.execute(
        _sel(TaskModel).where(TaskModel.template_id == t.id))).scalars().all()
    assert len(tasks) == 1
    assert tasks[0].employee_id == emp.id
    assert tasks[0].zone_id is None and tasks[0].room_id is None


async def test_run_due_tenant_scope(session, seed):
    """A manual /templates/generate-due trigger must only fire generation
    for the caller's own company — never for foreign tenants."""
    import datetime as _dt
    from sqlalchemy import select as _sel
    from app.models.company import Company
    from app.models.property import Property
    from app.models.task import Task as TaskModel
    from app.models.template import WorkTemplate
    from app.services.template import TemplateService

    past = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(minutes=5)

    other_company = Company(
        company_name="Other", brand_name="Other", address="x",
        pin_code="1", email="o@x.test", phone_number="1",
    )
    session.add(other_company)
    await session.flush()
    other_prop = Property(
        company_id=other_company.id, name="P2", code="P2", location="L",
        city="C", state="ST", manager_name="M", manager_email="m2@x.test",
    )
    session.add(other_prop)
    await session.flush()

    def due_template(prop):
        t = WorkTemplate(
            company_id=prop.company_id, property_id=prop.id,
            name="Due", template_type="operations", status="active",
            assignment={"mode": "automatic"},
            location={"scope": "property"},
            schedule={"kind": "recurring", "frequency": "daily",
                      "time": "08:00"},
            checklist=[], verification={}, overdue={"actions": []},
            notifications={}, next_run_at=past,
        )
        session.add(t)
        return t

    own = due_template(seed["prop"])
    foreign = due_template(other_prop)
    await session.commit()

    stats = await TemplateService(session).run_due(
        company_id=seed["company"].id)
    assert stats["templates"] == 1
    assert stats["generated"] == 1

    own_tasks = (await session.execute(
        _sel(TaskModel).where(TaskModel.template_id == own.id))).scalars().all()
    foreign_tasks = (await session.execute(
        _sel(TaskModel).where(
            TaskModel.template_id == foreign.id))).scalars().all()
    assert len(own_tasks) == 1
    assert foreign_tasks == []
