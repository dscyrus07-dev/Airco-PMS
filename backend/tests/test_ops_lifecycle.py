"""Operational lifecycle tests — derived room status + per-unit round-robin.

Rules under test:
  - cleaning tasks distribute per-room round-robin (not one zone assignee)
  - employee submit does NOT free the room; supervisor approve does
  - a room with other blocking work never goes to 'available'
  - maintenance batches group by room (same room → same employee)
  - resolve doesn't release; close (acknowledgement) releases to available
"""

import uuid
from datetime import datetime, timedelta

from tests.test_allocation import _employee_in_zone, _room_in_zone, _zone
from tests.test_structure import _auth, _property, _signup


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


async def _room_status(client, h, room_uid):
    res = await client.get("/api/v1/rooms", headers=h)
    for r in res.json()["items"]:
        if r["room_uid"] == room_uid:
            return r["status"]
    raise AssertionError("room not found")


# ---------------------------------------------------------------------------
# Cleaning allocation — per-room round-robin
# ---------------------------------------------------------------------------

async def test_bulk_cleaning_round_robin_per_room(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    await _employee_in_zone(client, h, pid, z["zone_uid"], "B", "b@t.co")
    rooms = [await _room_in_zone(client, h, pid, z["zone_uid"], n)
             for n in ("201", "202", "203")]

    res = await _bulk(client, h, pid, action="cleaning",
                      room_uids=[r["room_uid"] for r in rooms])
    tasks = res["generated_tasks"]
    assert len(tasks) == 3
    # per-room round-robin — NOT all on one employee
    assert [t["assigned_to_name"] for t in tasks] == ["A", "B", "A"]
    assert {t["allocation_batch_id"] for t in tasks} and \
        len({t["allocation_batch_id"] for t in tasks}) == 3


async def test_bulk_cleaning_rotation_continues_across_calls(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    await _employee_in_zone(client, h, pid, z["zone_uid"], "B", "b@t.co")
    r1 = await _room_in_zone(client, h, pid, z["zone_uid"], "301")
    r2 = await _room_in_zone(client, h, pid, z["zone_uid"], "302")

    t1 = (await _bulk(client, h, pid, action="cleaning",
                      room_uids=[r1["room_uid"]]))["generated_tasks"][0]
    t2 = (await _bulk(client, h, pid, action="cleaning",
                      room_uids=[r2["room_uid"]]))["generated_tasks"][0]
    # second bulk op continues the rotation — doesn't restart at A
    assert (t1["assigned_to_name"], t2["assigned_to_name"]) == ("A", "B")


async def test_cleaning_skips_ineligible_employees(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    gone = await _employee_in_zone(client, h, pid, z["zone_uid"], "B", "b@t.co")
    await client.patch(f"/api/v1/employees/{gone['employee_uid']}",
                       headers=h, json={"status": "Inactive"})
    rooms = [await _room_in_zone(client, h, pid, z["zone_uid"], n)
             for n in ("401", "402")]
    tasks = (await _bulk(client, h, pid, action="cleaning",
                         room_uids=[r["room_uid"] for r in
                                    rooms]))["generated_tasks"]
    assert [t["assigned_to_name"] for t in tasks] == ["A", "A"]


# ---------------------------------------------------------------------------
# Cleaning lifecycle — submit → acknowledge → available
# ---------------------------------------------------------------------------

async def test_cleaning_submit_does_not_release_room(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    emp = await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "501")

    res = await _bulk(client, h, pid, action="checkout",
                      room_uids=[room["room_uid"]])
    assert res["rooms"][0]["status"] == "cleaning"
    task = res["generated_tasks"][0]
    assert task["assigned_to_name"] == "A"

    # employee submits — room must NOT flip to available
    eh = _auth(await _login_employee(client, "a@t.co"))
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/submit",
                            headers=eh, json={"note": "done", "photo_urls": ["/uploads/a.jpg"]})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "submitted"
    assert await _room_status(client, h, room["room_uid"]) == "cleaning"

    # supervisor acknowledges → room derives to available
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/approve",
                            headers=h, json={})
    assert res.status_code == 200, res.text
    assert res.json()["task"]["status"] == "completed"
    assert await _room_status(client, h, room["room_uid"]) == "available"


async def test_blocking_maintenance_keeps_room_unavailable(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "601")

    # maintenance ticket → room blocked
    res = await client.post("/api/v1/maintenance", headers=h, json={
        "property_uid": pid, "room_uid": room["room_uid"],
        "maintenance_type": "plumbing", "issue": "leak", "priority": "high"})
    assert res.status_code == 201, res.text
    assert await _room_status(client, h, room["room_uid"]) == "maintenance"

    # cleaning task on the same room — approve it; maintenance still blocks
    res = await _bulk(client, h, pid, action="cleaning",
                      room_uids=[room["room_uid"]])
    task = res["generated_tasks"][0]
    await client.post(f"/api/v1/tasks/{task['task_uid']}/submit",
                      headers=_auth(await _login_employee(client, "a@t.co")),
                      json={"photo_urls": ["/uploads/a.jpg"]})
    await client.post(f"/api/v1/tasks/{task['task_uid']}/approve",
                      headers=h, json={})
    assert await _room_status(client, h, room["room_uid"]) == "maintenance"

    # manual 'available' must not override the active maintenance
    res = await _bulk(client, h, pid, action="available",
                      room_uids=[room["room_uid"]])
    assert res["skipped_blocked"] == ["601"]
    assert await _room_status(client, h, room["room_uid"]) == "maintenance"


async def test_available_bulk_releases_clean_room(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "701")

    res = await _bulk(client, h, pid, action="cleaning",
                      room_uids=[room["room_uid"]])
    task = res["generated_tasks"][0]
    # complete + approve the only blocker → bulk available now derives clean
    eh = _auth(await _login_employee(client, "a@t.co"))
    await client.post(f"/api/v1/tasks/{task['task_uid']}/submit",
                      headers=eh, json={"photo_urls": ["/uploads/a.jpg"]})
    await client.post(f"/api/v1/tasks/{task['task_uid']}/approve",
                      headers=h, json={})
    assert await _room_status(client, h, room["room_uid"]) == "available"


# ---------------------------------------------------------------------------
# Maintenance allocation — same room = same employee; per-room rotation
# ---------------------------------------------------------------------------

async def test_same_room_maintenance_shares_employee(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    await _employee_in_zone(client, h, pid, z["zone_uid"], "B", "b@t.co")
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "801")

    res = await client.post("/api/v1/work-batches", headers=h, json={
        "property_uid": pid,
        "tickets": [
            {"kind": "maintenance", "room_uid": room["room_uid"],
             "maintenance_type": "hvac", "issue": "AC broken"},
            {"kind": "maintenance", "room_uid": room["room_uid"],
             "maintenance_type": "plumbing", "issue": "Tap leak"},
            {"kind": "maintenance", "room_uid": room["room_uid"],
             "maintenance_type": "electrical", "issue": "Light dead"},
        ]})
    assert res.status_code == 201, res.text
    batches = res.json()["batches"]
    assert len(batches) == 1                      # one allocation group
    assert len(batches[0]["tickets"]) == 3
    assert {t["assigned_to_name"] for t in batches[0]["tickets"]} == {"A"}


async def test_multi_room_maintenance_rotates(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    await _employee_in_zone(client, h, pid, z["zone_uid"], "B", "b@t.co")
    r1 = await _room_in_zone(client, h, pid, z["zone_uid"], "901")
    r2 = await _room_in_zone(client, h, pid, z["zone_uid"], "902")

    res = await client.post("/api/v1/work-batches", headers=h, json={
        "property_uid": pid,
        "tickets": [
            {"kind": "maintenance", "room_uid": r1["room_uid"],
             "maintenance_type": "hvac", "issue": "AC broken"},
            {"kind": "maintenance", "room_uid": r1["room_uid"],
             "maintenance_type": "plumbing", "issue": "Tap leak"},
            {"kind": "maintenance", "room_uid": r2["room_uid"],
             "maintenance_type": "hvac", "issue": "AC broken"},
            {"kind": "maintenance", "room_uid": r2["room_uid"],
             "maintenance_type": "electrical", "issue": "Plug dead"},
        ]})
    batches = res.json()["batches"]
    assert len(batches) == 2
    # each room's items share ONE employee; rooms rotate A → B
    assert [b["employee_name"] for b in batches] == ["A", "B"]
    assert all(len(b["tickets"]) == 2 for b in batches)


async def test_maintenance_resolve_blocks_until_supervisor_close(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "1001")

    res = await client.post("/api/v1/maintenance", headers=h, json={
        "property_uid": pid, "room_uid": room["room_uid"],
        "maintenance_type": "hvac", "issue": "AC broken", "priority": "medium"})
    t = res.json()

    # employee resolves → room still blocked (no release without ack)
    res = await client.post(f"/api/v1/maintenance/{t['ticket_uid']}/resolve",
                            headers=h, json={"resolution_notes": "fixed",
                                             "photo_urls": []})
    assert res.status_code == 200
    assert await _room_status(client, h, room["room_uid"]) == "maintenance"

    # supervisor closes (acknowledges) → unit back to available
    res = await client.post(f"/api/v1/maintenance/{t['ticket_uid']}/close",
                            headers=h)
    assert res.status_code == 200
    assert await _room_status(client, h, room["room_uid"]) == "available"


async def test_partial_maintenance_close_keeps_room_blocked(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "1101")

    res = await client.post("/api/v1/work-batches", headers=h, json={
        "property_uid": pid,
        "tickets": [
            {"kind": "maintenance", "room_uid": room["room_uid"],
             "maintenance_type": "hvac", "issue": "AC broken"},
            {"kind": "maintenance", "room_uid": room["room_uid"],
             "maintenance_type": "plumbing", "issue": "Tap leak"},
        ]})
    t1, t2 = res.json()["batches"][0]["tickets"]

    for t in (t1, t2):
        await client.post(f"/api/v1/maintenance/{t['ticket_uid']}/resolve",
                          headers=h, json={"resolution_notes": "done",
                                           "photo_urls": []})
    # close the first — the second resolved-but-unclosed ticket still blocks
    await client.post(f"/api/v1/maintenance/{t1['ticket_uid']}/close",
                      headers=h)
    assert await _room_status(client, h, room["room_uid"]) == "maintenance"

    # close the last blocker → unit released to available
    await client.post(f"/api/v1/maintenance/{t2['ticket_uid']}/close",
                      headers=h)
    assert await _room_status(client, h, room["room_uid"]) == "available"


# ---------------------------------------------------------------------------
# Idempotent / duplicate operations
# ---------------------------------------------------------------------------

async def test_duplicate_cleaning_bulk_does_not_double_book(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "1201")

    r1 = await _bulk(client, h, pid, action="checkout",
                     room_uids=[room["room_uid"]])
    r2 = await _bulk(client, h, pid, action="checkout",
                     room_uids=[room["room_uid"]])
    assert len(r1["generated_tasks"]) == 1
    assert r2["generated_tasks"] == []        # deduped, not duplicated


async def test_double_acknowledge_is_consistent(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "1301")

    task = (await _bulk(client, h, pid, action="cleaning",
                        room_uids=[room["room_uid"]]))["generated_tasks"][0]
    await client.post(f"/api/v1/tasks/{task['task_uid']}/submit",
                      headers=_auth(await _login_employee(client, "a@t.co")),
                      json={"photo_urls": ["/uploads/a.jpg"]})
    r1 = await client.post(f"/api/v1/tasks/{task['task_uid']}/approve",
                           headers=h, json={})
    r2 = await client.post(f"/api/v1/tasks/{task['task_uid']}/approve",
                           headers=h, json={})
    assert r1.status_code == 200
    # second ack is rejected cleanly — no duplicate state transition
    assert r2.status_code in (200, 409)
    assert await _room_status(client, h, room["room_uid"]) == "available"


# ---------------------------------------------------------------------------
# Pending Check — PM review queue
# ---------------------------------------------------------------------------

async def _setup_cleaning_task(client):
    """company+property+zone+employee+room with one open cleaning task."""
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "1401")
    task = (await _bulk(client, h, pid, action="cleaning",
                        room_uids=[room["room_uid"]]))["generated_tasks"][0]
    return h, pid, task, room


async def test_pending_check_lists_submitted_work(client):
    h, pid, task, room = await _setup_cleaning_task(client)

    # nothing pending yet
    res = await client.get("/api/v1/tasks/pending-check",
                           headers=h, params={"property_uid": pid})
    assert res.status_code == 200
    assert res.json()["count"] == 0

    # employee submits → appears in the queue with evidence
    await client.post(f"/api/v1/tasks/{task['task_uid']}/submit",
                      headers=_auth(await _login_employee(client, "a@t.co")),
                      json={"note": "done", "photo_urls": ["/uploads/x.jpg"]})
    res = await client.get("/api/v1/tasks/pending-check",
                           headers=h, params={"property_uid": pid})
    body = res.json()
    assert body["count"] == 1
    item = body["items"][0]
    assert item["kind"] == "task" and item["uid"] == task["task_uid"]
    assert item["employee"] == "A" and item["photo_urls"] == ["/uploads/x.jpg"]

    # approval removes it from the queue
    await client.post(f"/api/v1/tasks/{task['task_uid']}/approve",
                      headers=h, json={})
    res = await client.get("/api/v1/tasks/pending-check",
                           headers=h, params={"property_uid": pid})
    assert res.json()["count"] == 0


async def test_submit_requires_photo_evidence(client):
    h, pid, task, _ = await _setup_cleaning_task(client)
    eh = _auth(await _login_employee(client, "a@t.co"))
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/submit",
                            headers=eh, json={"note": "no photo"})
    assert res.status_code == 422


