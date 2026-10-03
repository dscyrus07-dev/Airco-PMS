"""Maintenance calendar + daily analysis — service-level coverage.

Carry-forward policy under test: tickets are never rolled over/mutated;
daily membership is reconstructed window-wise from the event stream.
IST is the operational timezone — `ist()` pins UTC instants to IST
wall-clock times.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models.maintenance import MaintenanceTicket, MaintenanceTicketEvent
from app.models.resource_state_event import ResourceStateEvent
from app.models.structure import Area, Zone
from app.services.maintenance_analysis import MaintenanceAnalysisService
from app.services.rollover import RolloverService

UTC = timezone.utc
DAY = "2026-10-02"


def ist(y, m, d, hh, mm):
    """UTC instant equal to the given IST wall-clock time."""
    return datetime(y, m, d, hh, mm, tzinfo=timezone(timedelta(hours=5, minutes=30))) \
        .astimezone(UTC)


def make_ticket(prop, company, **kw) -> MaintenanceTicket:
    kw.setdefault("id", uuid.uuid4())
    kw.setdefault("company_id", company.id)
    kw.setdefault("property_id", prop.id)
    kw.setdefault("ticket_number", f"MT-2026-{uuid.uuid4().int % 99999:05d}")
    kw.setdefault("maintenance_type", "plumbing")
    kw.setdefault("issue", "Leak under sink")
    return MaintenanceTicket(**kw)


def make_event(ticket, action, at, **kw) -> MaintenanceTicketEvent:
    return MaintenanceTicketEvent(
        id=uuid.uuid4(), ticket_id=ticket.id, action=action,
        created_at=at, **kw,
    )


async def _day(session, seed, day=DAY):
    return await MaintenanceAnalysisService(session).day(
        seed["admin"], seed["prop"].id, day
    )


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------

async def test_calendar_counts_raised_and_carried(session, seed):
    prop, company = seed["prop"], seed["company"]
    raised = make_ticket(prop, company, created_at=ist(2026, 10, 2, 9, 0))
    carried = make_ticket(prop, company, created_at=ist(2026, 9, 30, 10, 0))
    session.add_all([raised, carried])
    session.add_all([
        make_event(raised, "created", raised.created_at),
        make_event(carried, "created", carried.created_at),
    ])
    await session.commit()

    res = await MaintenanceAnalysisService(session).calendar(
        seed["admin"], prop.id, "2026-10"
    )
    days = {d["date"]: d for d in res["days"]}
    assert res["month"] == "2026-10"
    # The carried ticket is present on every day of the month (still open);
    # Oct 1 is the last day before Oct 2 where carried shows alone.
    assert days["2026-10-01"]["carried"] == 1
    assert days["2026-10-02"]["raised"] == 1
    assert days["2026-10-02"]["carried"] == 1


async def test_calendar_empty_month(session, seed):
    res = await MaintenanceAnalysisService(session).calendar(
        seed["admin"], seed["prop"].id, "2026-10"
    )
    assert res["days"] == []


async def test_calendar_skips_ticket_terminal_before_day(session, seed):
    """A ticket cancelled Sep 30 must not light up October days."""
    prop, company = seed["prop"], seed["company"]
    t = make_ticket(prop, company, created_at=ist(2026, 9, 29, 8, 0))
    session.add(t)
    session.add_all([
        make_event(t, "created", t.created_at),
        make_event(t, "cancelled", ist(2026, 9, 30, 12, 0)),
    ])
    await session.commit()
    res = await MaintenanceAnalysisService(session).calendar(
        seed["admin"], prop.id, "2026-10"
    )
    assert res["days"] == []


async def test_calendar_bad_month_rejected(session, seed):
    from app.services.structure import ValidationErr
    with pytest.raises(ValidationErr):
        await MaintenanceAnalysisService(session).calendar(
            seed["admin"], seed["prop"].id, "2026-13"
        )


# ---------------------------------------------------------------------------
# Operational-day boundary
# ---------------------------------------------------------------------------

async def test_boundary_0559_belongs_to_previous_day(session, seed):
    """05:59 IST Oct 3 is still Oct 2's operational day (06:00 start)."""
    prop, company = seed["prop"], seed["company"]
    t = make_ticket(prop, company, created_at=ist(2026, 10, 3, 5, 59))
    session.add(t)
    session.add(make_event(t, "created", t.created_at))
    await session.commit()

    oct2 = await _day(session, seed, "2026-10-02")
    oct3 = await _day(session, seed, "2026-10-03")
    assert oct2["summary"]["raised"] == 1
    assert oct3["summary"]["raised"] == 0
    assert oct3["summary"]["carried"] == 1  # still open → carried next day


