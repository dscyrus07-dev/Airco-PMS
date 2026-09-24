"""Maintenance tickets + task ticket workflow tests (in-memory SQLite)."""

import pytest_asyncio
from httpx import AsyncClient

from tests.test_structure import _auth, _property, _signup


@pytest_asyncio.fixture
async def admin(client):
    return await _signup(client)


@pytest_asyncio.fixture
async def prop(client, admin):
    return await _property(client, admin)


async def _room(client, admin, pid, number="101"):
    res = await client.post("/api/v1/rooms", headers=_auth(admin), json={
        "property_uid": pid, "room_number": number, "type": "Private Room"})
    assert res.status_code == 201, res.text
    return res.json()


async def test_maintenance_ticket_lifecycle(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    room = await _room(client, admin, pid)

    # create ticket → MT-YYYY-NNNNN + room → maintenance, atomically
    res = await client.post("/api/v1/maintenance", headers=h, json={
        "property_uid": pid, "room_uid": room["room_uid"],
        "maintenance_type": "plumbing", "issue": "Bathroom tap leaking",
        "priority": "high", "description": "Continuous basin tap leak."})
    assert res.status_code == 201, res.text
    t = res.json()
    assert t["ticket_number"].startswith("MT-")
    assert t["status"] == "open"
    assert t["room_number"] == "101"
    assert t["events"][0]["action"] == "created"

    # room status changed
    res = await client.get("/api/v1/rooms", headers=h)
    assert res.json()["items"][0]["status"] == "maintenance"

    # assign → start → resolve → close
    emp = (await client.post("/api/v1/employees", headers=h, json={
        "property_uid": pid, "name": "Fixer", "email": "fix@corp.test",
        "password": "Staff@1234", "job_title": "Plumber"})).json()
    res = await client.post(f"/api/v1/maintenance/{t['ticket_uid']}/assign",
                            headers=h, json={"employee_uid": emp["employee_uid"]})
    assert res.json()["status"] == "assigned"
    assert res.json()["assigned_to_name"] == "Fixer"

    res = await client.post(f"/api/v1/maintenance/{t['ticket_uid']}/start", headers=h)
    assert res.json()["status"] == "in_progress"

    res = await client.post(f"/api/v1/maintenance/{t['ticket_uid']}/resolve",
                            headers=h, json={
                                "resolution_notes": "Tap replaced and tested.",
                                "photo_urls": ["http://x/after.jpg"]})
    assert res.json()["status"] == "resolved"
    assert res.json()["resolved_at"]

    res = await client.post(f"/api/v1/maintenance/{t['ticket_uid']}/close", headers=h)
    assert res.json()["status"] == "closed"
    assert res.json()["closed_at"]

    # room is no longer maintenance (goes to cleaning post-work)
    res = await client.get("/api/v1/rooms", headers=h)
    assert res.json()["items"][0]["status"] == "cleaning"

    # timeline captured every step
    res = await client.get(f"/api/v1/maintenance/{t['ticket_uid']}", headers=h)
    actions = [e["action"] for e in res.json()["events"]]
    for a in ("created", "assigned", "started", "resolved", "closed"):
        assert a in actions


async def test_maintenance_room_history_and_list(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    room = await _room(client, admin, pid, "202")

    for issue in ("Tap leak", "AC not cooling"):
        await client.post("/api/v1/maintenance", headers=h, json={
            "property_uid": pid, "room_uid": room["room_uid"],
            "maintenance_type": "hvac", "issue": issue, "priority": "medium"})

    res = await client.get(f"/api/v1/rooms/{room['room_uid']}/maintenance", headers=h)
    assert res.json()["total"] == 2
    nums = [t["ticket_number"] for t in res.json()["items"]]
    assert len(set(nums)) == 2  # unique sequential numbers

    res = await client.get("/api/v1/maintenance", headers=h,
                           params={"property_uid": pid, "status": "open"})
    assert res.json()["total"] == 2


async def test_maintenance_scoping(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    room = await _room(client, admin, pid, "303")
    t = (await client.post("/api/v1/maintenance", headers=h, json={
        "property_uid": pid, "room_uid": room["room_uid"],
        "maintenance_type": "electrical", "issue": "Fan dead",
        "priority": "low"})).json()

    # other company sees nothing and cannot touch the ticket
    other = await _signup(client, "o2@other.test", "Other Co")
    h2 = _auth(other)
    res = await client.get("/api/v1/maintenance", headers=h2)
    assert res.json()["total"] == 0
    res = await client.get(f"/api/v1/maintenance/{t['ticket_uid']}", headers=h2)
    assert res.status_code == 404
    res = await client.post(f"/api/v1/maintenance/{t['ticket_uid']}/start", headers=h2)
    assert res.status_code == 404


async def test_task_ticket_number_and_review_workflow(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    emp = (await client.post("/api/v1/employees", headers=h, json={
        "property_uid": pid, "name": "Worker", "email": "w2@corp.test",
        "password": "Staff@1234", "job_title": "Cleaner"})).json()
    sup = (await client.post("/api/v1/employees", headers=h, json={
        "property_uid": pid, "name": "Boss", "email": "boss@corp.test",
        "password": "Staff@1234", "job_title": "Supervisor"})).json()

    task = (await client.post("/api/v1/tasks", headers=h, json={
        "property_uid": pid, "title": "Deep Clean 204", "task_type": "fixed",
        "employee_uid": emp["employee_uid"], "supervisor_uid": sup["employee_uid"],
        "priority": "high"})).json()
    assert task["ticket_number"].startswith("TASK-")
    assert task["status"] == "assigned"
    assert task["supervisor_name"] == "Boss"

    # employee login → start → submit
    tok = (await client.post("/api/v1/auth/login", json={
        "identifier": "w2@corp.test", "password": "Staff@1234"})).json()["access_token"]
    eh = _auth(tok)
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/start", headers=eh)
    assert res.json()["status"] == "in_progress"
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/submit", headers=eh,
                            json={"note": "Done, bathroom sanitized.",
                                  "photo_urls": ["http://x/p.jpg"]})
    assert res.json()["status"] == "submitted"

    # employee cannot approve own submission
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/approve", headers=eh,
                            json={})
    assert res.status_code == 403

    # supervisor rejects → reopened → resubmit → approve → completed
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/reject", headers=h,
                            json={"reason": "Mirror still streaky."})
    assert res.json()["status"] == "reopened"
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/submit", headers=eh,
                            json={"note": "Fixed.",
                                  "photo_urls": ["http://x/p2.jpg"]})
    assert res.json()["status"] == "submitted"
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/approve", headers=h,
                            json={"note": "Looks good."})
    assert res.json()["task"]["status"] == "completed"
    assert res.json()["task"]["completed_at"]

    types = [e["type"] for e in res.json()["task"]["history"]]
    for t_ in ("allocated", "started", "submitted", "rejected", "approved"):
        assert t_ in types