async def test_employee_cannot_approve_own_work(client):
    h, pid, task, room = await _setup_cleaning_task(client)
    eh = _auth(await _login_employee(client, "a@t.co"))
    await client.post(f"/api/v1/tasks/{task['task_uid']}/submit",
                      headers=eh, json={"photo_urls": ["/uploads/a.jpg"]})
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/approve",
                            headers=eh, json={})
    assert res.status_code in (403, 404)
    assert await _room_status(client, h, room["room_uid"]) == "cleaning"


async def test_employee_cannot_see_pending_check(client):
    h, pid, task, _ = await _setup_cleaning_task(client)
    eh = _auth(await _login_employee(client, "a@t.co"))
    res = await client.get("/api/v1/tasks/pending-check",
                           headers=eh, params={"property_uid": pid})
    assert res.status_code == 403


async def test_task_disapprove_returns_to_employee(client):
    h, pid, task, room = await _setup_cleaning_task(client)
    eh = _auth(await _login_employee(client, "a@t.co"))
    await client.post(f"/api/v1/tasks/{task['task_uid']}/submit",
                      headers=eh, json={"photo_urls": ["/uploads/a.jpg"]})

    # disapproval requires a reason
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/reject",
                            headers=h, json={"reason": "x"})
    assert res.status_code == 422

    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/reject",
                            headers=h, json={"reason": "Bathroom not done"})
    assert res.status_code == 200
    assert res.json()["status"] == "reopened"
    assert await _room_status(client, h, room["room_uid"]) == "cleaning"

    # employee resubmits → pending check again → approve → released
    await client.post(f"/api/v1/tasks/{task['task_uid']}/submit",
                      headers=eh, json={"photo_urls": ["/uploads/b.jpg"]})
    res = await client.get("/api/v1/tasks/pending-check",
                           headers=h, params={"property_uid": pid})
    assert res.json()["count"] == 1
    await client.post(f"/api/v1/tasks/{task['task_uid']}/approve",
                      headers=h, json={})
    assert await _room_status(client, h, room["room_uid"]) == "available"


