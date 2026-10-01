"""HR surface — /hr/* (workforce views/management scoped to the HR
caller's property) and /admin/hr (super-admin HR account management).

HR reuses the existing EmployeeService / WorkspaceRepository /
TaskHistoryEvent machinery — this router adds only the role gate and
property-scoped projections. No separate allocation or staff model.
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import hash_password
from app.dependencies.auth import require_role, require_super_admin
from app.models.employee import Employee
from app.models.property import Property
from app.models.task import Task, TaskHistoryEvent
from app.models.user import User, UserRole
from app.repositories.user import UserRepository
from app.repositories.workspace import WorkspaceRepository
from app.schemas.hr import HrCreateRequest, audit_out, hr_out
from app.schemas import workspace as ws
from app.schemas.structure import (
    EmployeeCreateRequest,
    EmployeeUpdateRequest,
)
from app.services.audit import AuditService
from app.services.auth import EmailAlreadyExists
from app.services.employee import EmployeeService
from app.services.structure import NotFoundErr, ValidationErr

router = APIRouter(tags=["hr"])

require_hr = require_role(UserRole.HUMAN_RESOURCE)


# ----------------------------------------------------------------------
# /hr/* — HR caller, scoped to user.property_id by the repositories
# ----------------------------------------------------------------------

@router.get("/hr/dashboard")
async def hr_dashboard(
    user: User = Depends(require_hr),
    session: AsyncSession = Depends(get_db),
):
    """Employee KPIs for the HR property — aggregate counts, no row pulls."""
    pid = user.property_id
    q = select(Employee).where(Employee.property_id == pid)
    res = await session.execute(q)
    employees = list(res.scalars())

    total = len(employees)
    active = sum(1 for e in employees if (e.status or "").lower() == "active")
    on_leave = sum(
        1 for e in employees
        if e.leave_status and (e.status or "").lower() == "active"
    )
    inactive = total - active
    now = datetime.now(timezone.utc)
    month_ago = now - timedelta(days=30)
    recent = [e for e in employees if e.created_at and e.created_at >= month_ago]
    dept_counts: dict[str, int] = {}
    for e in employees:
        if e.department:
            dept_counts[e.department] = dept_counts.get(e.department, 0) + 1

    return {
        "total_employees": total,
        "active_employees": active,
        "inactive_employees": inactive,
        "on_leave": on_leave,
        "departments": len(dept_counts),
        "new_last_30d": len(recent),
        "by_department": [
            {"department": d, "count": c}
            for d, c in sorted(dept_counts.items(), key=lambda kv: -kv[1])
        ],
        "recent_hires": [
            {"employee_uid": str(e.id), "name": e.name,
             "department": e.department,
             "created_at": e.created_at.isoformat() if e.created_at else None}
            for e in sorted(recent, key=lambda x: x.created_at, reverse=True)[:8]
        ],
    }


@router.get("/hr/employees")
async def hr_list_employees(
    zone_uid: str | None = Query(default=None),
    department: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(require_hr),
    session: AsyncSession = Depends(get_db),
):
    res = await WorkspaceRepository(session).list_employees(
        user, zone_id=_uid(zone_uid), department=department,
        status=status_, search=search, page=page, limit=limit,
    )
    res["items"] = [ws.employee_out(e) for e in res["items"]]
    return res


@router.post("/hr/employees", status_code=status.HTTP_201_CREATED)
async def hr_create_employee(
    payload: EmployeeCreateRequest,
    user: User = Depends(require_hr),
    session: AsyncSession = Depends(get_db),
):
    return ws.employee_out(
        await EmployeeService(session).create_employee(user, payload)
    )


@router.patch("/hr/employees/{employee_id}")
async def hr_update_employee(
    employee_id: uuid.UUID,
    payload: EmployeeUpdateRequest,
    user: User = Depends(require_hr),
    session: AsyncSession = Depends(get_db),
):
    return ws.employee_out(
        await EmployeeService(session).update_employee(user, employee_id, payload)
    )


@router.post("/hr/employees/{employee_id}/activate")
async def hr_reactivate_employee(
    employee_id: uuid.UUID,
    user: User = Depends(require_hr),
    session: AsyncSession = Depends(get_db),
):
    return ws.employee_out(
        await EmployeeService(session).reactivate(user, employee_id)
    )


@router.post("/hr/employees/{employee_id}/deactivate")
async def hr_deactivate_employee(
    employee_id: uuid.UUID,
    user: User = Depends(require_hr),
    session: AsyncSession = Depends(get_db),
):
    return ws.employee_out(
        await EmployeeService(session).deactivate(user, employee_id)
    )


@router.get("/hr/employee-logs")
async def hr_employee_logs(
    employee_uid: str | None = Query(default=None),
    action: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(require_hr),
    session: AsyncSession = Depends(get_db),
):
    res = await AuditService(session).list_events(
        user,
        entity_type="employee",
        entity_id=_uid(employee_uid),
        action=action, actor=actor,
        date_from=_ts(date_from), date_to=_ts(date_to, end_of_day=True),
        page=page, limit=limit,
    )
    res["items"] = [audit_out(e) for e in res["items"]]
    return res


@router.get("/hr/tasks/dashboard")
async def hr_tasks_dashboard(
    user: User = Depends(require_hr),
    session: AsyncSession = Depends(get_db),
):
    """Task KPIs for the HR property — SQL-level aggregation."""
    pid = user.property_id
    base = Task.property_id == pid
    async def group(col):
        res = await session.execute(
            select(col, func.count()).where(base).group_by(col)
        )
        return {str(k): c for k, c in res.all() if k is not None}

    by_status = await group(Task.status)
    by_type = await group(Task.task_type)
    by_employee = await group(Task.assigned_to_name)
    total = await session.execute(
        select(func.count(Task.id)).where(base)
    )
    return {
        "total": total.scalar() or 0,
        "open": sum(by_status.get(s, 0) for s in
                  ("pending", "assigned", "in_progress", "submitted",
                   "reopened", "scheduled")),
        "completed": by_status.get("completed", 0),
        "cancelled": by_status.get("cancelled", 0),
        "overdue": by_status.get("overdue", 0),
        "by_status": by_status,
        "by_type": by_type,
        "by_employee": [
            {"employee": n, "count": c}
            for n, c in sorted(by_employee.items(), key=lambda kv: -kv[1])[:10]
        ],
    }


@router.get("/hr/tasks")
async def hr_list_tasks(
    status_: str | None = Query(default=None, alias="status"),
    task_type: str | None = Query(default=None),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(require_hr),
    session: AsyncSession = Depends(get_db),
):
    res = await WorkspaceRepository(session).list_tasks(
        user, status=status_, task_type=task_type, search=search,
        page=page, limit=limit,
    )
    return {
        "items": [{
            "task_uid": str(t.id), "ticket_number": t.ticket_number,
            "title": t.title, "task_type": t.task_type,
            "status": t.status, "priority": t.priority,
            "assigned_to_name": t.assigned_to_name,
            "allocation_method": t.allocation_method,
            "allocation_status": t.allocation_status,
            "room_number": t.room_number, "dorm_name": t.dorm_name,
            "due_date": t.due_date,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        } for t in res["items"]],
        "total": res["total"], "page": res.get("page", page),
        "limit": res.get("limit", limit),
    }


@router.get("/hr/tasks/{task_id}/timeline")
async def hr_task_timeline(
    task_id: uuid.UUID,
    user: User = Depends(require_hr),
    session: AsyncSession = Depends(get_db),
):
    """Task + ordered history events — read-only, property-scoped."""
    res = await session.execute(
        select(Task).where(Task.id == task_id, Task.property_id == user.property_id)
    )
    task = res.scalar_one_or_none()
    if task is None:
        raise NotFoundErr()
    res = await session.execute(
        select(TaskHistoryEvent).where(TaskHistoryEvent.task_id == task.id)
        .order_by(TaskHistoryEvent.at)
    )
    return {
        "task": {
            "task_uid": str(task.id), "ticket_number": task.ticket_number,
            "title": task.title, "status": task.status,
            "assigned_to_name": task.assigned_to_name,
            "allocation_method": task.allocation_method,
            "created_at": task.created_at.isoformat() if task.created_at else None,
        },
        "events": [{
            "type": e.type,
            "at": e.at.isoformat() if e.at else None,
            "actor_name": e.actor_name,
            "note": e.note,
        } for e in res.scalars()],
    }


# ----------------------------------------------------------------------
# /admin/hr — super-admin HR account management
# ----------------------------------------------------------------------

def _hr_user(user_id_col=User.id):
    return select(User, Property.name).outerjoin(
        Property, User.property_id == Property.id
    ).where(User.role == UserRole.HUMAN_RESOURCE)


@router.post("/admin/hr", status_code=status.HTTP_201_CREATED)
async def admin_create_hr(
    payload: HrCreateRequest,
    user: User = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    """Create a HR login scoped to one company property — single
    transaction, no partial accounts."""
    res = await session.execute(
        select(Property).where(
            Property.id == payload.property_uid,
            Property.company_id == user.company_id,
        )
    )
    prop = res.scalar_one_or_none()
    if prop is None:
        raise ValidationErr("Property not found in this company.",
                            field="property_uid")
    email = payload.email.strip().lower()
    users = UserRepository(session)
    if await users.get_by_email(email):
        raise EmailAlreadyExists(field="email")
    username = email.split("@")[0]
    n = 1
    candidate = username
    while await users.username_exists(candidate):
        n += 1
        candidate = f"{username}.{n}"
    u = await users.create(
        company_id=user.company_id,
        name=payload.name.strip(),
        email=email,
        username=candidate,
        password_hash=hash_password(payload.password),
        phone_number=payload.phone,
        role=UserRole.HUMAN_RESOURCE,
        property_id=prop.id,
        job_title="Human Resources",
    )
    AuditService(session).record(
        user, entity_type="user", entity_id=u.id, entity_name=u.name,
        action="hr_created", property_id=prop.id,
        detail={"email": email, "property": prop.name},
    )
    await session.commit()
    return hr_out(u, prop.name)


@router.get("/admin/hr")
async def admin_list_hr(
    user: User = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    res = await session.execute(
        _hr_user().where(User.company_id == user.company_id)
        .order_by(User.created_at.desc())
    )
    return {"items": [hr_out(u, pname) for u, pname in res.all()]}


@router.post("/admin/hr/{user_id}/toggle")
async def admin_toggle_hr(
    user_id: uuid.UUID,
    user: User = Depends(require_super_admin),
    session: AsyncSession = Depends(get_db),
):
    res = await session.execute(
        select(User).where(
            User.id == user_id,
            User.role == UserRole.HUMAN_RESOURCE,
            User.company_id == user.company_id,
        )
    )
    target = res.scalar_one_or_none()
    if target is None:
        raise NotFoundErr()
    target.is_active = not target.is_active
    AuditService(session).record(
        user, entity_type="user", entity_id=target.id,
        entity_name=target.name,
        action="hr_activated" if target.is_active else "hr_deactivated",
        property_id=target.property_id,
    )
    await session.commit()
    pname = None
    if target.property_id:
        prop = await session.get(Property, target.property_id)
        pname = prop.name if prop else None
    return hr_out(target, pname)


def _uid(value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError):
        return None


def _ts(value: str | None, end_of_day: bool = False):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if end_of_day:
            dt = dt + timedelta(days=1)
        return dt
    except ValueError:
        return None
