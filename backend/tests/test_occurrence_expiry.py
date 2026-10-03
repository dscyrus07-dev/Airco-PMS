"""Recurring task instance lifecycle — expiry, generation, races.

Every scheduled occurrence is an INDEPENDENT task row with its own
validity window (`scheduled_for` → `expires_at`). The expiry sweep runs
before generation so an unfinished predecessor is abandoned, never
blocks its successor. IST is the operational timezone; `ist()` pins
UTC instants.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models.task import Task, TaskHistoryEvent
from app.models.template import WorkTemplate
from app.schemas.structure import TaskCompleteRequest, TaskSubmitRequest
from app.services.rollover import RolloverService
from app.services.task import TaskService
from app.services.template import TemplateService, compute_next_run
from app.services.structure import ConflictErr, ValidationErr
from app.services.task_ops import TaskOpsService

UTC = timezone.utc
IST_OFFSET = timezone(timedelta(hours=5, minutes=30))


def ist(y, m, d, hh, mm):
    """UTC instant equal to the given IST wall-clock time."""
    return datetime(y, m, d, hh, mm, tzinfo=IST_OFFSET).astimezone(UTC)


def _aware(dt):
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=UTC)


def make_template(prop, *, name="Clean Occupied", freq="hourly",
                  every=1, location=None, assignment=None,
                  next_run_at=None, **kw) -> WorkTemplate:
    t = WorkTemplate(
        company_id=prop.company_id, property_id=prop.id,
        name=name, template_type="cleaning", status="active",
        assignment=assignment or {"mode": "automatic"},
        location=location or {"scope": "property", "target": "rooms"},
        schedule={
            "kind": "recurring", "frequency": freq, "every": every,
            "start_time": "00:00", "window_end": "23:59",
        },
        checklist=[], verification={}, overdue={"actions": []},
        notifications={}, next_run_at=next_run_at, **kw,
    )
    return t


async def _tasks(session, template_id):
    return (await session.execute(
        select(Task).where(Task.template_id == template_id)
        .order_by(Task.created_at)
    )).scalars().all()


# ---------------------------------------------------------------------------
# compute_next_run — minutes/hourly interval grid
# ---------------------------------------------------------------------------

def test_minutes_frequency_grid():
    sched = {"kind": "recurring", "frequency": "minutes", "every": 30,
             "start_time": "10:00", "window_end": "23:59"}
    n1 = compute_next_run(sched, ist(2030, 10, 2, 9, 59))
    assert n1 == ist(2030, 10, 2, 10, 0)
    n2 = compute_next_run(sched, n1)
    assert n2 == ist(2030, 10, 2, 10, 30)
    n3 = compute_next_run(sched, n2)
    assert n3 == ist(2030, 10, 2, 11, 0)
    # window roll-over → next day 10:00
    assert compute_next_run(sched, ist(2030, 10, 2, 23, 59)) \
        == ist(2030, 10, 3, 10, 0)


def test_hourly_every_two_hours_grid():
    sched = {"kind": "recurring", "frequency": "hourly", "every": 2,
             "start_time": "10:00", "window_end": "23:59"}
    assert compute_next_run(sched, ist(2030, 10, 2, 9, 59)) \
        == ist(2030, 10, 2, 10, 0)
    assert compute_next_run(sched, ist(2030, 10, 2, 10, 0)) \
        == ist(2030, 10, 2, 12, 0)


# ---------------------------------------------------------------------------
# Basic lifecycle — 10:00 / 11:00 / 12:00 are three independent rows
# ---------------------------------------------------------------------------

async def test_three_occurrences_three_instances(session, seed):
    prop = seed["prop"]
    t = make_template(prop, next_run_at=ist(2030, 10, 2, 10, 0))
    session.add(t)
    await session.commit()

    for hh in (10, 11, 12):
        await TemplateService(session).run_due(now=ist(2030, 10, 2, hh, 0))

    tasks = await _tasks(session, t.id)
    assert len(tasks) == 3
    a, b, c = tasks
    assert len({x.id for x in tasks}) == 3  # never the same row mutated

    assert _aware(a.scheduled_for) == ist(2030, 10, 2, 10, 0)
    assert _aware(a.expires_at) == ist(2030, 10, 2, 11, 0)
    assert _aware(b.scheduled_for) == ist(2030, 10, 2, 11, 0)
    assert _aware(b.expires_at) == ist(2030, 10, 2, 12, 0)
    assert _aware(c.scheduled_for) == ist(2030, 10, 2, 12, 0)
    assert _aware(c.expires_at) == ist(2030, 10, 2, 13, 0)

    # predecessors were abandoned at their own boundaries; C still live
    assert a.status == "abandoned" and b.status == "abandoned"
    assert a.abandoned_reason == "NEXT_SCHEDULED_OCCURRENCE"
    assert a.abandoned_from_status in {"pending", "assigned"}
    assert c.status in {"pending", "assigned"}
    # every instance got a generation history event
    for x in tasks:
        ev = (await session.execute(
            select(func.count()).select_from(TaskHistoryEvent).where(
                TaskHistoryEvent.task_id == x.id,
                TaskHistoryEvent.type.in_(
                    ("auto_generated", "abandoned")),
            )
        )).scalar()
        assert ev >= 1
    # template cursor advanced past the generated occurrence
    assert _aware(t.next_run_at) == ist(2030, 10, 2, 13, 0)


async def test_completed_instance_stays_completed(session, seed):
    prop = seed["prop"]
    t = make_template(prop, next_run_at=ist(2030, 10, 2, 10, 0))
    session.add(t)
    await session.commit()
    await TemplateService(session).run_due(now=ist(2030, 10, 2, 10, 0))
    (a,) = await _tasks(session, t.id)

    # employee/manager completes inside the window (10:30)
    await TaskService(session).complete_task(
        seed["admin"], a.id, TaskCompleteRequest(photo_urls=["https://x.test/p.jpg"]))
    await session.refresh(a)
    assert a.status == "completed"

    await TemplateService(session).run_due(now=ist(2030, 10, 2, 11, 0))
    tasks = await _tasks(session, t.id)
    assert len(tasks) == 2
    await session.refresh(tasks[0])
    assert tasks[0].status == "completed"      # never flipped to abandoned
    assert tasks[1].status in {"pending", "assigned"}
    assert _aware(tasks[1].scheduled_for) == ist(2030, 10, 2, 11, 0)


async def test_repeated_abandonment_then_completion(session, seed):
    """10:00→A, 11:00→A, 12:00→A, then the 13:00 instance completes —
    every occurrence exists independently."""
    prop = seed["prop"]
    t = make_template(prop, next_run_at=ist(2030, 10, 2, 10, 0))
    session.add(t)
    await session.commit()
    for hh in (10, 11, 12, 13):
        await TemplateService(session).run_due(now=ist(2030, 10, 2, hh, 0))
    tasks = await _tasks(session, t.id)
    assert len(tasks) == 4
    assert [x.status for x in tasks[:3]] == ["abandoned"] * 3
    last = tasks[3]
    await TaskService(session).complete_task(
        seed["admin"], last.id, TaskCompleteRequest(photo_urls=["https://x.test/p.jpg"]))
    await session.refresh(last)
    assert last.status == "completed"


# ---------------------------------------------------------------------------
# Expiry sweep
# ---------------------------------------------------------------------------

async def test_expire_due_abandons_open_instance(session, seed):
    prop = seed["prop"]
    a = Task(
        id=uuid.uuid4(), property_id=prop.id, title="Clean 101",
        status="in_progress",
        scheduled_for=ist(2030, 10, 2, 10, 0),
        expires_at=ist(2030, 10, 2, 11, 0),
    )
    session.add(a)
    await session.commit()

    stats = await RolloverService(session).expire_due(
        now=ist(2030, 10, 2, 11, 0))
    assert stats["expired"] == 1
    await session.refresh(a)
    assert a.status == "abandoned"
    assert a.abandoned_reason == "NEXT_SCHEDULED_OCCURRENCE"
    assert a.abandoned_from_status == "in_progress"
    assert a.operational_date == "2030-10-02"
    # idempotent — second sweep is a no-op, no duplicate events
    assert (await RolloverService(session).expire_due(
        now=ist(2030, 10, 2, 11, 1)))["expired"] == 0
    n = (await session.execute(
        select(func.count()).select_from(TaskHistoryEvent).where(
            TaskHistoryEvent.task_id == a.id,
            TaskHistoryEvent.type == "abandoned")
    )).scalar()
    assert n == 1


async def test_submitted_survives_expiry(session, seed):
    """Work delivered in-window awaits review — never orphaned."""
    prop = seed["prop"]
    a = Task(
        id=uuid.uuid4(), property_id=prop.id, title="Clean 101",
        status="submitted", submitted_at=ist(2030, 10, 2, 10, 55),
        scheduled_for=ist(2030, 10, 2, 10, 0),
        expires_at=ist(2030, 10, 2, 11, 0),
    )
    session.add(a)
    await session.commit()
    stats = await RolloverService(session).expire_due(
        now=ist(2030, 10, 2, 11, 0))
    assert stats["expired"] == 0
    await session.refresh(a)
    assert a.status == "submitted"


async def test_expired_task_transitions_rejected(session, seed):
    """Post-boundary start/submit/complete → 409; the sweep owns the end."""
    prop = seed["prop"]
    a = Task(
        id=uuid.uuid4(), property_id=prop.id, title="Clean 101",
        status="assigned",
        scheduled_for=ist(2030, 10, 2, 10, 0),
        # expired one hour ago relative to real now
        expires_at=datetime.now(UTC) - timedelta(hours=1),
    )
    session.add(a)
    await session.commit()
    svc = TaskService(session)
    with pytest.raises(ConflictErr):
        await svc.start_task(seed["admin"], a.id)
    with pytest.raises(ConflictErr):
        await svc.submit_task(seed["admin"], a.id, TaskSubmitRequest())
    with pytest.raises(ConflictErr):
        await svc.complete_task(seed["admin"], a.id, TaskCompleteRequest(photo_urls=["https://x.test/p.jpg"]))


async def test_zero_target_occurrence_still_expires(session, seed):
    """11:00 with no matching targets → no new tasks, but the 10:00
    instance still dies at its own expires_at."""
    prop = seed["prop"]
    t = make_template(
        prop,
        location={"scope": "property", "target": "rooms",
                  "occupied_only": True},   # nothing occupied → 0 targets
        next_run_at=ist(2030, 10, 2, 11, 0),
    )
    session.add(t)
    await session.flush()          # t.id materializes
    a = Task(
        id=uuid.uuid4(), property_id=prop.id, template_id=t.id,
        title="Clean Occupied", status="assigned",
        scheduled_for=ist(2030, 10, 2, 10, 0),
        expires_at=ist(2030, 10, 2, 11, 0),
    )
    session.add(a)
    await session.commit()

    stats = await TemplateService(session).run_due(
        now=ist(2030, 10, 2, 11, 5))
    assert stats["generated"] == 0
    await session.refresh(a)
    assert a.status == "abandoned"
    assert a.abandoned_reason == "NEXT_SCHEDULED_OCCURRENCE"


# ---------------------------------------------------------------------------
# Catch-up / missed windows / idempotency
# ---------------------------------------------------------------------------

async def test_worker_downtime_only_latest_occurrence(session, seed):
    """Down 10:55→12:20 (IST): superseded 11:00 slot is skipped; only the
    latest due occurrence (12:00) materializes with its full window."""
    prop = seed["prop"]
    t = make_template(prop, next_run_at=ist(2030, 10, 2, 10, 0))
    session.add(t)
    await session.commit()

    await TemplateService(session).run_due(now=ist(2030, 10, 2, 10, 0))
    stats = await TemplateService(session).run_due(now=ist(2030, 10, 2, 12, 20))

    tasks = await _tasks(session, t.id)
    assert len(tasks) == 2                            # 10:00 + 12:00 only
    a, latest = tasks
    assert _aware(latest.scheduled_for) == ist(2030, 10, 2, 12, 0)
    assert _aware(latest.expires_at) == ist(2030, 10, 2, 13, 0)
    # The 10:00 instance died at its OWN 11:00 boundary — no grace, no
    # extension for the outage.
    await session.refresh(a)
    assert a.status == "abandoned"
    assert _aware(a.abandoned_at) == ist(2030, 10, 2, 12, 20)
    assert _aware(t.next_run_at) == ist(2030, 10, 2, 13, 0)


async def test_double_generation_is_idempotent(session, seed):
    """Same occurrence generated twice (retry/two ticks) → one task,
    one ledger row."""
    from app.models.template import TemplateGeneration
    prop = seed["prop"]
    t = make_template(prop, next_run_at=ist(2030, 10, 2, 10, 0))
    session.add(t)
    await session.commit()
    now = ist(2030, 10, 2, 10, 0)
    await TemplateService(session).run_due(now=now)

    # force the cursor back — simulates a second worker seeing the same
    # due occurrence before the first committed next_run_at
    t.next_run_at = ist(2030, 10, 2, 10, 0)
    await session.commit()
    await TemplateService(session).run_due(now=now)

    tasks = await _tasks(session, t.id)
    assert len(tasks) == 1
    ledger = (await session.execute(
        select(func.count()).select_from(TemplateGeneration).where(
            TemplateGeneration.template_id == t.id)
    )).scalar()
    assert ledger == 1


# ---------------------------------------------------------------------------
# Boundary race — conditional updates decide, never dual state
# ---------------------------------------------------------------------------

async def test_completion_committed_before_expiry_wins(session, seed):
    """Complete commits first → the sweep's conditional update no-ops."""
    prop = seed["prop"]
    a = Task(
        id=uuid.uuid4(), property_id=prop.id, title="Clean 101",
        status="in_progress",
        scheduled_for=ist(2030, 10, 2, 10, 0),
        expires_at=ist(2030, 10, 2, 11, 0),
        completed_at=ist(2030, 10, 2, 10, 59),
    )
    a.status = "completed"
    session.add(a)
    await session.commit()
    stats = await RolloverService(session).expire_due(
        now=ist(2030, 10, 2, 11, 0))
    assert stats["expired"] == 0
    await session.refresh(a)
    assert a.status == "completed"          # permanently completed


