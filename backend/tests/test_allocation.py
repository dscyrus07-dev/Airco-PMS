"""Work allocation engine tests — zone round-robin, batches, audit trail."""

import pytest_asyncio
from httpx import AsyncClient

from tests.test_structure import _auth, _property, _signup


@pytest_asyncio.fixture
async def admin(client):
    return await _signup(client)


@pytest_asyncio.fixture
async def prop(client, admin):
    return await _property(client, admin)


async def _zone(client, h, pid, name="Zone B"):
    res = await client.post("/api/v1/zones", headers=h, json={
        "property_uid": pid, "name": name, "zone_type": "stay"})
    assert res.status_code == 201, res.text
    return res.json()


async def _room_in_zone(client, h, pid, zid, number):
    res = await client.post("/api/v1/rooms", headers=h, json={
        "property_uid": pid, "room_number": number,
        "type": "Private Room", "zone_uid": zid})
    assert res.status_code == 201, res.text
    return res.json()


async def _employee_in_zone(client, h, pid, zid, name, email):
    res = await client.post("/api/v1/employees", headers=h, json={
        "property_uid": pid, "name": name, "email": email,
        "password": "Staff@1234", "job_title": "Housekeeping"})
    assert res.status_code == 201, res.text
    emp = res.json()
    res = await client.patch(
        f"/api/v1/employees/{emp['employee_uid']}/allocation",
        headers=h, json={"zone_uid": zid})
    assert res.status_code == 200, res.text
    return emp


async def _ticket(client, h, pid, room_uid, issue="Issue x"):
    res = await client.post("/api/v1/maintenance", headers=h, json={
        "property_uid": pid, "room_uid": room_uid,
        "maintenance_type": "plumbing", "issue": issue, "priority": "medium"})
    assert res.status_code == 201, res.text
    return res.json()


# -- Test 1: three single tickets rotate Rahul → Priya → Amit ---------------
async def test_round_robin_single_tickets(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    z = await _zone(client, h, pid)
    for i, (n, e) in enumerate([("Rahul", "r1@t.co"), ("Priya", "p2@t.co"), ("Amit", "a3@t.co")]):
        await _employee_in_zone(client, h, pid, z["zone_uid"], n, e)
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "101")

    names = []
    for i in range(3):
        t = await _ticket(client, h, pid, room["room_uid"], f"Leak {i}")
        names.append(t["assigned_to_name"])
        assert t["allocation_status"] == "auto_assigned"
        assert t["allocation_method"] == "round_robin"
        assert t["allocation_batch_id"]
        assert t["status"] == "assigned"  # auto-assigned ticket starts assigned
    assert names == ["Rahul", "Priya", "Amit"]

    # wrap-around
    t = await _ticket(client, h, pid, room["room_uid"], "Leak 4")
    assert t["assigned_to_name"] == "Rahul"


# -- Test 2+3: batch across 3 rooms → per-room groups rotate the pointer ----
async def test_batch_same_employee_pointer_once(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "Rahul", "r1@t.co")
    await _employee_in_zone(client, h, pid, z["zone_uid"], "Priya", "p2@t.co")
    rooms = [await _room_in_zone(client, h, pid, z["zone_uid"], n)
             for n in ("101", "102", "103")]

    res = await client.post("/api/v1/work-batches", headers=h, json={
        "property_uid": pid,
        "tickets": [
            {"kind": "maintenance", "room_uid": r["room_uid"],
             "maintenance_type": "plumbing", "issue": f"Batch issue {i}"}
            for i, r in enumerate(rooms)
        ]})
    assert res.status_code == 201, res.text
    batches = res.json()["batches"]
    # each room is its own allocation group → 3 batches rotating the pool
    assert len(batches) == 3
    assert [b["employee_name"] for b in batches] == ["Rahul", "Priya", "Rahul"]
    assert all(b["batch_number"].startswith("WB-") for b in batches)
    assert all(len(b["tickets"]) == 1 for b in batches)

    # pointer advanced per room → next single ticket goes to Priya
    t = await _ticket(client, h, pid, rooms[0]["room_uid"], "Next one")
    assert t["assigned_to_name"] == "Priya"


# -- Test 4: inactive employee is skipped ------------------------------------
async def test_inactive_employee_skipped(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "Rahul", "r1@t.co")
    priya = await _employee_in_zone(client, h, pid, z["zone_uid"], "Priya", "p2@t.co")
    await _employee_in_zone(client, h, pid, z["zone_uid"], "Amit", "a3@t.co")
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "101")

    # first ticket → Rahul
    t = await _ticket(client, h, pid, room["room_uid"], "one")
    assert t["assigned_to_name"] == "Rahul"

    # deactivate Priya → next is Amit (not Priya)
    res = await client.patch(f"/api/v1/employees/{priya['employee_uid']}",
                             headers=h, json={"status": "Inactive"})
    assert res.status_code == 200, res.text
    t = await _ticket(client, h, pid, room["room_uid"], "two")
    assert t["assigned_to_name"] == "Amit"


