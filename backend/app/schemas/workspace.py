"""
Workspace DTOs — serialization for the collections the frontend's
`loadWorkspace` fetches. Field names match frontend/src/types.ts exactly
(`*_uid` keys, snake_case).
"""

from datetime import datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel

from app.models.employee import Employee
from app.models.property import Property
from app.models.structure import Area, Bed, Dorm, Room, Zone
from app.models.task import Task, TaskHistoryEvent

T = TypeVar("T")


class ListResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int = 1
    limit: int = 20


# ---------------------------------------------------------------------------
# Serializers — ORM → plain dict matching the frontend types
# ---------------------------------------------------------------------------

def property_out(p: Property) -> dict:
    return {
        "property_uid": str(p.id),
        "company_uid": str(p.company_id),
        "name": p.name,
        "code": p.code,
        "location": p.location,
        "city": p.city,
        "state": p.state,
        "status": p.status,
        "manager_employee_uid": str(p.manager_employee_id) if p.manager_employee_id else None,
        "manager_name": p.manager_name,
        "manager_email": p.manager_email,
        "manager_phone": p.manager_phone,
        "created_at": p.created_at,
    }


def area_out(a: Area) -> dict:
    return {
        "area_uid": str(a.id),
        "property_uid": str(a.property_id),
        "name": a.name,
        "code": a.code,
        "level_number": a.level_number,
        "description": a.description,
        "created_at": a.created_at,
    }


def zone_out(z: Zone) -> dict:
    return {
        "zone_uid": str(z.id),
        "property_uid": str(z.property_id),
        "area_uid": str(z.area_id) if z.area_id else None,
        "name": z.name,
        "code": z.code,
        "zone_type": z.zone_type,
        "floor": z.floor,
        "description": z.description,
        "created_at": z.created_at,
    }


def room_out(r: Room) -> dict:
    return {
        "room_uid": str(r.id),
        "property_uid": str(r.property_id),
        "zone_uid": str(r.zone_id) if r.zone_id else None,
        "room_number": r.room_number,
        "type": r.type,
        "area_sqft": r.area_sqft,
        "status": r.status,
        "bed_count": r.bed_count,
        "cleaning_note": r.cleaning_note,
        "current_guest": r.current_guest,
        "created_at": r.created_at,
    }


def bed_out(b: Bed) -> dict:
    return {
        "bed_uid": str(b.id),
        "dorm_uid": str(b.dorm_id),
        "bed_number": b.bed_number,
        "status": b.status,
        "guest_name": b.guest_name,
    }


def dorm_out(d: Dorm) -> dict:
    return {
        "dorm_uid": str(d.id),
        "property_uid": str(d.property_id),
        "zone_uid": str(d.zone_id) if d.zone_id else None,
        "name": d.name,
        "dorm_type": d.dorm_type,
        "washroom": d.washroom,
        "status": d.status,
        "floor": d.floor,
        "area_sqft": d.area_sqft,
        "description": d.description,
        "beds": [bed_out(b) for b in d.beds],
        "created_at": d.created_at,
    }


def employee_out(e: Employee) -> dict:
    return {
        "employee_uid": str(e.id),
        "company_uid": str(e.company_id),
        "property_uid": str(e.property_id),
        "zone_uid": str(e.zone_id) if e.zone_id else None,
        "area_uid": str(e.area_id) if e.area_id else None,
        "name": e.name,
        "email": e.email,
        "phone": e.phone,
        "username": e.username,
        "job_title": e.job_title,
        "department": e.department,
        "status": e.status,
        "role": None,
        "salary": e.salary,
        "shift": e.shift,
        "joined_date": e.created_at.date().isoformat() if e.created_at else None,
        "start_date": e.start_date,
        "avatar_color": e.avatar_color,
        "leave_balance_days": e.leave_balance_days,
        "leave_status": e.leave_status,
        "created_at": e.created_at,
    }


def history_out(h: TaskHistoryEvent) -> dict:
    return {
        "event_uid": str(h.id),
        "type": h.type,
        "at": h.at,
        "actor_name": h.actor_name,
        "note": h.note,
        "photos": h.photos or [],
    }


def task_out(t: Task) -> dict:
    return {
        "task_uid": str(t.id),
        "ticket_number": t.ticket_number,
        "property_uid": str(t.property_id),
        "zone_uid": str(t.zone_id) if t.zone_id else None,
        "room_uid": str(t.room_id) if t.room_id else None,
        "room_number": t.room_number,
        "dorm_uid": str(t.dorm_id) if t.dorm_id else None,
        "dorm_name": t.dorm_name,
        "bed_uids": list(t.bed_ids) if t.bed_ids else None,
        "supervisor_uid": str(t.supervisor_id) if t.supervisor_id else None,
        "supervisor_name": t.supervisor_name,
        "employee_uid": str(t.employee_id) if t.employee_id else None,
        "assigned_to_name": t.assigned_to_name,
        "allocation_batch_id": str(t.allocation_batch_id) if t.allocation_batch_id else None,
        "allocation_status": t.allocation_status,
        "allocation_method": t.allocation_method,
        "allocation_reason": t.allocation_reason,
        "title": t.title,
        "description": t.description,
        "task_type": t.task_type,
        "status": t.status,
        "priority": t.priority,
        "due_date": t.due_date,
        "due_time": t.due_time,
        "start_time": t.start_time,
        "recurrence_start_date": t.recurrence_start_date,
        "recurrence_end_date": t.recurrence_end_date,
        "recurrence_window_end": t.recurrence_window_end,
        "created_by_name": t.created_by_name,
        "recurrence": t.recurrence,
        "recurrence_interval_days": t.recurrence_interval_days,
        "series_id": str(t.series_id) if t.series_id else None,
        "automation_rule": t.automation_rule,
        "history": [history_out(h) for h in t.history],
        "submitted_at": t.submitted_at.isoformat() if t.submitted_at else None,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "created_at": t.created_at,
    }
