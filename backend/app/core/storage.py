"""
Object storage for media uploads.

Two backends, one interface:

    LocalStorage — writes under UPLOAD_DIR (bind-mount a volume in Docker).
                   Dev/staging default; fine behind the /uploads mount.
    S3Storage    — S3-compatible object store (AWS S3, Supabase Storage,
                   MinIO). Production target: uploads survive container
                   replacement and are served from the bucket/CDN URL.

Selection is env-driven (STORAGE_BACKEND). The public URL for a stored
object comes back from save() — the caller never builds paths itself.
"""

import asyncio
import uuid
from pathlib import Path

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("app.storage")

MAX_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heic",
}


class StorageBackend:
    async def save(self, data: bytes, key: str, content_type: str) -> str:
        """Persist `data` at `key`; return the URL the client should store."""
        raise NotImplementedError


class LocalStorage(StorageBackend):
    def __init__(self, base_dir: str | Path | None = None):
        self.dir = Path(base_dir or settings.UPLOAD_DIR)
        if not self.dir.is_absolute():
            self.dir = Path(__file__).resolve().parents[2] / self.dir

    async def save(self, data: bytes, key: str, content_type: str) -> str:
        self.dir.mkdir(parents=True, exist_ok=True)
        path = self.dir / key
        # write off the event loop — uploads can be several MB
        await asyncio.to_thread(path.write_bytes, data)
        return f"/uploads/{key}"  # relative — frontend resolves via mediaUrl()


class S3Storage(StorageBackend):
    def __init__(self):
        import boto3  # deferred — only needed when this backend is selected

        if not settings.S3_BUCKET:
            raise RuntimeError("STORAGE_BACKEND=s3 requires S3_BUCKET")
        self.bucket = settings.S3_BUCKET
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL or None,
            region_name=settings.S3_REGION,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
        )

    async def save(self, data: bytes, key: str, content_type: str) -> str:
        await asyncio.to_thread(
            self.client.put_object,
            Bucket=self.bucket, Key=key, Body=data,
            ContentType=content_type,
        )
        if settings.S3_PUBLIC_BASE_URL:
            return f"{settings.S3_PUBLIC_BASE_URL.rstrip('/')}/{key}"
        if settings.S3_ENDPOINT_URL:
            base = settings.S3_ENDPOINT_URL.rstrip("/")
            return f"{base}/{self.bucket}/{key}"
        return f"https://{self.bucket}.s3.{settings.S3_REGION}.amazonaws.com/{key}"


class SupabaseStorage(StorageBackend):
    """Supabase Storage via its REST API — needs only SUPABASE_SECRET_KEY,
    which deployments already carry for the database. Objects land in a
    public bucket so the returned URL renders without signing."""

    def __init__(self):
        if not settings.SUPABASE_SECRET_KEY:
            raise RuntimeError("supabase storage requires SUPABASE_SECRET_KEY")
        self.base = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1"
        self.bucket = settings.SUPABASE_STORAGE_BUCKET

    async def save(self, data: bytes, key: str, content_type: str) -> str:
        import httpx  # deferred — only needed when this backend is selected

        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.post(
                f"{self.base}/object/{self.bucket}/{key}",
                content=data,
                headers={
                    "Authorization": f"Bearer {settings.SUPABASE_SECRET_KEY}",
                    "apikey": settings.SUPABASE_SECRET_KEY,
                    "Content-Type": content_type,
                },
            )
            res.raise_for_status()
        return f"{self.base}/object/public/{self.bucket}/{key}"


def _s3_ready() -> bool:
    return bool(
        settings.S3_BUCKET and settings.S3_ACCESS_KEY and settings.S3_SECRET_KEY
    )


_backend: StorageBackend | None = None


def get_storage() -> StorageBackend:
    """Resolve the effective backend. `auto` prefers durable object storage
    (S3 creds, then the Supabase service key) and only falls back to the
    local filesystem when nothing persistent is configured — writing to a
    container's disk silently loses every upload on the next deploy."""
    global _backend
    if _backend is None:
        mode = settings.STORAGE_BACKEND.lower()
        if mode == "s3" or (mode == "auto" and _s3_ready()):
            _backend = S3Storage()
        elif mode == "supabase" or (
            mode == "auto" and settings.SUPABASE_SECRET_KEY
        ):
            _backend = SupabaseStorage()
        else:
            _backend = LocalStorage()
        logger.info("storage backend: %s", type(_backend).__name__)
    return _backend


def new_object_key(filename: str | None, content_type: str) -> str:
    """Collision-free object key — uuid + extension from the VALIDATED
    content type (never trust the client-supplied filename)."""
    ext = ALLOWED_CONTENT_TYPES.get(content_type, ".jpg")
    return f"{uuid.uuid4().hex}{ext}"