async def test_maintenance_pending_check_and_disapprove(client):
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "1501")

    res = await client.post("/api/v1/maintenance", headers=h, json={
        "property_uid": pid, "room_uid": room["room_uid"],
        "maintenance_type": "hvac", "issue": "AC broken", "priority": "high"})
    t = res.json()

    # resolve → shows in pending check as a maintenance item
    await client.post(f"/api/v1/maintenance/{t['ticket_uid']}/resolve",
                      headers=h, json={"resolution_notes": "replaced",
                                       "photo_urls": ["/uploads/r.jpg"]})
    res = await client.get("/api/v1/tasks/pending-check",
                           headers=h, params={"property_uid": pid})
    body = res.json()
    assert body["count"] == 1 and body["items"][0]["kind"] == "maintenance"
    assert body["items"][0]["note"] == "replaced"

    # disapprove → back to rework, still blocking
    res = await client.post(f"/api/v1/maintenance/{t['ticket_uid']}/disapprove",
                            headers=h, json={"reason": "Leak persists"})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "in_progress"
    res = await client.get("/api/v1/tasks/pending-check",
                           headers=h, params={"property_uid": pid})
    assert res.json()["count"] == 0
    assert await _room_status(client, h, room["room_uid"]) == "maintenance"

    # rework → resubmit → approve (close) → available
    await client.post(f"/api/v1/maintenance/{t['ticket_uid']}/resolve",
                      headers=h, json={"resolution_notes": "fixed again",
                                       "photo_urls": []})
    await client.post(f"/api/v1/maintenance/{t['ticket_uid']}/close",
                      headers=h)
    assert await _room_status(client, h, room["room_uid"]) == "available"


