"""
import_old_generation.py — OLD-GENERATION schema → CURRENT schema data import.

Transforms data from the previous-generation AiROS database
(OLD_DATABASE_URL, read-only) into the current schema on the app's
configured database. Deterministic field mapping — see the mapping plan.

    OLD_DATABASE_URL=... python scripts/import_old_generation.py --dry-run
    OLD_DATABASE_URL=... python scripts/import_old_generation.py --execute \
        --confirm RESET-AND-IMPORT

No DDL. No credentials in code. Backup before write; single transaction;
any validation failure rolls back. Dropped (no target table): guests,
departments, leave_types, leave_requests, holidays, notifications.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
import uuid as uuidlib
from pathlib import Path

import asyncpg

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent))

import migrate_old_database as mig  # noqa: E402
from app.core.config import settings  # noqa: E402

DROP_TABLES = {"guests", "departments", "leave_types", "leave_requests",
               "holidays", "notifications"}

STATUS_ROOM = {"Available": "available", "Cleaning": "cleaning",
               "Maintenance": "maintenance", "Occupied": "occupied"}
STATUS_TASK = {"Pending": "pending", "In Progress": "in_progress",
               "Submitted": "submitted", "Completed": "completed",
               "Reopened": "reopened", "Cancelled": "cancelled"}
STATUS_TICKET = {"Reported": "open", "Assigned": "assigned",
                 "In Progress": "in_progress", "On Hold": "on_hold",
                 "Resolved": "closed", "Closed": "closed",
                 "Cancelled": "cancelled"}
STATUS_SUBMISSION = {"Pending": "pending", "Approved": "approved",
                     "Rejected": "rejected"}
DEPARTMENT_MAP = {"HK": "Housekeeping & Cleanliness",
                  "Housekeeping": "Housekeeping & Cleanliness"}
AVATAR_COLORS = ["#386641", "#6A994E", "#A7C957", "#BC4749", "#F2A65A",
                 "#457B9D", "#8338EC", "#FF006E"]


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", ".", s.lower()).strip(".") or "user"


async def fetch_all(conn, table):
    return [dict(r) for r in await conn.fetch(f'SELECT * FROM "{table}"')]


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--confirm", metavar="RESET-AND-IMPORT")
    args = ap.parse_args()
    if not (args.dry_run or args.execute):
        ap.error("specify --dry-run or --execute")
    if args.execute and args.confirm != "RESET-AND-IMPORT":
        ap.error("--execute requires --confirm RESET-AND-IMPORT")

    old_url = os.environ.get("OLD_DATABASE_URL", "").strip()
    if not old_url:
        print("FATAL: OLD_DATABASE_URL not set"); return 2
    new_url = settings.database_url
    if mig.dsn_host(old_url) == mig.dsn_host(new_url):
        print("FATAL: source and target are the same host"); return 2

    src = await mig.connect(old_url, readonly=True)
    dst = await mig.connect(new_url)
    try:
        # ---- load source ----
        s = {t: await fetch_all(src, t) for t in
             ["companies", "properties", "floors", "zones", "rooms", "beds",
              "employees", "users", "departments", "guest_stays", "guests",
              "tasks", "task_history", "task_submissions",
              "maintenance_requests", "audit_logs"]}

        user_by_id = {u["id"]: u for u in s["users"]}
        guest_by_id = {g["id"]: g for g in s["guests"]}
        dept_by_id = {d["id"]: d for d in s["departments"]}
        emp_by_id = {e["id"]: e for e in s["employees"]}
        room_by_id = {r["id"]: r for r in s["rooms"]}
        emp_user = {}  # employee_id -> user (linkage is users.employee_id)
        for u in s["users"]:
            if u["employee_id"]:
                emp_user[u["employee_id"]] = u

        # property -> first PROPERTY_MANAGER user
        pm_by_prop: dict = {}
        for u in sorted(s["users"], key=lambda x: x["created_at"]):
            if u["role"] == "PROPERTY_MANAGER" and u["property_id"]:
                pm_by_prop.setdefault(u["property_id"], u)

        dorm_rooms = [r for r in s["rooms"] if r["type"] == "Dorm"]
        dorm_ids = {r["id"] for r in dorm_rooms}
        reg_rooms = [r for r in s["rooms"] if r["type"] != "Dorm"]
        area_of_floor = {}  # floor id -> area row (same uuid)

        rows: dict[str, list[dict]] = {t: [] for t in
            ["companies", "properties", "areas", "zones", "rooms", "dorms",
             "beds", "employees", "users", "occupancies", "tasks",
             "task_history_events", "task_completion_submissions",
             "maintenance_tickets", "maintenance_ticket_events",
             "audit_events"]}

        def norm_dept(e):
            d = DEPARTMENT_MAP.get(e["department"], e["department"])
            if (not d or not d.strip()) and e["department_id"] in dept_by_id:
                d = dept_by_id[e["department_id"]]["name"]
            return (d or "").strip() or None

        for c in s["companies"]:
            rows["companies"].append(dict(
                id=c["id"], company_name=c["name"], brand_name=c["brand_name"],
                address=c["address"], pin_code="", email=c["email"],
                phone_number=c["phone"], legal_name=None,
                is_active=(c["status"] or "").lower() == "active",
                created_at=c["created_at"], updated_at=c["updated_at"]))

        used_prop_names = set()
        for p in s["properties"]:
            pm = pm_by_prop.get(p["id"])
            rows["properties"].append(dict(
                id=p["id"], company_id=p["company_id"], name=p["name"],
                code=p["code"],
                location=", ".join(x for x in [p["address"], p["country"]] if x),
                city=p["city"], state=p["state"],
                status=(p["status"] or "active").lower(),
                manager_employee_id=None,
                manager_name=pm["name"] if pm else "—",
                manager_email=(pm["email"] if pm else "unassigned@imported.local"),
                manager_phone=None,
                created_at=p["created_at"], updated_at=p["updated_at"]))

        for i, f in enumerate(sorted(s["floors"],
                                     key=lambda x: (x["property_id"], x["sort_order"]))):
            rows["areas"].append(dict(
                id=f["id"], property_id=f["property_id"], name=f["label"],
                code=f"L{f['sort_order']:02d}", level_number=f["sort_order"],
                description=None, status="active",
                created_at=f["created_at"], updated_at=f["updated_at"]))
        area_of_floor = {f["id"]: f["id"] for f in s["floors"]}

        per_prop_zone = {}
        for z in sorted(s["zones"], key=lambda x: x["created_at"]):
            i = per_prop_zone[z["property_id"]] = \
                per_prop_zone.get(z["property_id"], 0) + 1
            rows["zones"].append(dict(
                id=z["id"], property_id=z["property_id"], area_id=None,
                name=z["name"], code=f"ZONE-{i:03d}", zone_type="stay",
                floor=None, description=z["description"], status="active",
                display_order=i, created_at=z["created_at"],
                updated_at=z["updated_at"]))

        def room_status(v):
            out = STATUS_ROOM.get(v)
            if out is None:
                raise SystemExit(f"unknown old room/bed status {v!r}")
            return out

        for r in reg_rooms:
            rows["rooms"].append(dict(
                id=r["id"], property_id=r["property_id"], zone_id=r["zone_id"],
                area_id=area_of_floor.get(r["floor_id"]),
                room_number=r["number"], type=r["type"], area_sqft=None,
                status=room_status(r["status"]), bed_count=1,
                cleaning_note=r["maintenance_notes"],
                current_guest=r["current_guest"], display_order=0,
                created_at=r["created_at"], updated_at=r["updated_at"]))

        for r in dorm_rooms:
            rows["dorms"].append(dict(
                id=r["id"], property_id=r["property_id"], zone_id=r["zone_id"],
                area_id=area_of_floor.get(r["floor_id"]), name=r["number"],
                dorm_type="Mixed Dorm", washroom="No Washroom",
                floor=str(r["floor"]) if r["floor"] is not None else None,
                area_sqft=None, description=None,
                status=room_status(r["status"]), is_active=True,
                created_at=r["created_at"], updated_at=r["updated_at"]))

        for b in s["beds"]:
            parent = room_by_id[b["room_id"]]
            rows["beds"].append(dict(
                id=b["id"], dorm_id=b["room_id"],
                bed_number=b["number"],
                status=room_status(b["status"]), guest_name=None,
                property_id=parent["property_id"],
                created_at=b["created_at"], updated_at=b["updated_at"]))

        for i, e in enumerate(s["employees"]):
            lu = emp_user.get(e["id"])
            code = (e["employee_code"] or str(e["id"])[:8])
            rows["employees"].append(dict(
                id=e["id"], company_id=e["company_id"],
                property_id=e["property_id"], zone_id=e["zone_id"],
                area_id=None, name=e["name"],
                email=lu["email"] if lu else f"emp-{slug(code)}@imported.local",
                phone=e["phone"], username=code,
                job_title=e["designation"], department=norm_dept(e),
                status=e["status"], salary=(str(e["salary"]) if e["salary"] is not None else None),
                shift=None,
                start_date=str(e["joining_date"]) if e["joining_date"] else None,
                avatar_color=AVATAR_COLORS[i % len(AVATAR_COLORS)],
                leave_balance_days=None, leave_status=False,
                deactivated_at=None, reactivated_at=None,
                created_at=e["created_at"], updated_at=e["updated_at"]))

        used_usernames = set()
        for u in s["users"]:
            uname = slug(u["email"].split("@")[0])
            base, n = uname, 1
            while uname in used_usernames:
                n += 1
                uname = f"{base}-{n}"
            used_usernames.add(uname)
            rows["users"].append(dict(
                id=u["id"], company_id=u["company_id"], name=u["name"],
                email=u["email"], username=uname,
                password_hash=u["password_hash"], phone_number=None,
                role=u["role"], property_id=u["property_id"],
                employee_id=u["employee_id"], zone_id=None, job_title=None,
                is_active=u["is_active"], last_login_at=None,
                created_at=u["created_at"], updated_at=u["updated_at"]))

        for g in s["guest_stays"]:
            rows["occupancies"].append(dict(
                id=g["id"], property_id=g["property_id"], room_id=g["room_id"],
                bed_id=g["bed_id"],
                guest_name=guest_by_id[g["guest_id"]]["name"],
                checked_in_at=g["check_in_at"],
                checked_out_at=g["check_out_at"],
                checked_in_by=None, checked_out_by=None,
                created_at=g["created_at"], updated_at=g["updated_at"]))

        room_no = {r["id"]: r["number"] for r in s["rooms"]}
        for i, t in enumerate(sorted(s["tasks"], key=lambda x: x["created_at"])):
            emp = emp_by_id.get(t["employee_id"])
            cb = user_by_id.get(t["created_by_id"])
            st = STATUS_TASK.get(t["status"])
            if st is None:
                raise SystemExit(f"unknown old task status {t['status']!r}")
            rows["tasks"].append(dict(
                id=t["id"], property_id=t["property_id"], zone_id=t["zone_id"],
                employee_id=t["employee_id"],
                assigned_to_name=emp["name"] if emp else None,
                title=t["title"], description=t["description"],
                task_type="fixed", status=st,
                priority=(t["priority"] or "medium").lower(),
                due_date=t["due_date"].date().isoformat() if t["due_date"] else None,
                due_time=t["due_date"].strftime("%H:%M") if t["due_date"] else None,
                created_by_name=cb["name"] if cb else None,
                ticket_number=f"TASK-{t['created_at'].year}-{i + 1:05d}",
                room_id=t["room_id"],
                room_number=room_no.get(t["room_id"]),
                submitted_at=t["completed_at"], completed_at=t["completed_at"],
                allocation_status="assigned" if t["employee_id"] else "unassigned",
                origin="manual",
                created_at=t["created_at"], updated_at=t["updated_at"]))

        for h in s["task_history"]:
            actor = user_by_id.get(h["actor_user_id"])
            rows["task_history_events"].append(dict(
                id=h["id"], task_id=h["task_id"], type=h["action"],
                at=h["created_at"],
                actor_name=actor["name"] if actor else None,
                note=json.dumps(h["detail"], default=str) if h["detail"] else None,
                photos=None))

        attempt = {}
        for sub in sorted(s["task_submissions"], key=lambda x: x["created_at"]):
            emp = emp_by_id.get(sub["employee_id"])
            rv = user_by_id.get(sub["reviewed_by_id"])
            attempt[sub["task_id"]] = attempt.get(sub["task_id"], 0) + 1
            st = STATUS_SUBMISSION.get(sub["status"], sub["status"].lower())
            rows["task_completion_submissions"].append(dict(
                id=sub["id"], task_id=sub["task_id"], history_event_id=None,
                employee_id=sub["employee_id"],
                employee_name=emp["name"] if emp else None,
                attempt_number=attempt[sub["task_id"]], status=st,
                submitted_at=sub["created_at"], reviewed_at=sub["reviewed_at"],
                reviewed_by_id=sub["reviewed_by_id"],
                reviewed_by_name=rv["name"] if rv else None,
                review_comment=sub["review_note"],
                created_at=sub["created_at"]))
            if sub["note"]:
                rows["task_history_events"].append(dict(
                    id=uuidlib.uuid4(), task_id=sub["task_id"],
                    type="submission_note", at=sub["created_at"],
                    actor_name=emp["name"] if emp else None,
                    note=sub["note"], photos=None))

        for i, m in enumerate(sorted(s["maintenance_requests"],
                                     key=lambda x: x["created_at"])):
            st = STATUS_TICKET.get(m["status"])
            if st is None:
                raise SystemExit(f"unknown old maint status {m['status']!r}")
            rep = user_by_id.get(m["reported_by_id"])
            asg = emp_by_id.get(m["assigned_to_id"])
            tid = f"MT-{m['created_at'].year}-{i + 1:05d}"
            rows["maintenance_tickets"].append(dict(
                id=m["id"], ticket_number=tid, company_id=m["company_id"],
                property_id=m["property_id"], room_id=m["room_id"],
                room_number=room_no.get(m["room_id"]),
                reported_by=m["reported_by_id"],
                reported_by_name=rep["name"] if rep else None,
                maintenance_type="other", issue=m["title"],
                description=m["description"],
                priority=(m["priority"] or "medium").lower(), status=st,
                assigned_to=m["assigned_to_id"],
                assigned_to_name=asg["name"] if asg else None,
                due_date=None, resolved_at=m["resolved_at"],
                closed_at=m["resolved_at"] if st == "closed" else None,
                resolution_notes=m["resolution"], zone_id=m["zone_id"],
                allocation_status="assigned" if m["assigned_to_id"] else "unassigned",
                created_at=m["created_at"], updated_at=m["updated_at"]))
            rows["maintenance_ticket_events"].append(dict(
                id=uuidlib.uuid4(), ticket_id=m["id"], action="reported",
                actor_name=rep["name"] if rep else None, comment=None,
                created_at=m["created_at"]))
            if m["assigned_to_id"]:
                rows["maintenance_ticket_events"].append(dict(
                    id=uuidlib.uuid4(), ticket_id=m["id"], action="assigned",
                    actor_name=rep["name"] if rep else None,
                    comment=f"Assigned to {asg['name']}" if asg else None,
                    created_at=m["updated_at"]))
            if st == "closed":
                rows["maintenance_ticket_events"].append(dict(
                    id=uuidlib.uuid4(), ticket_id=m["id"], action="closed",
                    actor_name=None, comment=m["resolution"],
                    created_at=m["resolved_at"] or m["updated_at"]))

        for a in s["audit_logs"]:
            actor = user_by_id.get(a["actor_user_id"])
            detail = None
            if a["before"] is not None or a["after"] is not None:
                detail = {"before": a["before"], "after": a["after"]}
            rows["audit_events"].append(dict(
                id=a["id"], property_id=a["property_id"],
                actor_user_id=a["actor_user_id"],
                actor_name=actor["name"] if actor else None,
                entity_type=a["entity_type"], entity_id=a["entity_id"],
                entity_name=None, action=a["action"], detail=detail,
                created_at=a["created_at"]))

        # ---- dry-run report ----
        print(f"SOURCE: {mig.mask_dsn(old_url)}")
        print(f"TARGET: {mig.mask_dsn(new_url)}")
        print(f"{'target table':36s} {'rows':>5}")
        for t, rs in rows.items():
            print(f"  {t:34s} {len(rs):>5}")
        print(f"dropped source tables: {sorted(DROP_TABLES)}")
        print(f"old 'Dorm' rooms -> dorms: {len(dorm_rooms)} "
              f"(beds remapped room_id->dorm_id: {len(s['beds'])})")

        if args.dry_run:
            print("\nDRY RUN — no writes performed.")
            return 0

        # ---- execute ----
        d_info = await mig.introspect(dst)
        stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
        dest = mig.BACKUP_ROOT / f"pre-migration-{stamp}"
        print(f"Backing up target -> {dest}")
        await mig.backup(dst, d_info, dest)
        print("Backup verified.")

        order, _deferred = mig.dependency_order(d_info["fks"], d_info["tables"])

        async with dst.transaction():
            for t in reversed(order):
                await dst.execute(f'DELETE FROM "{t}"')
            for t, rs in rows.items():
                if rs:
                    await dst.copy_records_to_table(
                        t, records=[
                            tuple(
                                json.dumps(v, default=str)
                                if isinstance(v, (dict, list)) else v
                                for v in r.values()
                            )
                            for r in rs
                        ],
                        columns=list(rs[0].keys()))
            # sequences: keep ticket counters ahead of imported rows
            await dst.execute(
                "SELECT setval('task_ticket_seq', $1, $2)",
                len(rows["tasks"]), bool(rows["tasks"]))
            await dst.execute(
                "SELECT setval('maintenance_ticket_seq', $1, $2)",
                len(rows["maintenance_tickets"]),
                bool(rows["maintenance_tickets"]))

            errors = []
            for t, rs in rows.items():
                n = await dst.fetchval(f'SELECT count(*) FROM "{t}"')
                if n != len(rs):
                    errors.append(f"{t}: inserted {n} != expected {len(rs)}")
            for fk in d_info["fks"]:
                if fk["child"] in mig.PRESERVED_TABLES:
                    continue
                orphans = await dst.fetchval(
                    f'SELECT count(*) FROM "{fk["child"]}" c LEFT JOIN '
                    f'"{fk["parent"]}" p ON c."{fk["col"]}"=p."{fk["pcol"]}" '
                    f'WHERE c."{fk["col"]}" IS NOT NULL '
                    f'AND p."{fk["pcol"]}" IS NULL')
                if orphans:
                    errors.append(
                        f'orphans {fk["child"]}.{fk["col"]}: {orphans}')
            if errors:
                raise RuntimeError("validation failed, rolling back:\n  "
                                   + "\n  ".join(errors))

        print("\nMIGRATION COMMITTED.")
        print(f"backup: {dest}")
        return 0
    finally:
        await src.close()
        await dst.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
