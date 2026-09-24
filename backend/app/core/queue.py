"""
Job enqueue helper — the API's door into the arq queue.

`enqueue()` returns the arq Job on success, None when the queue is
unavailable (Redis down/unconfigured). Callers decide whether a failed
enqueue is fatal: for work that MUST happen, fall back to running inline
rather than dropping it silently.
"""

import arq
import arq.jobs

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("app.queue")

_pool: arq.ArqRedis | None = None


async def _get_pool() -> arq.ArqRedis | None:
    global _pool
    if not settings.REDIS_URL:
        return None
    if _pool is None:
        try:
            _pool = await arq.create_pool(
                arq.connections.RedisSettings.from_dsn(settings.REDIS_URL)
            )
        except Exception as exc:
            logger.warning("Job queue unavailable (%s)", type(exc).__name__)
            return None
    return _pool


async def enqueue(job_name: str, *args, _defer_by=None, **kwargs) -> arq.jobs.Job | None:
    """Enqueue `job_name` for a worker. None when the queue is down."""
    pool = await _get_pool()
    if pool is None:
        logger.warning("Job %r dropped — queue unavailable", job_name)
        return None
    return await pool.enqueue_job(job_name, *args, _defer_by=_defer_by, **kwargs)


async def close_queue() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