async def test_boundary_0600_belongs_to_new_day(session, seed):
    prop, company = seed["prop"], seed["company"]
    t = make_ticket(prop, company, created_at=ist(2026, 10, 3, 6, 0))
    session.add(t)
    session.add(make_event(t, "created", t.created_at))
    await session.commit()

    assert (await _day(session, seed, "2026-10-02"))["summary"]["raised"] == 0
    assert (await _day(session, seed, "2026-10-03"))["summary"]["raised"] == 1


async def test_custom_operational_start_respected(session, seed):
    """A company with 22:00 start groups 21:59/22:00 around its boundary."""
    company, prop = seed["company"], seed["prop"]
    company.operational_day_start = "22:00"
    t = make_ticket(prop, company, created_at=ist(2026, 10, 2, 21, 59))
    session.add(t)
    session.add(make_event(t, "created", t.created_at))
    await session.commit()

    assert (await _day(session, seed, "2026-10-01"))["summary"]["raised"] == 1
    assert (await _day(session, seed, "2026-10-02"))["summary"]["raised"] == 0


# ---------------------------------------------------------------------------
# Daily analysis — counts, lifecycle replay, carry-forward
# ---------------------------------------------------------------------------

async def test_daily_counts(session, seed):
    prop, company = seed["prop"], seed["company"]
    emp = seed["employee"]

    raised = make_ticket(
        prop, company, status="closed", room_id=seed["room"].id,
        room_number="101", assigned_to=emp.id, assigned_to_name=emp.name,
        created_at=ist(2026, 10, 2, 9, 0), resolved_at=ist(2026, 10, 2, 11, 0),
        closed_at=ist(2026, 10, 2, 12, 0),
    )
    cancelled = make_ticket(prop, company, status="cancelled",
                            created_at=ist(2026, 10, 2, 10, 0))
    open_t = make_ticket(prop, company, created_at=ist(2026, 10, 2, 14, 0))
    session.add_all([raised, cancelled, open_t])
    session.add_all([
        make_event(raised, "created", raised.created_at),
        make_event(raised, "assigned", ist(2026, 10, 2, 9, 5)),
        make_event(raised, "started", ist(2026, 10, 2, 9, 30),
                   actor_name=emp.name),
        make_event(raised, "resolved", ist(2026, 10, 2, 11, 0)),
        make_event(raised, "closed", ist(2026, 10, 2, 12, 0)),
        make_event(cancelled, "created", cancelled.created_at),
        make_event(cancelled, "cancelled", ist(2026, 10, 2, 15, 0)),
        make_event(open_t, "created", open_t.created_at),
    ])
    await session.commit()

    res = await _day(session, seed)
    s = res["summary"]
    assert s["raised"] == 3
    assert s["allocated"] == 1
    assert s["resolved"] == 1
    assert s["closed"] == 1
    assert s["cancelled"] == 1
    assert s["open_at_end"] == 1
    assert s["employees_involved"] == 1

    row = next(t for t in res["tickets"]
               if t["ticket_uid"] == str(raised.id))
    assert row["status_at_day_end"] == "closed"
    assert row["resolution_time_min"] == 120.0      # 09:00→11:00
    assert row["time_to_start_min"] == 30.0          # 09:00→09:30
    assert row["actual_worker"] == emp.name
    assert row["resource_label"] == "Room 101"


async def test_status_at_day_end_replayed(session, seed):
    """Resolved Oct 2, closed Oct 4 → Oct 2 shows 'resolved', Oct 4 'closed'."""
    prop, company = seed["prop"], seed["company"]
    t = make_ticket(
        prop, company, status="closed",
        created_at=ist(2026, 10, 2, 9, 0),
        resolved_at=ist(2026, 10, 2, 11, 0),
        closed_at=ist(2026, 10, 4, 10, 0),
    )
    session.add(t)
    session.add_all([
        make_event(t, "created", t.created_at),
        make_event(t, "resolved", t.resolved_at),
        make_event(t, "closed", t.closed_at),
    ])
    await session.commit()

    oct2 = await _day(session, seed, "2026-10-02")
    oct3 = await _day(session, seed, "2026-10-03")
    oct4 = await _day(session, seed, "2026-10-04")
    assert oct2["tickets"][0]["status_at_day_end"] == "resolved"
    assert oct2["summary"]["pending_review"] == 1
    # Oct 3 — resolved (pending close) carries forward, blocking the room
    assert oct3["tickets"][0]["status_at_day_end"] == "resolved"
    assert oct3["summary"]["carried"] == 1
    assert oct4["tickets"][0]["status_at_day_end"] == "closed"
    assert oct4["summary"]["closed"] == 1


