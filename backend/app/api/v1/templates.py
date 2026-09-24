"""
Work templates — reusable operational definitions + the generation tick.

The backend owns scheduling: templates store next_run_at, and
POST /templates/generate-due (also driven by the background loop) expands
due templates into real tasks/tickets via the shared allocation engine.
"""

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies.auth import get_current_user, require_property_manager
from app.models.user import User
from app.schemas.template import (
    TemplateCreateRequest,
    TemplateUpdateRequest,
    template_out,
)
from app.services.template import TemplateService

router = APIRouter()

Staff = Depends(require_property_manager)


def _uid(v: str | None) -> uuid.UUID | None:
    return uuid.UUID(v) if v else None


@router.post("/templates", status_code=status.HTTP_201_CREATED)
async def create_template(
    payload: TemplateCreateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return template_out(await TemplateService(session).create(user, payload))


@router.get("/templates")
async def list_templates(
    property_uid: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    template_type: str | None = Query(default=None),
    category: str | None = Query(default=None),
    search: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    items = await TemplateService(session).list_templates(
        user, _uid(property_uid), status_, template_type, category, search
    )
    return {"items": [template_out(t) for t in items], "total": len(items)}


@router.get("/templates/{template_id}")
async def get_template(
    template_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    return template_out(await TemplateService(session)._get_template(user, template_id))


@router.patch("/templates/{template_id}")
async def update_template(
    template_id: uuid.UUID,
    payload: TemplateUpdateRequest,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return template_out(await TemplateService(session).update(user, template_id, payload))


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    await TemplateService(session).delete(user, template_id)


@router.post("/templates/{template_id}/pause")
async def pause_template(
    template_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return template_out(await TemplateService(session).set_status(user, template_id, "paused"))


@router.post("/templates/{template_id}/resume")
async def resume_template(
    template_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return template_out(await TemplateService(session).set_status(user, template_id, "active"))


@router.post("/templates/{template_id}/activate")
async def activate_template(
    template_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return template_out(await TemplateService(session).set_status(user, template_id, "active"))


@router.post("/templates/{template_id}/archive")
async def archive_template(
    template_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return template_out(await TemplateService(session).set_status(user, template_id, "archived"))


@router.post("/templates/{template_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_template(
    template_id: uuid.UUID,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    return template_out(await TemplateService(session).duplicate(user, template_id))


@router.get("/templates/{template_id}/history")
async def template_history(
    template_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    return {"items": await TemplateService(session).history(user, template_id)}


@router.get("/templates/{template_id}/generated-work")
async def template_generated_work(
    template_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    return await TemplateService(session).generated_work(user, template_id)


@router.post("/templates/{template_id}/generate-occurrence")
async def generate_occurrence(
    template_id: uuid.UUID,
    payload: dict,
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    """'Generate Now' for one scheduled occurrence — validates, creates the
    task, runs the shared allocation engine, returns the task."""
    from app.services.task_ops import TaskOpsService
    from app.schemas.workspace import task_out
    task = await TaskOpsService(session).generate_occurrence(
        user, template_id, payload.get("occurrence_key", "")
    )
    return task_out(task)


@router.post("/templates/generate-due")
async def generate_due(
    user: User = Staff,
    session: AsyncSession = Depends(get_db),
):
    """Scheduler tick — also invoked by the background loop; exposed here so
    ops/tests can force a generation cycle. Idempotent via the ledger."""
    return await TemplateService(session).run_due()
