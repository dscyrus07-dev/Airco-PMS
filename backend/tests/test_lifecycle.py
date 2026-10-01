"""Task & maintenance lifecycle — flag-on-start, approval release, task
deletion reconciliation, assignee enforcement, and authorization.
"""
import uuid

import pytest
from sqlalchemy import select

from app.dependencies.auth import Forbidden
from app.models.maintenance import MaintenanceTicket
from app.models.occupancy import Occupancy
from app.models.resource_state_event import ResourceStateEvent
from app.models.structure import Room
from app.models.task import Task, TaskHistoryEvent
from app.schemas.maintenance import MaintenanceCreateRequest
from app.schemas.structure import BulkUnitStatusRequest
from app.services.maintenance import MaintenanceService
from app.services.structure import ConflictErr, StructureService, ValidationErr
from app.services.task import TaskService


def make_task(session, prop, employee, **kw) -> Task:
    t = Task(
        property_id=prop.id,
        employee_id=employee.id,
        title=kw.pop("title", "Cleaning — unit"),
        status=kw.pop("status", "assigned"),
        **kw,
    )
    session.add(t)
    return t


async def test_task_start_flags_room_cleaning(session, seed, stub_tasks):
    room = seed["room"]
    task = make_task(
        session, seed["prop"], seed["employee"],
        room_id=room.id, title="Cleaning — 101",
    )
    await session.commit()

    await TaskService(session).start_task(seed["emp_user"], task.id)
    await session.commit()
    await session.refresh(room)
    assert room.status == "cleaning"
    res = await session.execute(
        select(ResourceStateEvent).where(ResourceStateEvent.resource_id == room.id)
    )
    ev = res.scalar_one()
    assert ev.source == "task_start" and ev.task_id == task.id


async def test_scheduled_task_does_not_flag(session, seed, stub_tasks):
    """Creating/scheduling a cleaning task never flags the resource —
    only START does (flag-on-start)."""
    room = seed["room"]
    make_task(
        session, seed["prop"], seed["employee"],
        room_id=room.id, title="Cleaning — 101", status="pending",
    )
    await session.commit()
    await session.refresh(room)
    assert room.status == "available"


async def test_non_cleaning_task_start_does_not_flag(session, seed, stub_tasks):
    room = seed["room"]
    task = make_task(
        session, seed["prop"], seed["employee"],
        room_id=room.id, title="Inspect the HVAC", status="assigned",
    )
    await session.commit()
    await TaskService(session).start_task(seed["emp_user"], task.id)
    await session.refresh(room)
    assert room.status == "available"


async def test_task_approve_releases_resource(session, seed, stub_tasks):
    room = seed["room"]
    task = make_task(
        session, seed["prop"], seed["employee"],
        room_id=room.id, title="Cleaning — 101", status="submitted",
    )
    room.status = "cleaning"
    await session.commit()

    await TaskService(session).approve_task(seed["admin"], task.id)
    await session.refresh(room)
    assert task.status == "completed"
    assert room.status == "available"  # released via derive


async def test_task_approve_never_touches_occupancy(session, seed, stub_tasks):
    """A submitted cleaning task on an OCCUPIED room: approval must not
    release occupied→available — occupancy is an independent state that
    only the occupancy workflow controls."""
    room = seed["room"]
    occ = Occupancy(
        property_id=seed["prop"].id, room_id=room.id, guest_name="Ada",
    )
    session.add(occ)
    task = make_task(
        session, seed["prop"], seed["employee"],
        room_id=room.id, title="Cleaning — 101", status="submitted",
    )
    room.status = "occupied"
    await session.commit()

    await TaskService(session).approve_task(seed["admin"], task.id)
    await session.refresh(room)
    await session.refresh(occ)
    assert task.status == "completed"
    assert room.status == "occupied"        # occupancy preserved
    assert occ.checked_out_at is None       # no phantom checkout