async def test_unassigned_open_replay(session, seed):
    """assigned→Unassigned event replay returns the ticket to 'open'."""
    prop, company = seed["prop"], seed["company"]
    t = make_ticket(prop, company, status="open",
                    created_at=ist(2026, 10, 2, 9, 0))
    session.add(t)
    session.add_all([
        make_event(t, "created", t.created_at),
        make_event(t, "assigned", ist(2026, 10, 2, 9, 5)),
        make_event(t, "assigned", ist(2026, 10, 2, 10, 0),
                   comment="Unassigned"),
    ])
    await session.commit()
    res = await _day(session, seed)
    assert res["tickets"][0]["status_at_day_end"] == "open"


async def test_carry_forward_no_mutation(session, seed):
    """Analysis is read-only: repeated calls add zero history events and
    never touch the ticket; the rollover sweep ignores maintenance rows."""
    prop, company = seed["prop"], seed["company"]
    t = make_ticket(prop, company, status="in_progress",
                    created_at=ist(2026, 10, 1, 9, 0))
    session.add(t)
    session.add_all([
        make_event(t, "created", t.created_at),
        make_event(t, "started", ist(2026, 10, 1, 10, 0)),
    ])
    await session.commit()

    for _ in range(2):
        res = await _day(session, seed, "2026-10-02")
        assert res["summary"]["carried"] == 1
        assert res["tickets"][0]["status_at_day_end"] == "in_progress"

    # rollover writes nothing for tickets
    stats = await RolloverService(session).run(now=ist(2026, 10, 3, 7, 0))
    assert stats["abandoned"] == 0
    await session.refresh(t)
    assert t.status == "in_progress"

    n = (await session.execute(
        select(func.count()).select_from(MaintenanceTicketEvent)
        .where(MaintenanceTicketEvent.ticket_id == t.id)
    )).scalar_one()
    assert n == 2  # created + started only — no analysis events


async def test_cancelled_before_window_excluded(session, seed):
    prop, company = seed["prop"], seed["company"]
    t = make_ticket(prop, company, status="cancelled",
                    created_at=ist(2026, 10, 1, 8, 0))
    session.add(t)
    session.add_all([
        make_event(t, "created", t.created_at),
        make_event(t, "cancelled", ist(2026, 10, 1, 18, 0)),
    ])
    await session.commit()
    res = await _day(session, seed)
    assert res["summary"]["tickets"] == 0


# ---------------------------------------------------------------------------
# Aggregations
# ---------------------------------------------------------------------------

async def _agg_seed(session, seed):
    """Two zones + one area, three tickets exercising every bucket."""
    company, prop, emp = seed["company"], seed["prop"], seed["employee"]
    area = Area(id=uuid.uuid4(), property_id=prop.id, name="Floor 1",
                code="F1")
    zone1 = Zone(id=uuid.uuid4(), property_id=prop.id, area_id=area.id,
                 name="Zone A", code="ZA")
    zone2 = Zone(id=uuid.uuid4(), property_id=prop.id, area_id=area.id,
                 name="Zone B", code="ZB")
    session.add_all([area, zone1, zone2])
    t1 = make_ticket(prop, company, status="closed", zone_id=zone1.id,
                     maintenance_type="hvac", issue="AC dead",
                     assigned_to=emp.id, assigned_to_name=emp.name,
                     created_at=ist(2026, 10, 2, 9, 0),
                     resolved_at=ist(2026, 10, 2, 10, 0),
                     closed_at=ist(2026, 10, 2, 10, 30))
    t2 = make_ticket(prop, company, status="in_progress", zone_id=zone2.id,
                     maintenance_type="plumbing", issue="Tap leak",
                     created_at=ist(2026, 10, 2, 11, 0))
    t3 = make_ticket(prop, company, status="open",
                     maintenance_type="hvac", issue="No cold air",
                     created_at=ist(2026, 10, 2, 12, 0))
    session.add_all([t1, t2, t3])
    session.add_all([
        make_event(t1, "created", t1.created_at),
        make_event(t1, "assigned", ist(2026, 10, 2, 9, 2)),
        make_event(t1, "resolved", t1.resolved_at),
        make_event(t1, "closed", t1.closed_at),
        make_event(t2, "created", t2.created_at),
        make_event(t2, "started", ist(2026, 10, 2, 11, 30),
                   actor_name=emp.name),
        make_event(t3, "created", t3.created_at),
    ])
    await session.commit()


