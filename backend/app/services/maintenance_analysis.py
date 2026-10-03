"""Maintenance calendar + operational-day analysis — read-only.

ROLLOVER POLICY (documented decision): maintenance tickets CARRY FORWARD
across operational days — they are never abandoned by the daily rollover.
A ticket records a real-world defect (a broken AC doesn't stop being
broken at 06:00); abandoning it would release the resource while the
issue is unresolved — the exact inconsistency ResourceStateService is
built to prevent. `cancelled` is the existing terminal-without-resolution
outcome and is reported as its own metric.

Consequently the analysis is WINDOW-based, not anchor-based: a ticket
belongs to an operational day if it was open during that day's window or
had any lifecycle event in it. Tickets raised earlier and still open
appear as `carried`. Status-at-day-end is replayed from the ticket's
event stream, so historical days remain accurate after later closes.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.company import Company
from app.models.employee import Employee
from app.models.maintenance import MaintenanceTicket, MaintenanceTicketEvent
from app.models.resource_state_event import ResourceStateEvent
from app.models.structure import (
    Area,
    Bed,
    Dorm,
    Room,
    Washroom,
    WashroomFixture,
    Zone,
)
from app.models.user import User

from .rollover import IST, current_operational_day, parse_day_start
from .task_ops import TaskOpsService

# Unresolved work — `resolved` is blocking for the RESOURCE but the work
# itself is done pending supervisor acknowledgement, so it is reported
# separately from genuinely open work.
OPEN_WORK = {"open", "assigned", "in_progress", "on_hold"}
TERMINAL = {"closed", "cancelled"}

# Event action → status it leaves the ticket in (replay for state-at-instant)
_EVENT_STATUS = {
    "started": "in_progress",
    "resumed": "in_progress",
    "disapproved": "in_progress",
    "held": "on_hold",
    "resolved": "resolved",
    "closed": "closed",
    "cancelled": "cancelled",
}


def _window(day: str, start: time) -> tuple[datetime, datetime]:
    """Aware-UTC bounds of the operational day `day` (IST wall clock)."""
    d = date.fromisoformat(day)
    ws = datetime.combine(d, start, tzinfo=IST).astimezone(timezone.utc)
    return ws, ws + timedelta(days=1)


def _aware(dt: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; Postgres returns aware. Treat naive
    as UTC so both backends compare consistently against window bounds."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _status_at(events: list[MaintenanceTicketEvent], instant: datetime) -> str:
    """Ticket status at `instant`, replayed from the ordered event stream."""
    st = "open"
    for ev in events:
        at = _aware(ev.created_at)
        if at is None or at > instant:
            break
        if ev.action == "assigned":
            st = "open" if (ev.comment or "") == "Unassigned" else "assigned"
        elif ev.action in _EVENT_STATUS:
            st = _EVENT_STATUS[ev.action]
    return st


def _open_at(events: list[MaintenanceTicketEvent], instant: datetime) -> bool:
    """True when no terminal event exists at or before `instant`."""
    return _status_at(events, instant) not in TERMINAL


def _first_at(events, *actions) -> datetime | None:
    for ev in events:
        if ev.action in actions:
            return _aware(ev.created_at)
    return None


def _last_at(events, *actions) -> datetime | None:
    ts = None
    for ev in events:
        if ev.action in actions:
            ts = _aware(ev.created_at)
    return ts


def _minutes(a: datetime | None, b: datetime | None) -> float | None:
    a, b = _aware(a), _aware(b)
    if not a or not b:
        return None
    return round((b - a).total_seconds() / 60, 1)


class MaintenanceAnalysisService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.ops = TaskOpsService(session)

    async def _scoped(self, user: User, property_id):
        prop = await self.ops._property(user, property_id)
        company = await self.session.get(Company, prop.company_id)
        start = parse_day_start(
            company.operational_day_start if company else None
        )
        return prop, start

    async def _tickets(self, prop, upto: datetime):
        """All tickets that could intersect the window — created before it
        ended, and not terminated before it began. Terminal filtering for
        `cancelled` (which sets no closed_at) is done in Python via events."""
        res = await self.session.execute(
            select(MaintenanceTicket)
            .where(
                MaintenanceTicket.property_id == prop.id,
                MaintenanceTicket.created_at < upto,
            )
            .options(selectinload(MaintenanceTicket.events))
            .order_by(MaintenanceTicket.created_at)
        )
        return list(res.scalars())

    # ------------------------------------------------------------------
    # Calendar month view
    # ------------------------------------------------------------------

    async def calendar(
        self, user: User, property_id: uuid.UUID | None, month: str
    ) -> dict:
        try:
            y, m = (int(p) for p in month.split("-"))
            date(y, m, 1)
        except (ValueError, AttributeError):
            from app.services.structure import ValidationErr
            raise ValidationErr("month must be YYYY-MM.")

        prop, start = await self._scoped(user, property_id)
        nxt = date(y + (m == 12), 1 if m == 12 else m + 1, 1)
        tickets = await self._tickets(
            prop,
            datetime(nxt.year, nxt.month, nxt.day, tzinfo=timezone.utc)
            + timedelta(days=1),
        )

        today_key = current_operational_day(
            datetime.now(timezone.utc), start
        )
        days: dict[str, dict] = {}
        days_in_month = (nxt - date(y, m, 1)).days
        for dnum in range(1, days_in_month + 1):
            key = date(y, m, dnum).isoformat()
            if key > today_key:
                continue  # never project open tickets into future days
            ws, we = _window(key, start)
            for t in tickets:
                created = _aware(t.created_at)
                if created >= we:
                    continue
                evs = t.events
                if not _open_at(evs, ws):
                    continue  # already closed/cancelled before this day
                d = days.setdefault(key, {
                    "date": key, "raised": 0, "carried": 0,
                    "resolved": 0, "closed": 0, "cancelled": 0,
                })
                if ws <= created < we:
                    d["raised"] += 1
                else:
                    d["carried"] += 1
                # per-ticket flags — a disapproved→re-resolved ticket counts
                # once, matching the day-analysis summary semantics
                in_window = {
                    ev.action for ev in evs
                    if ev.created_at and ws <= _aware(ev.created_at) < we
                }
                for action in ("resolved", "closed", "cancelled"):
                    if action in in_window:
                        d[action] += 1

        return {
            "month": month,
            "today": today_key,
            "operational_day_start": start.strftime("%H:%M"),
            "days": [days[k] for k in sorted(days)],
        }

    # ------------------------------------------------------------------
    # Daily analysis
    # ------------------------------------------------------------------

    async def day(
        self, user: User, property_id: uuid.UUID | None, day: str
    ) -> dict:
        try:
            date.fromisoformat(day)
        except (ValueError, AttributeError):
            from app.services.structure import ValidationErr
            raise ValidationErr("date must be YYYY-MM-DD.")

        prop, start = await self._scoped(user, property_id)
        ws, we = _window(day, start)

        members = [
            t for t in await self._tickets(prop, we)
            if _aware(t.created_at) < we and _open_at(t.events, ws)
        ]
        ids = [t.id for t in members]

        # ---- related lookups -------------------------------------------
        transitions: dict[uuid.UUID, list[ResourceStateEvent]] = {}
        if ids:
            res = await self.session.execute(
                select(ResourceStateEvent)
                .where(ResourceStateEvent.ticket_id.in_(ids))
                .order_by(ResourceStateEvent.created_at)
            )
            for e in res.scalars():
                transitions.setdefault(e.ticket_id, []).append(e)

        zone_ids = {t.zone_id for t in members if t.zone_id}
        emp_ids = {t.assigned_to for t in members if t.assigned_to}
        zones = {z.id: z for z in (await self.session.execute(
            select(Zone).where(Zone.id.in_(zone_ids)))).scalars()} \
            if zone_ids else {}
        employees = {e.id: e for e in (await self.session.execute(
            select(Employee).where(Employee.id.in_(emp_ids)))).scalars()} \
            if emp_ids else {}

        # Area: the ticket has no area column — resolve through its zone
        # first, then through the targeted resource's own area_id.
        res_ids = {
            kind: {getattr(t, f"{kind}_id") for t in members
                   if getattr(t, f"{kind}_id")}
            for kind in ("room", "dorm", "bed", "washroom")
        }
        resources: dict[tuple, object] = {}
        models = {"room": Room, "dorm": Dorm, "bed": Bed, "washroom": Washroom}
        for kind, ids_ in res_ids.items():
            if ids_:
                res = await self.session.execute(
                    select(models[kind]).where(models[kind].id.in_(ids_))
                )
                for r in res.scalars():
                    resources[(kind, r.id)] = r
        area_ids = {getattr(r, "area_id", None) for r in resources.values()}
        area_ids |= {z.area_id for z in zones.values()
                     if getattr(z, "area_id", None)}
        area_ids.discard(None)
        areas = {a.id: a for a in (await self.session.execute(
            select(Area).where(Area.id.in_(area_ids)))).scalars()} \
            if area_ids else {}

        # ---- per-ticket detail rows + aggregates ------------------------
        items = []
        summary = {
            "raised": 0, "carried": 0, "allocated": 0, "resolved": 0,
            "closed": 0, "cancelled": 0, "open_at_end": 0,
            "pending_review": 0,
        }
        zones_agg: dict[str, dict] = {}
        areas_agg: dict[str, dict] = {}
        cats_agg: dict[str, dict] = {}
        emps_agg: dict[uuid.UUID, dict] = {}
        employees_involved: set = set()
        zones_hit: set = set()
        res_hit: set = set()
        resolution_times: list[float] = []
        start_times: list[float] = []

        for t in members:
            evs = t.events
            created = _aware(t.created_at)
            raised_here = ws <= created < we
            allocated_at = _first_at(evs, "assigned")
            started_at = _first_at(evs, "started")
            resolved_ev_at = _last_at(evs, "resolved")
            cancelled_at = _last_at(evs, "cancelled")
            closed_at = _aware(t.closed_at) or _last_at(evs, "closed")
            resolved_at = _aware(t.resolved_at) or resolved_ev_at
            status_end = _status_at(evs, we - timedelta(seconds=1))
            worker = next(
                (e.actor_name for e in reversed(evs)
                 if e.action in ("started", "resolved") and e.actor_name),
                None,
            )

            zone = zones.get(t.zone_id)
            zone_name = zone.name if zone else None
            resource = resource_label = rtype = rid = None
            for kind, col, label_col in (
                ("room", t.room_id, t.room_number),
                ("bed", t.bed_id, t.bed_number),
                ("dorm", t.dorm_id, t.dorm_name),
                ("washroom", t.washroom_id, t.washroom_name),
            ):
                if col:
                    rtype, rid = kind, col
                    resource = resources.get((kind, col))
                    resource_label = label_col
                    break
            if rtype == "room" and resource_label:
                resource_label = f"Room {resource_label}"
            if t.washroom_fixture_label:
                resource_label = (
                    f"{resource_label} / {t.washroom_fixture_label}"
                    if resource_label else t.washroom_fixture_label
                )
            area_id = getattr(zone, "area_id", None) or getattr(
                resource, "area_id", None
            )
            area_name = areas[area_id].name if area_id in areas else None

            # resource impact — the audited prev→new chain + live state
            trans = transitions.get(t.id, [])
            first_flag = next(
                (e for e in trans if e.new_state == "maintenance"), None
            )
            last = trans[-1] if trans else None
            live_status = getattr(resource, "status", None)

            raised_m = _minutes(created, allocated_at)
            start_m = _minutes(created, started_at)
            res_m = _minutes(created, resolved_at)
            close_m = _minutes(created, closed_at)

            items.append({
                "ticket_uid": str(t.id),
                "ticket_number": t.ticket_number,
                "issue": t.issue,
                "maintenance_type": t.maintenance_type,
                "priority": t.priority,
                "status": t.status,
                "status_at_day_end": status_end,
                "raised_today": raised_here,
                "carried": not raised_here,
                "resource_type": rtype,
                "resource_label": resource_label,
                "zone_name": zone_name,
                "area_name": area_name,
                "assigned_employee_uid": str(t.assigned_to)
                if t.assigned_to else None,
                "assigned_employee": t.assigned_to_name
                or (employees[t.assigned_to].name
                    if t.assigned_to in employees else None),
                "actual_worker": worker,
                "reported_by": t.reported_by_name,
                "created_at": created,
                "allocated_at": allocated_at,
                "started_at": started_at,
                "resolved_at": resolved_at,
                "closed_at": closed_at,
                "cancelled_at": cancelled_at,
                "resolution_notes": t.resolution_notes,
                "allocation_method": t.allocation_method,
                "due_date": t.due_date,
                "time_to_allocate_min": raised_m,
                "time_to_start_min": start_m,
                "resolution_time_min": res_m,
                "close_time_min": close_m,
                "resource_was": first_flag.previous_state
                if first_flag else None,
                "resource_after": last.new_state if last else live_status,
                "resource_current": live_status,
                "resource_transitions": [
                    {
                        "at": e.created_at,
                        "from": e.previous_state,
                        "to": e.new_state,
                        "source": e.source,
                        "actor": e.actor_name,
                    }
                    for e in trans
                ],
            })

            # ---- aggregates ---------------------------------------------
            if raised_here:
                summary["raised"] += 1
            else:
                summary["carried"] += 1
            if allocated_at and ws <= allocated_at < we:
                summary["allocated"] += 1
            if resolved_ev_at and ws <= resolved_ev_at < we:
                summary["resolved"] += 1
            if closed_at and ws <= closed_at < we:
                summary["closed"] += 1
            if cancelled_at and ws <= cancelled_at < we:
                summary["cancelled"] += 1
            if status_end == "resolved":
                summary["pending_review"] += 1
            elif status_end in OPEN_WORK:
                summary["open_at_end"] += 1
            if res_m is not None and raised_here:
                resolution_times.append(res_m)
            if start_m is not None and raised_here:
                start_times.append(start_m)
            if t.assigned_to:
                employees_involved.add(t.assigned_to)
            if t.zone_id:
                zones_hit.add(t.zone_id)
            if rid:
                res_hit.add((rtype, rid))

            for agg, name in (
                (zones_agg, zone_name or "Unzoned"),
                (areas_agg, area_name or "Unassigned"),
                (cats_agg, (t.maintenance_type or "other").title()),
            ):
                b = agg.setdefault(name, {
                    "raised": 0, "allocated": 0, "resolved": 0,
                    "closed": 0, "cancelled": 0, "open_at_end": 0,
                    "employees": set(), "res_times": [],
                })
                b["raised"] += 1
                if t.assigned_to:
                    b["allocated"] += 1
                    b["employees"].add(t.assigned_to)
                if status_end in TERMINAL:
                    if status_end == "closed":
                        b["closed"] += 1
                    else:
                        b["cancelled"] += 1
                elif status_end == "resolved":
                    b["resolved"] += 1
                else:
                    b["open_at_end"] += 1
                if res_m is not None:
                    b["res_times"].append(res_m)

            if t.assigned_to:
                eb = emps_agg.setdefault(t.assigned_to, {
                    "employee_uid": str(t.assigned_to),
                    "employee": t.assigned_to_name
                    or (employees[t.assigned_to].name
                        if t.assigned_to in employees else None),
                    "tickets": 0, "resolved": 0, "closed": 0,
                    "cancelled": 0, "open": 0, "pending_review": 0,
                    "zones": set(), "areas": set(), "work": [],
                    "res_times": [],
                })
                eb["tickets"] += 1
                if status_end == "resolved":
                    eb["resolved"] += 1
                    eb["pending_review"] += 1
                elif status_end in TERMINAL:
                    eb["closed" if status_end == "closed"
                       else "cancelled"] += 1
                else:
                    eb["open"] += 1
                if zone_name:
                    eb["zones"].add(zone_name)
                if area_name:
                    eb["areas"].add(area_name)
                if resource_label:
                    eb["work"].append(f"{resource_label} — {t.issue}")
                if res_m is not None:
                    eb["res_times"].append(res_m)

        allocated_total = sum(
            1 for i in items if i["assigned_employee_uid"]
        )
        denom = allocated_total or len(items)
        out_summary = {
            **summary,
            "tickets": len(items),
            "allocated_total": allocated_total,
            "completion_rate": round(
                100 * summary["closed"] / denom, 1
            ) if denom else 0.0,
            "employees_involved": len(employees_involved),
            "zones_affected": len(zones_hit),
            "resources_affected": len(res_hit),
            "avg_resolution_min": round(
                sum(resolution_times) / len(resolution_times), 1
            ) if resolution_times else None,
            "avg_time_to_start_min": round(
                sum(start_times) / len(start_times), 1
            ) if start_times else None,
        }

        def _bucket_rows(agg: dict, label: str) -> list:
            rows = []
            for name, b in agg.items():
                done = b["closed"] + b["resolved"]
                rows.append({
                    label: name,
                    "raised": b["raised"], "allocated": b["allocated"],
                    "resolved": b["resolved"], "closed": b["closed"],
                    "cancelled": b["cancelled"],
                    "open": b["open_at_end"],
                    "employees_involved": len(b["employees"]),
                    "completion_rate": round(
                        100 * done / b["raised"], 1
                    ) if b["raised"] else 0.0,
                    "avg_resolution_min": round(
                        sum(b["res_times"]) / len(b["res_times"]), 1
                    ) if b["res_times"] else None,
                })
            return sorted(rows, key=lambda r: -r["raised"])

        return {
            "date": day,
            "operational_day_start": start.strftime("%H:%M"),
            "window_start_utc": ws.isoformat(),
            "window_end_utc": we.isoformat(),
            "is_today": ws <= datetime.now(timezone.utc) < we,
            "summary": out_summary,
            "tickets": sorted(
                items, key=lambda r: r["created_at"], reverse=True
            ),
            "employees": sorted(
                (
                    {
                        **{k: v for k, v in e.items()
                           if k not in ("zones", "areas", "work", "res_times")},
                        "zones": sorted(e["zones"]),
                        "areas": sorted(e["areas"]),
                        "work": e["work"],
                        "avg_resolution_min": round(
                            sum(e["res_times"]) / len(e["res_times"]), 1
                        ) if e["res_times"] else None,
                    }
                    for e in emps_agg.values()
                ),
                key=lambda r: -r["tickets"],
            ),
            "zones": _bucket_rows(zones_agg, "zone"),
            "areas": _bucket_rows(areas_agg, "area"),
            "categories": _bucket_rows(cats_agg, "category"),
        }
