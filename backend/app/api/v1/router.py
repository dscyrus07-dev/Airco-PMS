"""
Versioned API aggregator.

Every business router mounts here — the frontend contract in /API.md
expects them under {API_V1_PREFIX}.
"""

from fastapi import APIRouter

from app.api.v1 import auth, media, templates, work_batches, workspace

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(workspace.router)
api_router.include_router(media.router)
api_router.include_router(work_batches.router)
api_router.include_router(templates.router)

# Future routers (API.md contract):
# api_router.include_router(companies.router,   prefix="/companies",  tags=["companies"])
# api_router.include_router(properties.router,  prefix="/properties", tags=["properties"])
# api_router.include_router(areas.router,       prefix="/areas",      tags=["areas"])
# api_router.include_router(zones.router,       prefix="/zones",      tags=["zones"])
# api_router.include_router(rooms.router,       prefix="/rooms",      tags=["rooms"])
# api_router.include_router(dorms.router,       prefix="/dorms",      tags=["dorms"])
# api_router.include_router(employees.router,   prefix="/employees",  tags=["employees"])
# api_router.include_router(tasks.router,       prefix="/tasks",      tags=["tasks"])
# api_router.include_router(units.router,       prefix="/units",      tags=["units"])
# api_router.include_router(media.router,       prefix="/media",      tags=["media"])