async def test_task_disapprove_repeated_rework_cycle(client):
    """Submit → reject → rework → resubmit → reject → resubmit → approve —
    the SAME task travels the whole cycle; no duplicates, assignee kept."""
    h, pid, task, room = await _setup_cleaning_task(client)
    eh = _auth(await _login_employee(client, "a@t.co"))
    uid = task["task_uid"]

    for i in range(2):
        res = await client.post(f"/api/v1/tasks/{uid}/submit",
                                headers=eh,
                                json={"photo_urls": [f"/uploads/cycle{i}.jpg"]})
        assert res.status_code == 200 and res.json()["status"] == "submitted"

        res = await client.post(f"/api/v1/tasks/{uid}/reject",
                                headers=h, json={"reason": f"redo #{i + 1}"})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["task_uid"] == uid                # same task — no clone
        assert body["status"] == "reopened"
        assert body["assigned_to_name"] == "A"        # original assignee kept
        assert body["submitted_at"] is None
        rejected = [e for e in body["history"] if e["type"] == "rejected"]
        assert len(rejected) == i + 1
        assert rejected[-1]["note"] == f"redo #{i + 1}"

        # not under review while it's back with the employee
        res = await client.get("/api/v1/tasks/pending-check",
                               headers=h, params={"property_uid": pid})
        assert res.json()["count"] == 0
        # and no duplicate task was spawned for the same work
        res = await client.get("/api/v1/tasks", headers=h,
                               params={"property_uid": pid, "limit": 100})
        assert len([t for t in res.json()["items"]
                    if t["title"] == task["title"]]) == 1

    # third submission is finally approved — same task reaches 'completed'
    res = await client.post(f"/api/v1/tasks/{uid}/submit",
                            headers=eh, json={"photo_urls": ["/uploads/done.jpg"]})
    assert res.json()["status"] == "submitted"
    res = await client.post(f"/api/v1/tasks/{uid}/approve", headers=h, json={})
    assert res.status_code == 200
    assert res.json()["task"]["status"] == "completed"
    assert await _room_status(client, h, room["room_uid"]) == "available"


