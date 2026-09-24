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


_backend: StorageBackend | None = None


def get_storage() -> StorageBackend:
    global _backend
    if _backend is None:
        _backend = (
            S3Storage() if settings.STORAGE_BACKEND.lower() == "s3"
            else LocalStorage()
        )
    return _backend


def new_object_key(filename: str | None, content_type: str) -> str:
    """Collision-free object key — uuid + extension from the VALIDATED
    content type (never trust the client-supplied filename)."""
    ext = ALLOWED_CONTENT_TYPES.get(content_type, ".jpg")
    return f"{uuid.uuid4().hex}{ext}"
