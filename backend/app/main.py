"""
Management Tool API — application entrypoint.

Run:  uvicorn app.main:app --reload   (from backend/)
Docs: http://localhost:8000/docs
"""

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.database import (
    AsyncSessionLocal,
    check_database,
    close_db,
    describe_db_error,
)
from app.core.exceptions import register_exception_handlers
from app.core.logging import get_logger, setup_logging
from app.core.middleware import (
    AccessLogMiddleware,
    RequestIDMiddleware,
    SecurityHeadersMiddleware,
)
from app.core.queue import close_queue
from app.core.redis import check_redis, close_redis, redis_configured

setup_logging()
logger = get_logger("app.main")

# Startup DB probe — transient DNS/network hiccups shouldn't permanently mark
# the app as DB-less, but a real outage must still surface loudly in the logs.
_DB_STARTUP_ATTEMPTS = 3
_DB_STARTUP_RETRY_DELAY = 2.0

_ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


async def check_schema_version() -> str | None:
    """Compare the database's alembic_version with the script head.

    A reachable-but-stale database is the silent-killer failure: every
    query against a missing column surfaces as an unrelated 503. Returns
    None when current, else a human-readable remediation string."""
    from alembic.config import Config as AlembicConfig
    from alembic.script import ScriptDirectory
    from sqlalchemy import text

    if not _ALEMBIC_INI.exists():
        return None  # no migration config — nothing to compare
    try:
        cfg = AlembicConfig(str(_ALEMBIC_INI))
        heads = set(ScriptDirectory.from_config(cfg).get_heads())
        async with AsyncSessionLocal() as session:
            rows = await session.execute(
                text("SELECT version_num FROM alembic_version")
            )
            current = {r[0] for r in rows}
    except Exception as exc:
        return f"could not read schema version ({describe_db_error(exc)}) — run `alembic upgrade head`"
    if current != heads:
        return (
            f"database schema is stale (at {sorted(current) or '[]'}, head is "
            f"{sorted(heads)}) — run `alembic upgrade head`"
        )
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s (%s)", settings.APP_NAME, settings.APP_ENV)
    logger.info(
        "Environment: %s | API prefix: %s | CORS origins: %s",
        settings.APP_ENV, settings.API_V1_PREFIX,
        ",".join(settings.cors_origins) or "(none)",
    )

    # Fail fast on hard misconfiguration in production — a prod boot with no
    # JWT secret or no database is worse than no boot at all.
    fatal = [w for w in settings.production_warnings()
             if "JWT_SECRET_KEY" in w or "no database" in w]
    if fatal:
        for w in fatal:
            logger.error("FATAL CONFIG: %s", w)
        raise RuntimeError(f"Production misconfiguration: {'; '.join(fatal)}")
    for w in settings.production_warnings():
        logger.warning("Production warning: %s", w)

    last_error: str | None = None
    for attempt in range(1, _DB_STARTUP_ATTEMPTS + 1):
        try:
            await check_database()
            logger.info("Database connection verified")
            last_error = None
            break
        except Exception as exc:
            last_error = describe_db_error(exc)
            if attempt < _DB_STARTUP_ATTEMPTS:
                logger.warning(
                    "Database connection attempt %d/%d failed: %s — retrying",
                    attempt, _DB_STARTUP_ATTEMPTS, last_error,
                )
                await asyncio.sleep(_DB_STARTUP_RETRY_DELAY)
    if last_error is not None:
        # Server stays up so /health + diagnostics keep working; every
        # DB-backed route will report a real 503 until connectivity returns.
        logger.error("Database connection failed at startup: %s", last_error)
    else:
        # Schema drift check — a reachable DB on an old revision produces
        # exactly the "endpoint 503s for no obvious reason" failure mode.
        # Refuse to serve rather than boot half-broken.
        stale = await check_schema_version()
        if stale:
            logger.error("FATAL: %s", stale)
            raise RuntimeError(f"Database schema out of date: {stale}")

    # Scheduler ownership: embedded loop in dev/single-process mode; the arq
    # worker's cron owns it in production so the API stays stateless and
    # replicas don't multiply the tick.
    scheduler = None
    if settings.RUN_EMBEDDED_SCHEDULER:
        scheduler = _start_template_scheduler()
        logger.info("Embedded generation scheduler started (RUN_EMBEDDED_SCHEDULER=true)")
    else:
        logger.info("Embedded scheduler disabled — arq worker owns generation ticks")

    yield

    # Shutdown — SIGTERM path: stop new work, let in-flight requests finish
    # (uvicorn), then release pools/connections.
    if scheduler is not None:
        scheduler.cancel()
    await close_queue()
    await close_redis()
    await close_db()
    logger.info("Shutdown complete")


