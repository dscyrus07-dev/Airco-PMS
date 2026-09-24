"""
Structure & allocation tests — areas/zones/rooms/dorms/beds/employees.

Runs against isolated in-memory SQLite — never touches Supabase.
"""

import pytest_asyncio
from httpx import AsyncClient


async def _signup(client: AsyncClient, email="admin@corp.test", company="Acme Stays"):
    res = await client.post(
        "/api/v1/auth/signup",
        json={
            "company_name": company,
            "brand_name": company,
            "address": "1 Main St",
            "pin_code": "400001",
            "email": email,
            "phone_number": "+919800000001",
            "password": "Secret@123",
            "confirm_password": "Secret@123",
        },
    )
    assert res.status_code == 201, res.text
    return res.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _property(client: AsyncClient, token: str, name="Zostel One", mgr_email="pm1@corp.test"):
    res = await client.post(
        "/api/v1/properties",
        headers=_auth(token),
        json={
            "name": name,
            "location": "Andheri",
            "city": "Mumbai",
            "state": "Maharashtra",
            "manager": {
                "name": "PM One",
                "email": mgr_email,
                "password": "Manager@123",
            },
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


@pytest_asyncio.fixture
async def admin(client):
    return await _signup(client)


@pytest_asyncio.fixture
async def prop(client, admin):
    return await _property(client, admin)


async def test_create_area_zone_room_dorm(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]

    area = (
        await client.post(
            "/api/v1/areas", headers=h,
            json={"property_uid": pid, "name": "Main Building", "level_number": 0},
        )
    ).json()
    assert area["area_uid"] and area["name"] == "Main Building"

    zone = (
        await client.post(
            "/api/v1/zones", headers=h,
            json={"property_uid": pid, "name": "Ground Floor",
                  "area_uid": area["area_uid"], "zone_type": "stay"},
        )
    ).json()
    assert zone["zone_uid"]

    room = (
        await client.post(
            "/api/v1/rooms", headers=h,
            json={"property_uid": pid, "room_number": "201",
                  "type": "Private Room", "zone_uid": zone["zone_uid"]},
        )
    ).json()
    assert room["room_number"] == "201"
    assert room["zone_uid"] == zone["zone_uid"]

    dorm = (
        await client.post(
            "/api/v1/dorms", headers=h,
            json={"property_uid": pid, "name": "Male Dorm", "dorm_type": "Male Dorm",
                  "washroom": "Attached", "bed_count": 4,
                  "zone_uid": zone["zone_uid"]},
        )
    ).json()
    assert len(dorm["beds"]) == 4  # beds auto-generated
    assert {b["bed_number"] for b in dorm["beds"]} == {
        "Bed 01", "Bed 02", "Bed 03", "Bed 04"}


async def test_bulk_room_create_and_duplicates(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    res = await client.post(
        "/api/v1/rooms/bulk", headers=h,
        json={"property_uid": pid, "start": 201, "end": 205, "type": "Private Room"},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert [r["room_number"] for r in body["created"]] == ["201", "202", "203", "204", "205"]
    assert body["errors"] == []

    # duplicate room number rejected
    res = await client.post(
        "/api/v1/rooms", headers=h,
        json={"property_uid": pid, "room_number": "201", "type": "Private Room"},
    )
    assert res.status_code == 409
    assert res.json()["detail"]["field"] == "room_number"

    # bulk with a partial duplicate reports the collision, creates the rest
    res = await client.post(
        "/api/v1/rooms/bulk", headers=h,
        json={"property_uid": pid, "start": 205, "end": 207, "type": "Private Room"},
    )
    body = res.json()
    assert "Room 205 already exists" in body["errors"]
    assert [r["room_number"] for r in body["created"]] == ["206", "207"]


async def test_room_allocation_and_zone_validation(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    stay = (await client.post("/api/v1/zones", headers=h, json={
        "property_uid": pid, "name": "Wing A", "zone_type": "stay"})).json()
    ops = (await client.post("/api/v1/zones", headers=h, json={
        "property_uid": pid, "name": "Kitchen", "zone_type": "common"})).json()
    room = (await client.post("/api/v1/rooms", headers=h, json={
        "property_uid": pid, "room_number": "301", "type": "Double"})).json()

    # non-stay zones reject units
    res = await client.patch(
        f"/api/v1/rooms/{room['room_uid']}/allocation", headers=h,
        json={"zone_uid": ops["zone_uid"]})
    assert res.status_code == 422

    # assign to stay zone
    res = await client.patch(
        f"/api/v1/rooms/{room['room_uid']}/allocation", headers=h,
        json={"zone_uid": stay["zone_uid"]})
    assert res.status_code == 200
    assert res.json()["zone_uid"] == stay["zone_uid"]

    # unassign
    res = await client.patch(
        f"/api/v1/rooms/{room['room_uid']}/allocation", headers=h,
        json={"zone_uid": None})
    assert res.json()["zone_uid"] is None


async def test_dorm_bed_resize_safe(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    dorm = (await client.post("/api/v1/dorms", headers=h, json={
        "property_uid": pid, "name": "Female Dorm", "dorm_type": "Female Dorm",
        "washroom": "Attached", "bed_count": 4})).json()
    assert len(dorm["beds"]) == 4

    # occupy the LAST bed � tail-removal must mark it inactive
    bed = dorm["beds"][-1]
    res = await client.patch(f"/api/v1/beds/{bed['bed_uid']}/status", headers=h,
                             json={"status": "occupied", "guest_name": "Priya"})
    assert res.status_code == 200

    # grow 4 → 6
    res = await client.patch(f"/api/v1/dorms/{dorm['dorm_uid']}", headers=h,
                             json={"bed_count": 6})
    assert len(res.json()["beds"]) == 6

    # shrink 6 → 2 — occupied bed becomes inactive, not destroyed
    res = await client.patch(f"/api/v1/dorms/{dorm['dorm_uid']}", headers=h,
                             json={"bed_count": 2})
    beds = res.json()["beds"]
    assert any(b["status"] == "inactive" for b in beds)


async def test_employee_zone_allocation_and_history(client, admin, prop, db_session):
    h = _auth(admin)
    pid = prop["property_uid"]
    zone = (await client.post("/api/v1/zones", headers=h, json={
        "property_uid": pid, "name": "Floor 1", "zone_type": "stay"})).json()
    emp = (await client.post("/api/v1/employees", headers=h, json={
        "property_uid": pid, "name": "Rahul", "email": "rahul@corp.test",
        "password": "Staff@1234", "job_title": "Housekeeper"})).json()
    assert emp["username"]  # auto-generated

    # employee can log in
    res = await client.post("/api/v1/auth/login", json={
        "identifier": emp["email"], "password": "Staff@1234"})
    assert res.status_code == 200
    assert res.json()["user"]["role"] == "employee"

    # assign to zone — records history
    res = await client.patch(f"/api/v1/employees/{emp['employee_uid']}/zone",
                             headers=h, json={"zone_uid": zone["zone_uid"]})
    assert res.status_code == 200
    assert res.json()["zone_uid"] == zone["zone_uid"]

    from sqlalchemy import select
    from app.models.allocation import AllocationEvent

    events = (await db_session.execute(
        select(AllocationEvent).where(AllocationEvent.entity_type == "employee")
    )).scalars().all()
    assert len(events) == 1
    assert str(events[0].to_zone_id) == zone["zone_uid"]

    # move to unassigned — releases the zone
    res = await client.patch(f"/api/v1/employees/{emp['employee_uid']}/zone",
                             headers=h, json={"zone_uid": None})
    assert res.json()["zone_uid"] is None


async def test_delete_safety(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    area = (await client.post("/api/v1/areas", headers=h, json={
        "property_uid": pid, "name": "Block A"})).json()
    zone = (await client.post("/api/v1/zones", headers=h, json={
        "property_uid": pid, "name": "Z1", "area_uid": area["area_uid"],
        "zone_type": "stay"})).json()
    room = (await client.post("/api/v1/rooms", headers=h, json={
        "property_uid": pid, "room_number": "401", "type": "Private Room",
        "zone_uid": zone["zone_uid"]})).json()

    # area with zones → 409
    res = await client.delete(f"/api/v1/areas/{area['area_uid']}", headers=h)
    assert res.status_code == 409

    # zone with rooms → 409
    res = await client.delete(f"/api/v1/zones/{zone['zone_uid']}", headers=h)
    assert res.status_code == 409

    # occupied room → 409
    await client.patch(f"/api/v1/rooms/{room['room_uid']}", headers=h,
                       json={"status": "occupied", "current_guest": "Sam"})
    res = await client.delete(f"/api/v1/rooms/{room['room_uid']}", headers=h)
    assert res.status_code == 409


async def test_cross_company_isolation(client, admin, prop):
    # A second company must not see or modify the first company's data
    other = await _signup(client, "boss@other.test", "Other Corp")
    h2 = _auth(other)

    res = await client.get("/api/v1/properties", headers=h2)
    assert res.json()["total"] == 0

    res = await client.get("/api/v1/rooms", headers=h2)
    assert res.json()["total"] == 0

    # write attempts against company A's property → 404 (not found in scope)
    res = await client.post("/api/v1/areas", headers=h2, json={
        "property_uid": prop["property_uid"], "name": "Hack"})
    assert res.status_code == 404

    res = await client.post("/api/v1/rooms", headers=h2, json={
        "property_uid": prop["property_uid"], "room_number": "X1", "type": "Other"})
    assert res.status_code == 404


async def test_employee_cannot_modify_structure(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    emp = (await client.post("/api/v1/employees", headers=h, json={
        "property_uid": pid, "name": "Staff", "email": "staff@corp.test",
        "password": "Staff@1234", "job_title": "Cleaner"})).json()
    tok = (await client.post("/api/v1/auth/login", json={
        "identifier": "staff@corp.test", "password": "Staff@1234"})).json()["access_token"]

    res = await client.post("/api/v1/areas", headers=_auth(tok), json={
        "property_uid": pid, "name": "Nope"})
    assert res.status_code == 403
    res = await client.post("/api/v1/rooms", headers=_auth(tok), json={
        "property_uid": pid, "room_number": "1", "type": "Other"})
    assert res.status_code == 403


async def test_property_manager_scoping(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    pm_tok = (await client.post("/api/v1/auth/login", json={
        "identifier": "pm1@corp.test", "password": "Manager@123"})).json()["access_token"]

    # PM can create structure in their own property
    res = await client.post("/api/v1/areas", headers=_auth(pm_tok), json={
        "property_uid": pid, "name": "PM Area"})
    assert res.status_code == 201

    # PM cannot create a new property (super_admin only)
    res = await client.post("/api/v1/properties", headers=_auth(pm_tok), json={
        "name": "Nope", "location": "X", "city": "Y", "state": "Z",
        "manager": {"name": "M", "email": "m@x.test", "password": "Manager@123"}})
    assert res.status_code == 403


async def test_task_lifecycle(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    emp = (await client.post("/api/v1/employees", headers=h, json={
        "property_uid": pid, "name": "Worker", "email": "w@corp.test",
        "password": "Staff@1234", "job_title": "Cleaner"})).json()
    task = (await client.post("/api/v1/tasks", headers=h, json={
        "property_uid": pid, "title": "Clean 201", "task_type": "fixed",
        "employee_uid": emp["employee_uid"], "priority": "high"})).json()
    assert task["status"] == "assigned"  # assignee present → starts assigned
    assert task["assigned_to_name"] == "Worker"
    assert task["ticket_number"].startswith("TASK-")

    # start → in_progress
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/start", headers=h)
    assert res.json()["status"] == "in_progress"

    # complete requires photos
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/complete", headers=h,
                            json={"photo_urls": []})
    assert res.status_code == 422
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/complete", headers=h,
                            json={"photo_urls": ["http://x/1.jpg"], "note": "done"})
    assert res.status_code == 200
    assert res.json()["task"]["status"] == "completed"

    # history captured
    types = [e["type"] for e in res.json()["task"]["history"]]
    assert "allocated" in types and "started" in types and "completed" in types


async def test_repetitive_task_regenerates(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    task = (await client.post("/api/v1/tasks", headers=h, json={
        "property_uid": pid, "title": "Daily sweep", "task_type": "repetitive",
        "recurrence": "daily", "due_date": "2026-09-25"})).json()
    res = await client.post(f"/api/v1/tasks/{task['task_uid']}/complete", headers=h,
                            json={"photo_urls": ["http://x/p.jpg"]})
    gen = res.json().get("generated_task")
    assert gen is not None
    assert gen["due_date"] == "2026-09-26"
    assert gen["status"] == "pending"


async def test_company_get_and_patch(client, admin):
    h = _auth(admin)
    me = (await client.get("/api/v1/auth/me", headers=h)).json()
    cid = me["company"]["company_uid"]

    res = await client.get(f"/api/v1/companies/{cid}", headers=h)
    assert res.status_code == 200
    assert res.json()["name"] == "Acme Stays"

    res = await client.patch(f"/api/v1/companies/{cid}", headers=h,
                             json={"brand_name": "Acme Brand", "pin_code": "400099"})
    assert res.json()["brand_name"] == "Acme Brand"
    assert res.json()["pin_code"] == "400099"
