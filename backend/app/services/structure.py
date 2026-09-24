"""
StructureService — Areas / Zones / Rooms / Dorms / Beds mutations.

Every operation resolves the entity → its property → the caller's scope:
  super_admin       → entity's property.company_id == user.company_id
  property_manager  → entity's property.id == user.property_id
  employee          → read-only (structure writes rejected upstream)

Client-supplied company/property ids are never trusted for authorization.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import AppError
from app.models.allocation import AllocationEvent
from app.models.employee import Employee
from app.models.property import Property
from app.models.structure import Area, Bed, Dorm, Room, Zone
from app.models.task import Task
from app.models.user import User, UserRole
from app.schemas.structure import (
    AreaCreateRequest,
    AreaUpdateRequest,
    BulkUnitStatusRequest,
    DormCreateRequest,
    DormUpdateRequest,
    RoomBulkCreateRequest,
    RoomBulkDeleteRequest,
    RoomCreateRequest,
    RoomUpdateRequest,
    ZoneCreateRequest,
    ZoneUpdateRequest,
)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class NotFoundErr(AppError):
    status_code = 404
    code = "NOT_FOUND"
    message = "The requested resource was not found."


class ConflictErr(AppError):
    status_code = 409
    code = "CONFLICT"


class ValidationErr(AppError):
    status_code = 422
    code = "VALIDATION_ERROR"


BED_STATUSES = {"available", "occupied", "cleaning", "maintenance", "inactive"}
ROOM_STATUSES = {"available", "occupied", "cleaning", "maintenance"}
STAY_TYPES = {"stay"}


class StructureService:
    def __init__(self, session: AsyncSession):
        self.session = session

    # ------------------------------------------------------------------
    # Scope helpers
    # ------------------------------------------------------------------

    async def _property_for_write(self, user: User, property_id: uuid.UUID) -> Property:
        res = await self.session.execute(
            select(Property).where(Property.id == property_id)
        )
        prop = res.scalar_one_or_none()
        if prop is None:
            raise NotFoundErr("Property not found.")
        if user.role == UserRole.SUPER_ADMIN:
            if prop.company_id != user.company_id:
                raise NotFoundErr("Property not found.")
        elif user.property_id != prop.id:
            raise NotFoundErr("Property not found.")
        return prop

    async def _get(self, model, entity_id: uuid.UUID, user: User, options=None):
        """Fetch entity + its property in ONE query — halves RTTs vs. the
        previous entity-then-property two-step (each remote query ≈300ms)."""
        q = (
            select(model, Property)
            .join(Property, model.property_id == Property.id)
            .where(model.id == entity_id)
        )
        if options:
            q = q.options(*options)
        res = await self.session.execute(q)
        row = res.first()
        if row is None:
            raise NotFoundErr()
        entity, prop = row
        if user.role == UserRole.SUPER_ADMIN:
            if prop.company_id != user.company_id:
                raise NotFoundErr()
        elif user.property_id != prop.id:
            raise NotFoundErr()
        return entity, prop

    async def _zone_in_property(self, zone_id: uuid.UUID | None, property_id: uuid.UUID):
        if zone_id is None:
            return None
        res = await self.session.execute(
            select(Zone).where(Zone.id == zone_id, Zone.property_id == property_id)
        )
        zone = res.scalar_one_or_none()
        if zone is None:
            raise ValidationErr("Zone not found in this property.", field="zone_uid")
        if zone.zone_type not in STAY_TYPES:
            raise ValidationErr(
                "Units can only be assigned to zones of type 'stay'.",
                field="zone_uid",
            )
        return zone

    async def _area_in_property(self, area_id: uuid.UUID | None, property_id: uuid.UUID):
        if area_id is None:
            return None
        res = await self.session.execute(
            select(Area).where(Area.id == area_id, Area.property_id == property_id)
        )
        if res.scalar_one_or_none() is None:
            raise ValidationErr("Area not found in this property.", field="area_uid")
        return area_id

    async def _next_code(self, model, property_id: uuid.UUID, prefix: str) -> str:
        res = await self.session.execute(
            select(func.count(model.id)).where(model.property_id == property_id)
        )
        return f"{prefix}-{(res.scalar() or 0) + 1:03d}"

    def _record(
        self,
        user: User,
        entity_type: str,
        entity_id: uuid.UUID,
        property_id: uuid.UUID,
        from_zone=None,
        to_zone=None,
        from_area=None,
        to_area=None,
    ):
        self.session.add(
            AllocationEvent(
                entity_type=entity_type,
                entity_id=entity_id,
                property_id=property_id,
                from_zone_id=from_zone,
                to_zone_id=to_zone,
                from_area_id=from_area,
                to_area_id=to_area,
                actor_user_id=user.id,
                actor_name=user.name,
            )
        )

    # ------------------------------------------------------------------
    # Automation — fire rule-driven tasks on unit status changes
    # ------------------------------------------------------------------

    async def _fire_automation(
        self, user: User, property_id: uuid.UUID, trigger: str, zone_id=None
    ):
        """Generate a task instance for each active automated rule matching
        the trigger (and zone scope) in this property."""
        res = await self.session.execute(
            select(Task).where(
                Task.property_id == property_id,
                Task.task_type == "automated",
                Task.status != "completed",
            )
        )
        generated = []
        for rule_task in res.scalars():
            rule = rule_task.automation_rule or {}
            if rule.get("trigger") != trigger:
                continue
            scope_zone = rule.get("scope_zone_uid")
            if scope_zone and zone_id and str(zone_id) != scope_zone:
                continue
            today = datetime.now(timezone.utc).date().isoformat()
            emp_id = (uuid.UUID(rule["assign_to_uid"])
                      if rule.get("assign_to_uid") else None)
            emp_name = None
            status_ = "pending"
            if emp_id is None:
                # no named assignee → zone round-robin, same engine as the
                # cleaning-task path, so generated work still lands allocated
                from app.services.work_allocation import (
                    WorkAllocationService,
                )
                prop = await self.session.get(Property, property_id)
                alloc = await WorkAllocationService(self.session).allocate(
                    None, property_id=property_id, zone_id=zone_id,
                    zone_name=None, work_type="task",
                    manager_employee_id=(
                        prop.manager_employee_id if prop else None),
                    company_id=prop.company_id if prop else None,
                    actor_name="Automation",
                )
                if alloc.employee:
                    emp_id, emp_name = alloc.employee.id, alloc.employee.name
                    status_ = "assigned"
            task = Task(
                property_id=property_id,
                zone_id=zone_id or rule_task.zone_id,
                employee_id=emp_id,
                assigned_to_name=emp_name,
                title=rule.get("template_title", "Automation task"),
                description=rule.get("template_description"),
                task_type="fixed",
                status=status_,
                priority="medium",
                due_date=today,
            )
            self.session.add(task)
            await self.session.flush()
            from app.models.task import TaskHistoryEvent

            self.session.add(
                TaskHistoryEvent(
                    task_id=task.id,
                    type="auto_generated",
                    actor_name=rule_task.title,
                    note=f"Automation '{rule_task.title}' triggered by {trigger}",
                )
            )
            generated.append(task)
        return generated

    # ------------------------------------------------------------------
    # Areas
    # ------------------------------------------------------------------

    async def create_area(self, user: User, payload: AreaCreateRequest) -> Area:
        prop = await self._property_for_write(user, payload.property_uid)
        area = Area(
            property_id=prop.id,
            name=payload.name.strip(),
            code=await self._next_code(Area, prop.id, "AREA"),
            level_number=payload.level_number,
            description=payload.description,
        )
        self.session.add(area)
        await self._commit()
        return area

    async def update_area(
        self, user: User, area_id: uuid.UUID, payload: AreaUpdateRequest
    ) -> Area:
        area, _ = await self._get(Area, area_id, user)
        data = payload.model_dump(exclude_unset=True)
        for k, v in data.items():
            setattr(area, k, v)
        await self._commit()
        return area

    async def delete_area(self, user: User, area_id: uuid.UUID) -> None:
        area, _ = await self._get(Area, area_id, user)
        res = await self.session.execute(
            select(func.count(Zone.id)).where(Zone.area_id == area_id)
        )
        zones = res.scalar() or 0
        res = await self.session.execute(
            select(func.count(Room.id)).where(Room.area_id == area_id)
        )
        rooms = res.scalar() or 0
        res = await self.session.execute(
            select(func.count(Dorm.id)).where(Dorm.area_id == area_id)
        )
        dorms = res.scalar() or 0
        if zones or rooms or dorms:
            raise ConflictErr(
                f"Cannot delete area with {zones} zones, {rooms} rooms, "
                f"{dorms} dorms — reassign them first."
            )
        await self.session.delete(area)
        await self._commit()

    # ------------------------------------------------------------------
    # Zones
    # ------------------------------------------------------------------

    async def create_zone(self, user: User, payload: ZoneCreateRequest) -> Zone:
        prop = await self._property_for_write(user, payload.property_uid)
        await self._area_in_property(payload.area_uid, prop.id)
        zone = Zone(
            property_id=prop.id,
            area_id=payload.area_uid,
            name=payload.name.strip(),
            code=await self._next_code(Zone, prop.id, "ZONE"),
            zone_type=payload.zone_type or "stay",
            floor=payload.floor,
            description=payload.description,
        )
        self.session.add(zone)
        await self._commit()
        return zone

    async def update_zone(
        self, user: User, zone_id: uuid.UUID, payload: ZoneUpdateRequest
    ) -> Zone:
        zone, _ = await self._get(Zone, zone_id, user)
        data = payload.model_dump(exclude_unset=True)
        if "area_uid" in data:
            data["area_id"] = await self._area_in_property(
                data.pop("area_uid"), zone.property_id
            )
        new_type = data.get("zone_type")
        if new_type and new_type != zone.zone_type and new_type not in STAY_TYPES:
            # Moving away from 'stay' — unassign any units inside
            res = await self.session.execute(
                select(Room).where(Room.zone_id == zone_id)
            )
            for room in res.scalars():
                self._record(user, "room", room.id, room.property_id,
                             from_zone=zone_id)
                room.zone_id = None
            res = await self.session.execute(
                select(Dorm).where(Dorm.zone_id == zone_id)
            )
            for dorm in res.scalars():
                self._record(user, "dorm", dorm.id, dorm.property_id,
                             from_zone=zone_id)
                dorm.zone_id = None
        for k, v in data.items():
            setattr(zone, k, v)
        await self._commit()
        return zone

    async def delete_zone(self, user: User, zone_id: uuid.UUID) -> None:
        zone, _ = await self._get(Zone, zone_id, user)
        counts = {}
        for model, key in (
            (Room, "rooms"),
            (Dorm, "dorms"),
            (Employee, "employees"),
            (Task, "tasks"),
        ):
            res = await self.session.execute(
                select(func.count(model.id)).where(model.zone_id == zone_id)
            )
            counts[key] = res.scalar() or 0
        if any(counts.values()):
            parts = ", ".join(f"{v} {k}" for k, v in counts.items() if v)
            raise ConflictErr(f"Cannot delete zone containing {parts} — reassign them first.")
        await self.session.delete(zone)
        await self._commit()

    # ------------------------------------------------------------------
    # Rooms
    # ------------------------------------------------------------------

    async def _room_number_exists(self, property_id, room_number: str) -> bool:
        res = await self.session.execute(
            select(Room.id).where(
                Room.property_id == property_id,
                func.lower(Room.room_number) == room_number.strip().lower(),
            )
        )
        return res.scalar_one_or_none() is not None

    async def create_room(self, user: User, payload: RoomCreateRequest) -> Room:
        prop = await self._property_for_write(user, payload.property_uid)
        zone = await self._zone_in_property(payload.zone_uid, prop.id)
        area_id = await self._area_in_property(payload.area_uid, prop.id)
        if area_id is None and zone is not None:
            area_id = zone.area_id  # inherit the zone's area
        if await self._room_number_exists(prop.id, payload.room_number):
            raise ConflictErr(
                f"Room {payload.room_number} already exists in this property.",
                field="room_number",
            )
        room = Room(
            property_id=prop.id,
            zone_id=zone.id if zone else None,
            area_id=area_id,
            room_number=payload.room_number.strip(),
            type=payload.type,
            area_sqft=payload.area_sqft,
            bed_count=payload.bed_count or 1,
            status="available",
        )
        self.session.add(room)
        await self.session.flush()
        if zone:
            self._record(user, "room", room.id, prop.id, to_zone=zone.id,
                         to_area=area_id)
        await self._commit()
        return room

    async def bulk_create_rooms(
        self, user: User, payload: RoomBulkCreateRequest
    ) -> dict:
        prop = await self._property_for_write(user, payload.property_uid)
        if payload.end < payload.start:
            raise ValidationErr("'end' must be ≥ 'start'.", field="end")
        if payload.end - payload.start > 100:
            raise ValidationErr("Cannot create more than 100 rooms at once.", field="end")
        zone = await self._zone_in_property(payload.zone_uid, prop.id)
        area_id = await self._area_in_property(payload.area_uid, prop.id)
        if area_id is None and zone is not None:
            area_id = zone.area_id

        created, errors = [], []
        for n in range(payload.start, payload.end + 1):
            number = str(n)
            if await self._room_number_exists(prop.id, number):
                errors.append(f"Room {number} already exists")
                continue
            room = Room(
                property_id=prop.id,
                zone_id=zone.id if zone else None,
                area_id=area_id,
                room_number=number,
                type=payload.type,
                area_sqft=payload.area_sqft,
                status="available",
            )
            self.session.add(room)
            await self.session.flush()
            if zone:
                self._record(user, "room", room.id, prop.id, to_zone=zone.id,
                             to_area=area_id)
            created.append(room)
        await self._commit()
        return {"created": created, "errors": errors}

    async def update_room(
        self, user: User, room_id: uuid.UUID, payload: RoomUpdateRequest
    ) -> Room:
        room, _ = await self._get(Room, room_id, user)
        data = payload.model_dump(exclude_unset=True)

        if "room_number" in data and data["room_number"] != room.room_number:
            if await self._room_number_exists(room.property_id, data["room_number"]):
                raise ConflictErr(
                    f"Room {data['room_number']} already exists in this property.",
                    field="room_number",
                )
        if "zone_uid" in data:
            zone = await self._zone_in_property(data.pop("zone_uid"), room.property_id)
            from_zone, from_area = room.zone_id, room.area_id
            room.zone_id = zone.id if zone else None
            room.area_id = zone.area_id if zone else (room.area_id if "area_uid" not in data else None)
            if room.zone_id:
                room.area_id = zone.area_id
            if from_zone != room.zone_id:
                self._record(user, "room", room.id, room.property_id,
                             from_zone=from_zone, to_zone=room.zone_id,
                             from_area=from_area, to_area=room.area_id)
        if "area_uid" in data:
            room.area_id = await self._area_in_property(
                data.pop("area_uid"), room.property_id
            )
        for k, v in data.items():
            setattr(room, k, v)
        await self._commit()
        return room

    async def delete_room(self, user: User, room_id: uuid.UUID) -> None:
        room, _ = await self._get(Room, room_id, user)
        if room.status == "occupied":
            raise ConflictErr("Cannot delete an occupied room — check out the guest first.")
        await self.session.delete(room)
        await self._commit()

    async def bulk_delete_rooms(
        self, user: User, payload: RoomBulkDeleteRequest
    ) -> dict:
        prop = await self._property_for_write(user, payload.property_uid)
        res = await self.session.execute(
            select(Room).where(
                Room.id.in_(payload.room_uids), Room.property_id == prop.id
            )
        )
        rooms = list(res.scalars())
        occupied = [r.room_number for r in rooms if r.status == "occupied"]
        if occupied:
            raise ConflictErr(
                f"Cannot delete occupied rooms: {', '.join(sorted(occupied))}."
            )
        if len(rooms) != len(payload.room_uids):
            raise NotFoundErr("Some rooms were not found in this property.")
        for room in rooms:
            await self.session.delete(room)
        await self._commit()
        return {"deleted": len(rooms)}

    # ------------------------------------------------------------------
    # Dorms & Beds
    # ------------------------------------------------------------------

    async def create_dorm(self, user: User, payload: DormCreateRequest) -> Dorm:
        prop = await self._property_for_write(user, payload.property_uid)
        zone = await self._zone_in_property(payload.zone_uid, prop.id)
        area_id = await self._area_in_property(payload.area_uid, prop.id)
        if area_id is None and zone is not None:
            area_id = zone.area_id
        dorm = Dorm(
            property_id=prop.id,
            zone_id=zone.id if zone else None,
            area_id=area_id,
            name=payload.name.strip(),
            dorm_type=payload.dorm_type,
            washroom=payload.washroom,
            floor=payload.floor,
            area_sqft=payload.area_sqft,
            description=payload.description,
        )
        self.session.add(dorm)
        await self.session.flush()
        for i in range(1, payload.bed_count + 1):
            self.session.add(
                Bed(dorm_id=dorm.id, property_id=prop.id, bed_number=f"Bed {i:02d}")
            )
        if zone:
            self._record(user, "dorm", dorm.id, prop.id, to_zone=zone.id,
                         to_area=area_id)
        await self._commit()
        return await self._reload_dorm(dorm.id)

    async def update_dorm(
        self, user: User, dorm_id: uuid.UUID, payload: DormUpdateRequest
    ) -> Dorm:
        dorm, _ = await self._get(
            Dorm, dorm_id, user, options=[selectinload(Dorm.beds)]
        )
        data = payload.model_dump(exclude_unset=True)

        if "zone_uid" in data:
            zone = await self._zone_in_property(data.pop("zone_uid"), dorm.property_id)
            from_zone, from_area = dorm.zone_id, dorm.area_id
            dorm.zone_id = zone.id if zone else None
            if zone:
                dorm.area_id = zone.area_id
            if from_zone != dorm.zone_id:
                self._record(user, "dorm", dorm.id, dorm.property_id,
                             from_zone=from_zone, to_zone=dorm.zone_id,
                             from_area=from_area, to_area=dorm.area_id)
        if "area_uid" in data:
            dorm.area_id = await self._area_in_property(
                data.pop("area_uid"), dorm.property_id
            )
        if "bed_count" in data and data["bed_count"] is not None:
            target = data.pop("bed_count")
            await self._resize_beds(user, dorm, target)
        for k, v in data.items():
            setattr(dorm, k, v)
        await self._commit()
        return await self._reload_dorm(dorm.id)

    async def _resize_beds(self, user: User, dorm: Dorm, target: int) -> None:
        """Grow → append new beds. Shrink → remove only 'available' beds from
        the tail; occupied/cleaning/maintenance beds are marked 'inactive'
        instead of destroyed."""
        active_beds = [b for b in dorm.beds if b.status != "inactive"]
        current = len(active_beds)
        if target == current:
            return
        if target > current:
            for i in range(current + 1, target + 1):
                self.session.add(
                    Bed(dorm_id=dorm.id, property_id=dorm.property_id,
                        bed_number=f"Bed {i:02d}")
                )
            await self.session.flush()
            return
        # shrink — drop from the tail
        removable = target
        for bed in sorted(active_beds, key=lambda b: b.bed_number, reverse=True):
            if len([b for b in active_beds]) <= removable:
                break
            if bed.status == "available":
                await self.session.delete(bed)
            else:
                bed.status = "inactive"  # has occupants/history — keep the row
            active_beds.remove(bed)
        await self.session.flush()

    async def delete_dorm(self, user: User, dorm_id: uuid.UUID) -> None:
        dorm, _ = await self._get(
            Dorm, dorm_id, user, options=[selectinload(Dorm.beds)]
        )
        occupied = [b.bed_number for b in dorm.beds if b.status == "occupied"]
        if occupied:
            raise ConflictErr(
                f"Cannot delete dorm with occupied beds: {', '.join(sorted(occupied))}."
            )
        await self.session.delete(dorm)
        await self._commit()

    async def dorm_checkout(self, user: User, dorm_id: uuid.UUID) -> Dorm:
        dorm, _ = await self._get(
            Dorm, dorm_id, user, options=[selectinload(Dorm.beds)]
        )
        changed = [b for b in dorm.beds if b.status == "occupied"]
        for bed in changed:
            bed.status = "cleaning"
            bed.guest_name = None
        await self._commit()
        await self._fire_automation(user, dorm.property_id, "bed_marked_cleaning",
                                    dorm.zone_id)
        prop = await self.session.get(Property, dorm.property_id)
        if prop and changed:
            await self._generate_cleaning_tasks(user, prop, "checkout", [], changed)
            await self._commit()
        return await self._reload_dorm(dorm.id)

    async def dorm_mark_cleaning(self, user: User, dorm_id: uuid.UUID) -> Dorm:
        dorm, _ = await self._get(
            Dorm, dorm_id, user, options=[selectinload(Dorm.beds)]
        )
        for bed in dorm.beds:
            if bed.status == "available":
                bed.status = "cleaning"
        await self._commit()
        return await self._reload_dorm(dorm.id)

    async def update_bed_status(
        self, user: User, bed_id: uuid.UUID, status: str, guest_name=None
    ) -> Dorm:
        res = await self.session.execute(
            select(Bed).where(Bed.id == bed_id).options(selectinload(Bed.dorm))
        )
        bed = res.scalar_one_or_none()
        if bed is None:
            raise NotFoundErr()
        await self._property_for_write(user, bed.property_id or bed.dorm.property_id)
        if status not in BED_STATUSES:
            raise ValidationErr(f"Invalid bed status '{status}'.", field="status")
        prev = bed.status
        bed.status = status
        bed.guest_name = guest_name if status == "occupied" else None
        await self._commit()
        prop_id = bed.property_id or bed.dorm.property_id
        if prev == "occupied" and status in ("available", "cleaning"):
            await self._fire_automation(user, prop_id, "bed_available_after_checkout",
                                        bed.dorm.zone_id)
        if status == "cleaning":
            await self._fire_automation(user, prop_id, "bed_marked_cleaning",
                                        bed.dorm.zone_id)
        return await self._reload_dorm(bed.dorm_id)

    async def _reload_dorm(self, dorm_id: uuid.UUID) -> Dorm:
        res = await self.session.execute(
            select(Dorm)
            .where(Dorm.id == dorm_id)
            .options(selectinload(Dorm.beds))
            .execution_options(populate_existing=True)  # refresh stale collections
        )
        return res.scalar_one()

    # ------------------------------------------------------------------
    # Bulk unit status (rooms + beds in one call)
    # ------------------------------------------------------------------

    async def bulk_unit_status(
        self, user: User, payload: BulkUnitStatusRequest
    ) -> dict:
        prop = await self._property_for_write(user, payload.property_uid)
        target = {
            "checkout": "cleaning",   # checkout → unit needs cleaning
            "cleaning": "cleaning",
            "available": "available",
            "maintenance": "maintenance",
        }.get(payload.action)
        if target is None:
            raise ValidationErr("action must be checkout|cleaning|available|maintenance",
                                field="action")

        rooms = dorms = beds = []
        skipped_blocked: list[str] = []
        prev_bed_status: dict[uuid.UUID, str] = {}
        if payload.room_uids:
            res = await self.session.execute(
                select(Room).where(
                    Room.id.in_(payload.room_uids), Room.property_id == prop.id
                )
            )
            rooms = list(res.scalars())
            if target == "available":
                # status is derived from active work — a room with blocking
                # tickets stays unavailable; staff can cancel/close the work
                # first if the release is genuinely intended. Occupied rooms
                # are never touched here (checkout is the only exit).
                from app.services.ops_status import OpsStatusService
                ops = OpsStatusService(self.session)
                for r in rooms:
                    if r.status == "occupied":
                        continue
                    new = await ops.refresh_room(
                        r.id, release_to="available",
                        actor_name=user.name,
                        trigger="manual available request",
                    )
                    if new is None and r.status in ("cleaning", "maintenance"):
                        skipped_blocked.append(r.room_number)
                    elif r.status == "available":
                        r.current_guest = None
            else:
                for r in rooms:
                    r.status = target
        if payload.bed_uids:
            res = await self.session.execute(
                select(Bed)
                .where(Bed.id.in_(payload.bed_uids))
                .options(selectinload(Bed.dorm))
            )
            beds = [b for b in res.scalars() if b.dorm.property_id == prop.id]
            prev_bed_status = {b.id: b.status for b in beds}
            if target == "available":
                from app.services.ops_status import OpsStatusService
                ops = OpsStatusService(self.session)
                for b in beds:
                    if b.status == "occupied":
                        continue
                    new = await ops.refresh_bed(
                        b.id, release_to="available",
                        actor_name=user.name,
                        trigger="manual available request",
                    )
                    if new is None and b.status in ("cleaning", "maintenance"):
                        skipped_blocked.append(f"Bed {b.bed_number}")
                    elif b.status == "available":
                        b.guest_name = None
            else:
                for b in beds:
                    b.status = target
            dorm_ids = {b.dorm_id for b in beds}
            res = await self.session.execute(
                select(Dorm).where(Dorm.id.in_(dorm_ids)).options(selectinload(Dorm.beds))
            )
            dorms = list(res.scalars())
        await self._commit()

        generated = []
        if target == "cleaning":
            # flagging a unit for cleaning produces real work — one task per
            # room / per dorm, allocated to that zone's floor employee
            generated = await self._generate_cleaning_tasks(
                user, prop, payload.action, rooms, beds
            )
            # bed automation parity with update_bed_status / dorm_checkout
            for b in beds:
                if (payload.action == "checkout"
                        and prev_bed_status.get(b.id) == "occupied"):
                    await self._fire_automation(
                        user, prop.id, "bed_available_after_checkout",
                        b.dorm.zone_id)
                await self._fire_automation(
                    user, prop.id, "bed_marked_cleaning", b.dorm.zone_id)
            # activate the room_checked_out trigger for configured rules
            if payload.action == "checkout":
                for r in rooms:
                    await self._fire_automation(
                        user, prop.id, "room_checked_out", r.zone_id)
            await self._commit()
        return {"rooms": rooms, "dorms": dorms, "generated_tasks": generated,
                "skipped_blocked": skipped_blocked}

    async def _generate_cleaning_tasks(
        self, user: User, prop: Property, action: str,
        rooms: list[Room], beds: list[Bed],
    ) -> list[Task]:
        """One cleaning task per room / per dorm — ROUND-ROBIN per unit:
        every unit gets its own allocation step, so the zone pool's
        persistent pointer advances per room (201→A, 202→B, 203→C, 204→A…)
        and repeated bulk operations continue the rotation instead of
        restarting at the first employee. Units already holding an open
        cleaning task are skipped WITHOUT consuming a rotation step."""
        from collections import defaultdict

        from app.services.task import IST
        from app.services.work_allocation import WorkAllocationService

        label = "Checkout cleaning" if action == "checkout" else "Cleaning"
        allocs = WorkAllocationService(self.session)
        today = datetime.now(IST).date().isoformat()
        generated: list[Task] = []
        zone_names: dict[uuid.UUID | None, str | None] = {}

        async def zname(zone_id):
            if zone_id not in zone_names:
                zn = await self.session.get(Zone, zone_id) if zone_id else None
                zone_names[zone_id] = zn.name if zn else None
            return zone_names[zone_id]

        async def alloc_for(zone_id):
            return await allocs.allocate(
                user, property_id=prop.id, zone_id=zone_id,
                zone_name=await zname(zone_id), work_type="task",
                manager_employee_id=prop.manager_employee_id,
            )

        # One task per room — each room is an independent allocation unit.
        for r in rooms:
            title = f"{label} — Room {r.room_number}"
            if await self._has_open_cleaning(prop.id, r.id, title):
                continue  # already queued — don't consume a rotation step
            alloc = await alloc_for(r.zone_id)
            t = await self._spawn_cleaning_task(
                user, prop, allocs, title=title, zone_id=r.zone_id,
                room=r, alloc=alloc, today=today,
            )
            if t:
                generated.append(t)

        # One task per dorm (its beds covered by the same cleaning task).
        dorms: dict[uuid.UUID, list[Bed]] = defaultdict(list)
        for b in beds:
            dorms[b.dorm_id].append(b)
        for dorm_beds in dorms.values():
            dorm = dorm_beds[0].dorm
            nums = ", ".join(sorted(b.bed_number for b in dorm_beds))
            title = f"{label} — {dorm.name or 'Dorm'} ({nums})"
            if await self._has_open_cleaning(prop.id, None, title):
                continue
            alloc = await alloc_for(dorm.zone_id)
            t = await self._spawn_cleaning_task(
                user, prop, allocs, title=title, zone_id=dorm.zone_id,
                room=None, alloc=alloc, today=today,
            )
            if t:
                generated.append(t)
        return generated

    async def _has_open_cleaning(self, property_id, room_id, title) -> bool:
        """Dedupe — an identical OPEN cleaning task means the unit is
        already queued for work; never create a second ticket."""
        res = await self.session.execute(
            select(Task.id).where(
                Task.property_id == property_id,
                Task.title == title,
                Task.room_id == room_id,
                Task.status.not_in(("completed", "cancelled")),
            )
        )
        return res.scalar_one_or_none() is not None

    async def _spawn_cleaning_task(
        self, user: User, prop: Property, allocs, *,
        title: str, zone_id, room, alloc, today: str,
    ) -> Task | None:
        """Create one cleaning task for the allocation result."""
        from sqlalchemy.exc import IntegrityError

        from app.models.task import TaskHistoryEvent
        from app.services.maintenance import next_ticket_number

        emp_id = alloc.employee.id if alloc.employee else None
        emp_name = alloc.employee.name if alloc.employee else None
        t = Task(
            property_id=prop.id,
            ticket_number=await next_ticket_number(self.session, "task"),
            zone_id=zone_id,
            room_id=room.id if room else None,
            room_number=room.room_number if room else None,
            employee_id=emp_id,
            assigned_to_name=emp_name,
            title=title,
            task_type="fixed",
            status="assigned" if emp_id else "pending",
            priority="medium",
            due_date=today,
            created_by_name=user.name,
            allocation_batch_id=alloc.batch.id if alloc else None,
            allocation_status="auto_assigned" if emp_id else "unassigned",
            allocation_method=alloc.method if alloc else None,
            allocation_reason=alloc.reason if alloc else None,
        )
        self.session.add(t)
        # append while transient — avoids a lazy-load hit and keeps the
        # in-memory collection populated for task_out serialization
        t.history.append(TaskHistoryEvent(
            type="auto_generated", actor_name=user.name,
            note=f"Generated — {title} flagged from the zone board",
        ))
        try:
            async with self.session.begin_nested():  # SAVEPOINT — one dup
                await self.session.flush()           # can't kill the batch
        except IntegrityError:
            # uq_tasks_open_room_title — a concurrent request won the same
            # (property, room, title) slot; dedupe instead of duplicating
            return None
        allocs.record(
            property_id=prop.id, zone_id=zone_id,
            batch=alloc.batch if alloc else None,
            ticket_kind="task", ticket_id=t.id,
            ticket_number=t.ticket_number,
            employee_id=emp_id, employee_name=emp_name,
            method=alloc.method if alloc else "manual",
            reason=alloc.reason if alloc else None,
            actor_name=user.name,
        )
        return t

    # ------------------------------------------------------------------
    # Dedicated allocation endpoints
    # ------------------------------------------------------------------

    async def allocate_unit(
        self, user: User, model, entity_id: uuid.UUID, area_uid, zone_uid
    ):
        entity, _ = await self._get(model, entity_id, user)
        zone = await self._zone_in_property(zone_uid, entity.property_id)
        area_id = await self._area_in_property(area_uid, entity.property_id)
        if zone is not None and area_uid is None:
            area_id = zone.area_id
        from_zone, from_area = entity.zone_id, entity.area_id
        entity.zone_id = zone.id if zone else None
        entity.area_id = area_id
        if from_zone != entity.zone_id or from_area != entity.area_id:
            self._record(
                user, model.__name__.lower(), entity.id, entity.property_id,
                from_zone=from_zone, to_zone=entity.zone_id,
                from_area=from_area, to_area=entity.area_id,
            )
        await self._commit()
        return entity

    async def _commit(self):
        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise ConflictErr("A conflicting record already exists.") from exc
