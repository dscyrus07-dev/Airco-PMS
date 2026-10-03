"""Daily rollover + task calendar/analysis — service-level coverage.

IST is the operational timezone: the boundary tests pin `now` to UTC
instants that map to just-before/just-after 06:00 IST.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models.task import Task, TaskHistoryEvent
from app.services.day_analysis import DayAnalysisService
from app.services.rollover import (
    RolloverService,
    current_operational_day,
    operational_day_key,
    parse_day_start,
)

UTC = timezone.utc


def ist(y, m, d, hh, mm):
    """UTC instant equal to the given IST wall-clock time."""
    return datetime(y, m, d, hh, mm, tzinfo=timezone(timedelta(hours=5, minutes=30))) \
        .astimezone(UTC)


def make_task(prop, **kw) -> Task:
    t = Task(
        id=uuid.uuid4(),
        property_id=prop.id,
        title=kw.pop("title", "Clean room"),
        status=kw.pop("status", "assigned"),
        **kw,
    )
    return t


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def test_parse_day_start():
    assert parse_day_start("06:30").hour == 6
    assert parse_day_start("00:00").hour == 0
    assert parse_day_start(None).hour == 6
    assert parse_day_start("garbage").hour == 6
    assert parse_day_start("25:00").hour == 6  # invalid range → default


def test_operational_day_key_boundary():
    from datetime import time
    start = time(6, 0)
    assert operational_day_key(datetime(2026, 10, 3, 5, 59), start) == "2026-10-02"
    assert operational_day_key(datetime(2026, 10, 3, 6, 0), start) == "2026-10-03"
    assert operational_day_key(datetime(2026, 10, 3, 23, 59), start) == "2026-10-03"
    # custom start — the boundary moves with it
    assert operational_day_key(
        datetime(2026, 10, 3, 21, 59), time(22, 0)) == "2026-10-02"
    assert operational_day_key(
        datetime(2026, 10, 3, 22, 0), time(22, 0)) == "2026-10-03"


# ---------------------------------------------------------------------------
# Rollover
# ---------------------------------------------------------------------------

async def test_unfinished_task_abandoned(session, seed):
    prop = seed["prop"]
    t = make_task(prop, due_date="2026-10-02", room_id=seed["room"].id,
                  room_number="101")
    session.add(t)
    await session.commit()

    stats = await RolloverService(session).run(now=ist(2026, 10, 3, 6, 30))
    assert stats["abandoned"] == 1

    await session.refresh(t)
    assert t.status == "abandoned"
    assert t.abandoned_reason == "SYSTEM_DAILY_ROLLOVER"
    assert t.abandoned_from_status == "assigned"
    assert t.operational_date == "2026-10-02"
    assert t.abandoned_at is not None

    events = (await session.execute(
        select(TaskHistoryEvent).where(
            TaskHistoryEvent.task_id == t.id,
            TaskHistoryEvent.type == "abandoned",
        )
    )).scalars().all()
    assert len(events) == 1
    assert "assigned" in (events[0].note or "")


async def test_completed_and_cancelled_untouched(session, seed):
    prop = seed["prop"]
    done = make_task(prop, status="completed", due_date="2026-10-02",
                     completed_at=ist(2026, 10, 2, 12, 0))
    cancelled = make_task(prop, status="cancelled", due_date="2026-10-02")
    session.add_all([done, cancelled])
    await session.commit()

    stats = await RolloverService(session).run(now=ist(2026, 10, 3, 6, 30))
    assert stats["abandoned"] == 0
    await session.refresh(done)
    await session.refresh(cancelled)
    assert done.status == "completed"
    assert cancelled.status == "cancelled"


@pytest.mark.parametrize("status", [
    "pending", "assigned", "in_progress", "submitted", "reopened", "overdue",
])
async def test_every_open_status_abandoned(session, seed, status):
    prop = seed["prop"]
    t = make_task(prop, status=status, due_date="2026-10-01")
    session.add(t)
    await session.commit()
    stats = await RolloverService(session).run(now=ist(2026, 10, 3, 7, 0))
    assert stats["abandoned"] == 1
    await session.refresh(t)
    assert t.status == "abandoned"
    assert t.abandoned_from_status == status


async def test_rollover_idempotent(session, seed):
    prop = seed["prop"]
    t = make_task(prop, due_date="2026-10-02")
    session.add(t)
    await session.commit()

    svc = RolloverService(session)
    assert (await svc.run(now=ist(2026, 10, 3, 6, 30)))["abandoned"] == 1
    second = await svc.run(now=ist(2026, 10, 3, 6, 31))
    assert second["abandoned"] == 0

    count = (await session.execute(
        select(func.count()).select_from(TaskHistoryEvent).where(
            TaskHistoryEvent.task_id == t.id,
            TaskHistoryEvent.type == "abandoned",
        )
    )).scalar()
    assert count == 1  # no duplicate history


async def test_current_and_future_opday_untouched(session, seed):
    prop = seed["prop"]
    today = make_task(prop, due_date="2026-10-03")
    future = make_task(prop, due_date="2026-10-05")
    session.add_all([today, future])
    await session.commit()

    stats = await RolloverService(session).run(now=ist(2026, 10, 3, 6, 30))
    assert stats["abandoned"] == 0


async def test_rollover_boundary_timing(session, seed):
    """05:59 IST keeps the day open; 06:00 IST closes it."""
    prop = seed["prop"]
    t = make_task(prop, due_date="2026-10-02")
    session.add(t)
    await session.commit()

    assert (await RolloverService(session).run(
        now=ist(2026, 10, 3, 5, 59)))["abandoned"] == 0
    assert (await RolloverService(session).run(
        now=ist(2026, 10, 3, 6, 0)))["abandoned"] == 1


async def test_custom_day_start(session, seed):
    """Updated company setting is honored by the rollover."""
    prop = seed["prop"]
    company = seed["company"]
    company.operational_day_start = "00:00"
    t = make_task(prop, due_date="2026-10-02")
    session.add(t)
    await session.commit()

    # 05:00 IST: with the 06:00 default this day would still be open —
    # with a midnight boundary the previous op-day already ended.
    stats = await RolloverService(session).run(now=ist(2026, 10, 3, 5, 0))
    assert stats["abandoned"] == 1
    await session.refresh(t)
    assert t.status == "abandoned"


async def test_iso_due_timestamp_uses_opday(session, seed):
    """due_date 'YYYY-MM-DDT02:00' belongs to the PREVIOUS op day when the
    start is 06:00 — a 2am task is yesterday's work."""
    prop = seed["prop"]
    t = make_task(prop, due_date="2026-10-03T02:00")
    session.add(t)
    await session.commit()
    # At Oct-3 06:30 IST, current op-day is Oct-3; the 2am-Oct-3 task
    # anchors to op-day Oct-2 → abandoned.
    stats = await RolloverService(session).run(now=ist(2026, 10, 3, 6, 30))
    assert stats["abandoned"] == 1
    await session.refresh(t)
    assert t.operational_date == "2026-10-02"


