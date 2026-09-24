# Management Tool

Property operations management SaaS — staff allocation, zones/rooms/dorms,
task & maintenance workflows, template-driven scheduled work generation.

## Architecture

```
Browser ──► nginx (SPA + reverse proxy) ──► FastAPI API ──► PostgreSQL (source of truth)
                                                │
                                                ▼
                                            Redis ──► arq worker
                                          (cache · rate limiting · queue · cron)
```

- **backend/** — FastAPI + SQLAlchemy 2 async + asyncpg + Alembic
- **frontend/** — React 19 + TypeScript + Vite + Tailwind, built SPA served by nginx
- **worker** — `arq` process (same backend image): cron-scheduled template/repetitive task generation + enqueued jobs
- **Redis** — rate limiting, job queue, distributed tick lock, cache. Optional in dev; required in production for the worker.
- **PostgreSQL** — the only source of truth. Redis never stores business data.

## Quick start (local, no Docker)

```bash
cd backend && cp .env.example .env   # fill SUPABASE_DB_PASSWORD / JWT_SECRET_KEY
python main.py                     # repo root: boots backend :8000 + frontend :3000
```

The embedded scheduler runs inside the API in this mode (`RUN_EMBEDDED_SCHEDULER=true`).

## Docker — full stack

```bash
cp .env.example .env               # set JWT_SECRET_KEY at minimum
docker compose up --build          # → http://localhost:8080
```

Services: `postgres`, `redis`, `migrate` (one-shot alembic), `api`, `worker` (arq cron), `frontend` (nginx :80).

## Production

```bash
# required env: DATABASE_URL, REDIS_URL, JWT_SECRET_KEY, CORS_ORIGINS (+S3_*)
docker compose -f docker-compose.prod.yml run --rm api alembic upgrade head
docker compose -f docker-compose.prod.yml up -d --build
```

Production runs with `RUN_EMBEDDED_SCHEDULER=false` — the arq worker owns
all scheduled generation; the API stays stateless and scales horizontally
(`--scale api=N`). Worker replicas self-dedupe via a Redis lock + the
`template_generations` ledger.

### Endpoints

- `GET /health` — liveness (process up)
- `GET /ready` / `GET /api/v1/health` — readiness (DB + Redis probes; 503 when degraded)
- `/docs` — OpenAPI (non-production only)

### Migrations

```bash
cd backend && alembic upgrade head     # always before/with deploys
```

Never hand-edit the production schema; all changes go through Alembic.

### Environment variables

See `backend/.env.example` (API) and `.env.example` (compose). Key ones:
`DATABASE_URL` or `SUPABASE_DB_*`, `REDIS_URL`, `JWT_SECRET_KEY` (required in prod — boot fails without it), `CORS_ORIGINS`, `STORAGE_BACKEND` + `S3_*`, `RUN_EMBEDDED_SCHEDULER`, `RATE_LIMIT_ENABLED`.

### Backups

Docker volumes are **not** backups. Use managed Postgres backups
(Supabase: automatic daily) or schedule `pg_dump` off-host; document
restore RTO/RPO before go-live. Uploads belong in object storage
(`STORAGE_BACKEND=s3`), which provides its own durability.

## Tests

```bash
cd backend && .venv/Scripts/python -m pytest tests/ -q   # SQLite, no services needed
cd frontend && npx tsc --noEmit && npm run build
```