def _start_template_scheduler():
    """Background tick — generates due template work every minute.

    Idempotent via the template_generations ledger, so overlapping runs and
    manual /templates/generate-due calls can't double-create work."""
    import asyncio

    async def _loop():
        from app.services.task import TaskService
        from app.services.template import TemplateService
        consecutive_failures = 0
        ticks = 0
        while True:
            try:
                async with AsyncSessionLocal() as session:
                    stats = await TemplateService(session).run_due()
                    if stats["generated"]:
                        logger.info("Template scheduler: %s", stats)
                async with AsyncSessionLocal() as session:
                    rep = await TaskService(session).run_due_repetitive()
                    if rep["generated"]:
                        logger.info("Repetitive-task scheduler: %s", rep)
                ticks += 1
                if ticks % 15 == 0:
                    # state reconciliation sweep — detect + log, never
                    # silently rewrite (repair is a deliberate SA action)
                    from app.services.reconciliation import (
                        reconcile_property,
                    )
                    from sqlalchemy import select

                    from app.models.property import Property
                    async with AsyncSessionLocal() as session:
                        for pid in (await session.execute(
                            select(Property.id)
                        )).scalars():
                            findings = await reconcile_property(session, pid)
                            actionable = [
                                f for f in findings
                                if f.get("severity") != "info"
                            ]
                            if actionable:
                                logger.warning(
                                    "State reconciliation — property %s: "
                                    "%d finding(s): %s", pid,
                                    len(actionable),
                                    [
                                        f"{f['issue']} "
                                        f"{f['resource_type']}:{f['label']}"
                                        for f in actionable
                                    ],
                                )
                if consecutive_failures:
                    logger.info("Template scheduler recovered after %d failed tick(s)", consecutive_failures)
                consecutive_failures = 0
                delay = 60
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                consecutive_failures += 1
                # Log the first failure of an outage loudly, then throttle —
                # a dead database must not produce an error every minute.
                if consecutive_failures == 1 or consecutive_failures % 10 == 0:
                    logger.error(
                        "Template scheduler tick failed (%d consecutive): %s",
                        consecutive_failures, describe_db_error(exc),
                    )
                # Exponential backoff, capped at 10 minutes
                delay = min(60 * (2 ** min(consecutive_failures - 1, 4)), 600)
            await asyncio.sleep(delay)

    return asyncio.create_task(_loop())


app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    docs_url="/docs" if settings.APP_ENV != "production" else None,
    openapi_url="/openapi.json" if settings.APP_ENV != "production" else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# GZip — compress JSON payloads >500B (list endpoints return sizeable bodies)
from fastapi.middleware.gzip import GZipMiddleware  # noqa: E402

app.add_middleware(GZipMiddleware, minimum_size=500)

# Middleware stack — Starlette runs the LAST added first, so RequestID is
# outermost: the id exists before the access log or any handler runs.
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(AccessLogMiddleware)
app.add_middleware(RequestIDMiddleware)

register_exception_handlers(app)

# Serve /uploads unconditionally — rows created under local storage carry
# relative /uploads/* URLs, and the mount resolves them whenever the files
# exist on this host's disk (object-storage backends return absolute URLs).
from fastapi.staticfiles import StaticFiles  # noqa: E402

from app.core.storage import LocalStorage  # noqa: E402

_uploads = LocalStorage().dir
_uploads.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads)), name="uploads")


@app.get("/health", tags=["health"])
async def health() -> dict:
    """Liveness — process is up and configuration loaded."""
    return {"status": "ok", "service": settings.APP_NAME, "env": settings.APP_ENV}


@app.get("/health/db", tags=["health"])
async def health_db() -> dict:
    """Readiness — verifies real PostgreSQL connectivity (SELECT 1)."""
    from fastapi import HTTPException

    try:
        await check_database()
        return {"status": "ok", "database": "connected"}
    except Exception as exc:
        logger.error("Database health check failed: %s", describe_db_error(exc))
        raise HTTPException(
            status_code=503,
            detail={"code": "DATABASE_UNAVAILABLE", "message": "Database is unreachable."},
        )


@app.get("/ready", tags=["health"])
@app.get(f"{settings.API_V1_PREFIX}/health", tags=["health"])
async def api_health() -> JSONResponse:
    """Readiness — DB + Redis probes. 200 when serving traffic fully, 503
    'degraded' when a dependency is down. Redis is reported but does not
    fail readiness on its own when unconfigured (it is an accelerator)."""
    status_ = {"status": "ok", "database": "connected", "redis": "disabled"}
    try:
        await check_database()
    except Exception as exc:
        logger.error("Database health check failed: %s", describe_db_error(exc))
        status_["database"] = "disconnected"
        status_["status"] = "degraded"
    if redis_configured():
        status_["redis"] = "connected" if await check_redis() else "unreachable"
        if status_["redis"] == "unreachable":
            status_["status"] = "degraded"  # queue/limiter impaired
    if status_["database"] == "connected":
        stale = await check_schema_version()
        status_["schema"] = "current" if stale is None else "stale"
        if stale is not None:
            status_["status"] = "degraded"
            status_["schema_detail"] = stale
    return JSONResponse(
        status_code=200 if status_["status"] == "ok" else 503,
        content=status_,
    )


app.include_router(api_router, prefix=settings.API_V1_PREFIX)
