"""Zone-aware distribution for condition-based template generation.

A multi-zone condition ("all occupied rooms, all areas, all zones") must
expand to per-unit work items grouped by zone, and each unit must be
allocated ONLY inside its own zone's eligible pool (zone staff UNION the
covering area's floor staff — the existing permitted fallback). Never a
global pick, never one employee hoarding a zone's whole workload.
"""
import datetime as _dt
import uuid

import pytest
from sqlalchemy import select

from app.models.employee import Employee
from app.models.occupancy import Occupancy
from app.models.structure import Area, Bed, Dorm, Room, Zone
from app.models.task import Task
from app.models.template import WorkTemplate
from app.services.template import TemplateService


def _zone(session, prop, name, *, area=None):
    z = Zone(
        property_id=prop.id, area_id=area.id if area else None,
        name=name, code=name[:8], floor="F1", zone_type="stay",
    )
    session.add(z)
    return z


def _room(session, prop, number, zone=None):
    r = Room(
        property_id=prop.id, zone_id=zone.id if zone else None,
        area_id=zone.area_id if zone else None,
        room_number=number, type="Std",
    )
    session.add(r)
    return r


def _emp(session, seed, name, *, zone=None, area=None,
         status="Active", dept="Housekeeping", leave=False):
    e = Employee(
        company_id=seed["company"].id, property_id=seed["prop"].id,
        name=name, email=f"{name.lower()}@acme.test",
        department=dept, status=status, leave_status=leave,
        zone_id=zone.id if zone else None,
        area_id=area.id if area else None,
    )
    session.add(e)
    return e


async def _tmpl(session, prop, loc, *, name="Clean", ttype="cleaning"):
    t = WorkTemplate(
        company_id=prop.company_id, property_id=prop.id,
        name=name, template_type=ttype, status="active",
        assignment={"mode": "automatic"}, location=loc,
        schedule={"kind": "recurring", "frequency": "daily", "time": "08:00"},
        checklist=[], verification={}, overdue={"actions": []},
        notifications={},
    )
    session.add(t)
    await session.flush()
    return t


async def _tasks_for(session, t):
    res = await session.execute(
        select(Task).where(Task.template_id == t.id)
    )
    return list(res.scalars())


def _occupy(session, prop, *, room=None, bed=None):
    session.add(Occupancy(
        property_id=prop.id, room_id=room.id if room else None,
        bed_id=bed.id if bed else None, guest_name="G",
    ))


@pytest.fixture
async def four_zones(session, seed):
    """The spec's example: Z1×4 rooms, Z2×1, Z3×2, Z4×1 — each zone with
    its own staff (Z1 gets two employees, Z4 gets two)."""
    area = Area(property_id=seed["prop"].id, name="Floor 1", code="F1")
    session.add(area)
    await session.flush()
    z1 = _zone(session, seed["prop"], "Zone 1", area=area)
    z2 = _zone(session, seed["prop"], "Zone 2", area=area)
    z3 = _zone(session, seed["prop"], "Zone 3", area=area)
    z4 = _zone(session, seed["prop"], "Zone 4", area=area)
    await session.flush()  # zone ids materialize on flush — rooms need them
    rooms = {
        z1: [_room(session, seed["prop"], n, z1)
             for n in ("Z101", "Z102", "Z103", "Z104")],
        z2: [_room(session, seed["prop"], "Z201", z2)],
        z3: [_room(session, seed["prop"], n, z3) for n in ("Z301", "Z302")],
        z4: [_room(session, seed["prop"], "Z401", z4)],
    }
    staff = {
        z1.id: [_emp(session, seed, "ZA1A", zone=z1),
                _emp(session, seed, "ZA1B", zone=z1)],
        z2.id: [_emp(session, seed, "ZA2C", zone=z2)],
        z3.id: [_emp(session, seed, "ZA3E", zone=z3)],
        z4.id: [_emp(session, seed, "ZA4F", zone=z4),
                _emp(session, seed, "ZA4G", zone=z4)],
    }
    await session.flush()
    return {"area": area, "zones": [z1, z2, z3, z4],
            "rooms": rooms, "staff": staff}


