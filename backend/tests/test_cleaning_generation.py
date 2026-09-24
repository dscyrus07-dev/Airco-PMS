"""Zone board bulk actions → cleaning task generation + zone allocation."""

from tests.test_allocation import _employee_in_zone, _room_in_zone, _zone
from tests.test_structure import _auth, _property, _signup


async def _bulk(client, h, pid, **kw):
    res = await client.post("/api/v1/units/bulk-status", headers=h,
                            json={"property_uid": pid, **kw})
    assert res.status_code == 200, res.text
    return res.json()


async def test_checkout_generates_allocated_cleaning_task(client):
    admin = await _signup(client)
    h = _auth(admin)
    prop = await _property(client, admin)
    pid = prop["property_uid"]
    z = await _zone(client, h, pid)
    emp = await _employee_in_zone(client, h, pid, z["zone_uid"], "Rahul", "r1@t.co")
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "201")

    res = await _bulk(client, h, pid, action="checkout",
                      room_uids=[room["room_uid"]])
    assert res["rooms"][0]["status"] == "cleaning"

    tasks = res["generated_tasks"]
    assert len(tasks) == 1
    t = tasks[0]
    assert t["title"] == "Checkout cleaning — Room 201"
    assert t["employee_uid"] == emp["employee_uid"]
    assert t["status"] == "assigned"
    assert t["room_uid"] == room["room_uid"]
    assert t["zone_uid"] == z["zone_uid"]
    assert t["allocation_method"] == "round_robin"
    assert t["ticket_number"]
    assert t["history"][0]["type"] == "auto_generated"


async def test_cleaning_action_labels_task_cleaning(client):
    admin = await _signup(client)
    h = _auth(admin)
    prop = await _property(client, admin)
    pid = prop["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "Rahul", "r1@t.co")
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "202")

    res = await _bulk(client, h, pid, action="cleaning",
                      room_uids=[room["room_uid"]])
    t = res["generated_tasks"][0]
    assert t["title"] == "Cleaning — Room 202"

    # re-clicking the same action must not pile up duplicates
    res2 = await _bulk(client, h, pid, action="cleaning",
                       room_uids=[room["room_uid"]])
    assert res2["generated_tasks"] == []


async def test_unassigned_zone_still_generates_open_task(client):
    admin = await _signup(client)
    h = _auth(admin)
    prop = await _property(client, admin)
    pid = prop["property_uid"]
    z = await _zone(client, h, pid)
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "203")

    res = await _bulk(client, h, pid, action="cleaning",
                      room_uids=[room["room_uid"]])
    t = res["generated_tasks"][0]
    assert t["status"] == "pending"  # no eligible employee → open pool
    assert t["allocation_reason"] == "no_eligible_employee"


async def test_available_action_generates_nothing(client):
    admin = await _signup(client)
    h = _auth(admin)
    prop = await _property(client, admin)
    pid = prop["property_uid"]
    z = await _zone(client, h, pid)
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "204")

    res = await _bulk(client, h, pid, action="available",
                      room_uids=[room["room_uid"]])
    assert res["generated_tasks"] == []