async def test_reopened_task_stays_on_today_list(client):
    """A disapproved task must remain on the employee's Today list even when
    its due date already passed — rework cannot silently disappear."""
    admin = await _signup(client)
    h = _auth(admin)
    pid = (await _property(client, admin))["property_uid"]
    z = await _zone(client, h, pid)
    emp = await _employee_in_zone(client, h, pid, z["zone_uid"], "A", "a@t.co")

    yesterday = (datetime.now() - timedelta(days=1)).date().isoformat()
    res = await client.post("/api/v1/tasks", headers=h, json={
        "property_uid": pid, "title": "Deep clean carpets",
        "task_type": "fixed", "employee_uid": emp["employee_uid"],
        "due_date": yesterday})
    assert res.status_code == 201, res.text
    task = res.json()

    eh = _auth(await _login_employee(client, "a@t.co"))
    await client.post(f"/api/v1/tasks/{task['task_uid']}/submit",
                      headers=eh, json={"photo_urls": ["/uploads/a.jpg"]})
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/reject",
                            headers=h, json={"reason": "not done properly"})
    assert res.json()["status"] == "reopened"

    # employee's Today list keeps the rework visible + actionable
    res = await client.get("/api/v1/tasks/today",
                           headers=eh, params={"property_uid": pid})
    items = {i["task_uid"]: i for i in res.json()["items"]}
    assert task["task_uid"] in items
    assert items[task["task_uid"]]["work_status"] == "reopened"
    assert items[task["task_uid"]]["assignee"] == "A"


