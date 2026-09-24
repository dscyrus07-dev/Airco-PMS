"""
arq worker configuration — run with:

    arq app.workers.settings.WorkerSettings

A single worker process owns BOTH the cron schedule and the API-enqueued
job queue — one Redis, one queue system. Scale by running more replicas;
the DB ledger + Redis locks keep generation idempotent under N workers.
"""

from arq import cron
from arq.connections import RedisSettings

from app.core.config import settings
from app.core.database import close_db
from app.core.logging import setup_logging
from app.workers.jobs import generation_tick

setup_logging()


async def startup(ctx: dict) -> None:
    ctx["started_at"] = __import__("time").time()


async def shutdown(ctx: dict) -> None:
    await close_db()


def _redis_settings() -> RedisSettings:
    if not settings.REDIS_URL:
        raise RuntimeError(
            "REDIS_URL is required to run the worker — the job queue and "
            "cron scheduler live on Redis."
        )
    rs = RedisSettings.from_dsn(settings.REDIS_URL)
    rs.conn_timeout = int(settings.REDIS_CONNECT_TIMEOUT)
    return rs


class WorkerSettings:
    redis_settings = _redis_settings()

    functions = [generation_tick]
    cron_jobs = [
        # every minute — the template/repetitive generation sweep
        cron(generation_tick, minute=set(range(60)), unique=True,
             timeout=120, max_tries=1),
    ]

    max_jobs = 20
    job_timeout = 300          # seconds — generation sweeps are the longest jobs
    max_tries = 3              # retries for API-enqueued jobs (backoff built in)
    poll_delay = 0.5
    on_startup = startup
    on_shutdown = shutdown
    handle_signals = True      # SIGTERM → finish in-flight jobs, then exit
