# AiROS / Management Tool — Codebase Index

Deep codebase index for `C:\Users\ADMIN\Desktop\tool_21`. Companion to
`AGENTS.md` (which holds operating rules); this file is the *map*.

Property-operations management SaaS. Multi-tenant: `Company` owns
`Property`s; non-super-admin users are scoped by `user.property_id`.
Roles: `super_admin`, `property_manager`, `human_resource`,
`department_manager` (reserved), `employee`.

---

## 1. Repo layout

```
main.py                     # dev launcher: frees :8000/:3000, uvicorn --reload + vite dev
backend/                    # FastAPI + SQLAlchemy 2 async + asyncpg + Alembic
  app/main.py               # lifespan, middleware, /health /ready, embedded scheduler
  app/api/v1/               # router.py mounts everything under /api/v1
  app/core/                 # config, db, security, redis, queue, rate_limit, storage
  app/dependencies/auth.py  # get_current_user, require_role (company_id = tenant scope)
  app/domain/               # resource state transitions (pure domain layer)
  app/models/               # SQLAlchemy ORM models
  app/repositories/         # data access; workspace.py holds company/property scoping
  app/schemas/              # pydantic request/response + *_out() UUID→uid mappers
  app/services/             # business logic (Router → Service → Repository → ORM)
  app/workers/              # arq worker: jobs.py + settings.py
  alembic/versions/         # 28 migrations (never hand-edit prod schema)
  scripts/sync_local_uploads.py
  tests/                    # pytest-asyncio suite (111 tests)
frontend/                   # React 19 + TS + Vite 8 + Tailwind v4 + react-router-dom 7
  src/App.tsx               # routes + RequireAuth/RequireRole/PropertyScopedView
  src/context/AppContext.tsx# god-context: session, collections, mutations, toasts
  src/api/                  # thin wrappers over apiFetch + types.ts
  src/components/           # feature views (below)
  src/lib/                  # utils: permissions, task/maintenance/washroom/zone helpers
  src/hooks/usePolling.ts   # view-aware polling hook
  src/dev/perf.ts           # phase-1.1 perf instrumentation
```

Also: `AGENTS.md` (rules), `backend/API.md` + `frontend/API.md` (API
contract docs), `.github/workflows/ci.yml`, `docker-compose.yml`,
`backend/railway.toml` (Railway deploy), `backend/uploads/` (real dev
images referenced by DB rows — gitignored, do NOT delete).

## 2. Backend files — what each owns

### api/v1/

| File | Contents |
|---|---|
| `router.py` | mounts auth, workspace, media, work_batches, templates, hr |
| `auth.py` | POST /login, /signup, /refresh, /logout; GET+PATCH /me |
| `workspace.py` | ~86 routes — the operational core (properties, areas, zones, rooms, dorms, beds, washrooms, employees, tasks, maintenance, occupancy check-in/out, resource transitions/repair, units/bulk-status) |
| `templates.py` | WorkTemplate CRUD + pause/resume/activate/archive/duplicate/history/generated-work/generate-occurrence/generate-due |
| `media.py` | POST /media/uploads (local|S3|Supabase storage backend) |
| `work_batches.py` | POST /work-batches (bulk assign), GET batch, per-property list |
| `hr.py` | HR dashboard, HR employee CRUD, task dashboards/timeline, admin HR-account management |

### core/

`config.py` (pydantic-settings, single config source), `database.py`
(async engine/session), `security.py` (JWT HS256 30min + hashed refresh
30d, argon2), `redis.py`, `queue.py` (arq), `rate_limit.py` (sliding
window + in-memory fallback), `storage.py` (local /s3 /supabase),
`middleware.py` (request-id + access log), `exceptions.py`, `logging.py`.

### domain/ — pure state-transition rules

| File | Role |
|---|---|
| `resource_states.py` | canonical operational states per resource type |
| `transitions.py` | legal transition table + reasons |
| `resource_events.py` | event vocabulary feeding state machine |

### models/ (ORM)

