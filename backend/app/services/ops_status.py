"""OpsStatusService — single source of truth for resource status transitions.

A room/bed/dorm's operational status is DERIVED from active work, never set
in isolation:

    blocking maintenance ticket  → "maintenance"
    blocking operational task    → "cleaning"      (room targets only)
    nothing blocking             → release_to ("available" or "cleaning")

Rules that make this safe:

- The resource row is locked FOR UPDATE before reading its blockers, so two
  concurrent acknowledgements serialize instead of racing a stale read.
- Only "cleaning"/"maintenance" resources are ever transitioned — "occupied"
  and "available" are guest-facing states this service never overrides.
- Employee completion does NOT release a resource: "submitted" tasks and
  "resolved" (awaiting close) maintenance tickets still count as blocking.
  Only the supervisor acknowledgement path calls refresh with a release.

Audit: every transition is recorded on the triggering ticket/task's event
stream (actor, trigger, previous → new status).
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.maintenance import MaintenanceTicket
from app.models.structure import Bed, Dorm, Room
from app.models.task import Task

# A ticket still holds the resource until the supervisor closes it — the
# employee "resolved" state is completion, not acknowledgement.
BLOCKING_MAINTENANCE = {"open", "assigned", "in_progress", "on_hold", "resolved"}

# Open operational work — completed/cancelled are the only non-blocking states.
BLOCKING_TASK = {"pending", "assigned", "in_progress", "submitted",
                 "reopened", "scheduled", "overdue"}

TRANSITIONABLE = {"cleaning", "maintenance"}


class OpsStatusService:
    def __init__(self, session: AsyncSession):
        self.session = session

    # ------------------------------------------------------------------
    # Blocking checks
    # ------------------------------------------------------------------

    async def _room_blockers(self, room_id: uuid.UUID) -> dict:
        maint = (await self.session.execute(
            select(MaintenanceTicket.id, MaintenanceTicket.ticket_number)
            .where(
                MaintenanceTicket.room_id == room_id,
                MaintenanceTicket.status.in_(BLOCKING_MAINTENANCE),
            )
        )).all()
        tasks = (await self.session.execute(
            select(Task.id, Task.ticket_number)
            .where(
                Task.room_id == room_id,
                Task.status.in_(BLOCKING_TASK),
            ).execution_options(populate_existing=True)
        )).all()
        return {"maintenance": maint, "tasks": tasks}

    async def _bed_blocked(self, bed_id: uuid.UUID, dorm_id: uuid.UUID) -> bool:
        res = await self.session.execute(
            select(MaintenanceTicket.id).where(
                MaintenanceTicket.status.in_(BLOCKING_MAINTENANCE),
                (MaintenanceTicket.bed_id == bed_id)
                | (MaintenanceTicket.dorm_id == dorm_id),
            ).limit(1)
        )
        return res.scalar_one_or_none() is not None

    async def _dorm_blocked(self, dorm_id: uuid.UUID) -> bool:
        res = await self.session.execute(
            select(MaintenanceTicket.id).where(
                MaintenanceTicket.dorm_id == dorm_id,
                MaintenanceTicket.status.in_(BLOCKING_MAINTENANCE),
            ).limit(1)
        )
        return res.scalar_one_or_none() is not None

    # ------------------------------------------------------------------
    # Refresh — lock, derive, transition, audit
    # ------------------------------------------------------------------

    async def refresh_room(
        self, room_id: uuid.UUID | None, *, release_to: str = "available",
        actor_name: str | None = None, trigger: str,
        audit=None,
    ) -> str | None:
        """Re-derive a room's status from its active work. Returns the new
        status when it changed, else None. `audit` is a callback receiving
        (event_note) — callers wire it to their ticket/task event stream."""
        if room_id is None:
            return None
        await self.session.flush()  # pending writes visible to the read
        res = await self.session.execute(
            select(Room).where(Room.id == room_id).with_for_update()
        )
        room = res.scalar_one_or_none()
        if room is None or room.status not in TRANSITIONABLE:
            return None

        blockers = await self._room_blockers(room.id)
        if blockers["maintenance"]:
            target = "maintenance"
        elif blockers["tasks"]:
            target = "cleaning"
        else:
            target = release_to

        if room.status == target:
            return None
        prev, room.status = room.status, target
        note = (f"Room {room.room_number}: {prev} → {target} "
                f"({trigger})")
        if audit is not None:
            audit(note)
        return target

    async def refresh_bed(
        self, bed_id: uuid.UUID | None, *, release_to: str = "available",
        actor_name: str | None = None, trigger: str,
        audit=None,
    ) -> str | None:
        if bed_id is None:
            return None
        await self.session.flush()
        res = await self.session.execute(
            select(Bed).where(Bed.id == bed_id).with_for_update()
        )
        bed = res.scalar_one_or_none()
        if bed is None or bed.status not in TRANSITIONABLE:
            return None
        target = "maintenance" if await self._bed_blocked(bed.id, bed.dorm_id) \
            else release_to
        if bed.status == target:
            return None
        prev, bed.status = bed.status, target
        if audit is not None:
            audit(f"Bed {bed.bed_number}: {prev} → {target} ({trigger})")
        return target

    async def refresh_dorm(
        self, dorm_id: uuid.UUID | None, *, release_to: str = "available",
        actor_name: str | None = None, trigger: str,
        audit=None,
    ) -> str | None:
        """Dorm-level release — the dorm and every non-occupied bed derive
        from remaining maintenance blockers."""
        if dorm_id is None:
            return None
        await self.session.flush()
        res = await self.session.execute(
            select(Dorm).where(Dorm.id == dorm_id).with_for_update()
        )
        dorm = res.scalar_one_or_none()
        if dorm is None:
            return None
        blocked = await self._dorm_blocked(dorm.id)
        target = "maintenance" if blocked else release_to
        changed = []
        if dorm.status in TRANSITIONABLE and dorm.status != target:
            changed.append(f"dorm:{dorm.status}->{target}")
            dorm.status = target
        res = await self.session.execute(
            select(Bed).where(Bed.dorm_id == dorm.id)
        )
        for b in res.scalars():
            if b.status in TRANSITIONABLE and b.status != target:
                if await self._bed_blocked(b.id, dorm.id):
                    continue  # bed-level ticket still blocks this bed
                b.status = target
                changed.append(f"bed {b.bed_number}")
        if changed and audit is not None:
            audit(f"Dorm {dorm.name}: → {target} ({trigger}); "
                  f"{', '.join(changed)}")
        return target if changed else None