# ---------------------------------------------------------------------------
# Calendar + daily analysis
# ---------------------------------------------------------------------------

async def _mk_day_tasks(session, seed):
    """A mixed day: 2 completed, 1 abandoned, 1 active."""
    prop = seed["prop"]
    room = seed["room"]
    emp = seed["employee"]
    tasks = [
        make_task(prop, title="Clean 101", status="completed",
                  due_date="2026-10-02", room_id=room.id, room_number="101",
                  employee_id=emp.id, assigned_to_name="Worker One",
                  work_type="cleaning",
                  completed_at=ist(2026, 10, 2, 9, 0)),
        make_task(prop, title="Fix tap", status="abandoned",
                  due_date="2026-10-02", work_type="maintenance",
                  employee_id=emp.id, assigned_to_name="Worker One",
                  abandoned_at=ist(2026, 10, 3, 6, 0),
                  abandoned_reason="SYSTEM_DAILY_ROLLOVER",
                  abandoned_from_status="assigned",
                  operational_date="2026-10-02"),
        make_task(prop, title="Inspect", status="in_progress",
                  due_date="2026-10-02", work_type="inspection"),
        make_task(prop, title="Restock", status="completed",
                  due_date="2026-10-03", work_type=None),  # other day
    ]
    session.add_all(tasks)
    await session.commit()
    return tasks