async def test_zone_area_category_aggregations(session, seed):
    await _agg_seed(session, seed)
    res = await _day(session, seed)

    zones = {z["zone"]: z for z in res["zones"]}
    assert zones["Zone A"]["raised"] == 1 and zones["Zone A"]["closed"] == 1
    assert zones["Zone B"]["raised"] == 1 and zones["Zone B"]["open"] == 1
    assert zones["Unzoned"]["raised"] == 1

    areas = {a["area"]: a for a in res["areas"]}
    assert areas["Floor 1"]["raised"] == 2
    assert areas["Floor 1"]["avg_resolution_min"] == 60.0

    cats = {c["category"]: c for c in res["categories"]}
    assert cats["Hvac"]["raised"] == 2
    assert cats["Hvac"]["closed"] == 1
    assert cats["Hvac"]["open"] == 1
    assert cats["Hvac"]["completion_rate"] == 50.0
    assert cats["Plumbing"]["raised"] == 1


async def test_employee_aggregation(session, seed):
    await _agg_seed(session, seed)
    res = await _day(session, seed)
    assert len(res["employees"]) == 1
    e = res["employees"][0]
    assert e["employee"] == seed["employee"].name
    assert e["tickets"] == 1            # only t1 is assigned
    assert e["closed"] == 1
    assert e["avg_resolution_min"] == 60.0
    assert "Zone A" in e["zones"]


# ---------------------------------------------------------------------------
# Resource impact
# ---------------------------------------------------------------------------

async def test_resource_transitions_surfaced(session, seed):
    prop, company = seed["prop"], seed["company"]
    room = seed["room"]
    t = make_ticket(prop, company, status="resolved", room_id=room.id,
                    room_number="101", created_at=ist(2026, 10, 2, 9, 0),
                    resolved_at=ist(2026, 10, 2, 11, 0))
    session.add(t)
    session.add_all([
        make_event(t, "created", t.created_at),
        make_event(t, "resolved", t.resolved_at),
        ResourceStateEvent(
            resource_type="room", resource_id=room.id,
            property_id=prop.id, previous_state="available",
            new_state="maintenance", source="ticket_created",
            ticket_id=t.id, actor_name="Admin User",
            created_at=t.created_at,
        ),
        ResourceStateEvent(
            resource_type="room", resource_id=room.id,
            property_id=prop.id, previous_state="maintenance",
            new_state="available", source="ticket_closed",
            ticket_id=t.id, actor_name="Admin User",
            created_at=ist(2026, 10, 2, 12, 0),
        ),
    ])
    await session.commit()

    res = await _day(session, seed)
    row = res["tickets"][0]
    assert row["resource_was"] == "available"
    assert row["resource_after"] == "available"
    assert row["resource_current"] == room.status
    assert len(row["resource_transitions"]) == 2
    assert row["resource_transitions"][0]["to"] == "maintenance"


async def test_resolved_ticket_resource_stays_blocked(session, seed):
    """resolved ≠ released — the room stays 'maintenance' until close."""
    prop, company = seed["prop"], seed["company"]
    room = seed["room"]
    room.status = "maintenance"
    t = make_ticket(prop, company, status="resolved", room_id=room.id,
                    room_number="101", created_at=ist(2026, 10, 2, 9, 0),
                    resolved_at=ist(2026, 10, 2, 11, 0))
    session.add(t)
    session.add_all([
        make_event(t, "created", t.created_at),
        make_event(t, "resolved", t.resolved_at),
        ResourceStateEvent(
            resource_type="room", resource_id=room.id,
            property_id=prop.id, previous_state="available",
            new_state="maintenance", source="ticket_created",
            ticket_id=t.id, created_at=t.created_at,
        ),
    ])
    await session.commit()

    res = await _day(session, seed)
    row = res["tickets"][0]
    assert row["status_at_day_end"] == "resolved"
    assert res["summary"]["pending_review"] == 1
    # last transition left it in maintenance — honest blocked reporting
    assert row["resource_after"] == "maintenance"
    assert row["resource_current"] == "maintenance"


# ---------------------------------------------------------------------------
# Scoping + validation
# ---------------------------------------------------------------------------

async def test_property_scoped(session, seed):
    """Tickets from another property must not leak into this analysis."""
    from app.models.property import Property
    other = Property(
        company_id=seed["company"].id, name="Other", code="OTH",
        location="L", city="C", state="S", manager_name="M",
        manager_email="o@x.test",
    )
    session.add(other)
    await session.flush()
    t = make_ticket(other, seed["company"],
                    created_at=ist(2026, 10, 2, 9, 0))
    session.add(t)
    session.add(make_event(t, "created", t.created_at))
    await session.commit()
    res = await _day(session, seed)
    assert res["summary"]["tickets"] == 0


async def test_bad_date_rejected(session, seed):
    from app.services.structure import ValidationErr
    with pytest.raises(ValidationErr):
        await _day(session, seed, "02-10-2026")