| File | Tables / key fields |
|---|---|
| `company.py` | `companies` |
| `property.py` | `properties` (+`manager_employee_id`) |
| `structure.py` | `areas`, `zones`, `rooms`, `dorms`, `beds`, `washrooms`, `washroom_fixtures` (per-fixture status rows) |
| `employee.py` | `employees` (department, status, leave_status, zone_id, area_id, `employee_is_assignable()`) |
| `user.py` | `users` (role, property_id, employee_id link) |
| `occupancy.py` | `occupancies` — open row iff `checked_out_at IS NULL`; room or bed scoped |
| `task.py` | `tasks` (zone_id/area_id/room_id/dorm_id/bed_ids/washroom_id all nullable, template provenance, allocation fields, recurrence), `task_completion_submissions`, `task_completion_images` |
| `maintenance.py` | `maintenance_tickets` (one target: room|dorm|bed|washroom+fixture), `maintenance_ticket_events`, `maintenance_ticket_attachments` |
| `template.py` | `work_templates` (JSONB: assignment/location/schedule/checklist/verification/overdue/notifications; `TEMPLATE_TYPES`), `work_template_versions`, `template_generations` (occurrence ledger) |
| `work_allocation.py` | `work_allocation_batches`, `work_allocation_history`, `zone_allocation_states` (rotation pointer row) |
| `allocation.py` | `allocation_events` |
| `audit.py` | `audit_events` |
| `resource_state_event.py` | `resource_state_events` |
| `refresh_token.py` | `refresh_tokens` |

### services/ — business logic

| File | Responsibility |
|---|---|
| `resource_state.py` | **ResourceStateService** — THE authoritative status writer. `transition()`, `derive()`, `repair()`. All status writes funnel here |
| `task.py` (~1300) | `TaskService` — task CRUD, lifecycle (start/submit/approve/reject/reopen/complete), repetitive-series engine, evidence |
| `task_ops.py` | task assignment/bulk-ops helpers |
| `task_location.py` | `resolve_task_location()` — room/dorm/bed/washroom → zone/area resolution |
| `template.py` (~1290) | `TemplateService` — template CRUD+validate, `_expand_targets` (condition resolver), `_structure` per-run snapshot (incl. open-occupancy id sets + derived dorm occupancy), `_generate`/`_generate_for_target`/`_make_task`/`_make_ticket`, dedupe (`_open_task_exists` + savepoint), people pools (`_people_pool`, `allocate_people` callers) |
| `work_allocation.py` (~820) | `WorkAllocationService` — `allocate()` (zone/area/property pools), `allocate_people()` (named/team/dept pools), `_fair_pick` (workload-first + rotation), `_locked_state`/`_locked_area`/`_locked_property` (FOR UPDATE), `_active_workloads`, `infer_task_work_type`, `WORK_TYPE_DEPARTMENTS` |
| `maintenance.py` (~850) | `MaintenanceService` — ticket lifecycle incl. `flag_ticket_resource` (blocking tickets flag resource via state engine) |
| `occupancy.py` | `OccupancyService` — check-in/out (room + bed) |
| `structure.py` (~2050) | `StructureService` — CRUD for areas/zones/rooms/dorms/beds/washrooms/fixtures; `ValidationErr`; bulk ops; units listing |
| `employee.py` | `EmployeeService` — employee CRUD, zone/area assignment, deactivate/reactivate |
| `property.py` | property/company CRUD |
| `audit.py` | audit event writes |
| `auth.py` | login/signup/refresh/me |
| `reconciliation.py` | drift repair — resource state vs reality sweep |

### workers/

`jobs.py`: `generation_tick` cron (every minute) → `TemplateService.run_due()`
+ `TaskService.run_due_repetitive()` under Redis lock `mt:lock:generation-tick`
(55s TTL); `reconciliation_tick`. `settings.py`: arq WorkerSettings.

### tests/ (pytest-asyncio, sqlite)

`conftest.py` (session/seed fixtures), `test_allocation.py` (pool
fairness: zone+area union, workload-first, dedupe, dept gating,
people pools, property/area levels), `test_state_pipeline.py`
(occupancy → state → task pipeline + template expansion/condition
matrix), `test_occupancy.py`, `test_lifecycle.py`,
`test_resource_state.py`. **111 passing.**

## 3. Frontend files — what each owns

### api/ (thin wrappers over `apiFetch`)

`client.ts` (bearer + refresh-on-401 + ApiError), `types.ts` (**all wire
types — single source**; `*_uid` strings everywhere), `auth.ts`,
`companies.ts`, `properties.ts`, `areas.ts`, `zones.ts`, `rooms.ts`,
`dorms.ts`, `washrooms.ts`, `employees.ts`, `tasks.ts`,
`maintenance.ts`, `templates.ts`, `media.ts`, `hr.ts`, `index.ts`.

### context/

`AppContext.tsx` — session/user, all collections (rooms/dorms/beds/
washrooms/zones/areas/employees/tasks/tickets/templates), every
mutation (task lifecycle, ticket actions, occupancy toggles), toasts,
**unit-deselect pub/sub** (`subscribeUnitDeselect` — emits
room/bed/dorm/washroom uids on completed/closed transitions, both local
mutations and poll-observed transitions), view-aware polling via
`usePolling`.

### components/

