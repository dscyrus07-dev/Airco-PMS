"""AuditService — append-only record for staff-facing mutations.

`record()` writes an AuditEvent into the caller's transaction — the event
commits/rolls back with the operation it describes. `detail` carries only
non-secret context (no passwords/tokens).
"""

import uuid

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditEvent
from app.models.property import Property
from app.models.user import User


class AuditService:
    def __init__(self, session: AsyncSession):
        self.session = session

    def record(
        self,
        actor: User,
        *,
        entity_type: str,
        entity_id: uuid.UUID | None = None,
        entity_name: str | None = None,
        action: str,
        property_id: uuid.UUID | None = None,
        detail: dict | None = None,
    ) -> AuditEvent:
        ev = AuditEvent(
            property_id=property_id,
            actor_user_id=actor.id,
            actor_name=actor.name,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            action=action,
            detail=detail,
        )
        self.session.add(ev)
        return ev

    async def list_events(
        self,
        user: User,
        *,
        entity_type: str | None = None,
        entity_id: uuid.UUID | None = None,
        action: str | None = None,
        actor: str | None = None,
        date_from=None,
        date_to=None,
        page: int = 1,
        limit: int = 50,
    ) -> dict:
        """Property-scoped log query — non-admins see only their own
        property's events."""
        q = select(AuditEvent)
        if user.property_id is not None:
            q = q.where(AuditEvent.property_id == user.property_id)
        elif user.company_id:
            q = q.join(Property, AuditEvent.property_id == Property.id).where(
                Property.company_id == user.company_id
            )
        if entity_type:
            q = q.where(AuditEvent.entity_type == entity_type)
        if entity_id:
            q = q.where(AuditEvent.entity_id == entity_id)
        if action:
            q = q.where(AuditEvent.action == action)
        if actor:
            q = q.where(AuditEvent.actor_name.ilike(f"%{actor}%"))
        if date_from:
            q = q.where(AuditEvent.created_at >= date_from)
        if date_to:
            q = q.where(AuditEvent.created_at < date_to)
        total = await self.session.execute(
            select(func.count()).select_from(q.subquery())
        )
        res = await self.session.execute(
            q.order_by(desc(AuditEvent.created_at))
            .offset((page - 1) * limit).limit(limit)
        )
        return {"items": list(res.scalars()), "total": total.scalar() or 0}
