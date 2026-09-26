"""Repro: employee deactivate/delete returning 409."""

import pytest_asyncio
from httpx import AsyncClient

from tests.test_structure import _auth, _property, _signup
from tests.test_allocation import _zone, _employee_in_zone, _room_in_zone, _ticket


@pytest_asyncio.fixture
async def admin(client):
    return await _signup(client)


@pytest_asyncio.fixture
async def prop(client, admin):
    return await _property(client, admin)


async def test_deactivate_and_delete_employee(client, admin, prop):
    h = _auth(admin)
    pid = prop["property_uid"]
    z = await _zone(client, h, pid)
    emp = await _employee_in_zone(client, h, pid, z["zone_uid"], "Baljyot", "bal@t.co")
    eid = emp["employee_uid"]
    room = await _room_in_zone(client, h, pid, z["zone_uid"], "101")
    await _ticket(client, h, pid, room["room_uid"])  # auto-assigns to emp

    # deactivate
    res = await client.post(f"/api/v1/employees/{eid}/deactivate", headers=h)
    print("DEACTIVATE:", res.status_code, res.text[:300])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "Inactive"
    assert body["zone_uid"] is None  # dialog promises unassignment

    # permanent delete
    res = await client.delete(f"/api/v1/employees/{eid}", headers=h)
    print("DELETE:", res.status_code, res.text[:300])
    assert res.status_code == 204, res.text

    # the deleted employee's email must be free — re-create must NOT 409
    res = await client.post("/api/v1/employees", headers=h, json={
        "property_uid": pid, "name": "Baljyot", "email": "bal@t.co",
        "password": "Staff@1234", "job_title": "Housekeeping"})
    print("RE-CREATE:", res.status_code, res.text[:200])
    assert res.status_code == 201, res.text
