"""Area-level employee assignment — covers every zone inside the area."""

from tests.test_allocation import _employee_in_zone, _room_in_zone, _zone
from tests.test_structure import _auth, _property, _signup


async def _area(client, h, pid, name="Ground Floor"):
    res = await client.post("/api/v1/areas", headers=h, json={
        "property_uid": pid, "name": name, "level_number": 0,
    })
    assert res.status_code == 201, res.text
    return res.json()


async def _zone_in_area(client, h, pid, area_uid, name="Dorms"):
    res = await client.post("/api/v1/zones", headers=h, json={
        "property_uid": pid, "name": name,
        "zone_type": "stay", "area_uid": area_uid,
    })
    assert res.status_code == 201, res.text
    return res.json()


async def test_area_assignee_is_eligible_in_its_zones(client):
    admin = await _signup(client)
    h = _auth(admin)
    prop = await _property(client, admin)
    pid = prop["property_uid"]
    area = await _area(client, h, pid)
    z1 = await _zone_in_area(client, h, pid, area["area_uid"], "Dorms")
    z2 = await _zone_in_area(client, h, pid, area["area_uid"], "Rooms")
    emp = await _employee_in_zone(client, h, pid, None, "Rahul", "r1@t.co")

    # assign employee to the whole area
    res = await client.patch(
        f"/api/v1/employees/{emp['employee_uid']}/allocation", headers=h,
        json={"area_uid": area["area_uid"]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["area_uid"] == area["area_uid"]
    assert body["zone_uid"] is None

    # work in EITHER zone of that area lands on the area assignee
    for i, z in enumerate((z1, z2)):
        res = await client.post("/api/v1/units/bulk-status", headers=h, json={
            "property_uid": pid, "action": "cleaning",
            "room_uids": [
                (await _room_in_zone(client, h, pid, z["zone_uid"], f"{i+1}"))["room_uid"]
            ],
        })
        assert res.status_code == 200, res.text
        t = res.json()["generated_tasks"][0]
        assert t["employee_uid"] == emp["employee_uid"]


async def test_zone_assign_clears_area_and_back(client):
    admin = await _signup(client)
    h = _auth(admin)
    prop = await _property(client, admin)
    pid = prop["property_uid"]
    area = await _area(client, h, pid)
    z = await _zone_in_area(client, h, pid, area["area_uid"], "Dorms")
    emp = await _employee_in_zone(client, h, pid, z["zone_uid"], "Rahul", "r1@t.co")

    res = await client.patch(
        f"/api/v1/employees/{emp['employee_uid']}/zone", headers=h,
        json={"zone_uid": None, "area_uid": area["area_uid"]})
    assert res.json()["area_uid"] == area["area_uid"]
    assert res.json()["zone_uid"] is None

    # re-assigning a zone clears the area assignment
    res = await client.patch(
        f"/api/v1/employees/{emp['employee_uid']}/zone", headers=h,
        json={"zone_uid": z["zone_uid"]})
    assert res.json()["zone_uid"] == z["zone_uid"]
    assert res.json()["area_uid"] is None

    # clearing everything → unallocated
    res = await client.patch(
        f"/api/v1/employees/{emp['employee_uid']}/zone", headers=h,
        json={"zone_uid": None})
    assert res.json()["zone_uid"] is None
    assert res.json()["area_uid"] is None


async def test_area_assignee_not_eligible_outside_area(client):
    admin = await _signup(client)
    h = _auth(admin)
    prop = await _property(client, admin)
    pid = prop["property_uid"]
    area = await _area(client, h, pid)
    await _zone_in_area(client, h, pid, area["area_uid"], "Dorms")
    other = await _zone(client, h, pid)          # zone outside the area
    room = await _room_in_zone(client, h, pid, other["zone_uid"], "9")
    emp = await _employee_in_zone(client, h, pid, None, "Rahul", "r1@t.co")
    await client.patch(
        f"/api/v1/employees/{emp['employee_uid']}/zone", headers=h,
        json={"zone_uid": None, "area_uid": area["area_uid"]})

    res = await client.post("/api/v1/units/bulk-status", headers=h, json={
        "property_uid": pid, "action": "cleaning",
        "room_uids": [room["room_uid"]],
    })
    t = res.json()["generated_tasks"][0]
    assert t["status"] == "pending"   # area assignee not eligible here
    assert t["allocation_reason"] == "no_eligible_employee"