async def test_occupied_bed_flagged_maintenance_keeps_occupancy_axis(
    session, seed, stub_tasks
):
    """Two-axis model: a maintenance ticket on an occupied bed flips the
    operational status to maintenance, but `is_occupied` still resolves
    true — the visual layer must read occupied+problem (red), not
    unoccupied+maintenance (beige)."""
    from app.schemas.workspace import bed_out, mark_open_occupancy
    from app.services.resource_state import ResourceStateService

    bed = seed["bed"]
    session.add(Occupancy(
        property_id=seed["prop"].id, bed_id=bed.id, guest_name="Sam",
    ))
    await session.commit()

    # ticket flag → operational maintenance, occupancy stays open
    await ResourceStateService(session).transition(
        "bed", bed.id, "maintenance", user=seed["admin"],
        source="ticket_created", reason="leak",
    )
    await mark_open_occupancy(session, beds=[bed])
    out = bed_out(bed)
    assert out["status"] == "maintenance"
    assert out["is_occupied"] is True


async def test_task_reject_keeps_room_blocked(session, seed, stub_tasks):
    room = seed["room"]
    task = make_task(
        session, seed["prop"], seed["employee"],
        room_id=room.id, title="Cleaning — 101", status="submitted",
    )
    room.status = "cleaning"
    await session.commit()

    await TaskService(session).reject_task(
        seed["admin"], task.id, "not clean enough"
    )
    await session.refresh(room)
    assert task.status == "reopened"
    assert room.status == "cleaning"  # still blocked


async def test_pm_cannot_approve_resource_task(session, seed, stub_tasks):
    room = seed["room"]
    task = make_task(
        session, seed["prop"], seed["employee"],
        room_id=room.id, title="Cleaning — 101", status="submitted",
    )
    await session.commit()
    with pytest.raises(Forbidden):
        await TaskService(session).approve_task(seed["pm"], task.id)


async def test_pm_can_approve_untargeted_task(session, seed, stub_tasks):
    """Tasks without a resource target stay staff-approvable — the SA gate
    applies to resource-releasing work only."""
    task = make_task(
        session, seed["prop"], seed["employee"],
        title="Weekly reporting", status="submitted",
    )
    await session.commit()
    await TaskService(session).approve_task(seed["pm"], task.id)
    assert task.status == "completed"


async def test_task_delete_reconciles_resource(session, seed, stub_tasks):
    room = seed["room"]
    task = make_task(
        session, seed["prop"], seed["employee"],
        room_id=room.id, title="Cleaning — 101", status="in_progress",
    )
    room.status = "cleaning"
    await session.commit()

    await TaskService(session).delete_task(seed["pm"], task.id)
    await session.refresh(room)
    # derive releases the now-unblocked room — nothing is stranded
    assert room.status == "available"


async def test_request_redo_rejects_terminal_states(
    session, seed, stub_tasks
):
    task = make_task(
        session, seed["prop"], seed["employee"], title="Job", status="submitted"
    )
    await session.commit()
    with pytest.raises(ConflictErr):
        await TaskService(session).request_redo(seed["pm"], task.id, None)


# ---------------------------------------------------------------------------
# Maintenance
# ---------------------------------------------------------------------------

def maint_req(prop, **kw):
    return MaintenanceCreateRequest(
        property_uid=prop.id,
        maintenance_type="plumbing", issue="Tap leaking", **kw,
    )


async def test_ticket_creation_flags_room(session, seed, stub_tasks):
    room = seed["room"]
    svc = MaintenanceService(session)
    ticket = await svc.create_ticket(
        seed["pm"], maint_req(seed["prop"], room_uid=room.id)
    )
    await session.refresh(room)
    assert room.status == "maintenance"
    res = await session.execute(
        select(ResourceStateEvent).where(
            ResourceStateEvent.resource_id == room.id
        )
    )
    ev = res.scalar_one()
    assert ev.source == "ticket_created" and ev.ticket_id == ticket.id


async def test_ticket_start_requires_assignee(session, seed, stub_tasks):
    room = seed["room"]
    svc = MaintenanceService(session)
    ticket = await svc.create_ticket(
        seed["pm"], maint_req(seed["prop"], room_uid=room.id)
    )
    # ticket unassigned → an employee cannot claim-start arbitrary tickets
    with pytest.raises(Forbidden):
        await svc.start(seed["emp_user"], ticket.id)
    # staff CAN start any ticket in their property
    ticket = await svc.start(seed["pm"], ticket.id)
    assert ticket.status == "in_progress"


