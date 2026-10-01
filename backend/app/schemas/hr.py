"""HR account + audit-log schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class HrCreateRequest(BaseModel):
    property_uid: uuid.UUID
    name: str = Field(min_length=2, max_length=255)
    email: str = Field(min_length=3, max_length=255)
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=8, max_length=128)


class HrAccountOut(BaseModel):
    user_uid: uuid.UUID
    name: str
    email: str
    phone: str | None
    property_uid: uuid.UUID | None
    property_name: str | None
    is_active: bool
    created_at: datetime | None


class AuditEventOut(BaseModel):
    event_uid: uuid.UUID
    action: str
    entity_type: str
    entity_id: uuid.UUID | None
    entity_name: str | None
    actor_name: str | None
    detail: dict | None
    created_at: datetime | None


def hr_out(u, prop_name: str | None) -> dict:
    return {
        "user_uid": str(u.id), "name": u.name, "email": u.email,
        "phone": u.phone_number,
        "property_uid": str(u.property_id) if u.property_id else None,
        "property_name": prop_name,
        "is_active": u.is_active,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


def audit_out(e) -> dict:
    return {
        "event_uid": str(e.id), "action": e.action,
        "entity_type": e.entity_type,
        "entity_id": str(e.entity_id) if e.entity_id else None,
        "entity_name": e.entity_name, "actor_name": e.actor_name,
        "detail": e.detail,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }
