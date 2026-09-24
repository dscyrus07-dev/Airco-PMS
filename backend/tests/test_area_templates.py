"""Area-scoped templates — expand to zone targets / area pool allocation."""

from tests.test_allocation import _employee_in_zone
from tests.test_area_assignment import _area, _zone_in_area
from tests.test_structure import _auth, _property, _signup


async def _template(client, h, pid, location, name="Mop the floor"):
    res = await client.post("/api/v1/templates", headers=h, json={
        "property_uid": pid,
        "name": name,
        "template_type": "task",
        "priority": "medium",
        "location": location,
        "assignment": {"mode": "automatic", "method": "zone_round_robin"},
        "schedule": {"kind": "one_time", "date": "2020-01-01", "time": "08:00"},
        "status": "active",
    })
    assert res.status_code == 201, res.text
    return res.json()


async def _assign_to_area(client, h, emp_uid, area_uid):
    res = await client.patch(f"/api/v1/employees/{emp_uid}/zone",
                             headers=h,
                             json={"zone_uid": None, "area_uid": area_uid})
    assert res.status_code == 200, res.text


async def test_area_scope_with_zones_allocates_via_zone_pool(client):
    admin = await _signup(client)
    h = _auth(admin)
    prop = await _property(client, admin)
    pid = prop["property_uid"]
    area = await _area(client, h, pid)
    z = await _zone_in_area(client, h, pid, area["area_uid"], "Dorms")
    # area-level assignee — no zone assignment
    emp = await _employee_in_zone(client, h, pid, None, "Rahul", "r1@t.co")
    await _assign_to_area(client, h, emp["employee_uid"], area["area_uid"])

    await _template(client, h, pid, {
        "scope": "area", "area_uid": area["area_uid"], "target": "rooms",
    })
    stats = (await client.post("/api/v1/templates/generate-due",
                               headers=h)).json()
    assert stats["generated"] == 1  # one zone-level target for the area's zone

    tasks = (await client.get("/api/v1/tasks", headers=h,
                              params={"property_uid": pid})).json()["items"]
    assert len(tasks) == 1
    assert tasks[0]["zone_uid"] == z["zone_uid"]
    assert tasks[0]["employee_uid"] == emp["employee_uid"]
    assert tasks[0]["status"] == "assigned"


async def test_zoneless_area_scope_allocates_via_area_pool(client):
    admin = await _signup(client)
    h = _auth(admin)
    prop = await _property(client, admin)
    pid = prop["property_uid"]
    area = await _area(client, h, pid)          # NO zones inside
    emp = await _employee_in_zone(client, h, pid, None, "Rahul", "r1@t.co")
    await _assign_to_area(client, h, emp["employee_uid"], area["area_uid"])

    await _template(client, h, pid, {
        "scope": "area", "area_uid": area["area_uid"], "target": "rooms",
    })
    stats = (await client.post("/api/v1/templates/generate-due",
                               headers=h)).json()
    assert stats["generated"] == 1

    tasks = (await client.get("/api/v1/tasks", headers=h,
                              params={"property_uid": pid})).json()["items"]
    assert len(tasks) == 1
    assert tasks[0]["zone_uid"] is None
    assert tasks[0]["employee_uid"] == emp["employee_uid"]
    assert tasks[0]["status"] == "assigned"


async def test_area_scope_no_staff_stays_unassigned_with_reason(client):
    admin = await _signup(client)
    h = _auth(admin)
    prop = await _property(client, admin)
    pid = prop["property_uid"]
    area = await _area(client, h, pid)
    await _zone_in_area(client, h, pid, area["area_uid"], "Dorms")

    await _template(client, h, pid, {
        "scope": "area", "area_uid": area["area_uid"], "target": "rooms",
    })
    stats = (await client.post("/api/v1/templates/generate-due",
                               headers=h)).json()
    assert stats["generated"] == 1

    tasks = (await client.get("/api/v1/tasks", headers=h,
                              params={"property_uid": pid})).json()["items"]
    assert len(tasks) == 1
    assert tasks[0]["zone_uid"] is not None   # zone-level fallback target
    assert tasks[0]["status"] == "pending"
    assert tasks[0]["allocation_reason"] == "no_eligible_employee"