@pytest.mark.asyncio
async def test_all_rooms_distributed_per_zone(session, seed, four_zones):
    """All-areas/all-zones room condition → every room gets a task, and
    each task's assignee belongs to that room's zone pool."""
    t = await _tmpl(session, seed["prop"],
                    {"scope": "property", "target": "rooms"})
    n = await TemplateService(session)._generate(
        t, _dt.datetime.now(_dt.timezone.utc))
    assert n == 9  # 4 + 1 + 2 + 1 rooms + seed room (zone-less → property)

    tasks = await _tasks_for(session, t)
    staff = four_zones["staff"]
    by_zone = {}
    for task in tasks:
        by_zone.setdefault(task.zone_id, []).append(task)
        if task.zone_id in staff:
            allowed = {e.id for e in staff[task.zone_id]}
            assert task.employee_id in allowed, (
                f"{task.room_number} went to a foreign-zone employee")

    # Zone 1's 4 rooms split across BOTH its employees — nobody hoards.
    z1_tasks = by_zone[four_zones["zones"][0].id]
    assert len(z1_tasks) == 4
    assert {tk.employee_id for tk in z1_tasks} == \
        {e.id for e in staff[four_zones["zones"][0].id]}
    counts = {}
    for tk in z1_tasks:
        counts[tk.employee_id] = counts.get(tk.employee_id, 0) + 1
    assert sorted(counts.values()) == [2, 2]

    # Single-employee zones get their whole zone's work — nobody else can.
    for zone, expect in ((four_zones["zones"][1], 1),
                         (four_zones["zones"][2], 2)):
        ztasks = by_zone[zone.id]
        assert len(ztasks) == expect
        assert {tk.employee_id for tk in ztasks} == \
            {staff[zone.id][0].id}


@pytest.mark.asyncio
async def test_balanced_within_zone(session, seed):
    """10 rooms / 3 zone employees → all three share the load ±1."""
    z = _zone(session, seed["prop"], "Big Zone")
    await session.flush()
    for i in range(10):
        _room(session, seed["prop"], f"B{i:02d}", z)
    emps = [_emp(session, seed, f"BE{i}", zone=z) for i in range(3)]
    await session.flush()

    t = await _tmpl(session, seed["prop"],
                    {"scope": "property", "target": "rooms"})
    await TemplateService(session)._generate(
        t, _dt.datetime.now(_dt.timezone.utc))
    counts = {}
    for tk in await _tasks_for(session, t):
        if tk.zone_id == z.id:
            counts[tk.employee_id] = counts.get(tk.employee_id, 0) + 1
    assert set(counts) == {e.id for e in emps}
    assert sum(counts.values()) == 10
    assert max(counts.values()) - min(counts.values()) <= 1


@pytest.mark.asyncio
async def test_single_employee_zone_gets_all(session, seed):
    """7 rooms / 1 employee → that employee carries all 7 (nobody else is
    eligible IN that zone)."""
    z = _zone(session, seed["prop"], "Solo Zone")
    await session.flush()
    for i in range(7):
        _room(session, seed["prop"], f"S{i:02d}", z)
    e = _emp(session, seed, "SOLO", zone=z)
    await session.flush()

    t = await _tmpl(session, seed["prop"],
                    {"scope": "property", "target": "rooms"})
    await TemplateService(session)._generate(
        t, _dt.datetime.now(_dt.timezone.utc))
    ztasks = [tk for tk in await _tasks_for(session, t) if tk.zone_id == z.id]
    assert len(ztasks) == 7
    assert {tk.employee_id for tk in ztasks} == {e.id}


@pytest.mark.asyncio
async def test_zone_without_staff_uses_area_fallback(session, seed):
    """Zone with zero staff → the covering area's floor employees take it
    (the permitted fallback)."""
    area = Area(property_id=seed["prop"].id, name="Floor A", code="FA")
    session.add(area)
    await session.flush()
    z = _zone(session, seed["prop"], "Staffless", area=area)
    await session.flush()
    _room(session, seed["prop"], "ZZ1", z)
    _room(session, seed["prop"], "ZZ2", z)
    fallback = _emp(session, seed, "FLOOR", area=area)
    await session.flush()

    t = await _tmpl(session, seed["prop"],
                    {"scope": "property", "target": "rooms"})
    await TemplateService(session)._generate(
        t, _dt.datetime.now(_dt.timezone.utc))
    ztasks = [tk for tk in await _tasks_for(session, t) if tk.zone_id == z.id]
    assert len(ztasks) == 2
    assert {tk.employee_id for tk in ztasks} == {fallback.id}
    assert all(tk.allocation_status == "auto_assigned" for tk in ztasks)


