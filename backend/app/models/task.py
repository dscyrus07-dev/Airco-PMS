"""Tasks + audit history events."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, func, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    property_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    zone_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("zones.id", ondelete="SET NULL"), nullable=True, index=True
    )
    employee_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("employees.id", ondelete="SET NULL"), nullable=True, index=True
    )
    ticket_number: Mapped[str | None] = mapped_column(
        String(32), nullable=True, unique=True, index=True
    )  # TASK-YYYY-NNNNN — generated server-side
    room_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True, index=True
    )
    room_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    supervisor_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("employees.id", ondelete="SET NULL"), nullable=True, index=True
    )
    supervisor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    assigned_to_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    allocation_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("work_allocation_batches.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    # auto_assigned | manually_assigned | unassigned
    allocation_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="unassigned"
    )
    allocation_method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    allocation_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Work-template provenance (scheduler-generated tasks)
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("work_templates.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    template_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    task_type: Mapped[str] = mapped_column(String(32), nullable=False, default="fixed")
    # pending | in_progress | completed | overdue | scheduled
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    priority: Mapped[str] = mapped_column(String(32), nullable=False, default="medium")
    # Date (YYYY-MM-DD) or ISO timestamp for hourly schedules
    due_date: Mapped[str | None] = mapped_column(String(64), nullable=True)
    due_time: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # HH:MM — anchor time a repetitive schedule starts from each cycle
    start_time: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Repetition window — from date to end date (None = runs forever), and
    # an optional daily time window for multi-per-day recurrences
    recurrence_start_date: Mapped[str | None] = mapped_column(String(64), nullable=True)
    recurrence_end_date: Mapped[str | None] = mapped_column(String(64), nullable=True)
    recurrence_window_end: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    recurrence: Mapped[str | None] = mapped_column(String(32), nullable=True)
    recurrence_interval_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Repetitive-task lineage — all clones of one recurring series share the
    # root task's id. Lets the scheduler find the series head and dedupe
    # occurrences without relying on matching cloned fields.
    series_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Automation rule for task_type='automated' — JSON document
    automation_rule: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    history: Mapped[list["TaskHistoryEvent"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="TaskHistoryEvent.at"
    )


class TaskHistoryEvent(Base):
    __tablename__ = "task_history_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # allocated | started | completed | redo_requested | reassigned | edited | auto_generated
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    actor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    photos: Mapped[list | None] = mapped_column(JSON, nullable=True)

    task: Mapped[Task] = relationship(back_populates="history")
