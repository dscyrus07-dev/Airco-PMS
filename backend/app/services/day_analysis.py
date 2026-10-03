"""Task calendar + operational-day analysis — read-only aggregations.

A task belongs to the operational day containing its anchor: stamped
`operational_date` (abandoned rows), else `due_date`, else `created_at` —
all evaluated against the company's configured IST day-start
(`services/rollover.py::_task_anchor_key` is the single implementation).

The calendar month view and the per-day breakdown share the same row
fetch so both surfaces always agree.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.structure import Area, Zone
from app.models.task import Task, TaskCompletionSubmission, TaskHistoryEvent
from app.models.template import WorkTemplate
from app.models.user import User
from app.models.work_allocation import WorkAllocationHistory

from .rollover import (
    OPEN_STATUSES,
    _task_anchor_key,
    current_operational_day,
    parse_day_start,
)
from .task_ops import TaskOpsService

IST_DATE_LEN = 10  # 'YYYY-MM-DD'


def _category(work_type: str | None) -> str:
    """Map the existing work_type vocabulary onto the report categories —
    no new category system is introduced."""
    return {
        "maintenance": "Maintenance",
        "cleaning": "Housekeeping",
        "housekeeping": "Housekeeping",
        "inspection": "Checklist",
        "checklist": "Checklist",
        "operations": "Operations",
    }.get((work_type or "").lower(), "Other")


def _month_bounds(month: str) -> tuple[datetime, datetime]:
    """Aware-UTC bounds covering every IST instant whose op-day key can
    fall inside the calendar month (±1 day margin for boundary shifts)."""
    y, m = (int(p) for p in month.split("-"))
    first = date(y, m, 1)
    nxt = date(y + (m == 12), 1 if m == 12 else m + 1, 1)
    lo = datetime(first.year, first.month, first.day, tzinfo=timezone.utc) \
        - timedelta(days=2)
    hi = datetime(nxt.year, nxt.month, nxt.day, tzinfo=timezone.utc) \
        + timedelta(days=2)
    return lo, hi


def _empty_bucket() -> dict:
    return {
        "generated": 0, "allocated": 0, "completed": 0,
        "abandoned": 0, "active": 0, "employees": set(),
    }


def _close_bucket(b: dict) -> dict:
    completed = b["completed"]
    denom = b["allocated"] or b["generated"]
    b = {k: v for k, v in b.items()}
    b["employees_involved"] = len(b.pop("employees"))
    b["completion_rate"] = round(100 * completed / denom, 1) if denom else 0.0
    return b


class DayAnalysisService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.ops = TaskOpsService(session)

    async def _scoped(self, user: User, property_id):
        """Property + the company's operational-day start (IST)."""
        prop = await self.ops._property(user, property_id)
        from app.models.company import Company
        company = await self.session.get(Company, prop.company_id)
        start = parse_day_start(
            company.operational_day_start if company else None
        )
        return prop, start

    async def _anchored_rows(
        self, prop, prefix: str, start
    ) -> list[tuple[Task, str]]:
        """Tasks of the property whose op-day key starts with `prefix`
        ('YYYY-MM' or 'YYYY-MM-DD'), each paired with its computed key."""
        lo, hi = _month_bounds(prefix[:7])
        res = await self.session.execute(
            select(Task).where(
                Task.property_id == prop.id,
                or_(
                    Task.operational_date.like(f"{prefix}%"),
                    Task.due_date.like(f"{prefix}%"),
                    and_(
                        Task.created_at >= lo,
                        Task.created_at < hi,
                    ),
                ),
            )
        )
        rows = []
        for t in res.scalars():
            key = _task_anchor_key(t, start)
            if key and key.startswith(prefix):
                rows.append((t, key))
        return rows

    # ------------------------------------------------------------------
    # Calendar month view
    # ------------------------------------------------------------------

    async def calendar(
        self, user: User, property_id: uuid.UUID | None, month: str
    ) -> dict:
        """Per-day activity counts for one calendar month of op-days."""
        try:
            y, m = (int(p) for p in month.split("-"))
            date(y, m, 1)
        except (ValueError, AttributeError):
            from app.services.structure import ValidationErr
            raise ValidationErr("month must be YYYY-MM.")

        prop, start = await self._scoped(user, property_id)
        rows = await self._anchored_rows(prop, month, start)

        days: dict[str, dict] = {}
        for task, key in rows:
            d = days.setdefault(key, {
                "date": key, "generated": 0, "allocated": 0,
                "completed": 0, "abandoned": 0, "active": 0,
            })
            d["generated"] += 1
            if task.employee_id or task.allocation_status in (
                "auto_assigned", "manually_assigned"
            ):
                d["allocated"] += 1
            if task.status == "completed":
                d["completed"] += 1
            elif task.status == "abandoned":
                d["abandoned"] += 1
            elif task.status in OPEN_STATUSES:
                d["active"] += 1

        now_utc = datetime.now(timezone.utc)
        return {
            "month": month,
            "today": current_operational_day(now_utc, start),
            "operational_day_start": start.strftime("%H:%M"),
            "days": [days[k] for k in sorted(days)],
        }

    # ------------------------------------------------------------------
    # Daily analysis
    # ------------------------------------------------------------------

    async def day(
        self, user: User, property_id: uuid.UUID | None, day: str
    ) -> dict:
        """Full analysis for one operational day (its YYYY-MM-DD key)."""
        try:
            date.fromisoformat(day)
        except (ValueError, AttributeError):
            from app.services.structure import ValidationErr
            raise ValidationErr("date must be YYYY-MM-DD.")

        prop, start = await self._scoped(user, property_id)
        rows = await self._anchored_rows(prop, day, start)
        tasks = [t for t, _ in rows]

        # ---- related lookups -------------------------------------------
        task_ids = [t.id for t in tasks]
        hist: dict[uuid.UUID, list[TaskHistoryEvent]] = {}
        alloc_first: dict[uuid.UUID, datetime] = {}
        worker_by_task: dict[uuid.UUID, str] = {}
        if task_ids:
            res = await self.session.execute(
                select(TaskHistoryEvent)
                .where(TaskHistoryEvent.task_id.in_(task_ids))
                .order_by(TaskHistoryEvent.at)
            )
            for ev in res.scalars():
                hist.setdefault(ev.task_id, []).append(ev)
            res = await self.session.execute(
                select(WorkAllocationHistory)
                .where(
                    WorkAllocationHistory.ticket_kind == "task",
                    WorkAllocationHistory.ticket_id.in_(task_ids),
                )
                .order_by(WorkAllocationHistory.created_at)
            )
            for a in res.scalars():
                alloc_first.setdefault(a.ticket_id, a.created_at)
            res = await self.session.execute(
                select(TaskCompletionSubmission)
                .where(TaskCompletionSubmission.task_id.in_(task_ids))
                .order_by(TaskCompletionSubmission.submitted_at)
            )
            for s in res.scalars():
                if s.employee_name:
                    worker_by_task[s.task_id] = s.employee_name

        zone_ids = {t.zone_id for t in tasks if t.zone_id}
        area_ids = {t.area_id for t in tasks if t.area_id}
        tpl_ids = {t.template_id for t in tasks if t.template_id}
        emp_ids = {t.employee_id for t in tasks if t.employee_id}

        zones = {z.id: z for z in (await self.session.execute(
            select(Zone).where(Zone.id.in_(zone_ids)))).scalars()} \
            if zone_ids else {}
        # Zone can imply the area when the task row doesn't carry one.
        for t in tasks:
            if t.area_id is None and t.zone_id in zones:
                z = zones[t.zone_id]
                if getattr(z, "area_id", None):
                    t._resolved_area_id = z.area_id
                    area_ids.add(z.area_id)
        areas = {a.id: a for a in (await self.session.execute(
            select(Area).where(Area.id.in_(area_ids)))).scalars()} \
            if area_ids else {}
        templates = {t.id: t for t in (await self.session.execute(
            select(WorkTemplate).where(WorkTemplate.id.in_(tpl_ids))
        )).scalars()} if tpl_ids else {}
        employees = {e.id: e for e in (await self.session.execute(
            select(Employee).where(Employee.id.in_(emp_ids)))).scalars()} \
            if emp_ids else {}

        # ---- per-task detail rows --------------------------------------
        items = []
        summary = _empty_bucket()
        zones_agg: dict[str, dict] = {}
        areas_agg: dict[str, dict] = {}
        cats_agg: dict[str, dict] = {}
        emps_agg: dict[uuid.UUID, dict] = {}
        resources: set[tuple] = set()

        for t in tasks:
            events = hist.get(t.id, [])
            first = lambda *types: next(
                (e.at for e in events if e.type in types), None
            )
            generated_at = t.created_at
            allocated_at = first("allocated", "reassigned") \
                or alloc_first.get(t.id)
            started_at = first("started")
            worker = worker_by_task.get(t.id) or (
                next(
                    (e.actor_name for e in reversed(events)
                     if e.type in ("submitted", "completed") and e.actor_name),
                    None,
                )
            )
            allocated = bool(
                t.employee_id
                or allocated_at
                or t.allocation_status
                in ("auto_assigned", "manually_assigned")
            )
            active = t.status in OPEN_STATUSES
            zone_name = zones[t.zone_id].name if t.zone_id in zones else None
            area_id = t.area_id or getattr(t, "_resolved_area_id", None)
            area_name = areas[area_id].name if area_id in areas else None
            category = _category(t.work_type)
            emp = employees.get(t.employee_id)
            emp_name = t.assigned_to_name or (emp.name if emp else None)
            if t.room_number:
                resource_label = f"Room {t.room_number}"
            elif t.dorm_name:
                resource_label = t.dorm_name
            elif t.washroom_id or t.washroom_name:
                resource_label = (t.washroom_name or "") + (
                    f" / {t.washroom_fixture_label}"
                    if t.washroom_fixture_label else ""
                ) or None
            else:
                resource_label = None

            items.append({
                "task_uid": str(t.id),
                "ticket_number": t.ticket_number,
                "title": t.title,
                "status": t.status,
                "priority": t.priority,
                "task_type": t.task_type,
                "work_type": t.work_type,
                "category": category,
                "origin": t.origin,
                "template_name": templates[t.template_id].name
                if t.template_id in templates else None,
                "assigned_employee_uid": str(t.employee_id)
                if t.employee_id else None,
                "assigned_employee": emp_name,
                "actual_worker": worker or emp_name,
                "zone_uid": str(t.zone_id) if t.zone_id else None,
                "zone_name": zone_name,
                "area_uid": str(area_id) if area_id else None,
                "area_name": area_name,
                "resource": resource_label,
                "room_number": t.room_number,
                "dorm_name": t.dorm_name,
                "washroom_name": t.washroom_name,
                "scheduled_for": t.scheduled_for,
                "expires_at": t.expires_at,
                "generated_at": generated_at,
                "allocated_at": allocated_at,
                "started_at": started_at,
                "submitted_at": t.submitted_at,
                "completed_at": t.completed_at,
                "abandoned": t.status == "abandoned",
                "abandoned_at": t.abandoned_at,
                "abandoned_reason": t.abandoned_reason,
                "abandoned_from_status": t.abandoned_from_status,
                "auto_abandoned": t.abandoned_reason in {
                    "SYSTEM_DAILY_ROLLOVER", "NEXT_SCHEDULED_OCCURRENCE"},
                "allocation_method": t.allocation_method,
                "allocation_batch_uid": str(t.allocation_batch_id)
                if t.allocation_batch_id else None,
            })

            # ---- aggregates -------------------------------------------
            summary["generated"] += 1
            for agg, key in (
                (zones_agg, zone_name or "Unzoned"),
                (areas_agg, area_name or "Unassigned"),
                (cats_agg, category),
            ):
                b = agg.setdefault(key, _empty_bucket())
                b["generated"] += 1
                if allocated:
                    b["allocated"] += 1
                if t.status == "completed":
                    b["completed"] += 1
                elif t.status == "abandoned":
                    b["abandoned"] += 1
                elif active:
                    b["active"] += 1
                if t.employee_id:
                    b["employees"].add(t.employee_id)

            if allocated:
                summary["allocated"] += 1
            if t.status == "completed":
                summary["completed"] += 1
            elif t.status == "abandoned":
                summary["abandoned"] += 1
            elif active:
                summary["active"] += 1
            if t.employee_id:
                summary["employees"].add(t.employee_id)
            res_key = t.room_id or t.dorm_id or t.washroom_id \
                or t.washroom_fixture_id
            if res_key:
                resources.add(("resource", res_key))

            if t.employee_id:
                eb = emps_agg.setdefault(t.employee_id, {
                    "employee_uid": str(t.employee_id),
                    "employee": emp_name,
                    "allocated": 0, "completed": 0,
                    "abandoned": 0, "active": 0,
                    "zones": set(), "areas": set(), "work": [],
                })
                eb["allocated"] += 1
                if t.status == "completed":
                    eb["completed"] += 1
                elif t.status == "abandoned":
                    eb["abandoned"] += 1
                elif active:
                    eb["active"] += 1
                if zone_name:
                    eb["zones"].add(zone_name)
                if area_name:
                    eb["areas"].add(area_name)
                label = resource_label or t.title
                if label:
                    eb["work"].append(
                        f"{label} — {t.title}"
                        if resource_label else t.title
                    )

        completion_denom = summary["allocated"] or summary["generated"]
        out_summary = {
            "generated": summary["generated"],
            "allocated": summary["allocated"],
            "completed": summary["completed"],
            "abandoned": summary["abandoned"],
            "active": summary["active"],
            "completion_rate": round(
                100 * summary["completed"] / completion_denom, 1
            ) if completion_denom else 0.0,
            "employees_involved": len(summary["employees"]),
            "resources_processed": len(resources),
        }

        def _named(agg: dict, label_key: str) -> list:
            out = []
            for name, b in agg.items():
                row = _close_bucket(b)
                row.pop("employees_involved", None)
                out.append({label_key: name, **row})
            return sorted(out, key=lambda r: -r["generated"])

        return {
            "date": day,
            "operational_day_start": start.strftime("%H:%M"),
            "is_today": day == current_operational_day(
                datetime.now(timezone.utc), start
            ),
            "summary": out_summary,
            "tasks": sorted(
                items,
                key=lambda r: (r["generated_at"] or datetime.min.replace(
                    tzinfo=timezone.utc),),
                reverse=True,
            ),
            "employees": sorted(
                (
                    {
                        **{k: v for k, v in e.items()
                           if k not in ("zones", "areas", "work")},
                        "zones": sorted(e["zones"]),
                        "areas": sorted(e["areas"]),
                        "work": e["work"],
                        "completion_rate": round(
                            100 * e["completed"] / e["allocated"], 1
                        ) if e["allocated"] else 0.0,
                    }
                    for e in emps_agg.values()
                ),
                key=lambda r: -r["allocated"],
            ),
            "zones": _named(zones_agg, "zone"),
            "areas": _named(areas_agg, "area"),
            "categories": _named(cats_agg, "category"),
        }
