"""Repetitive task series — clock-driven generation + completion chain."""

from datetime import datetime, timedelta

from app.services.task import TaskService, next_occurrence, _local_now

from tests.test_allocation import _employee_in_zone, _zone
from tests.test_structure import _auth, _property, _signup


async def _repetitive_task(client, h, pid, **over):
    body = {
        "property_uid": pid,
        "title": "Fill the water bottle",
        "task_type": "repetitive",
        "priority": "medium",
        "due_date": "2020-01-01",  # long past — next slot is already due
        "due_time": "20:00",
        "recurrence": "hourly",
        **over,
    }
    res = await client.post("/api/v1/tasks", headers=h, json=body)
    assert res.status_code == 201, res.text
    return res.json()


async def test_sweep_generates_due_occurrence(client, db_session):
    admin = await _signup(client)
    h = _auth(admin)
    prop = await _property(client, admin)
    pid = prop["property_uid"]
    z = await _zone(client, h, pid)
    emp = await _employee_in_zone(client, h, pid, z["zone_uid"], "Rahul", "r1@t.co")

    task = await _repetitive_task(client, h, pid, employee_uid=emp["employee_uid"])
    assert task["series_id"] == task["task_uid"]

    stats = await TaskService(db_session).run_due_repetitive()
    assert stats["generated"] == 1, stats

    res = await client.get("/api/v1/tasks", headers=h,
                           params={"property_uid": pid})
    tasks = res.json()["items"]
    assert len(tasks) == 2
    clone = next(t for t in tasks if t["task_uid"] != task["task_uid"])
    assert clone["series_id"] == task["task_uid"]
    assert clone["employee_uid"] == emp["employee_uid"]  # assignee carried over
    assert clone["status"] == "assigned"
    assert clone["ticket_number"] and clone["ticket_number"] != task["ticket_number"]
    # occurrence is on the hourly grid anchored at 20:00
    assert "T" in clone["due_date"] and clone["due_date"].endswith(":00")


async def test_sweep_is_idempotent(client, db_session):
    admin = await _signup(client)
    h = _auth(admin)
    prop = await _property(client, admin)
    pid = prop["property_uid"]

    await _repetitive_task(client, h, pid)
    svc = TaskService(db_session)
    assert (await svc.run_due_repetitive())["generated"] == 1
    # second tick — head advanced, next slot is still in the future
    assert (await svc.run_due_repetitive())["generated"] == 0


async def test_sweep_allocates_unassigned_head(client, db_session):
    admin = await _signup(client)
    h = _auth(admin)
    prop = await _property(client, admin)
    pid = prop["property_uid"]
    z = await _zone(client, h, pid)
    emp = await _employee_in_zone(client, h, pid, z["zone_uid"], "Rahul", "r1@t.co")

    # no assignee — the sweep should still land it on someone via round-robin
    head = await _repetitive_task(client, h, pid, zone_uid=z["zone_uid"])
    stats = await TaskService(db_session).run_due_repetitive()
    assert stats["generated"] == 1

    res = await client.get("/api/v1/tasks", headers=h,
                           params={"property_uid": pid, "task_type": "repetitive"})
    clone = next(t for t in res.json()["items"]
                 if t["task_uid"] != head["task_uid"])
    assert clone["employee_uid"] == emp["employee_uid"]
    assert clone["allocation_method"] == "round_robin"


async def test_completion_spawns_future_instance(client, db_session):
    admin = await _signup(client)
    h = _auth(admin)
    prop = await _property(client, admin)
    pid = prop["property_uid"]

    # due yesterday, completed now → next instance must be in the FUTURE
    yesterday = (_local_now() - timedelta(days=1)).date().isoformat()
    task = await _repetitive_task(client, h, pid, due_date=yesterday,
                                  recurrence="daily", start_time="09:00")
    res = await client.post(
        f"/api/v1/tasks/{task['task_uid']}/complete", headers=h,
        json={"photo_urls": ["https://x.test/p.jpg"], "note": "done"})
    assert res.status_code == 200, res.text
    gen = res.json()["generated_task"]
    assert gen is not None
    assert datetime.fromisoformat(gen["due_date"]) > _local_now()


async def test_next_occurrence_respects_due_time():
    """Regression: hourly next slot must step from due_time, not midnight."""
    from app.models.task import Task
    t = Task(due_date="2026-09-23", due_time="20:00", recurrence="hourly")
    occ = next_occurrence(t, datetime(2026, 9, 23, 20, 0))
    assert occ == datetime(2026, 9, 23, 21, 0)


async def test_next_occurrence_window_resumes_next_day():
    from app.models.task import Task
    t = Task(due_date="2026-09-23", due_time="20:00", recurrence="hourly",
             start_time="07:00", recurrence_window_end="22:00")
    # last slot of the day is 22:00 → next resumes tomorrow 07:00
    occ = next_occurrence(t, datetime(2026, 9, 23, 22, 0))
    assert occ == datetime(2026, 9, 24, 7, 0)