async def test_expiry_committed_before_completion_wins(session, seed):
    """Sweep commits first → the row is abandoned; a later completion
    attempt is rejected 409 (never a completed+abandoned dual state)."""
    prop = seed["prop"]
    a = Task(
        id=uuid.uuid4(), property_id=prop.id, title="Clean 101",
        status="assigned",
        scheduled_for=ist(2030, 10, 2, 10, 0),
        expires_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    session.add(a)
    await session.commit()
    await RolloverService(session).expire_due()
    await session.refresh(a)
    assert a.status == "abandoned"
    with pytest.raises(ConflictErr):
        await TaskService(session).complete_task(
            seed["admin"], a.id, TaskCompleteRequest(photo_urls=["https://x.test/p.jpg"]))
    await session.refresh(a)
    assert a.status == "abandoned"          # unchanged


# ---------------------------------------------------------------------------
# Operational-day interaction
# ---------------------------------------------------------------------------

async def test_opday_rollover_skips_still_valid_instance(session, seed):
    """05:30→06:30 instance, op-day starts 06:00: at the 06:00 boundary
    the task is still inside its window → daily rollover leaves it;
    it dies at 06:30 via occurrence expiry instead."""
    prop = seed["prop"]
    a = Task(
        id=uuid.uuid4(), property_id=prop.id, title="Night clean",
        status="assigned",
        scheduled_for=ist(2030, 10, 3, 5, 30),
        expires_at=ist(2030, 10, 3, 6, 30),
        operational_date="2030-10-02",
    )
    session.add(a)
    await session.commit()

    roll = await RolloverService(session).run(now=ist(2030, 10, 3, 6, 0))
    assert roll["abandoned"] == 0
    await session.refresh(a)
    assert a.status == "assigned"

    stats = await RolloverService(session).expire_due(
        now=ist(2030, 10, 3, 6, 30))
    assert stats["expired"] == 1
    await session.refresh(a)
    assert a.abandoned_reason == "NEXT_SCHEDULED_OCCURRENCE"
    assert a.operational_date == "2030-10-02"  # the 05:30 occurrence's day


# ---------------------------------------------------------------------------
# Dynamic targets + independent allocation per occurrence
# ---------------------------------------------------------------------------

async def test_dynamic_targets_evaluated_per_occurrence(session, seed):
    """10:00 sees rooms occupied at 10:00; 11:00 re-evaluates live —
    each instance keeps its own target set."""
    from app.models.structure import Room
    from app.services.occupancy import OccupancyService

    prop = seed["prop"]
    room2 = Room(property_id=prop.id, room_number="201", type="Std")
    session.add(room2)
    await session.flush()
    t = make_template(
        prop,
        location={"scope": "property", "target": "rooms",
                  "occupied_only": True},
        next_run_at=ist(2030, 10, 2, 10, 0),
    )
    session.add(t)
    await session.commit()

    occ = OccupancyService(session)
    await occ.check_in_room(seed["admin"], seed["room"].id, "Ada")
    # a fresh service per run — the tick instantiates one per pass and
    # the per-instance structure snapshot must not outlive it
    await TemplateService(session).run_due(now=ist(2030, 10, 2, 10, 0))
    first = await _tasks(session, t.id)
    assert len(first) == 1 and first[0].room_id == seed["room"].id

    # occupancy changed at 10:30 → the 11:00 occurrence sees BOTH rooms
    await occ.check_in_room(seed["admin"], room2.id, "Ben")
    await TemplateService(session).run_due(now=ist(2030, 10, 2, 11, 0))
    tasks = await _tasks(session, t.id)
    assert len(tasks) == 3
    occ10 = [x for x in tasks
             if _aware(x.scheduled_for) == ist(2030, 10, 2, 10, 0)]
    occ11 = [x for x in tasks
             if _aware(x.scheduled_for) == ist(2030, 10, 2, 11, 0)]
    assert [x.room_id for x in occ10] == [seed["room"].id]  # unchanged
    assert {x.room_id for x in occ11} == {seed["room"].id, room2.id}


async def test_each_occurrence_allocates_independently(session, seed):
    """Zone round-robin hands consecutive occurrences to different
    employees — allocation is re-run, never copied."""
    from app.models.employee import Employee
    from app.models.structure import Zone
    from app.models.work_allocation import WorkAllocationHistory

    prop = seed["prop"]
    zone = Zone(property_id=prop.id, name="Z1", code="Z1",
                zone_type="stay")
    session.add(zone)
    await session.flush()
    seed["room"].zone_id = zone.id
    e1 = Employee(company_id=prop.company_id, property_id=prop.id,
                  name="E1", email="e1@x.test", department="Housekeeping",
                  status="Active", leave_status=False, zone_id=zone.id)
    e2 = Employee(company_id=prop.company_id, property_id=prop.id,
                  name="E2", email="e2@x.test", department="Housekeeping",
                  status="Active", leave_status=False, zone_id=zone.id)
    session.add_all([e1, e2])
    await session.flush()

    t = make_template(
        prop,
        location={"scope": "zone", "zone_uid": str(zone.id),
                  "target": "rooms"},
        next_run_at=ist(2030, 10, 2, 10, 0),
    )
    session.add(t)
    await session.commit()
    for hh in (10, 11):
        await TemplateService(session).run_due(now=ist(2030, 10, 2, hh, 0))

    tasks = await _tasks(session, t.id)
    assert len(tasks) == 2
    a, b = tasks
    assert a.employee_id and b.employee_id
    assert a.employee_id != b.employee_id          # round-robin advanced
    # separate allocation history per instance
    hist = (await session.execute(
        select(WorkAllocationHistory).where(
            WorkAllocationHistory.ticket_id.in_([a.id, b.id]))
    )).scalars().all()
    assert {h.ticket_id for h in hist} == {a.id, b.id}


# ---------------------------------------------------------------------------
# Series (repetitive) path — same validity window semantics
# ---------------------------------------------------------------------------

async def test_series_instances_carry_window_and_expire(session, seed):
    """A repetitive series stamps scheduled_for/expires_at on each clone;
    the sweep abandons an unfinished predecessor and the next slot
    still generates (uq_tasks_open_room_title can't block it)."""
    prop = seed["prop"]
    room = seed["room"]
    head = Task(
        id=uuid.uuid4(), property_id=prop.id, title="Restock",
        task_type="repetitive", recurrence="hourly",
        status="assigned",
        due_date="2030-10-02T10:00",
        room_id=room.id, room_number="101",
    )
    session.add(head)
    await session.flush()
    head.series_id = head.id
    from app.services.task import _due_dt, next_occurrence
    anchor = _due_dt(head)
    await TaskService(session)._stamp_occurrence_window(head, anchor)
    await session.commit()
    assert head.expires_at is not None

    # clock at 11:05 IST — head (10:00→11:00) is expired
    now_ist = datetime(2030, 10, 2, 11, 5)
    stats = await TaskService(session).run_due_repetitive(now=now_ist)
    assert stats["generated"] == 1
    await session.refresh(head)
    assert head.status == "abandoned"
    assert head.abandoned_reason == "NEXT_SCHEDULED_OCCURRENCE"

    clone = (await session.execute(
        select(Task).where(Task.series_id == head.id,
                           Task.id != head.id)
    )).scalar_one()
    assert clone.status in {"pending", "assigned"}
    assert _aware(clone.scheduled_for) == ist(2030, 10, 2, 11, 0)
    assert _aware(clone.expires_at) == ist(2030, 10, 2, 12, 0)


async def test_series_unique_index_blocks_dup_spawn(session, seed):
    """DB-level dedupe: two rows can't share (series_id, due_date)."""
    import sqlalchemy.exc as sa_exc
    prop = seed["prop"]
    sid = uuid.uuid4()
    t1 = Task(id=uuid.uuid4(), property_id=prop.id, title="X",
              task_type="repetitive", series_id=sid,
              due_date="2030-10-02T10:00")
    t2 = Task(id=uuid.uuid4(), property_id=prop.id, title="X",
              task_type="repetitive", series_id=sid,
              due_date="2030-10-02T10:00")
    session.add_all([t1, t2])
    with pytest.raises(sa_exc.IntegrityError):
        await session.commit()


# ---------------------------------------------------------------------------
# "Generate Now" — manual generation runs the same expiry→generation
# lifecycle as the scheduler tick.
# ---------------------------------------------------------------------------

async def test_generate_now_supersedes_open_predecessor(session, seed):
    from app.models.structure import Room
    prop, admin, room = seed["prop"], seed["admin"], seed["room"]
    room2 = Room(property_id=prop.id, room_number="102", type="Deluxe")
    session.add(room2)
    await session.flush()
    t = make_template(
        prop, next_run_at=ist(2030, 10, 2, 10, 0),
        location={"scope": "rooms",
                  "room_uids": [str(room.id), str(room2.id)]},
    )
    session.add(t)
    await session.commit()

    await TemplateService(session).run_due(now=ist(2030, 10, 2, 10, 0))
    tasks = await _tasks(session, t.id)
    assert len(tasks) == 2
    a = next(x for x in tasks if x.room_id == room.id)
    b = next(x for x in tasks if x.room_id == room2.id)
    assert a.status in {"pending", "assigned"}

    # Generate the 11:00 occurrence for room 101 on demand — only room
    # 101's still-open 10:00 instance is superseded. Room 102's instance
    # of the same occurrence stays valid until its own expiry.
    occ = ist(2030, 10, 2, 11, 0)
    created = await TaskOpsService(session).generate_occurrence(
        admin, t.id, f"{occ.isoformat()}|room:{room.id}")

    await session.refresh(a)
    assert a.status == "abandoned"
    assert a.abandoned_reason == "NEXT_SCHEDULED_OCCURRENCE"
    await session.refresh(b)
    assert b.status in {"pending", "assigned"}   # sibling untouched
    tasks = await _tasks(session, t.id)
    assert len(tasks) == 3
    assert tasks[2].id == created.id
    assert tasks[2].status in {"pending", "assigned"}
    assert _aware(tasks[2].scheduled_for) == occ
    assert _aware(tasks[2].expires_at) == ist(2030, 10, 2, 12, 0)


async def test_generate_now_still_blocked_by_unrelated_open_task(session, seed):
    """Duplicate protection stays for non-recurring blockers — an open
    manual task with the same room+title is not superseded."""
    prop, admin, room = seed["prop"], seed["admin"], seed["room"]
    session.add(Task(
        property_id=prop.id, title="Clean Occupied", room_id=room.id,
        room_number=room.room_number, status="assigned",
    ))
    t = make_template(
        prop, next_run_at=ist(2030, 10, 2, 10, 0),
        location={"scope": "rooms", "room_uids": [str(room.id)]},
    )
    session.add(t)
    await session.commit()

    occ = ist(2030, 10, 2, 11, 0)
    with pytest.raises(ValidationErr):
        await TaskOpsService(session).generate_occurrence(
            admin, t.id, f"{occ.isoformat()}|room:{room.id}")


# ---------------------------------------------------------------------------
# Common-area target — one zone-scoped task per zone.
# ---------------------------------------------------------------------------

async def test_common_area_generates_one_task_per_zone(session, seed):
    from app.models.structure import Zone
    prop = seed["prop"]
    session.add_all([
        Zone(property_id=prop.id, name="Cafe", code="CF", zone_type="public"),
        Zone(property_id=prop.id, name="Pool", code="PL", zone_type="public"),
    ])
    await session.flush()
    t = make_template(
        prop, next_run_at=ist(2030, 10, 2, 10, 0),
        location={"scope": "property", "target": "common_area"})
    session.add(t)
    await session.commit()

    tgts = await TemplateService(session)._expand_targets(t)
    assert len(tgts) == 2
    assert all(tg["key"].startswith("zone:") for tg in tgts)

    await TemplateService(session).run_due(now=ist(2030, 10, 2, 10, 0))
    tasks = await _tasks(session, t.id)
    assert len(tasks) == 2
    assert {x.zone_id for x in tasks} == {
        tg["zone_id"] for tg in tgts}
    for x in tasks:
        assert x.room_id is None and x.dorm_id is None
        assert x.washroom_id is None
        assert _aware(x.scheduled_for) == ist(2030, 10, 2, 10, 0)
        assert _aware(x.expires_at) == ist(2030, 10, 2, 11, 0)


async def test_common_area_generate_now_supersedes_only_that_zone(session, seed):
    from app.models.structure import Zone
    prop, admin = seed["prop"], seed["admin"]
    z1 = Zone(property_id=prop.id, name="Cafe", code="CF", zone_type="public")
    z2 = Zone(property_id=prop.id, name="Pool", code="PL", zone_type="public")
    session.add_all([z1, z2])
    await session.flush()
    t = make_template(
        prop, next_run_at=ist(2030, 10, 2, 10, 0),
        location={"scope": "property", "target": "common_area"})
    session.add(t)
    await session.commit()

    await TemplateService(session).run_due(now=ist(2030, 10, 2, 10, 0))
    tasks = await _tasks(session, t.id)
    a = next(x for x in tasks if x.zone_id == z1.id)
    b = next(x for x in tasks if x.zone_id == z2.id)

    occ = ist(2030, 10, 2, 11, 0)
    created = await TaskOpsService(session).generate_occurrence(
        admin, t.id, f"{occ.isoformat()}|zone:{z1.id}")

    await session.refresh(a)
    assert a.status == "abandoned"
    assert a.abandoned_reason == "NEXT_SCHEDULED_OCCURRENCE"
    await session.refresh(b)
    assert b.status in {"pending", "assigned"}   # other zone untouched
    assert _aware(created.scheduled_for) == occ
    assert _aware(created.expires_at) == ist(2030, 10, 2, 12, 0)


# ---------------------------------------------------------------------------
# Today's Abandoned — scoped to the operational day, resets at day start.
# ---------------------------------------------------------------------------

async def test_abandoned_today_scoped_to_operational_day(session, seed):
    from datetime import time as dtime
    from app.services.rollover import operational_day_bounds

    prop, admin = seed["prop"], seed["admin"]
    seed["company"].operational_day_start = "06:00"
    await session.commit()

    now_utc = datetime.now(UTC)
    op_start, op_end = operational_day_bounds(now_utc, dtime(6, 0))

    inside = Task(property_id=prop.id, title="In", status="abandoned",
                  abandoned_at=op_start + timedelta(minutes=1),
                  abandoned_reason="NEXT_SCHEDULED_OCCURRENCE")
    before = Task(property_id=prop.id, title="Out", status="abandoned",
                  abandoned_at=op_start - timedelta(minutes=1),
                  abandoned_reason="SYSTEM_DAILY_ROLLOVER")
    session.add_all([inside, before])
    await session.commit()

    res = await TaskOpsService(session).today(admin, prop.id)
    uids = {i["task_uid"] for i in res["abandoned_today"]}
    assert str(inside.id) in uids
    assert str(before.id) not in uids
    from app.services.rollover import operational_day_key
    assert res["abandoned_day"] == operational_day_key(
        now_utc.astimezone(IST_OFFSET), dtime(6, 0))
