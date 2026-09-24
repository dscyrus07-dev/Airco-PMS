"""Structural entities — Area (floor level), Zone, Room, Dorm, Bed."""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base


class Area(Base):
    """A structural level within a property (e.g. Ground Floor, Rooftop)."""

    __tablename__ = "areas"
    __table_args__ = (
        UniqueConstraint("property_id", "name", name="uq_areas_property_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    property_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(32), nullable=False)  # e.g. AREA-001
    level_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    zones: Mapped[list["Zone"]] = relationship(back_populates="area")


class Zone(Base):
    """A functional zone — only 'stay' zones may contain rooms/dorms/beds."""

    __tablename__ = "zones"
    __table_args__ = (
        UniqueConstraint("property_id", "name", name="uq_zones_property_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    property_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    area_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("areas.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(32), nullable=False)  # e.g. ZONE-001
    zone_type: Mapped[str] = mapped_column(String(32), nullable=False, default="stay")
    floor: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    area: Mapped[Area | None] = relationship(back_populates="zones")


class Room(Base):
    __tablename__ = "rooms"
    __table_args__ = (
        UniqueConstraint("property_id", "room_number", name="uq_rooms_property_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    property_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    zone_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("zones.id", ondelete="SET NULL"), nullable=True, index=True
    )
    area_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("areas.id", ondelete="SET NULL"), nullable=True, index=True
    )
    room_number: Mapped[str] = mapped_column(String(32), nullable=False)
    type: Mapped[str] = mapped_column(String(64), nullable=False, default="Private Room")
    area_sqft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # available | occupied | cleaning | maintenance
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="available")
    bed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    cleaning_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    current_guest: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Dorm(Base):
    __tablename__ = "dorms"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    property_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    zone_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("zones.id", ondelete="SET NULL"), nullable=True, index=True
    )
    area_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("areas.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    dorm_type: Mapped[str] = mapped_column(String(32), nullable=False, default="Mixed Dorm")
    washroom: Mapped[str] = mapped_column(String(32), nullable=False, default="Attached")
    floor: Mapped[str | None] = mapped_column(String(100), nullable=True)
    area_sqft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    beds: Mapped[list["Bed"]] = relationship(
        back_populates="dorm", cascade="all, delete-orphan", order_by="Bed.bed_number"
    )


class Bed(Base):
    __tablename__ = "beds"
    __table_args__ = (
        UniqueConstraint("dorm_id", "bed_number", name="uq_beds_dorm_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    dorm_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("dorms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    property_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("properties.id", ondelete="CASCADE"), nullable=True, index=True
    )
    bed_number: Mapped[str] = mapped_column(String(32), nullable=False)  # e.g. "Bed 01"
    # available | occupied | cleaning | maintenance | inactive
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="available")
    guest_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    dorm: Mapped[Dorm] = relationship(back_populates="beds")