| Dir | Files / role |
|---|---|
| `auth/` | `Login`, `Signup`, `FormField`, `PasswordInput` |
| `landing/` | marketing page (Hero/Features/Roles/Operations/ProductPreview/CTA/Footer/Header/LandingPage) |
| `navigation/` | `Header.tsx` (top nav + property breadcrumb + clock) |
| `properties/` | `PropertiesView`, `CreatePropertyModal` |
| `zones/` | `ZonesView` (area/zone board), `ZoneWorkspace` (zone detail + unit selection sets), `CreateAreaModal`, `CreateZoneModal` |
| `rooms/` | `RoomsDormsView` (main units grid — rooms+dorms+beds, selection sets, occupancy), `UnitZoneBoard`, `OccupancyToggle`, create/edit/bulk modals for rooms/dorms/washrooms, `WashroomsView`, `WashroomDetailModal`, `AssignWashroomTaskModal`, `ScheduleWashroomMaintenanceModal` |
| `tasks/` | `TasksView` (admin board, live/submitted/history tabs), `TodayTasksView`, `TaskHistoryView`, `PendingCheckView`, `TaskDetailDrawer`, `CreateTaskModal`, `CompletionEvidenceLightbox` |
| `maintenance/` | `MaintenanceView` (Current Live / History nav, raise/edit tickets), `CreateMaintenanceModal` |
| `templates/` | `TemplatesView` (cards + status filter + Premade library), `TemplateWizard` (7-step: Basics→Assignment→Condition→Schedule→Instructions→Verify→Review), `TemplateDetailDrawer` |
| `employees/` | `EmployeesView` (Zone Board / Active / Deactivated tabs), `EmployeeDirectory`, `ZoneBoard` (drag staff between zones/areas), `CreateEmployeeModal` |
| `employee_views/` | `EmployeeTasksView` (My tasks: live/submitted/completed tabs + assigned tickets), `RaiseMaintenanceTicketView`, `ProfileView` |
| `hr/` | `HrEmployeesView`, `HrTasksView` |
| `admin/` | `AdminEmployeesView`, `AdminSettingsView`, `HrAccountsCard` |
| `ui/` | `Button`, `Card`, `Modal`, `Drawer`, `Badge`, `ConfirmationDialog`, `Skeleton`, `ToastContainer` |

### lib/

`permissions.ts` (client-side `can()` role mirror), `taskUtils.ts`,
`maintenanceUtils.ts`, `washroomFixtures.ts`, `zoneUtils.ts`,
`employeeUtils.ts`, `mediaLimits.ts`, `utils.ts`. `dev/perf.ts` =
instrumentation. `hooks/usePolling.ts`.

## 4. Domain architecture (the important invariants)

### Resource lifecycle — the AiROS spine

```
TASK → allocation → employee work → submit → PM approval
     → ResourceStateService.transition() → entity state
     → derived visual → UI
```

- **`ResourceStateService` is the ONLY status writer.** Room/bed/dorm/
  washroom status is *derived* (open maintenance → "maintenance", open
  cleaning → "cleaning"); never set directly. Rows locked FOR UPDATE.
- Room/bed operational status = f(open blocking work). Occupancy is a
  **separate axis**: `occupancies` rows, open iff `checked_out_at IS NULL`.
- Dorm occupancy is **derived**: occupied iff ≥1 bed has open occupancy.

### Work allocation (the unified pool)

```
task type → scope → resolve resources OR people → eligible pool
  = zone staff ∪ covering-area staff   (zone-level)
  = area staff ∪ staff of area's zones  (area-level)
  = all in-scope property employees     (property-level)
  = named ∪ team ∪ department           (people pools)
  → dept/work-type filter → active+not-on-leave → dedupe
  → sorted created_at (scope-agnostic) → least-loaded wins,
    rotation (per work_type+level, history-based) breaks ties
```

- Locks: `ZoneAllocationState` FOR UPDATE (zone) · `Area` row (area) ·
  `Property` row (property/people).
- Empty pool → UNASSIGNED (`no_eligible_employee`), never scattered.
- `WORK_TYPE_DEPARTMENTS`: cleaning/housekeeping→housekeeping-ish;
  maintenance→maintenance/engineering; operations/inspection/task/
  checklist/other→ungated.
- Manual reassign never moves the rotation pointer.

### Templates