@pytest.mark.asyncio
async def test_no_eligible_stays_unassigned(session, seed):
    """A zone with no staff and no area coverage → the work stays
    UNASSIGNED with a reason. It must never leak to a random employee."""
    z = _zone(session, seed["prop"], "Dead Zone")
    await session.flush()
    _room(session, seed["prop"], "DZ1", z)
    await session.flush()

    t = await _tmpl(session, seed["prop"],
                    {"scope": "property", "target": "rooms"})
    await TemplateService(session)._generate(
        t, _dt.datetime.now(_dt.timezone.utc))
    ztasks = [tk for tk in await _tasks_for(session, t) if tk.zone_id == z.id]
    assert len(ztasks) == 1
    assert ztasks[0].employee_id is None
    assert ztasks[0].allocation_status == "unassigned"
    assert ztasks[0].allocation_reason == "no_eligible_employee"


@pytest.mark.asyncio
async def test_deactivated_employee_gets_nothing(session, seed):
    z = _zone(session, seed["prop"], "Zone D")
    await session.flush()
    for i in range(4):
        _room(session, seed["prop"], f"D{i}", z)
    live = _emp(session, seed, "LIVE", zone=z)
    _emp(session, seed, "DEAD", zone=z, status="Deactivated")
    _emp(session, seed, "LEAVE", zone=z, leave=True)
    await session.flush()

    t = await _tmpl(session, seed["prop"],
                    {"scope": "property", "target": "rooms"})
    await TemplateService(session)._generate(
        t, _dt.datetime.now(_dt.timezone.utc))
    ztasks = [tk for tk in await _tasks_for(session, t) if tk.zone_id == z.id]
    assert len(ztasks) == 4
    assert {tk.employee_id for tk in ztasks} == {live.id}


@pytest.mark.asyncio
async def test_department_gating_keeps_cleaning_off_engineering(
        session, seed):
    """A cleaning template must never land on Maintenance/Engineering —
    the dept gate applies inside the zone pool, not just globally."""
    z = _zone(session, seed["prop"], "Zone M")
    await session.flush()
    _room(session, seed["prop"], "M1", z)
    _emp(session, seed, "ENGG", zone=z, dept="Maintenance & Engineering")
    hk = _emp(session, seed, "HK", zone=z)
    await session.flush()

    t = await _tmpl(session, seed["prop"],
                    {"scope": "property", "target": "rooms"})
    await TemplateService(session)._generate(
        t, _dt.datetime.now(_dt.timezone.utc))
    ztasks = [tk for tk in await _tasks_for(session, t) if tk.zone_id == z.id]
    assert len(ztasks) == 1
    assert ztasks[0].employee_id == hk.id


@pytest.mark.asyncio
async def test_occupied_rooms_condition_zone_split(session, seed):
    """'All occupied rooms' — only rooms with an OPEN occupancy become
    work items, still allocated inside their own zone."""
    z1 = _zone(session, seed["prop"], "OZ1")
    z2 = _zone(session, seed["prop"], "OZ2")
    await session.flush()
    r1 = _room(session, seed["prop"], "O101", z1)
    r2 = _room(session, seed["prop"], "O102", z1)
    _room(session, seed["prop"], "O103", z1)          # vacant — excluded
    r3 = _room(session, seed["prop"], "O201", z2)
    e1 = _emp(session, seed, "OE1", zone=z1)
    e2 = _emp(session, seed, "OE2", zone=z2)
    await session.flush()
    _occupy(session, seed["prop"], room=r1)
    _occupy(session, seed["prop"], room=r2)
    _occupy(session, seed["prop"], room=r3)
    await session.flush()

    t = await _tmpl(session, seed["prop"], {
        "scope": "property", "target": "rooms", "occupancy": "occupied"})
    await TemplateService(session)._generate(
        t, _dt.datetime.now(_dt.timezone.utc))
    tasks = [tk for tk in await _tasks_for(session, t)
             if tk.room_id in {r1.id, r2.id, r3.id}]
    assert len(tasks) == 3
    for tk in tasks:
        expected_zone = z1.id if tk.room_id in {r1.id, r2.id} else z2.id
        assert tk.zone_id == expected_zone
        assert tk.employee_id == (e1.id if tk.zone_id == z1.id else e2.id)