async def test_calendar_marks_activity(session, seed):
    prop = seed["prop"]
    await _mk_day_tasks(session, seed)
    admin = seed["admin"]

    svc = DayAnalysisService(session)
    cal = await svc.calendar(admin, prop.id, "2026-10")
    days = {d["date"]: d for d in cal["days"]}
    assert days["2026-10-02"]["generated"] == 3
    assert days["2026-10-02"]["completed"] == 1
    assert days["2026-10-02"]["abandoned"] == 1
    assert days["2026-10-02"]["active"] == 1
    assert days["2026-10-03"]["generated"] == 1
    assert "2026-10-05" not in days  # no activity → no entry
    assert cal["operational_day_start"] == "06:00"


async def test_calendar_empty_month(session, seed):
    cal = await DayAnalysisService(session).calendar(
        seed["admin"], seed["prop"].id, "2026-11")
    assert cal["days"] == []


async def test_day_analysis_totals_and_breakdown(session, seed):
    prop = seed["prop"]
    tasks = await _mk_day_tasks(session, seed)

    res = await DayAnalysisService(session).day(
        seed["admin"], prop.id, "2026-10-02")
    s = res["summary"]
    assert s["generated"] == 3
    assert s["allocated"] == 2       # the two employee-assigned tasks
    assert s["completed"] == 1
    assert s["abandoned"] == 1
    assert s["active"] == 1
    assert s["employees_involved"] == 1
    assert s["resources_processed"] == 1  # room 101
    assert s["completion_rate"] == 50.0   # 1 completed / 2 allocated

    # employee aggregation
    assert len(res["employees"]) == 1
    e = res["employees"][0]
    assert e["employee"] == "Worker One"
    assert e["allocated"] == 2 and e["completed"] == 1 and e["abandoned"] == 1
    assert e["completion_rate"] == 50.0

    # category aggregation — cleaning / maintenance / checklist / other
    cats = {c["category"]: c for c in res["categories"]}
    assert cats["Housekeeping"]["generated"] == 1
    assert cats["Maintenance"]["generated"] == 1
    assert cats["Checklist"]["generated"] == 1

    # per-task detail rows
    by_title = {t["title"]: t for t in res["tasks"]}
    assert by_title["Clean 101"]["resource"] == "Room 101"
    assert by_title["Fix tap"]["auto_abandoned"] is True
    assert by_title["Fix tap"]["abandoned_from_status"] == "assigned"
    assert by_title["Fix tap"]["actual_worker"] == "Worker One"


async def test_day_analysis_other_day(session, seed):
    await _mk_day_tasks(session, seed)
    res = await DayAnalysisService(session).day(
        seed["admin"], seed["prop"].id, "2026-10-04")
    assert res["summary"]["generated"] == 0
    assert res["tasks"] == []


async def test_day_analysis_respects_custom_start(session, seed):
    """With a midnight boundary the 2am task lands on its own calendar day."""
    prop = seed["prop"]
    seed["company"].operational_day_start = "00:00"
    t = make_task(prop, due_date="2026-10-03T02:00", status="completed")
    session.add(t)
    await session.commit()

    res = await DayAnalysisService(session).day(
        seed["admin"], prop.id, "2026-10-03")
    assert res["summary"]["generated"] == 1
    res2 = await DayAnalysisService(session).day(
        seed["admin"], prop.id, "2026-10-02")
    assert res2["summary"]["generated"] == 0


async def test_settings_persisted_on_company(session, seed):
    from app.schemas.auth import company_to_out
    company = seed["company"]
    assert company.operational_day_start == "06:00"
    company.operational_day_start = "05:30"
    await session.commit()
    await session.refresh(company)
    assert company.operational_day_start == "05:30"
    out = company_to_out(company)
    assert out.operational_day_start == "05:30"


async def test_rollover_uses_updated_setting(session, seed):
    """Same instant, different setting → different outcome."""
    prop = seed["prop"]
    t = make_task(prop, due_date="2026-10-03", status="assigned")
    session.add(t)
    seed["company"].operational_day_start = "00:00"
    await session.commit()
    # 05:30 IST Oct-4: midnight boundary → Oct-3 op-day ended → abandon
    stats = await RolloverService(session).run(now=ist(2026, 10, 4, 5, 30))
    assert stats["abandoned"] == 1