async def test_ticket_resolve_wrong_assignee(session, seed, stub_tasks):
    from app.schemas.maintenance import MaintenanceResolveRequest

    room = seed["room"]
    svc = MaintenanceService(session)
    ticket = await svc.create_ticket(
        seed["pm"], maint_req(seed["prop"], room_uid=room.id)
    )
    ticket.assigned_to = seed["employee"].id
    ticket.status = "in_progress"
    await session.commit()
    with pytest.raises(Forbidden):
        await svc.resolve(
            seed["emp_user2"], ticket.id,
            MaintenanceResolveRequest(resolution_notes="fixed it"),
        )
    # assigned employee CAN resolve
    ticket = await svc.resolve(
        seed["emp_user"], ticket.id,
        MaintenanceResolveRequest(resolution_notes="fixed the leak"),
    )
    assert ticket.status == "resolved"


async def test_close_is_super_admin_only(session, seed, stub_tasks):
    from app.schemas.maintenance import MaintenanceResolveRequest

    room = seed["room"]
    svc = MaintenanceService(session)
    ticket = await svc.create_ticket(
        seed["pm"], maint_req(seed["prop"], room_uid=room.id)
    )
    ticket.assigned_to = seed["employee"].id
    ticket.status = "resolved"
    await session.commit()
    with pytest.raises(Forbidden):
        await svc.close(seed["pm"], ticket.id)
    ticket = await svc.close(seed["admin"], ticket.id)
    assert ticket.status == "closed"
    await session.refresh(room)
    assert room.status == "available"  # released via derive


async def test_fixture_ticket_flags_and_releases(session, seed, stub_tasks):
    fixture = seed["fixture"]
    svc = MaintenanceService(session)
    ticket = await svc.create_ticket(
        seed["pm"],
        maint_req(
            seed["prop"],
            washroom_uid=seed["washroom"].id,
            washroom_fixture_uid=fixture.id,
        ),
    )
    await session.refresh(fixture)
    await session.refresh(seed["washroom"])
    assert fixture.status == "maintenance"
    assert seed["washroom"].status == "maintenance"
    ticket.status = "resolved"
    await session.commit()
    ticket = await svc.close(seed["admin"], ticket.id)
    await session.refresh(seed["washroom"])
    assert seed["washroom"].status == "available"


# ---------------------------------------------------------------------------
# Fixture transitions + bulk ops
# ---------------------------------------------------------------------------

async def test_fixture_transition_canonical(session, seed, stub_tasks):
    washroom = seed["washroom"]
    svc = StructureService(session)
    w = await svc.update_fixture(
        seed["admin"], washroom.id, seed["fixture"].id, "maintenance"
    )
    f = next(x for x in w.fixtures if x.id == seed["fixture"].id)
    assert f.status == "maintenance"
    w = await svc.update_fixture(
        seed["admin"], washroom.id, seed["fixture"].id, "operational"
    )
    f = next(x for x in w.fixtures if x.id == seed["fixture"].id)
    assert f.status == "operational"
    # legacy state names are rejected
    with pytest.raises(ValidationErr):
        await svc.update_fixture(
            seed["admin"], washroom.id, seed["fixture"].id, "out_of_service"
        )


async def test_fixture_transition_pm_denied(session, seed, stub_tasks):
    svc = StructureService(session)
    with pytest.raises(Forbidden):
        await svc.update_fixture(
            seed["pm"], seed["washroom"].id, seed["fixture"].id, "maintenance"
        )


async def test_bulk_maintenance_super_admin_only(session, seed, stub_tasks):
    req = BulkUnitStatusRequest(
        action="maintenance", property_uid=seed["prop"].id,
        room_uids=[seed["room"].id],
    )
    svc = StructureService(session)
    with pytest.raises(Forbidden):
        await svc.bulk_unit_status(seed["pm"], req)
    await svc.bulk_unit_status(seed["admin"], req)
    await session.refresh(seed["room"])
    assert seed["room"].status == "maintenance"