@pytest.mark.asyncio
async def test_dorm_beds_zone_wise(session, seed):
    """Occupied dorm beds expand as per-bed work items and stay inside
    their dorm's zone pool."""
    z1 = _zone(session, seed["prop"], "DZ1")
    z2 = _zone(session, seed["prop"], "DZ2")
    await session.flush()
    d1 = Dorm(property_id=seed["prop"].id, zone_id=z1.id, name="Dorm 1")
    d2 = Dorm(property_id=seed["prop"].id, zone_id=z2.id, name="Dorm 2")
    session.add_all([d1, d2])
    await session.flush()
    beds1 = [Bed(property_id=seed["prop"].id, dorm_id=d1.id,
                 bed_number=f"1-{i}") for i in range(3)]
    beds2 = [Bed(property_id=seed["prop"].id, dorm_id=d2.id,
                 bed_number=f"2-{i}") for i in range(2)]
    session.add_all(beds1 + beds2)
    e1 = _emp(session, seed, "DE1", zone=z1)
    e2 = _emp(session, seed, "DE2", zone=z2)
    await session.flush()
    for b in beds1 + beds2:
        _occupy(session, seed["prop"], bed=b)
    await session.flush()

    t = await _tmpl(session, seed["prop"], {
        "scope": "property", "target": "beds", "occupancy": "occupied"})
    await TemplateService(session)._generate(
        t, _dt.datetime.now(_dt.timezone.utc))
    tasks = await _tasks_for(session, t)
    bed_tasks = [tk for tk in tasks if tk.bed_ids]
    assert len(bed_tasks) == 5
    for tk in bed_tasks:
        assert tk.employee_id == (e1.id if tk.zone_id == z1.id else e2.id)
    assert sum(1 for tk in bed_tasks if tk.zone_id == z1.id) == 3
    assert sum(1 for tk in bed_tasks if tk.zone_id == z2.id) == 2


@pytest.mark.asyncio
async def test_generation_is_idempotent(session, seed, four_zones):
    """A second run for the same occurrence creates NOTHING — the ledger
    precheck filters every target before any allocation happens."""
    svc = TemplateService(session)
    t = await _tmpl(session, seed["prop"],
                    {"scope": "property", "target": "rooms"})
    now = _dt.datetime.now(_dt.timezone.utc)
    first = await svc._generate(t, now)
    second = await svc._generate(t, now)
    assert first == 9
    assert second == 0
    assert len(await _tasks_for(session, t)) == 9


@pytest.mark.asyncio
async def test_four_rooms_four_employees_each_gets_one(session, seed):
    """4 occupied rooms in one zone + 4 eligible employees → 4 separate
    work items, one per employee (nobody doubled up while a colleague
    idles)."""
    z = _zone(session, seed["prop"], "Even Zone")
    await session.flush()
    rooms = [_room(session, seed["prop"], f"E{i}", z) for i in range(4)]
    emps = [_emp(session, seed, f"EV{i}", zone=z) for i in range(4)]
    await session.flush()
    for r in rooms:
        _occupy(session, seed["prop"], room=r)
    await session.flush()

    t = await _tmpl(session, seed["prop"], {
        "scope": "property", "target": "rooms", "occupancy": "occupied"})
    n = await TemplateService(session)._generate(
        t, _dt.datetime.now(_dt.timezone.utc))
    assert n == 4
    tasks = [tk for tk in await _tasks_for(session, t)
             if tk.zone_id == z.id]
    assert len(tasks) == 4
    # one work item per room — and four DISTINCT assignees
    assert {tk.room_id for tk in tasks} == {r.id for r in rooms}
    assert {tk.employee_id for tk in tasks} == {e.id for e in emps}
    assert all(tk.work_type == "cleaning" for tk in tasks)


