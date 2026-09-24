"""Media uploads — storage backend selected via STORAGE_BACKEND (local dir
or S3-compatible object store). Local objects are served from the
`/uploads` static mount; S3 objects get their public/CDN URL back.

Returns the stored URL so the frontend can render/store it directly.
"""

from fastapi import APIRouter, Depends, Request, UploadFile, status
from fastapi import File

from app.core.exceptions import AppError
from app.core.rate_limit import rate_limit
from app.core.storage import (
    ALLOWED_CONTENT_TYPES,
    MAX_BYTES,
    get_storage,
    new_object_key,
)
from app.dependencies.auth import get_current_user
from app.models.user import User

router = APIRouter(tags=["media"])


class InvalidUpload(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    code = "INVALID_UPLOAD"


@router.post(
    "/media/uploads",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("upload", limit=30, window_seconds=60))],
)
async def upload_media(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise InvalidUpload("Only JPEG/PNG/WebP images are allowed.", field="photos")
    data = await file.read()
    if not data:
        raise InvalidUpload("Empty file.", field="photos")
    if len(data) > MAX_BYTES:
        raise InvalidUpload("File exceeds the 10 MB limit.", field="photos")

    key = new_object_key(file.filename, file.content_type)
    url = await get_storage().save(data, key, file.content_type)
    # Local backend returns a relative /uploads/<key> path — the frontend's
    # mediaUrl() resolves it against the API origin. Works identically
    # direct, or behind nginx (absolute proxy-derived URLs lose the port).
    return {"url": url}
