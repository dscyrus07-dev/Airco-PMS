"""
One-shot migration: push legacy local uploads into Supabase Storage and
rewrite the DB rows that point at them.

Why: rows created while a dev instance ran with STORAGE_BACKEND=local carry
relative /uploads/<key> URLs. Those files live only on the machine that
uploaded them, so every other environment 404s. Run this ON THE MACHINE
THAT HAS THE FILES:

    python backend/scripts/sync_local_uploads.py

It uploads each referenced file from backend/uploads/ to the Supabase
Storage bucket (S3 API) and rewrites the matching rows to full public URLs.
Idempotent — already-migrated rows are skipped.
"""

import asyncio
import sys
from pathlib import Path

import asyncpg

ROOT = Path(__file__).resolve().parents[1]  # backend/
sys.path.insert(0, str(ROOT))

# pydantic resolves env_file=".env" against the CWD — this script is run from
# the repo root, so load backend/.env explicitly BEFORE importing settings.
from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from app.core.config import settings  # noqa: E402


async def connect():
    """Connect using the same env-driven settings as the application."""
    return await asyncpg.connect(
        host=settings.SUPABASE_DB_HOST,
        port=settings.SUPABASE_DB_PORT,
        user=settings.SUPABASE_DB_USER,
        password=settings.SUPABASE_DB_PASSWORD,
        database=settings.SUPABASE_DB_NAME,
        ssl="require",
        timeout=8,
    )


async def upload_to_bucket(key: str, path: Path, content_type: str) -> str:
    """Upload via the app's resolved storage backend (Supabase REST, S3, …)
    and return the public URL it reports — no S3 creds needed here."""
    from app.core.storage import get_storage

    return await get_storage().save(path.read_bytes(), key, content_type)


CONTENT_TYPES = {".jpg": "image/jpeg", ".png": "image/png",
                 ".webp": "image/webp", ".heic": "image/heic"}


async def main() -> None:
    # Rewrites database rows — refuse to run unless the environment is
    # explicitly development. Never infer safety from the hostname.
    if settings.APP_ENV != "development":
        raise SystemExit(
            f"Refusing to rewrite upload URLs: APP_ENV="
            f"{settings.APP_ENV!r} (expected 'development')."
        )
    uploads_dir = ROOT / settings.UPLOAD_DIR
    conn = await connect()

    rows = await conn.fetch(
        "SELECT DISTINCT url FROM maintenance_ticket_attachments "
        "WHERE url LIKE '/uploads/%'")
    print(f"{len(rows)} relative /uploads/ URL(s) in the database")

    synced = missing = 0
    for r in rows:
        url = r["url"]
        key = url.rsplit("/", 1)[-1]
        path = uploads_dir / key
        if not path.exists():
            missing += 1
            print(f"  MISSING on this machine: {key}")
            continue
        new_url = await upload_to_bucket(
            key, path,
            CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream"))
        await conn.execute(
            "UPDATE maintenance_ticket_attachments SET url = $1 WHERE url = $2",
            new_url, url)
        synced += 1
        print(f"  migrated: {key}")

    await conn.close()
    print(f"done — synced {synced}, missing {missing}")
    if missing:
        print("files above were uploaded from a different machine; re-upload "
              "them through the app or run this script there.")


if __name__ == "__main__":
    asyncio.run(main())
