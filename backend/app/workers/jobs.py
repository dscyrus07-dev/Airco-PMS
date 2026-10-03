"""
arq worker jobs — every job takes `ctx` first and returns a small dict.

Scheduling model:
    * `generation_tick` runs via cron every minute inside the WORKER process
      (not the API). Both sweeps are idempotent at the DB layer — the
      template_generations ledger and task series dedupe make a double-run
      harmless — and a Redis lock prevents N workers from running the same
      tick concurrently.
    * API-enqueued jobs land here too; keep payloads JSON-serializable.

Failure model:
    arq retries failed jobs (max_tries) with backoff; a job that exhausts
    retries is logged loudly. Worker SIGTERM → arq finishes in-flight jobs
    then exits (graceful by default).
"""

from app.core.database import AsyncSessionLocal
from app.core.logging import get_logger
from app.core.redis import get_redis

logger = get_logger("app.worker")

_TICK_LOCK_KEY = "mt:lock:generation-tick"
_TICK_LOCK_TTL_MS = 55_000  # < cron interval — a dead worker can't wedge the tick


async def generation_tick(ctx: dict) -> dict:
    """Minute cron — generate due template work + advance repetitive series.

    Distributed lock: only one worker runs the tick when several exist.
    The DB-level idempotency is the real guarantee; the lock just avoids
    duplicated work and log noise.
    """
    redis = await get_redis()
    if redis is not None:
        try:
            acquired = await redis.set(_TICK_LOCK_KEY, "1", nx=True, px=_TICK_LOCK_TTL_MS)
            if not acquired:
                return {"skipped": "locked"}
        except Exception:
            pass  # lock is an optimization; idempotency is the guarantee

    from app.services.task import TaskService
    from app.services.template import TemplateService
    from app.services.rollover import RolloverService

    # Order is load-bearing: occurrence expiry runs BEFORE generation so
    # a still-open predecessor releases its (property, room, title) slot
    # and never blocks the next recurring instance.
    async with AsyncSessionLocal() as session:
        exp = await RolloverService(session).expire_due()
    async with AsyncSessionLocal() as session:
        tpl = await TemplateService(session).run_due()
    async with AsyncSessionLocal() as session:
        rep = await TaskService(session).run_due_repetitive()
    async with AsyncSessionLocal() as session:
        roll = await RolloverService(session).run()

    result = {"expiry": exp, "templates": tpl,
              "repetitive": rep, "rollover": roll}
    if tpl["generated"] or rep["generated"] \
            or roll["abandoned"] or exp["expired"]:
        logger.info("Generation tick: %s", result)
    return result


_RECON_LOCK_KEY = "mt:lock:reconcile-tick"
_RECON_LOCK_TTL_MS = 10 * 60_000  # < cron interval


async def reconciliation_tick(ctx: dict) -> dict:
    """Periodic resource-state reconciliation — DETECT + LOG only.

    Reports projection drift (occupancy conflicts, unflagged work, orphan
    states) per property. It never mutates: safe corrections go through
    ResourceStateService.repair() (POST /resources/{type}/{id}/repair).
    """
    redis = await get_redis()
    if redis is not None:
        try:
            acquired = await redis.set(
                _RECON_LOCK_KEY, "1", nx=True, px=_RECON_LOCK_TTL_MS
            )
            if not acquired:
                return {"skipped": "locked"}
        except Exception:
            pass

    from sqlalchemy import select

    from app.models.property import Property
    from app.services.reconciliation import reconcile_property

    total = 0
    async with AsyncSessionLocal() as session:
        prop_ids = (await session.execute(
            select(Property.id)
        )).scalars().all()
        for pid in prop_ids:
            findings = await reconcile_property(session, pid)
            actionable = [
                f for f in findings if f.get("severity") != "info"
            ]
            if actionable:
                logger.warning(
                    "State reconciliation — property %s: %d finding(s): %s",
                    pid, len(actionable),
                    [
                        f"{f['issue']} {f['resource_type']}:{f['label']}"
                        for f in actionable
                    ],
                )
            total += len(actionable)
    return {"findings": total}