@pytest.mark.asyncio
async def test_occupancy_evaluated_at_generation_time(session, seed):
    """The condition must read LIVE occupancy — a room occupied after the
    template was created is included; one vacated before the run is not."""
    z = _zone(session, seed["prop"], "Live Zone")
    await session.flush()
    r1 = _room(session, seed["prop"], "L1", z)
    r2 = _room(session, seed["prop"], "L2", z)
    _emp(session, seed, "LE1", zone=z)
    await session.flush()

    # template created while ONLY r2 is occupied
    _occupy(session, seed["prop"], room=r2)
    await session.flush()
    t = await _tmpl(session, seed["prop"], {
        "scope": "property", "target": "rooms", "occupancy": "occupied"})

    # occupancy flips before the scheduled run: r1 checks in, r2 checks out
    _occupy(session, seed["prop"], room=r1)
    res = await session.execute(
        select(Occupancy).where(
            Occupancy.room_id == r2.id, Occupancy.checked_out_at.is_(None))
    )
    res.scalar_one().checked_out_at = _dt.datetime.now(_dt.timezone.utc)
    await session.flush()

    n = await TemplateService(session)._generate(
        t, _dt.datetime.now(_dt.timezone.utc))
    tasks = await _tasks_for(session, t)
    assert n == 1
    assert [tk.room_id for tk in tasks] == [r1.id]


@pytest.mark.asyncio
async def test_maintenance_type_uses_maintenance_eligibility(session, seed):
    """A maintenance work type produces maintenance TICKETS and only pulls
    from maintenance/engineering staff — housekeeping is never picked."""
    from app.models.maintenance import MaintenanceTicket

    z = _zone(session, seed["prop"], "Maint Zone")
    await session.flush()
    _room(session, seed["prop"], "MT1", z)
    _room(session, seed["prop"], "MT2", z)
    _emp(session, seed, "HK-ONLY", zone=z)                      # housekeeping
    eng = _emp(session, seed, "ENG", zone=z,
               dept="Maintenance & Engineering")
    await session.flush()

    t = await _tmpl(session, seed["prop"],
                    {"scope": "property", "target": "rooms"},
                    ttype="maintenance")
    n = await TemplateService(session)._generate(
        t, _dt.datetime.now(_dt.timezone.utc))
    assert n == 3  # MT1 + MT2 + the zone-less seed room (property pool)
    res = await session.execute(
        select(MaintenanceTicket).where(MaintenanceTicket.template_id == t.id))
    tickets = list(res.scalars())
    assert len(tickets) == 3
    assert {tk.assigned_to for tk in tickets} == {eng.id}
    # no Task rows — maintenance work type generates tickets
    assert await _tasks_for(session, t) == []


@pytest.mark.asyncio
async def test_multi_property_tick_uses_own_structure(session, seed):
    """The structure snapshot is keyed per property — a second property's
    template must NOT expand against the first property's rooms."""
    from app.models.company import Company
    from app.models.property import Property

    other = Company(
        company_name="Two", brand_name="Two", address="x",
        pin_code="1", email="t@x.test", phone_number="1",
    )
    session.add(other)
    await session.flush()
    prop2 = Property(
        company_id=other.id, name="P2", code="P2", location="L",
        city="C", state="ST", manager_name="M", manager_email="m2@x.test",
    )
    session.add(prop2)
    await session.flush()
    room2 = _room(session, prop2, "P2-01")
    t1 = await _tmpl(session, seed["prop"],
                     {"scope": "property", "target": "rooms"}, name="P1")
    t2 = await _tmpl(session, prop2,
                     {"scope": "property", "target": "rooms"}, name="P2")

    svc = TemplateService(session)
    await svc._expand_targets(t1)          # caches prop1's structure
    targets2 = await svc._expand_targets(t2)
    assert [x["room_id"] for x in targets2] == [room2.id]
    assert uuid.UUID(targets2[0]["key"].split(":")[1]) == room2.id