async def test_bulk_available_closes_maintenance_and_releases(
    session, seed, stub_tasks,
):
    """Mark Available on a maintenance unit terminates its ticket honestly —
    resolved+closed events by the acting Super Admin — then derives release."""
    room = seed["room"]
    room.status = "maintenance"
    ticket = MaintenanceTicket(
        ticket_number="MT-1", company_id=seed["company"].id,
        property_id=seed["prop"].id, room_id=room.id,
        maintenance_type="plumbing", issue="x", priority="medium",
        status="open",
    )
    session.add(ticket)
    await session.commit()
    res = await StructureService(session).bulk_unit_status(
        seed["admin"],
        BulkUnitStatusRequest(
            action="available", property_uid=seed["prop"].id,
            room_uids=[room.id],
        ),
    )
    await session.refresh(room)
    await session.refresh(ticket)
    assert room.status == "available"
    assert ticket.status == "closed"
    assert ticket.closed_at is not None
    assert res["skipped_blocked"] == []
    # logged — resolved + closed events carry the acting admin's name
    from app.models.maintenance import MaintenanceTicketEvent
    events = (await session.execute(
        select(MaintenanceTicketEvent).where(
            MaintenanceTicketEvent.ticket_id == ticket.id
        ).order_by(MaintenanceTicketEvent.created_at)
    )).scalars().all()
    assert [e.action for e in events] == ["resolved", "closed"]
    assert all(e.actor_name == seed["admin"].name for e in events)


async def test_bulk_available_admin_closes_cleaning_task(
    session, seed, stub_tasks,
):
    """Mark Available on a cleaning unit terminates its task honestly —
    admin_closed history event by the acting Super Admin — then releases."""
    room = seed["room"]
    room.status = "cleaning"
    task = make_task(
        session, seed["prop"], seed["employee"],
        room_id=room.id, title="Cleaning — 101",
    )
    await session.commit()
    res = await StructureService(session).bulk_unit_status(
        seed["admin"],
        BulkUnitStatusRequest(
            action="available", property_uid=seed["prop"].id,
            room_uids=[room.id],
        ),
    )
    await session.refresh(room)
    await session.refresh(task)
    assert room.status == "available"
    assert res["skipped_blocked"] == []
    assert task.status == "completed"
    events = (await session.execute(
        select(TaskHistoryEvent).where(
            TaskHistoryEvent.task_id == task.id
        ).order_by(TaskHistoryEvent.at)
    )).scalars().all()
    assert any(
        e.type == "admin_closed" and e.actor_name == seed["admin"].name
        for e in events
    )


async def test_bulk_available_occupied_released_by_admin(
    session, seed, stub_tasks,
):
    """Available force-releases an occupied unit — the open occupancy is
    closed (audited) and occupied→available exits via admin_override."""
    room = seed["room"]
    room.status = "occupied"
    occ = Occupancy(
        property_id=seed["prop"].id, room_id=room.id, guest_name="Ada",
    )
    session.add(occ)
    await session.commit()
    res = await StructureService(session).bulk_unit_status(
        seed["admin"],
        BulkUnitStatusRequest(
            action="available", property_uid=seed["prop"].id,
            room_uids=[room.id],
        ),
    )
    await session.refresh(room)
    await session.refresh(occ)
    assert room.status == "available"
    assert occ.checked_out_at is not None
    assert occ.checked_out_by == seed["admin"].id


# ---------------------------------------------------------------------------
# Hardening regressions — authorization matrix + lifecycle guards
# ---------------------------------------------------------------------------

async def test_hr_cannot_start_task(session, seed, stub_tasks):
    """HR passing get_current_user must still be blocked at the service —
    the assigned-employee gate now rejects every non-staff, non-assignee."""
    room = seed["room"]
    task = make_task(
        session, seed["prop"], seed["employee"],
        room_id=room.id, title="Cleaning — 101",
    )
    await session.commit()
    with pytest.raises(Forbidden):
        await TaskService(session).start_task(seed["hr"], task.id)
    await session.refresh(room)
    assert room.status == "available"  # no resource side-effect


