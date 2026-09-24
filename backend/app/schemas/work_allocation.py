"""Work allocation batch request/response schemas."""

import uuid

from pydantic import BaseModel, Field


class WorkBatchTicketIn(BaseModel):
    """One ticket inside a work batch — 'maintenance' or 'task'."""

    kind: str = "maintenance"  # maintenance | task

    # Maintenance target — exactly one of these
    room_uid: uuid.UUID | None = None
    dorm_uid: uuid.UUID | None = None
    bed_uid: uuid.UUID | None = None
    maintenance_type: str | None = Field(default=None, max_length=64)
    issue: str | None = Field(default=None, min_length=3, max_length=255)
    attachment_urls: list[str] = Field(default_factory=list)

    # Task fields
    title: str | None = Field(default=None, min_length=3, max_length=255)
    task_type: str | None = None
    zone_uid: uuid.UUID | None = None
    supervisor_uid: uuid.UUID | None = None
    due_time: str | None = None

    # Shared
    description: str | None = Field(default=None, max_length=4000)
    priority: str = "medium"
    due_date: str | None = Field(default=None, max_length=64)


class WorkBatchCreateRequest(BaseModel):
    property_uid: uuid.UUID
    tickets: list[WorkBatchTicketIn] = Field(..., min_length=1)


def ticket_ref_out(kind: str, t) -> dict:
    """Compact ticket reference inside a batch response."""
    if kind == "maintenance":
        return {
            "kind": "maintenance",
            "ticket_uid": str(t.id),
            "ticket_number": t.ticket_number,
            "issue": t.issue,
            "location_label": (
                f"Room {t.room_number}" if t.room_number
                else f"{t.dorm_name} · {t.bed_number}" if t.bed_number
                else t.dorm_name
            ),
            "status": t.status,
            "assigned_to": str(t.assigned_to) if t.assigned_to else None,
            "assigned_to_name": t.assigned_to_name,
        }
    return {
        "kind": "task",
        "ticket_uid": str(t.id),
        "ticket_number": t.ticket_number,
        "title": t.title,
        "status": t.status,
        "assigned_to": str(t.employee_id) if t.employee_id else None,
        "assigned_to_name": t.assigned_to_name,
    }


def batch_out(b, tickets: list[dict]) -> dict:
    return {
        "batch_id": str(b.id),
        "batch_number": b.batch_number,
        "property_uid": str(b.property_id),
        "zone_uid": str(b.zone_id) if b.zone_id else None,
        "zone_name": b.zone_name,
        "employee_uid": str(b.employee_id) if b.employee_id else None,
        "employee_name": b.employee_name,
        "work_type": b.work_type,
        "allocation_status": b.allocation_status,
        "allocation_reason": b.allocation_reason,
        "created_by_name": b.created_by_name,
        "created_at": b.created_at.isoformat() if b.created_at else None,
        "tickets": tickets,
    }
