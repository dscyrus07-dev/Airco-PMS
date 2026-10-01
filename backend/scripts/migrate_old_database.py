"""
migrate_old_database.py — DATA-ONLY reset + import for AiROS.

Resets operational data in the CURRENT database (the app's configured
DATABASE_URL / SUPABASE_DB_* target) and re-populates it from the OLD
PostgreSQL database identified by the OLD_DATABASE_URL environment variable.

Never contains credentials. Source is opened READ-ONLY.

    # inspection only — no writes to either database
    OLD_DATABASE_URL=postgresql://... python scripts/migrate_old_database.py --dry-run

    # destructive: backup → clean → import → validate (single transaction)
    OLD_DATABASE_URL=postgresql://... python scripts/migrate_old_database.py --execute

Schema is NEVER modified: no DDL, no DROP, no TRUNCATE ... CASCADE, no
alembic_version changes. All deletes/inserts run inside one transaction;
any validation failure rolls the whole thing back.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import settings  # noqa: E402

# Tables never touched (schema metadata — not operational data).
PRESERVED_TABLES = {"alembic_version"}

# Sequences carry operational counters (ticket numbering) — copy the
# source position so new tickets don't collide with imported numbers.

BACKUP_ROOT = Path.home() / "airos-migration-backups"


def mask_dsn(dsn: str) -> str:
    if "@" in dsn:
        head, tail = dsn.split("@", 1)
        head = head.split("://", 1)
        return f"{head[0]}://***@{tail}"
    return "***"


def norm_dsn(dsn: str) -> str:
    return dsn.replace("postgresql+asyncpg://", "postgresql://", 1)


def dsn_host(dsn: str) -> str:
    from urllib.parse import urlparse
    return urlparse(norm_dsn(dsn)).hostname or "<unknown>"


async def connect(dsn: str, *, readonly: bool = False) -> asyncpg.Connection:
    conn = await asyncpg.connect(norm_dsn(dsn))
    if readonly:
        await conn.execute(
            "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY"
        )
    return conn


# ----------------------------------------------------------------------
# Introspection
# ----------------------------------------------------------------------

async def introspect(conn: asyncpg.Connection) -> dict:
    tables = [
        r["table_name"]
        for r in await conn.fetch(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='public' AND table_type='BASE TABLE' "
            "ORDER BY table_name"
        )
    ]
    columns = {}
    for r in await conn.fetch(
        "SELECT table_name, column_name, data_type, is_nullable, "
        "column_default, udt_name FROM information_schema.columns "
        "WHERE table_schema='public' ORDER BY table_name, ordinal_position"
    ):
        columns.setdefault(r["table_name"], []).append(
            (r["column_name"], r["udt_name"], r["is_nullable"])
        )
    pks = {}
    for r in await conn.fetch(
        "SELECT tc.table_name, kcu.column_name "
        "FROM information_schema.table_constraints tc "
        "JOIN information_schema.key_column_usage kcu "
        "  ON tc.constraint_name=kcu.constraint_name "
        " AND tc.table_schema=kcu.table_schema "
        "WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public'"
    ):
        pks.setdefault(r["table_name"], []).append(r["column_name"])
    fks = await conn.fetch(
        "SELECT tc.table_name AS child, kcu.column_name AS col, "
        "ccu.table_name AS parent, ccu.column_name AS pcol, c.is_nullable "
        "FROM information_schema.table_constraints tc "
        "JOIN information_schema.key_column_usage kcu "
        "  ON tc.constraint_name=kcu.constraint_name "
        " AND tc.table_schema=kcu.table_schema "
        "JOIN information_schema.constraint_column_usage ccu "
        "  ON tc.constraint_name=ccu.constraint_name "
        " AND tc.table_schema=ccu.table_schema "
        "JOIN information_schema.columns c "
        "  ON c.table_name=tc.table_name AND c.column_name=kcu.column_name "
        " AND c.table_schema='public' "
        "WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'"
    )
    enums = {
        r["typname"]: r["v"]
        for r in await conn.fetch(
            "SELECT t.typname, string_agg(e.enumlabel, '|' "
            "ORDER BY e.enumsortorder) AS v "
            "FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid "
            "JOIN pg_namespace n ON n.oid=t.typnamespace "
            "WHERE n.nspname='public' GROUP BY t.typname"
        )
    }
    sequences = {
        r["sequence_name"]: await conn.fetchrow(
            f'SELECT last_value, is_called FROM "{r["sequence_name"]}"'
        )
        for r in await conn.fetch(
            "SELECT sequence_name FROM information_schema.sequences "
            "WHERE sequence_schema='public'"
        )
    }
    counts = {
        t: await conn.fetchval(f'SELECT count(*) FROM "{t}"') for t in tables
    }
    return {
        "tables": tables,
        "columns": columns,
        "pks": pks,
        "fks": [dict(f) for f in fks],
        "enums": enums,
        "sequences": sequences,
        "counts": counts,
        "alembic": await conn.fetchval("SELECT version_num FROM alembic_version"),
    }


def compare_schema(src: dict, dst: dict) -> list[str]:
    """Structural diff. Any output = STOP."""
    out: list[str] = []
    for t in sorted(set(src["tables"]) | set(dst["tables"])):
        if t not in src["tables"]:
            out.append(f"table {t}: exists in TARGET only")
        elif t not in dst["tables"]:
            out.append(f"table {t}: exists in SOURCE only")
    for t in sorted(set(src["tables"]) & set(dst["tables"])):
        s_cols = {c[0]: (c[1], c[2]) for c in src["columns"][t]}
        d_cols = {c[0]: (c[1], c[2]) for c in dst["columns"][t]}
        for c in sorted(set(s_cols) | set(d_cols)):
            if c not in s_cols:
                out.append(f"{t}.{c}: column exists in TARGET only")
            elif c not in d_cols:
                out.append(f"{t}.{c}: column exists in SOURCE only")
            elif s_cols[c][0] != d_cols[c][0]:
                out.append(
                    f"{t}.{c}: type {s_cols[c][0]} (src) != {d_cols[c][0]} (dst)"
                )
        if sorted(src["pks"].get(t, [])) != sorted(dst["pks"].get(t, [])):
            out.append(f"{t}: primary key mismatch")
    for e in sorted(set(src["enums"]) | set(dst["enums"])):
        if src["enums"].get(e) != dst["enums"].get(e):
            out.append(
                f"enum {e}: {src['enums'].get(e)} (src) != "
                f"{dst['enums'].get(e)} (dst)"
            )
    if src["alembic"] != dst["alembic"]:
        out.append(
            f"alembic revision: src={src['alembic']} dst={dst['alembic']}"
        )
    return out


def dependency_order(fks: list[dict], tables: list[str]) -> tuple[list[str], list[dict]]:
    """Insert order (parents first) + deferred self-FK edges.

    Returns (order, deferred): deferred edges are nullable self-referencing
    FKs that must be inserted NULL and fixed up afterwards.
    """
    data_tables = [t for t in tables if t not in PRESERVED_TABLES]
    deps: dict[str, set[str]] = {t: set() for t in data_tables}
    deferred: list[dict] = []
    for fk in fks:
        if fk["child"] in deps and fk["parent"] in deps:
            if fk["child"] == fk["parent"]:
                if fk["is_nullable"] == "YES":
                    deferred.append(fk)
                else:
                    raise SystemExit(
                        f"NOT NULL self-FK {fk['child']}.{fk['col']} — "
                        "cannot order inserts safely. STOP."
                    )
            else:
                deps[fk["child"]].add(fk["parent"])
    order: list[str] = []
    remaining = dict(deps)
    while remaining:
        ready = sorted(t for t, d in remaining.items() if not d)
        if not ready:
            raise SystemExit(
                f"FK cycle detected among {sorted(remaining)} — STOP."
            )
        order.extend(ready)
        for t in ready:
            del remaining[t]
        for d in remaining.values():
            d.difference_update(ready)
    return order, deferred


# ----------------------------------------------------------------------
# Backup
# ----------------------------------------------------------------------

async def backup(conn: asyncpg.Connection, info: dict, dest: Path) -> Path:
    dest.mkdir(parents=True, exist_ok=False)
    manifest = {
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "alembic": info["alembic"],
        "tables": {},
    }
    for t in info["tables"]:
        rows = await conn.fetch(f'SELECT * FROM "{t}"')
        payload = {
            "columns": [c[0] for c in info["columns"][t]],
            "rows": [
                [json.loads(json.dumps(v, default=str)) for v in r.values()]
                for r in rows
            ],
        }
        (dest / f"{t}.json").write_text(json.dumps(payload))
        manifest["tables"][t] = len(rows)
    for name, seq in info["sequences"].items():
        manifest.setdefault("sequences", {})[name] = dict(seq)
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2, default=str))
    # verify readability
    for t in info["tables"]:
        back = json.loads((dest / f"{t}.json").read_text())
        assert len(back["rows"]) == manifest["tables"][t], f"backup corrupt: {t}"
    return dest


# ----------------------------------------------------------------------
# Execute
# ----------------------------------------------------------------------

async def execute(src: asyncpg.Connection, dst: asyncpg.Connection,
                  s_info: dict, d_info: dict, order: list[str],
                  deferred: list[dict]) -> dict:
    report: dict = {"deleted": {}, "inserted": {}, "sequences": {}}
    async with dst.transaction():
        # delete children first
        for t in reversed(order):
            n = await dst.fetchval(f'SELECT count(*) FROM "{t}"')
            await dst.execute(f'DELETE FROM "{t}"')
            report["deleted"][t] = n

        deferred_by_table: dict[str, list[dict]] = {}
        for fk in deferred:
            deferred_by_table.setdefault(fk["child"], []).append(fk)

        pk_of = {t: s_info["pks"][t][0] for t in s_info["pks"] if s_info["pks"][t]}
        fixups: list[tuple[str, str, object, object]] = []  # t, col, pk, val
        for t in order:
            cols = [c[0] for c in s_info["columns"][t]]
            rows = await src.fetch(f'SELECT * FROM "{t}"')
            records = []
            for r in rows:
                rec = dict(r)
                for fk in deferred_by_table.get(t, []):
                    if rec[fk["col"]] is not None:
                        fixups.append(
                            (t, fk["col"], rec[pk_of[t]], rec[fk["col"]])
                        )
                        rec[fk["col"]] = None
                records.append(tuple(rec[c] for c in cols))
            if records:
                await dst.copy_records_to_table(
                    t, records=records, columns=cols
                )
            report["inserted"][t] = len(records)

        # deferred self-FK fixups
        for t, col, pkval, val in fixups:
            pk = pk_of[t]
            await dst.execute(
                f'UPDATE "{t}" SET "{col}"=$1 WHERE "{pk}"=$2', val, pkval
            )

        # sequences — carry the source counters over exactly
        for name, seq in s_info["sequences"].items():
            if name in d_info["sequences"]:
                await dst.execute(
                    "SELECT setval($1::regclass, $2, $3)",
                    name, seq["last_value"], seq["is_called"],
                )
                report["sequences"][name] = seq["last_value"]

        # ---- validation inside the transaction ----
        errors: list[str] = []
        for t in order:
            new = await dst.fetchval(f'SELECT count(*) FROM "{t}"')
            if new != s_info["counts"][t]:
                errors.append(
                    f"{t}: imported {new} != source {s_info['counts'][t]}"
                )
        # FK orphans
        for fk in s_info["fks"]:
            if fk["child"] in PRESERVED_TABLES or fk["parent"] in PRESERVED_TABLES:
                continue
            orphans = await dst.fetchval(
                f'SELECT count(*) FROM "{fk["child"]}" c '
                f'LEFT JOIN "{fk["parent"]}" p ON c."{fk["col"]}" = p."{fk["pcol"]}" '
                f'WHERE c."{fk["col"]}" IS NOT NULL AND p."{fk["pcol"]}" IS NULL'
            )
            if orphans:
                errors.append(
                    f'orphans: {fk["child"]}.{fk["col"]} -> '
                    f'{fk["parent"]}: {orphans} row(s)'
                )
        # duplicate PKs (paranoia — copy would already fail on constraint)
        for t in order:
            for pk in s_info["pks"].get(t, []):
                dupes = await dst.fetchval(
                    f'SELECT count(*) FROM (SELECT "{pk}" FROM "{t}" '
                    f'GROUP BY "{pk}" HAVING count(*) > 1) d'
                )
                if dupes:
                    errors.append(f"{t}: duplicate PK values ({dupes})")
        if errors:
            raise RuntimeError(
                "validation failed — rolling back:\n  " + "\n  ".join(errors)
            )
    return report


async def dry_run(src: asyncpg.Connection, dst: asyncpg.Connection) -> int:
    s_info = await introspect(src)
    d_info = await introspect(dst)
    print(f"SOURCE: {mask_dsn(os.environ['OLD_DATABASE_URL'])}")
    print(f"TARGET: {mask_dsn(settings.database_url)}")
    print(f"alembic: src={s_info['alembic']}  dst={d_info['alembic']}")

    mismatches = compare_schema(s_info, d_info)
    if mismatches:
        print("\nSCHEMA MISMATCH — STOP:")
        for m in mismatches:
            print(f"  {m}")
        return 1

    order, deferred = dependency_order(d_info["fks"], d_info["tables"])
    if deferred:
        print("\nDeferred self-FKs (inserted NULL then fixed):")
        for fk in deferred:
            print(f"  {fk['child']}.{fk['col']}")

    print("\nTABLE INVENTORY (src rows / dst rows / action):")
    print(f"  {'table':42s} {'src':>7} {'dst':>7}  action")
    for t in d_info["tables"]:
        if t in PRESERVED_TABLES:
            action = "PRESERVE (schema metadata)"
        else:
            action = "delete dst + import src"
        print(
            f"  {t:42s} {s_info['counts'].get(t, '-'):>7} "
            f"{d_info['counts'][t]:>7}  {action}"
        )

    print("\nINSERT ORDER (parents first):")
    print("  " + " → ".join(order))
    print("\nDELETE ORDER (children first):")
    print("  " + " → ".join(reversed(order)))
    print("\nSEQUENCES (src last_value → applied to dst):")
    for name, seq in s_info["sequences"].items():
        print(f"  {name}: {seq['last_value']} (is_called={seq['is_called']})")
    print("\nDRY RUN complete — no writes performed.")
    return 0


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--execute", action="store_true")
    ap.add_argument(
        "--confirm", metavar="RESET-AND-IMPORT",
        help="required with --execute",
    )
    args = ap.parse_args()
    if not (args.dry_run or args.execute):
        ap.error("specify --dry-run or --execute")
    if args.execute and args.confirm != "RESET-AND-IMPORT":
        ap.error("--execute requires --confirm RESET-AND-IMPORT")

    old_url = os.environ.get("OLD_DATABASE_URL", "").strip()
    if not old_url:
        print("FATAL: OLD_DATABASE_URL is not set — refusing to run.")
        return 2
    new_url = settings.database_url
    if not new_url:
        print("FATAL: target DATABASE_URL / SUPABASE_DB_* not configured.")
        return 2
    if dsn_host(old_url) == dsn_host(new_url):
        print(
            f"FATAL: source and target resolve to the same host "
            f"({dsn_host(old_url)}) — refusing."
        )
        return 2

    src = await connect(old_url, readonly=True)
    dst = await connect(new_url)
    try:
        if args.dry_run:
            return await dry_run(src, dst)

        s_info = await introspect(src)
        d_info = await introspect(dst)
        mismatches = compare_schema(s_info, d_info)
        if mismatches:
            print("SCHEMA MISMATCH — aborted before touching target:")
            for m in mismatches:
                print(f"  {m}")
            return 1

        stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
        dest = BACKUP_ROOT / f"pre-migration-{stamp}"
        print(f"Backing up target database → {dest}")
        backup_dir = await backup(dst, d_info, dest)
        print("Backup verified.")

        order, deferred = dependency_order(d_info["fks"], d_info["tables"])
        report = await execute(src, dst, s_info, d_info, order, deferred)

        print("\n=== MIGRATION REPORT ===")
        print(f"backup: {backup_dir}")
        print(f"{'table':42s} {'deleted':>8} {'inserted':>9}")
        for t in order:
            print(
                f"  {t:40s} {report['deleted'][t]:>8} "
                f"{report['inserted'][t]:>9}"
            )
        print("sequences:")
        for name, v in report["sequences"].items():
            print(f"  {name} = {v}")
        print("All in-transaction FK/count/PK validation passed.")
        return 0
    finally:
        await src.close()
        await dst.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
