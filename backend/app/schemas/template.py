"""Work template request/response schemas."""

import uuid

from pydantic import BaseModel, Field


class AssignmentConfig(BaseModel):
    mode: str = "automatic"  # team | individual | automatic
    team: str | None = None               # Housekeeping | Maintenance | …
    employee_uid: uuid.UUID | None = None
    supervisor_uid: uuid.UUID | None = None
    # zone_round_robin | supervisor — resolved by WorkAllocationService
    method: str | None = "zone_round_robin"


class LocationConfig(BaseModel):
    # property | zone | area | rooms | dorms | beds
    scope: str = "property"
    zone_uid: uuid.UUID | None = None
    area_uid: uuid.UUID | None = None
    room_uids: list[uuid.UUID] = Field(default_factory=list)
    dorm_uids: list[uuid.UUID] = Field(default_factory=list)
    bed_uids: list[uuid.UUID] = Field(default_factory=list)
    # dynamic expansion inside a zone/area: rooms | dorms | beds | units | none
    target: str | None = None


class ScheduleConfig(BaseModel):
    kind: str = "one_time"  # one_time | recurring
    timezone: str = "Asia/Kolkata"
    # one_time
    date: str | None = None               # YYYY-MM-DD
    time: str | None = None               # HH:MM
    end_time: str | None = None
    # recurring
    frequency: str | None = None          # hourly|daily|weekly|monthly|custom
    every: int = 1                        # every N hours/days/weeks
    custom_unit: str | None = None        # days | weeks | months (custom)
    start_time: str | None = None         # daily window start (hourly)
    window_end: str | None = None         # daily window end (hourly)
    weekdays: list[int] = Field(default_factory=list)  # 0=Mon … 6=Sun
    day_of_month: int | None = None
    relative_week: str | None = None      # first|second|third|fourth|last
    relative_weekday: int | None = None   # 0=Mon … 6=Sun
    start_date: str | None = None
    end_date: str | None = None


class ChecklistItem(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    required: bool = True


class VerificationConfig(BaseModel):
    mode: str = "self"  # self | checklist | supervisor | photo | photo_supervisor | none
    checklist_required: bool = False
    photo_required: bool = False
    min_photos: int = 1
    max_photos: int = 5
    supervisor_approval: bool = False
    before_photo: bool = False
    after_photo: bool = False


class OverdueConfig(BaseModel):
    # mark_overdue | notify_supervisor | notify_manager | escalate | auto_reassign
    actions: list[str] = Field(default_factory=lambda: ["mark_overdue"])
    threshold_minutes: int = 30
    reassign_method: str | None = None  # next_zone_employee | supervisor | manual


class NotificationConfig(BaseModel):
    notify_on_assignment: bool = True
    notify_on_completion: bool = False
    notify_on_overdue: bool = True
    remind_before_minutes: int | None = None  # 15 | 30 | 60 | 1440


class TemplateCreateRequest(BaseModel):
    property_uid: uuid.UUID
    name: str = Field(min_length=3, max_length=255)
    template_type: str = "task"
    description: str | None = Field(default=None, max_length=4000)
    category: str | None = Field(default=None, max_length=64)
    priority: str = "medium"
    duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    status: str = "draft"
    assignment: AssignmentConfig = Field(default_factory=AssignmentConfig)
    location: LocationConfig = Field(default_factory=LocationConfig)
    schedule: ScheduleConfig = Field(default_factory=ScheduleConfig)
    checklist: list[ChecklistItem] = Field(default_factory=list)
    verification: VerificationConfig = Field(default_factory=VerificationConfig)
    overdue: OverdueConfig = Field(default_factory=OverdueConfig)
    notifications: NotificationConfig = Field(default_factory=NotificationConfig)


class TemplateUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=255)
    template_type: str | None = None
    description: str | None = None
    category: str | None = None
    priority: str | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    status: str | None = None
    assignment: AssignmentConfig | None = None
    location: LocationConfig | None = None
    schedule: ScheduleConfig | None = None
    checklist: list[ChecklistItem] | None = None
    verification: VerificationConfig | None = None
    overdue: OverdueConfig | None = None
    notifications: NotificationConfig | None = None


def template_out(t) -> dict:
    return {
        "template_uid": str(t.id),
        "property_uid": str(t.property_id),
        "name": t.name,
        "template_type": t.template_type,
        "description": t.description,
        "category": t.category,
        "priority": t.priority,
        "duration_minutes": t.duration_minutes,
        "status": t.status,
        "version": t.version,
        "assignment": t.assignment,
        "location": t.location,
        "schedule": t.schedule,
        "checklist": t.checklist,
        "verification": t.verification,
        "overdue": t.overdue,
        "notifications": t.notifications,
        "next_run_at": t.next_run_at.isoformat() if t.next_run_at else None,
        "last_run_at": t.last_run_at.isoformat() if t.last_run_at else None,
        "generated_count": t.generated_count,
        "created_by_name": t.created_by_name,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }
