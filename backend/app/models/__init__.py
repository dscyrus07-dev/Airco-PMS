"""ORM models — shared declarative base plus entities."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""


from app.models.company import Company  # noqa: E402, F401
from app.models.user import User, UserRole  # noqa: E402, F401
from app.models.refresh_token import RefreshToken  # noqa: E402, F401
from app.models.property import Property  # noqa: E402, F401
from app.models.structure import Area, Zone, Room, Dorm, Bed  # noqa: E402, F401
from app.models.employee import Employee  # noqa: E402, F401
from app.models.work_allocation import (  # noqa: E402, F401
    WorkAllocationBatch,
    WorkAllocationHistory,
    ZoneAllocationState,
)
from app.models.template import (  # noqa: E402, F401
    TemplateGeneration,
    WorkTemplate,
    WorkTemplateVersion,
)
from app.models.task import Task, TaskHistoryEvent  # noqa: E402, F401
from app.models.allocation import AllocationEvent  # noqa: E402, F401
from app.models.maintenance import (  # noqa: E402, F401
    MaintenanceTicket,
    MaintenanceTicketAttachment,
    MaintenanceTicketEvent,
)
