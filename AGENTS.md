# Management Tool — codebase map

Property operations management SaaS (a.k.a. "AiROS" / "Airco PMS"). Multi-tenant:
a `Company` owns `Property`s; non-super-admin users are scoped by
`user.property_id`. Five roles: `super_admin`, `property_manager`,
`human_resource`, `department_manager` (reserved, no surface), `employee`.

## Layout

```
main.py                 # dev launcher: frees :8000/:3000, runs uvicorn --reload + vite dev
backend/                # FastAPI + SQLAlchemy 2 async + asyncpg + Alembic
  app/main.py           # lifespan, middleware, /health /ready, embedded scheduler toggle
  app/api/v1/           # router.py mounts: auth, workspace (~86 routes), media,
                        #   work_batches, templates, hr — all under /api/v1
  app/domain/           # pure state-transition rules (resource_states,
                        #   transitions, resource_events)
  app/core/             # config.py (pydantic-settings, single config source), database,
                        #   security (JWT HS256 30min + hashed refresh tokens 30d, argon2),
                        #   redis, queue (arq), rate_limit, storage (local/s3/supabase)
  app/dependencies/auth.py  # get_current_user, require_role; company_id = tenant scope
  app/models/           # see Domain below
  app/services/         # business logic (Router → Service → Repository → SQLAlchemy)
  app/repositories/     # data access; workspace.py holds company/property scoping
  app/workers/          # arq: generation_tick cron every minute + Redis dedupe lock
  alembic/versions/     # 30 migrations; NEVER hand-edit prod schema
  tests/                # pytest-asyncio suite (sqlite) — 111 tests
  scripts/sync_local_uploads.py  # pushes local uploads/ to remote storage
frontend/               # React 19 + TS + Vite 8 + Tailwind v4 + react-router-dom 7
  src/App.tsx           # routes + RequireAuth/RequireRole/PropertyScopedView guards
  src/context/AppContext.tsx  # god-context: session, all collections, all mutations, toasts
  src/api/              # thin wrappers over apiFetch (client.ts: bearer, refresh-on-401 once)
  src/lib/permissions.ts      # client-side can() mirror of role rules
```

## Domain model (Postgres is the only source of truth)

- **Structure**: Property → Area (floor levels) → Zone (`zone_type`; only `stay`
  holds rooms/dorms) → Room | Dorm → Bed. Washroom: dorm-attached (`dorm_id`
  set, 1-per-dorm unique) or zone-level. WashroomFixture = real per-fixture
  rows w/ own status (`operational|maintenance|inactive`).
- **Occupancy**: `occupancies` rows are the occupancy truth — open iff
  `checked_out_at IS NULL`; room- or bed-scoped. `occupied` is illegal
  without an open row; checkout closes the row + spawns the cleaning task +
  flips to `cleaning` atomically (`services/occupancy.py`). Dorm occupancy
  is derived from its beds.
- **Task**: `pending → assigned → in_progress → submitted → completed`, or
  `reopened` on reject. Evidence via TaskCompletionSubmission (attempts) +
  TaskCompletionImage. `task_type`: fixed | repetitive | automated
  (`automation_rule` JSONB). `series_id` links recurring clones.
  Partial unique index `uq_tasks_open_room_title` = one open task per
  (property, room, title).
- **MaintenanceTicket**: `open → assigned → in_progress → on_hold → resolved
  → closed | cancelled`; disapprove reopens. Exactly one target:
  room | dorm | bed | washroom(+fixture). `MT-YYYY-NNNNN` from PG sequence.
- **WorkTemplate**: JSONB config (assignment/location/schedule/checklist/
  verification/overdue/notifications), versioned (WorkTemplateVersion);
  `next_run_at` drives the scheduler; TemplateGeneration ledger
  (`template_id + occurrence_key` unique) makes generation idempotent.
- **Work allocation** (`services/work_allocation.py`): persistent zone
  round-robin (ZoneAllocationState row locked FOR UPDATE), area-level
  employee pool as fallback, department eligibility by work_type
  (cleaning→housekeeping, maintenance→maintenance/engineering).
  WorkAllocationBatch = one POST → N tickets, one employee per unit.
  Manual reassign never moves the pointer; everything audited in
  WorkAllocationHistory.
- **ResourceStateService** (`services/resource_state.py`): THE authoritative
  status writer for room/bed/dorm/washroom/fixture. All status writes funnel
  through `transition()` / `derive()` / `repair()`; status is DERIVED from
  blocking work (open maintenance → "maintenance", open cleaning task →
  "cleaning") + open occupancy. Rows locked FOR UPDATE; tenant scope checked
  per resource; only supervisor approval releases a resource. Canonical
  states + the legal transition table live in `app/domain/`.
- **Reconciliation** (`services/reconciliation.py`): read-only drift scan;
  repair goes through `POST /resources/{type}/{id}/repair` (super_admin).
- **Audit**: `audit_events` (entity lifecycle, actor, property-scoped) +
  `allocation_events` + per-ticket/task event streams.

## Scheduling & infra

- Dev (`RUN_EMBEDDED_SCHEDULER=true`, default): asyncio loop in the API ticks
  `TemplateService.run_due()` + `TaskService.run_due_repetitive()` every 60s.
- Prod: arq worker owns the tick (`generation_tick` cron); API stays
  stateless. Redis lock `mt:lock:generation-tick` + DB ledger dedupe.
- Redis: rate limit (sliding window, in-memory fallback), arq queue, tick
  lock. Optional in dev, required for worker.
- Media: `POST /media/uploads` → `STORAGE_BACKEND` local (`/uploads` mounted)
  or S3/Supabase storage (`auto` picks S3 when creds exist).

## Frontend notes

- `apiFetch` throws `ApiError` (status + fieldErrors); on 401 tries
  `/auth/refresh` once then fires `onUnauthorized` → AppContext logout.
- All wire IDs are `*_uid` strings; backend serializes UUID → `*_uid` in
  `schemas/*/…_out()` mappers.
- `WorkspaceGate` shows skeleton/error states; views are React.lazy.
- Mutations update AppContext collections directly; `refreshUnits()`
  re-pulls rooms/dorms/washrooms after approve/reject/reopen (server
  re-derives statuses).

## Commands

```bash
python main.py                                     # dev: backend :8000 + frontend :3000
cd frontend && npx tsc --noEmit && npm run build         # typecheck + build
cd backend && alembic upgrade head                       # migrate
docker compose up --build                                # full stack :8080
```

Env: backend reads `backend/.env` (see `.env.example` files). Required:
`DATABASE_URL` or `SUPABASE_DB_PASSWORD`, `JWT_SECRET_KEY` (fatal in prod),
`REDIS_URL` (worker only), `CORS_ORIGINS`, `STORAGE_BACKEND`+`S3_*`.

Deploy: Railway (api + arq worker + Redis), Vercel (frontend SPA),
Supabase (Postgres + S3 storage). CI: `.github/workflows/ci.yml`.

## Gotchas

- `cd backend && python -m pytest tests/ -x -q` — 111 tests (sqlite,
  pytest-asyncio) covering allocation fairness, occupancy, lifecycle, and
  the resource-state pipeline.
- `SUPABASE_DB_HOST` has a hardcoded project default in config.py.
- `backend/uploads/` holds real dev-uploaded images referenced by the DB —
  gitignored, but do not delete casually.
- `frontend/API.md` + `backend/API.md` are the API contract docs; keep in sync.
- Backend route permission shortcut: `Staff = Depends(require_property_manager)`
  (super_admin + property_manager).