- `location` JSONB IS the condition model: `scope` (property|area|zone|
  rooms|dorms|beds|washrooms|units) + `target` (rooms|beds|dorms|
  washrooms|units|rooms_beds) + `occupancy` (all|occupied|unoccupied) +
  `zone_uid`/`area_uid`/*_uids. Legacy `occupied_only` = occupied alias.
- `assignment.mode`: automatic | individual | employees | team | department.
- Generation: `run_due → _generate → _expand_targets → resolve_task_location
  → WorkAllocationService.allocate/allocate_people → _make_task/_make_ticket`;
  idempotent via `template_generations` ledger + `uq_tasks_open_room_title`
  savepoint. Conditions resolve live at generation time (rule stored,
  never a snapshot).
- Template types: `housekeeping`, `maintenance`, `operations`,
  `inspection`, `other` (+legacy `task`, `cleaning`, `checklist` kept
  for compat — 'cleaning' maps to housekeeping eligibility).

### Task lifecycle

`pending → assigned → in_progress → submitted → completed` (+`reopened`
on reject, `cancelled`). Evidence = `task_completion_submissions`
attempts + images. `origin`: manual | template | checkout | …
`task_type` = lifecycle shape (fixed | repetitive | automated), NOT the
operating department — that's `infer_task_work_type`.

Maintenance tickets: `open → assigned → in_progress → on_hold → resolved
→ closed|cancelled`; disapprove→reopen.

## 5. API surface (all under `/api/v1`)

- **auth**: login, signup, refresh, logout, me
- **structure**: areas/zones/rooms/dorms/beds/washrooms CRUD + bulk +
  `/allocation` zone-assign endpoints
- **occupancy**: `rooms/{id}/check-in|check-out`, `beds/{id}/check-in|out`,
  `dorms/{id}/checkout`
- **state**: `resources/{type}/{id}/transition`, `…/repair`,
  `units/bulk-status`, `properties/{id}/reconciliation`
- **employees**: CRUD + `/zone` `/allocation` `/deactivate` `/reactivate`
- **tasks**: CRUD + today/history/pending-check + start/complete/submit/
  approve/reject/reopen/request-redo/assignee/completion-images
- **maintenance**: CRUD + eligible-locations + assign/start/hold/
  resolve/disapprove/close
- **templates**: CRUD + pause/resume/activate/archive/duplicate/history/
  generated-work/generate-occurrence/generate-due
- **media**: uploads
- **work-batches**: create/get/list
- **hr**: dashboard, employee CRUD, task dashboards/timeline, admin hr

Route permission shortcut: `Staff = Depends(require_property_manager)`.

## 6. Infra & operations

- **DB**: Supabase Postgres (ap-south-1 / Mumbai), asyncpg driver.
  Env: `DATABASE_URL` or `SUPABASE_DB_*` parts; `SUPABASE_DB_HOST` has a
  hardcoded project default in `config.py`.
- **Scheduler**: dev = embedded asyncio loop (`RUN_EMBEDDED_SCHEDULER`,
  60s tick); prod = arq worker cron + Redis dedupe lock.
- **Redis**: rate-limit, arq queue, tick lock. Optional in dev.
- **Storage**: `STORAGE_BACKEND` local (`/uploads`) | s3 | supabase
  (`auto` → s3 when creds exist). `scripts/sync_local_uploads.py` pushes
  local files to remote.
- **Migrations**: 28 Alembic revisions — from `e01da4bc153a`
  (companies/users/tokens) through `l2c5d7e9f1a3` (task_origin). New
  schema changes → migration, never hand-edit.
- **Deploy**: Railway (api + arq worker + redis), Vercel (SPA),
  Supabase (db + storage). CI: `.github/workflows/ci.yml`.

## 7. Commands

```bash
python main.py                                  # dev: :8000 + :3000
cd backend && python -m pytest tests/ -x -q     # 111 tests
cd backend && alembic upgrade head              # migrate
cd frontend && npx tsc --noEmit && npm run build
docker compose up --build                       # full stack :8080
```

Env: `backend/.env` (required: `DATABASE_URL` or `SUPABASE_DB_PASSWORD`,
`JWT_SECRET_KEY`, `REDIS_URL` worker-only, `CORS_ORIGINS`, `STORAGE_BACKEND`+`S3_*`).

## 8. Conventions & gotchas

- All wire IDs are `*_uid` strings; `schemas/*_out()` mappers serialize UUID→uid.
- `apiFetch` throws `ApiError(status, fieldErrors)`; on 401 → `/auth/refresh` once → logout.
- Multi-tenant: `company_id` on users scopes everything; property_id scopes ops.
- WAN floor: DB is remote (Mumbai) — ~90–200ms/request minimum from dev.
- `backend/uploads/` = real images referenced by DB rows — do not delete.
- `frontend/API.md` + `backend/API.md` — keep in sync with route changes.
- WorkspaceGate → skeleton/error; feature views are React.lazy chunks.