async def test_task_status_cannot_be_patched_directly(client):
    """PATCH /tasks/{id} must refuse `status` — 'completed' set directly
    would fake approval without evidence, review, or unit release."""
    h, pid, task, room = await _setup_cleaning_task(client)
    res = await client.patch(f"/api/v1/tasks/{task['task_uid']}",
                             headers=h, json={"status": "completed"})
    assert res.status_code == 422
    res = await client.get("/api/v1/tasks", headers=h,
                           params={"property_uid": pid, "limit": 100})
    t = next(t for t in res.json()["items"] if t["task_uid"] == task["task_uid"])
    assert t["status"] == "assigned"
    # ordinary field updates still work
    res = await client.patch(f"/api/v1/tasks/{task['task_uid']}",
                             headers=h, json={"priority": "high"})
    assert res.status_code == 200 and res.json()["priority"] == "high"


async def test_reopen_already_reopened_task_conflicts(client):
    h, pid, task, room = await _setup_cleaning_task(client)
    eh = _auth(await _login_employee(client, "a@t.co"))
    await client.post(f"/api/v1/tasks/{task['task_uid']}/submit",
                      headers=eh, json={"photo_urls": ["/uploads/a.jpg"]})
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/reject",
                            headers=h, json={"reason": "redo it"})
    assert res.json()["status"] == "reopened"
    # reopening an already-open task is a clean conflict, not a corrupt state
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/reopen",
                            headers=h, json={})
    assert res.status_code == 409


async def test_employee_cannot_bypass_review_via_complete(client):
    h, pid, task, room = await _setup_cleaning_task(client)
    eh = _auth(await _login_employee(client, "a@t.co"))
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/complete",
                            headers=eh,
                            json={"photo_urls": ["/uploads/a.jpg"]})
    assert res.status_code == 403
    assert await _room_status(client, h, room["room_uid"]) == "cleaning"
