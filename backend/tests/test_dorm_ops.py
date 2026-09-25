"""Dorm/bed ops lifecycle — approval of generated work releases only the
covered beds; open work keeps a bed blocked; bed scope never leaks onto
siblings.
"""

from tests.test_allocation import _employee_in_zone, _zone
from tests.test_structure import _auth, _property, _signup


async def _dorm(client, h, pid, zid, name="Dorm 105", beds=4):
    res = await client.post("/api/v1/dorms", headers=h, json={
        "property_uid": pid, "name": name, "dorm_type": "Mixed Dorm",
        "washroom": "Attached", "bed_count": beds, "zone_uid": zid})
    assert res.status_code == 201, res.text
    return res.json()


async def _dorm_state(client, h, dorm_uid):
    res = await client.get("/api/v1/dorms", headers=h)
    assert res.status_code == 200, res.text
    for d in res.json()["items"]:
        if d["dorm_uid"] == dorm_uid:
            return d
    raise AssertionError("dorm not found")


async def _bulk(client, h, pid, **kw):
    res = await client.post("/api/v1/units/bulk-status", headers=h,
                            json={"property_uid": pid, **kw})
    assert res.status_code == 200, res.text
    return res.json()


async def _login_employee(client, email, password="Staff@1234"):
    res = await client.post("/api/v1/auth/login",
                            json={"identifier": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _bed(dorm, number):
    return next(b for b in dorm["beds"] if b["bed_number"] == number)


async def _submit_approve(client, h, emp_email, task):
    """employee submits evidence → PM approves."""
    eh = _auth(await _login_employee(client, emp_email))
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/submit",
                            headers=eh, json={
                                "note": "done",
                                "photo_urls": ["/uploads/a.jpg"]})
    assert res.status_code == 200, res.text
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/approve",
                            headers=h, json={})
    assert res.status_code == 200, res.text
    return res.json()


# ---------------------------------------------------------------------------
# The reported bug — approved bed cleaning must release the bed
# ---------------------------------------------------------------------------

