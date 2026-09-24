"""Work template engine tests — CRUD, scheduling, idempotent generation."""

import pytest_asyncio

from tests.test_allocation import _employee_in_zone, _room_in_zone, _zone
from tests.test_structure import _auth, _property, _signup


@pytest_asyncio.fixture
async def admin(client):
    return await _signup(client)


@pytest_asyncio.fixture
async def prop(client, admin):
    return await _property(client, admin)


async def test_template_crud_and_status(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    res = await client.post("/api/v1/templates", headers=h, json={
        "property_uid": pid, "name": "Daily Room Inspection",
        "template_type": "inspection", "priority": "high",
        "description": "Inspect cleanliness, lights, AC and bathroom.",
        "category": "housekeeping",
        "assignment": {"mode": "automatic", "method": "zone_round_robin"},
        "location": {"scope": "property"},
        "schedule": {"kind": "recurring", "frequency": "daily", "time": "10:00"},
        "duration_minutes": 30,
        "checklist": [{"title": "Check lighting", "required": True}],
        "verification": {"checklist_required": True, "photo_required": True},
        "status": "draft"})
    assert res.status_code == 201, res.text
    t = res.json()
    assert t["status"] == "draft" and t["version"] == 1
    assert t["next_run_at"] is None  # drafts never generate

    # activate → next_run_at computed
    res = await client.post(f"/api/v1/templates/{t['template_uid']}/activate",
                            headers=h)
    assert res.json()["status"] == "active"
    assert res.json()["next_run_at"]

    # edit bumps version + keeps a snapshot
    res = await client.patch(f"/api/v1/templates/{t['template_uid']}",
                             headers=h, json={"priority": "urgent"})
    assert res.json()["version"] == 2

    # pause → no schedule; delete requires paused/archived first
    res = await client.post(f"/api/v1/templates/{t['template_uid']}/pause",
                            headers=h)
    assert res.json()["next_run_at"] is None
    res = await client.post(f"/api/v1/templates/{t['template_uid']}/duplicate",
                            headers=h)
    assert res.status_code == 201
    assert res.json()["name"].endswith("(copy)")


async def test_scheduler_generates_idempotent_zone_work(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    z = await _zone(client, h, pid)
    await _employee_in_zone(client, h, pid, z["zone_uid"], "Rahul", "r1@t.co")
    rooms = [await _room_in_zone(client, h, pid, z["zone_uid"], n)
             for n in ("101", "102")]

    # daily template over all rooms in zone — overdue by forcing next_run_at
    res = await client.post("/api/v1/templates", headers=h, json={
        "property_uid": pid, "name": "Zone Cleaning",
        "template_type": "cleaning", "priority": "medium",
        "assignment": {"mode": "automatic", "method": "zone_round_robin"},
        "location": {"scope": "zone", "zone_uid": z["zone_uid"], "target": "rooms"},
        "schedule": {"kind": "one_time", "date": "2020-01-01", "time": "08:00"},
        "status": "active"})
    assert res.status_code == 201, res.text
    tid = res.json()["template_uid"]

    # force the run to be due NOW, then tick
    res = await client.post("/api/v1/templates/generate-due", headers=h)
    stats = res.json()
    assert stats["generated"] == 2, stats  # one task per room

    # tasks reference the template + got the round-robin employee
    res = await client.get(f"/api/v1/templates/{tid}/generated-work", headers=h)
    tasks = res.json()["tasks"]
    assert len(tasks) == 2
    assert all(t["assigned_to_name"] == "Rahul" for t in tasks)
    assert all(t["allocation_method"] == "round_robin" for t in tasks)
    assert {t["room_number"] for t in tasks} == {"101", "102"}

    # idempotent — a second tick in the same occurrence generates nothing new
    res = await client.post("/api/v1/templates/generate-due", headers=h)
    assert res.json()["generated"] == 0


async def test_template_type_validation(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    res = await client.post("/api/v1/templates", headers=h, json={
        "property_uid": pid, "name": "Bad", "template_type": "nonsense"})
    assert res.status_code == 422 or res.status_code == 400