async def test_employee_cannot_start_others_task(session, seed, stub_tasks):
    task = make_task(
        session, seed["prop"], seed["employee"],
        title="Cleaning — 101", status="assigned",
    )
    await session.commit()
    with pytest.raises(Forbidden):
        await TaskService(session).start_task(seed["emp_user2"], task.id)


async def test_cancelled_task_cannot_restart(session, seed, stub_tasks):
    task = make_task(
        session, seed["prop"], seed["employee"], title="Job",
        status="cancelled",
    )
    await session.commit()
    with pytest.raises(ConflictErr):
        await TaskService(session).start_task(seed["admin"], task.id)


async def test_double_submit_blocked(session, seed, stub_tasks):
    from app.schemas.structure import TaskSubmitRequest
    task = make_task(
        session, seed["prop"], seed["employee"], title="Job",
        status="in_progress",
    )
    await session.commit()
    svc = TaskService(session)
    await svc.submit_task(
        seed["emp_user"], task.id,
        TaskSubmitRequest(note="done", photo_urls=["evidence/1.jpg"]),
    )
    with pytest.raises(ConflictErr):
        await svc.submit_task(
            seed["emp_user"], task.id,
            TaskSubmitRequest(note="again", photo_urls=["evidence/2.jpg"]),
        )


async def test_employee_cannot_request_redo(session, seed, stub_tasks):
    task = make_task(
        session, seed["prop"], seed["employee"], title="Job",
        status="in_progress",
    )
    await session.commit()
    with pytest.raises(Forbidden):
        await TaskService(session).request_redo(
            seed["emp_user"], task.id, "redo pls"
        )
    await TaskService(session).request_redo(seed["pm"], task.id, "rework")
    assert task.status == "pending"


async def test_hr_cannot_create_ticket(session, seed, stub_tasks):
    with pytest.raises(Forbidden):
        await MaintenanceService(session).create_ticket(
            seed["hr"], maint_req(seed["prop"], room_uid=seed["room"].id)
        )


async def test_hr_cannot_resolve_ticket(session, seed, stub_tasks):
    from app.schemas.maintenance import MaintenanceResolveRequest
    svc = MaintenanceService(session)
    ticket = await svc.create_ticket(
        seed["pm"], maint_req(seed["prop"], room_uid=seed["room"].id)
    )
    ticket.assigned_to = seed["employee"].id
    ticket.status = "in_progress"
    await session.commit()
    with pytest.raises(Forbidden):
        await svc.resolve(
            seed["hr"], ticket.id,
            MaintenanceResolveRequest(resolution_notes="done"),
        )


async def test_transition_cross_property_blocked(session, seed):
    """IDOR: a super_admin of company A cannot touch company B's resources —
    out-of-scope ids behave as not-found."""
    from app.models.company import Company
    from app.models.property import Property
    from app.models.user import User, UserRole
    from app.services.resource_state import ResourceStateService
    from app.services.structure import NotFoundErr

    other_company = Company(
        company_name="Other", brand_name="Other", address="x",
        pin_code="1", email="o@x.test", phone_number="1",
    )
    session.add(other_company)
    await session.flush()
    other_admin = User(
        company_id=other_company.id, property_id=seed["prop"].id,
        name="Foreign Admin", email="f@x.test", username="fadmin",
        password_hash="x", role=UserRole.SUPER_ADMIN,
    )
    session.add(other_admin)
    await session.commit()
    with pytest.raises(NotFoundErr):
        await ResourceStateService(session).transition(
            "room", seed["room"].id, "maintenance", user=other_admin,
            source="admin_override", reason="foreign",
        )


async def test_transition_deleted_resource_not_found(session, seed):
    from app.services.resource_state import ResourceStateService
    from app.services.structure import NotFoundErr
    await StructureService(session).delete_room(seed["admin"], seed["room"].id)
    with pytest.raises(NotFoundErr):
        await ResourceStateService(session).transition(
            "room", seed["room"].id, "cleaning", user=seed["admin"],
            source="task_start",
        )