async def test_bed_cleaning_approval_releases_only_that_bed(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    dorm = await _dorm(client, h, pid, z["zone_uid"])
    bed4 = _bed(dorm, "Bed 04")

    res = await _bulk(client, h, pid, action="cleaning",
                      bed_uids=[bed4["bed_uid"]])
    task = res["generated_tasks"][0]
    # task carries the dorm/bed linkage needed for approval-time release
    assert task["dorm_uid"] == dorm["dorm_uid"]
    assert task["dorm_name"] == "Dorm 105"
    assert task["bed_uids"] == [bed4["bed_uid"]]

    state = await _dorm_state(client, h, dorm["dorm_uid"])
    assert _bed(state, "Bed 04")["status"] == "cleaning"
    assert _bed(state, "Bed 03")["status"] == "available"

    await _submit_approve(client, h, "a@t.co", task)
    state = await _dorm_state(client, h, dorm["dorm_uid"])
    assert _bed(state, "Bed 04")["status"] == "available"
    # siblings untouched by the release
    assert _bed(state, "Bed 01")["status"] == "available"


async def test_whole_dorm_cleaning_approval_releases_all_covered_beds(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    dorm = await _dorm(client, h, pid, z["zone_uid"])
    uids = [b["bed_uid"] for b in dorm["beds"]]

    res = await _bulk(client, h, pid, action="cleaning", bed_uids=uids)
    assert len(res["generated_tasks"]) == 1  # one dorm task covers all beds
    task = res["generated_tasks"][0]
    assert sorted(task["bed_uids"]) == sorted(uids)

    await _submit_approve(client, h, "a@t.co", task)
    state = await _dorm_state(client, h, dorm["dorm_uid"])
    assert {b["status"] for b in state["beds"]} == {"available"}


async def test_bed_checkout_approval_releases_bed(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    dorm = await _dorm(client, h, pid, z["zone_uid"])
    bed2 = _bed(dorm, "Bed 02")

    res = await _bulk(client, h, pid, action="checkout",
                      bed_uids=[bed2["bed_uid"]])
    task = res["generated_tasks"][0]
    assert task["bed_uids"] == [bed2["bed_uid"]]
    await _submit_approve(client, h, "a@t.co", task)
    state = await _dorm_state(client, h, dorm["dorm_uid"])
    assert _bed(state, "Bed 02")["status"] == "available"


# ---------------------------------------------------------------------------
# Blockers — open work must keep the bed locked
# ---------------------------------------------------------------------------

async def test_second_open_task_keeps_bed_in_cleaning(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    dorm = await _dorm(client, h, pid, z["zone_uid"])
    bed = _bed(dorm, "Bed 01")

    # two dorm tasks — Bed 01 in task1 only, Bed 02 in task2
    t1 = (await _bulk(client, h, pid, action="cleaning",
                      bed_uids=[bed["bed_uid"]]))["generated_tasks"][0]
    bed2 = _bed(dorm, "Bed 02")
    t2 = (await _bulk(client, h, pid, action="cleaning",
                      bed_uids=[bed2["bed_uid"]]))["generated_tasks"][0]
    assert t1["task_uid"] != t2["task_uid"]

    # approving t1 frees Bed 01; Bed 02 still has its own open task
    await _submit_approve(client, h, "a@t.co", t1)
    state = await _dorm_state(client, h, dorm["dorm_uid"])
    assert _bed(state, "Bed 01")["status"] == "available"
    assert _bed(state, "Bed 02")["status"] == "cleaning"


async def test_submitted_task_still_blocks_bed(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    dorm = await _dorm(client, h, pid, z["zone_uid"])
    bed = _bed(dorm, "Bed 01")

    task = (await _bulk(client, h, pid, action="cleaning",
                        bed_uids=[bed["bed_uid"]]))["generated_tasks"][0]
    eh = _auth(await _login_employee(client, "a@t.co"))
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/submit",
                            headers=eh, json={
                                "photo_urls": ["/uploads/a.jpg"]})
    assert res.status_code == 200, res.text
    state = await _dorm_state(client, h, dorm["dorm_uid"])
    # employee submission is not acknowledgement — still blocked
    assert _bed(state, "Bed 01")["status"] == "cleaning"


async def test_rejected_task_keeps_bed_blocked(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    dorm = await _dorm(client, h, pid, z["zone_uid"])
    bed = _bed(dorm, "Bed 01")

    task = (await _bulk(client, h, pid, action="cleaning",
                        bed_uids=[bed["bed_uid"]]))["generated_tasks"][0]
    eh = _auth(await _login_employee(client, "a@t.co"))
    await client.post(f"/api/v1/tasks/{task['task_uid']}/submit",
                      headers=eh, json={"photo_urls": ["/uploads/a.jpg"]})
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/reject",
                            headers=h, json={"reason": "not clean enough"})
    assert res.status_code == 200, res.text
    state = await _dorm_state(client, h, dorm["dorm_uid"])
    assert _bed(state, "Bed 01")["status"] == "cleaning"


# ---------------------------------------------------------------------------
# Maintenance scope — bed tickets release their bed only; dorm tickets the dorm
# ---------------------------------------------------------------------------

async def test_bed_maintenance_close_releases_only_that_bed(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    dorm = await _dorm(client, h, pid, z["zone_uid"])
    bed1 = _bed(dorm, "Bed 01")

    res = await client.post("/api/v1/maintenance", headers=h, json={
        "property_uid": pid, "bed_uid": bed1["bed_uid"],
        "maintenance_type": "plumbing", "issue": "broken rail",
        "priority": "medium"})
    assert res.status_code == 201, res.text
    ticket = res.json()

    state = await _dorm_state(client, h, dorm["dorm_uid"])
    assert _bed(state, "Bed 01")["status"] == "maintenance"
    assert _bed(state, "Bed 02")["status"] == "available"

    await client.post(f"/api/v1/maintenance/{ticket['ticket_uid']}/resolve",
                      headers=h, json={"resolution_notes": "fixed",
                                       "photo_urls": []})
    # resolve alone does not release — the PM close (acknowledgement) does
    state = await _dorm_state(client, h, dorm["dorm_uid"])
    assert _bed(state, "Bed 01")["status"] == "maintenance"

    await client.post(f"/api/v1/maintenance/{ticket['ticket_uid']}/close",
                      headers=h)
    state = await _dorm_state(client, h, dorm["dorm_uid"])
    # approved maintenance releases the bed; siblings untouched
    assert _bed(state, "Bed 01")["status"] == "available"
    assert _bed(state, "Bed 02")["status"] == "available"


async def test_dorm_maintenance_close_releases_dorm(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    dorm = await _dorm(client, h, pid, z["zone_uid"])

    res = await client.post("/api/v1/maintenance", headers=h, json={
        "property_uid": pid, "dorm_uid": dorm["dorm_uid"],
        "maintenance_type": "electrical", "issue": "rewire",
        "priority": "high"})
    assert res.status_code == 201, res.text
    ticket = res.json()

    state = await _dorm_state(client, h, dorm["dorm_uid"])
    assert {b["status"] for b in state["beds"]} == {"maintenance"}
    assert state["status"] == "maintenance"

    await client.post(f"/api/v1/maintenance/{ticket['ticket_uid']}/resolve",
                      headers=h, json={"resolution_notes": "done",
                                       "photo_urls": []})
    await client.post(f"/api/v1/maintenance/{ticket['ticket_uid']}/close",
                      headers=h)
    state = await _dorm_state(client, h, dorm["dorm_uid"])
    assert {b["status"] for b in state["beds"]} == {"available"}
    assert state["status"] == "available"