# -- Test 5: employee zone transfer makes them eligible ----------------------
async def test_employee_transfer_eligible(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    za = await _zone(client, h, pid, "Zone A")
    zb = await _zone(client, h, pid, "Zone B")
    rahul = await _employee_in_zone(client, h, pid, za["zone_uid"], "Rahul", "r1@t.co")
    room_b = await _room_in_zone(client, h, pid, zb["zone_uid"], "201")

    # Zone B has nobody → unassigned
    t = await _ticket(client, h, pid, room_b["room_uid"], "before move")
    assert t["allocation_status"] == "unassigned"
    assert t["allocation_reason"] == "no_eligible_employee"
    assert t["assigned_to"] is None

    # move Rahul to Zone B → he becomes eligible
    res = await client.patch(
        f"/api/v1/employees/{rahul['employee_uid']}/allocation",
        headers=h, json={"zone_uid": zb["zone_uid"]})
    assert res.status_code == 200
    t = await _ticket(client, h, pid, room_b["room_uid"], "after move")
    assert t["assigned_to_name"] == "Rahul"


# -- Test 6: room zone transfer resolves the NEW zone -------------------------
async def test_room_transfer_uses_new_zone(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    za = await _zone(client, h, pid, "Zone A")
    zb = await _zone(client, h, pid, "Zone B")
    await _employee_in_zone(client, h, pid, za["zone_uid"], "ZoneAGuy", "za@t.co")
    await _employee_in_zone(client, h, pid, zb["zone_uid"], "ZoneBGal", "zb@t.co")
    room = await _room_in_zone(client, h, pid, za["zone_uid"], "301")

    # move the room to Zone B — backend resolves zone from the DB row
    res = await client.patch(f"/api/v1/rooms/{room['room_uid']}/allocation",
                             headers=h, json={"zone_uid": zb["zone_uid"]})
    assert res.status_code == 200, res.text
    t = await _ticket(client, h, pid, room["room_uid"], "moved room")
    assert t["assigned_to_name"] == "ZoneBGal"
    assert t["zone_uid"] == zb["zone_uid"]


# -- Test 7: manual reassign doesn't disturb the pointer ----------------------
async def test_manual_reassign_preserves_pointer(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "Rahul", "r1@t.co")
    priya = await _employee_in_zone(client, h, pid, z["zone_uid"], "Priya", "p2@t.co")
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "101")

    t = await _ticket(client, h, pid, room["room_uid"], "auto")  # → Rahul
    assert t["assigned_to_name"] == "Rahul"

    # manual reassign Rahul → Priya; pointer must still hand the NEXT ticket
    # to Priya (round-robin sequence unaffected by the override)
    res = await client.post(f"/api/v1/maintenance/{t['ticket_uid']}/assign",
                            headers=h, json={"employee_uid": priya["employee_uid"]})
    assert res.status_code == 200, res.text
    assert res.json()["allocation_status"] == "manually_assigned"
    assert res.json()["allocation_method"] == "reassign"

    t2 = await _ticket(client, h, pid, room["room_uid"], "next auto")
    assert t2["assigned_to_name"] == "Priya"  # pointer moved Rahul → Priya


# -- Test 8: no-zone ticket → UNASSIGNED, no random scatter -------------------
async def test_no_zone_unassigned(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    res = await client.post("/api/v1/rooms", headers=h, json={
        "property_uid": pid, "room_number": "999", "type": "Private Room"})
    room = res.json()
    t = await _ticket(client, h, pid, room["room_uid"], "zoneless")
    assert t["allocation_status"] == "unassigned"
    assert t["allocation_reason"] == "no_zone"
    assert t["assigned_to"] is None
    assert t["allocation_batch_id"]  # single ticket = batch of one


# -- Task allocation uses the same engine -------------------------------------
async def test_task_auto_allocation(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "Rahul", "r1@t.co")
    await _employee_in_zone(client, h, pid, z["zone_uid"], "Priya", "p2@t.co")

    # maintenance ticket first → Rahul (shared zone pointer)
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "101")
    await _ticket(client, h, pid, room["room_uid"], "shared pointer")

    # task without employee → auto-allocated to next (Priya) on same pointer
    res = await client.post("/api/v1/tasks", headers=h, json={
        "property_uid": pid, "title": "Clean 101", "task_type": "fixed",
        "zone_uid": z["zone_uid"], "priority": "medium"})
    assert res.status_code == 201, res.text
    task = res.json()
    assert task["assigned_to_name"] == "Priya"
    assert task["allocation_status"] == "auto_assigned"
    assert task["allocation_method"] == "round_robin"


# -- Batch fetch + audit -------------------------------------------------------
async def test_batch_fetch_and_history(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "Rahul", "r1@t.co")
    rooms = [await _room_in_zone(client, h, pid, z["zone_uid"], n)
             for n in ("101", "102")]

    res = await client.post("/api/v1/work-batches", headers=h, json={
        "property_uid": pid,
        "tickets": [
            {"kind": "maintenance", "room_uid": rooms[0]["room_uid"],
             "maintenance_type": "hvac", "issue": "AC issue"},
            {"kind": "maintenance", "room_uid": rooms[0]["room_uid"],
             "maintenance_type": "hvac", "issue": "Thermostat"},
        ]})
    bid = res.json()["batches"][0]["batch_id"]

    res = await client.get(f"/api/v1/work-batches/{bid}", headers=h)
    assert res.status_code == 200, res.text
    b = res.json()
    assert b["employee_name"] == "Rahul"
    assert len(b["tickets"]) == 2  # same room → same batch → same employee

    res = await client.get(f"/api/v1/properties/{pid}/work-batches", headers=h)
    assert res.json()["total"] >= 1
