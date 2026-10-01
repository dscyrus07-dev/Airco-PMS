# Management Tool — Complete Feature & API Reference

> **AiROS / Airco PMS** — a multi-tenant property-operations SaaS. Companies own
> properties; property staff get work allocated via zones, units (rooms, dorms,
> beds), washrooms, tasks, maintenance tickets and scheduled work templates.

**Stack:** React 19 + TypeScript + Vite + Tailwind v4 + React Router 7 · FastAPI
+ SQLAlchemy 2 (async, asyncpg) + PostgreSQL (Supabase) · Redis (cache, rate
limiting, arq queue) + arq worker (cron `generation_tick` every minute) ·
Alembic migrations · Object storage (local `/uploads`, S3, or Supabase Storage).

**Base URLs:** API prefix `/api/v1` · dev backend `http://localhost:8000` ·
frontend `http://localhost:3000` · Swagger `http://localhost:8000/docs`.

---

## 1. Roles & Access Model

| Role | Scope | Capabilities |
|------|-------|--------------|
| `super_admin` | Company | Everything: properties, company profile, HR users, all property ops |
| `property_manager` | One property | Full ops for their property: structure, staff, tasks, tickets, templates |
| `human_resource` | Company | HR dashboard, employee lifecycle, task monitoring |
| `department_manager` | Department | Scoped work/team views |
| `employee` | Assigned zone(s) | Read-only structure; task + ticket execution (start/submit/resolve) |

- **Tenant scoping is server-side and authoritative:** every entity resolves to
  its property → `property.company_id == user.company_id`. Client-supplied
  company/property ids are never trusted for authorization.
- **JWT auth:** HS256 access token (30 min) + hashed opaque refresh token
  (30 d) in `refresh_tokens` table. Argon2id password hashing. `/auth/refresh`
  is a single-shot retry on 401 from the frontend client.
- **Rate limiting** via Redis middleware; uploads limited to 30/min/user.

---

## 2. Complete API Reference

All paths are under `/api/v1`. `Query` params noted where relevant.

### 2.1 Auth — `auth.py`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/signup` | Register company + first super_admin account |
| POST | `/auth/login` | Email/username + password → access + refresh tokens |
| POST | `/auth/refresh` | Exchange refresh token → new token pair (rotation) |
| POST | `/auth/logout` | Revoke the presented refresh token |
| GET | `/auth/me` | Current user profile (used as the session probe) |
| PATCH | `/auth/me` | Update own profile fields |

### 2.2 Workspace mega-router — `workspace.py`

**Properties & company**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/properties` | List properties (company-scoped) |
| POST | `/properties` | Create property (super_admin) |
| GET | `/properties/{id}` | Property detail |
| PATCH | `/properties/{id}` | Update property (name, location, manager, status) |
| DELETE | `/properties/{id}` | Delete property — cascades zones/units/staff/tasks |
| GET | `/companies/{id}` | Company profile |
| PATCH | `/companies/{id}` | Update company (name, brand, contact, address) |

**Structure: areas, zones, rooms**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/areas` | List areas (floors/building sections). `property_uid` |
| POST | `/areas` | Create area (name, level_number, description) |
| PATCH | `/areas/{id}` | Update area |
| DELETE | `/areas/{id}` | Delete area |
| GET | `/zones` | List zones. `property_uid`, `area_uid`, `zone_type`, `search` |
| POST | `/zones` | Create zone (name, floor, area, zone_type) |
| PATCH | `/zones/{id}` | Update zone (name/floor/area/type/status) |
| DELETE | `/zones/{id}` | Delete zone |
| GET | `/rooms` | List rooms. `property_uid`, `zone_uid`, `status`, `search` |
| POST | `/rooms` | Create single room |
| POST | `/rooms/bulk` | Range create — `start`/`end` + optional `prefix` → "Prefix NNN" |
| POST | `/rooms/bulk-delete` | Delete selected rooms (occupied rooms rejected) |
| PATCH | `/rooms/{id}` | Update room metadata (number, type, cleaning note, zone/area) — `status`/`current_guest` are NOT patchable |
| PATCH | `/rooms/{id}/allocation` | Move room to zone/area |
| POST | `/rooms/{id}/check-in` | Check in a guest `{guest_name}` → occupancy row + room `occupied` |
| POST | `/rooms/{id}/check-out` | Close occupancy + queue cleaning task → room `cleaning` (atomic) |
| DELETE | `/rooms/{id}` | Delete room |

**Dorms, beds & washrooms**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dorms` | List dorms with beds. `property_uid`, `zone_uid` |
| POST | `/dorms` | Create dorm — auto-creates `Bed 01…N` (`bed_count` ≤ 200) |
| POST | `/dorms/bulk` | All-or-nothing batch dorm creation (≤ 50 rows, all rows validated first) |
| PATCH | `/dorms/{id}` | Update dorm — `bed_count` resize grows appends / shrinks tail (non-available beds go `inactive`, never destroyed); rename re-derives `{dorm} - Washroom` names |
| PATCH | `/dorms/{id}/allocation` | Move dorm to zone/area |
| DELETE | `/dorms/{id}` | Delete dorm (occupied beds block deletion) |
| POST | `/dorms/{id}/checkout` | Check out every occupied bed |
| POST | `/dorms/{id}/mark-cleaning` | Flag all beds for cleaning |
| POST | `/dorms/{id}/mark-cleaned` | Acknowledge cleaning → beds available (super_admin) |
| POST | `/beds/{id}/check-in` | Check in a guest `{guest_name}` → occupancy row + bed `occupied`, dorm aggregates |
| POST | `/beds/{id}/check-out` | Close occupancy + queue cleaning task → bed `cleaning` (atomic) |
| GET | `/washrooms` | List washrooms. `property_uid`, `zone_uid`, `status`, `search` |
| POST | `/washrooms` | Create washroom — zone-level (`dorm_uid` null) or dorm-attached (`dorm_uid` set; name derived `{dorm} - Washroom`, zone/area inherited); fixture counts materialize real `washroom_fixtures` rows |
| POST | `/washrooms/bulk` | All-or-nothing batch washroom creation (one attached washroom per dorm enforced) |
| GET | `/washrooms/{id}` | Washroom detail with fixtures |
| PATCH | `/washrooms/{id}` | Update — count fields act as resize directives (grow appends, shrink removes from tail); dorm-owned renames ignored |
| PATCH | `/washrooms/{id}/allocation` | Move washroom between zones/areas |
| PATCH | `/washrooms/{id}/fixtures/{fid}` | Fixture transition `operational|maintenance|inactive` — super_admin only; `operational` auto-resolves+closes the fixture's blocking tickets |
| POST | `/resources/{type}/{id}/transition` | super_admin manual resource transition `{to, reason}` — legal-edge validated, `admin_override` audit |
| GET | `/properties/{id}/reconciliation` | Read-only state-consistency report (orphan occupied/cleaning/maintenance, invalid states) |
| DELETE | `/washrooms/{id}` | Delete washroom — task/ticket history preserved via `ON DELETE SET NULL` |
| GET | `/washrooms/{id}/maintenance` | Maintenance tickets for a washroom |
| GET | `/rooms/{id}/maintenance` | Maintenance tickets for a room |

**Bulk unit ops & employees**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/units/bulk-status` | `checkout`/`cleaning` are staff actions; `available`/`cleaned`/`maintenance` are super_admin-only; `cleaned` writes honest `admin_closed` task events |
| GET | `/employees` | List employees. `property_uid`, `zone_uid`, `department`, `status`, `search` |
| POST | `/employees` | Create employee (creates login user) |
| PATCH | `/employees/{id}` | Update profile fields |
| PATCH | `/employees/{id}/zone` | Zone assignment (or area-level — mutually exclusive) |
| PATCH | `/employees/{id}/allocation` | Dedicated allocation endpoint |
| POST | `/employees/{id}/deactivate` | Suspend employee (their tasks unassigned) |
| POST | `/employees/{id}/reactivate` | Re-enable employee |
| DELETE | `/employees/{id}` | Delete employee |

**Tasks**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks` | List tasks. `property_uid`, `zone_uid`, `status`, `search`, `limit` |
| GET | `/tasks/today` | Today's work for the caller |
| GET | `/tasks/history` | Completed/history view |
| GET | `/tasks/pending-check` | Submitted tasks awaiting supervisor approval |
| POST | `/tasks` | Create task — fixed/repetitive/automated; targets room/washroom/fixture; recurrence + automation rules |
| PATCH | `/tasks/{id}` | Partial update (fields, assignee, schedule, status) |
| DELETE | `/tasks/{id}` | Delete task |
| POST | `/tasks/{id}/start` | Employee begins work |
| POST | `/tasks/{id}/complete` | Finish work (photo_urls evidence, note) |
| POST | `/tasks/{id}/submit` | Submit for supervisor review |
| POST | `/tasks/{id}/approve` | Supervisor accepts → completed |
| POST | `/tasks/{id}/reject` | Supervisor rejects with reason |
| POST | `/tasks/{id}/request-redo` | Send back for rework |
| POST | `/tasks/{id}/reopen` | Reopen a completed/rejected task |
| PATCH | `/tasks/{id}/assignee` | Reassign |
| DELETE | `/tasks/{id}/completion-images/{image_id}` | Remove an evidence photo |

**Maintenance tickets**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/maintenance` | Create single ticket (exactly one of room/dorm/bed/washroom uid; optional fixture) |
| GET | `/maintenance/eligible-locations` | Locations that can receive tickets |
| GET | `/maintenance` | List tickets. `property_uid`, `status`, `zone_uid`, `search` |
| GET | `/maintenance/{id}` | Ticket detail + event timeline + attachments |
| PATCH | `/maintenance/{id}` | Edit ticket fields |
| DELETE | `/maintenance/{id}` | Delete ticket |
| POST | `/maintenance/{id}/assign` | Assign to employee (`null` unassigns) |
| POST | `/maintenance/{id}/start` | Assignee starts work → `in_progress` |
| POST | `/maintenance/{id}/hold` | Pause work → `on_hold` |
| POST | `/maintenance/{id}/resolve` | Employee marks done → `resolved` (notes + photos; template tickets enforce `photo_required`/`min_photos`); sets fixture `last_maintenance_at`, restores fixture to `operational` |
| POST | `/maintenance/{id}/disapprove` | Manager rejects a resolution → back to open |
| POST | `/maintenance/{id}/close` | Supervisor acknowledges → `closed` (releases the unit) |

### 2.3 Work batches — `work_batches.py`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/work-batches` | Grouped ticket creation — one POST; backend groups by zone and allocates each zone's batch to ONE employee via persistent round-robin (`SELECT FOR UPDATE` on the zone's allocation cursor; area-pool fallback; department eligibility by work type) |
| GET | `/work-batches/{id}` | Batch detail |
| GET | `/properties/{id}/work-batches` | List a property's batches |

### 2.4 Templates — `templates.py`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/templates` | Create work template (JSONB config: type, schedule, checklist, verification, assignment, location, overdue, notifications) |
| GET | `/templates` | List templates |
| GET | `/templates/{id}` | Template detail |
| PATCH | `/templates/{id}` | Update → version bump |
| DELETE | `/templates/{id}` | Delete |
| POST | `/templates/{id}/pause` / `/resume` | Pause/resume scheduling |
| POST | `/templates/{id}/activate` / `/archive` | Lifecycle transitions |
| POST | `/templates/{id}/duplicate` | Clone template |
| GET | `/templates/{id}/history` | Generation ledger |
| GET | `/templates/{id}/generated-work` | Tasks/tickets produced by the template |
| POST | `/templates/{id}/generate-occurrence` | Manual one-off generation |
| POST | `/templates/generate-due` | Generate all due templates (internal/scheduler) |

### 2.5 Media — `media.py`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/media/uploads` | Multipart image upload (JPEG/PNG/WebP/HEIC ≤ 10 MB; magic-byte validated; uuid object key). Returns `{url, key}`. Storage failure → clean 502 `STORAGE_UNAVAILABLE` |

### 2.6 HR & admin — `hr.py`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/hr/dashboard` | HR overview metrics |
| GET | `/hr/employees` | Company-wide employee list |
| POST | `/hr/employees` | HR creates employee |
| PATCH | `/hr/employees/{id}` | HR updates employee |
| POST | `/hr/employees/{id}/activate` / `/deactivate` | Lifecycle |
| GET | `/hr/employee-logs` | Employee activity logs |
| GET | `/hr/tasks/dashboard` | Company-wide task metrics |
| GET | `/hr/tasks` | All tasks across properties |
| GET | `/hr/tasks/{id}/timeline` | Full task event history |
| POST | `/admin/hr` | Super admin creates HR users |
| GET | `/admin/hr` | List HR users |
| POST | `/admin/hr/{user_id}/toggle` | Enable/disable HR account |

---

## 3. Feature Details & Interactions

### 3.1 Property structure hierarchy

```
Company → Property → Area (floor/section) → Zone (typed) → Units
                                              ├─ Room
                                              ├─ Dorm → Bed[]
                                              └─ Washroom → WashroomFixture[]
```

- **Zone types** drive capability: only stay-type zones hold rooms/dorms/beds
  (`zoneSupportsUnits`); washrooms can live in any zone. Non-stay zones render
  a dedicated empty state pointing at the staff board + tasks.
- **Allocation events** (`allocation_events` table) record every unit/employee
  zone move (`from_zone → to_zone`) — audit trail in `structure.py::_record`.
- **Dorm washroom is two things:** `dorm.washroom` is a *declared label*
  (`Attached Washroom | Shared Washroom | No Washroom`); the real resource is a
  `Washroom` row with `dorm_id` set — one per dorm, name derived
  `"{dorm} - Washroom"`, zone inherited from the dorm, independent fixture
  config. Dorm rename → washroom names re-derived. Declared-only facilities
  render a placeholder tile with a Configure path to materialize the record.
- **Washroom fixtures are real rows** — `washroom_fixtures(fixture_type,
  fixture_number, status, last_cleaned_at, last_maintenance_at)`. Count fields
  in create/update payloads are *resize directives*: grow appends numbered
  fixtures, shrink removes from the tail. Custom fixture types supported via
  `custom_fixtures: {label: count}`.

### 3.2 Unit status model — ONE authoritative state engine

- `ResourceStateService` (`app/services/resource_state.py`) is the **only**
  writer of `rooms/dorms/beds/washrooms/washroom_fixtures.status`. Every write
  validates the legal-transition table (`app/domain/transitions.py`), locks
  the row `FOR UPDATE`, and appends an immutable `resource_state_events` audit
  row. `OpsStatusService` is gone — its blocker logic lives in `derive()`.
- **Canonical states:** room/dorm `available|occupied|cleaning|maintenance`;
  bed +`inactive`; washroom `available|cleaning|maintenance|inactive`;
  fixture `operational|maintenance|inactive`. `needs_cleaning` is task-driven;
  `out_of_service`→`inactive`. Dorm lifecycle is `dorms.is_active`, separate
  from operational status. DB `CHECK` constraints enforce the sets.
- **Occupancy is authoritative**: `occupied` requires an open `occupancies`
  row (one-target CHECK + per-room/per-bed partial unique indexes). Check-in
  creates it; check-out closes it and — with a generated cleaning task —
  commits `occupied → cleaning` atomically (no `available` gap).
- **Blocking maintenance** = `{open, assigned, in_progress, on_hold,
  resolved}` — resolved still blocks until a supervisor **closes** it.
- **Flag-on-start:** creating/scheduling a cleaning task does NOT flag the
  resource; `start` does. Approvals release via `derive()` — never while
  other blocking work remains. Task delete re-derives (no stranded blocks).
- **Authorization:** only `super_admin` commits manual/releasing transitions
  (`/resources/{type}/{id}/transition`, bulk `available|cleaned|maintenance`,
  fixture ops, ticket close, resource-bound approvals). PM orchestrates
  (create/assign/delete); employees act only on assigned work.
- Bulk `cleaned` writes honest `admin_closed` task events — never fabricated
  approvals. Reconciliation is read-only (`/properties/{id}/reconciliation`).
- **Fixture→ticket sync:** fixture → `operational` resolves+closes the
  fixture's blocking tickets (`{fixture} restored to service` / `marked
  operational` events, actor = manager). Ticket `resolve()` → fixture
  `last_maintenance_at` + fixture back to `operational`.

### 3.3 Work allocation engine (`work_allocation.py`)

- **Persistent zone round-robin:** each zone keeps an allocation cursor;
  `POST /work-batches` locks it `FOR UPDATE`, groups tickets by zone, assigns
  each zone's batch to the next eligible employee.
- **Eligibility:** employee must be zone-assigned (or in the area pool as
  fallback) and department-eligible for the work type. Unassigned batches are
  still created with `allocation_status = unassigned`.
- Frontend never picks assignees when a batch is created — explicit assignee
  overrides happen per-ticket via `/maintenance/{id}/assign`.

### 3.4 Task lifecycle

- Types: `fixed` (one-off), `repetitive` (recurrence window fields), 
  `automated` (fired by triggers: `room_checked_out`,
  `bed_marked_cleaning`, `bed_available_after_checkout`).
- Flow: `open → in_progress (start) → submitted (submit + optional photos) →
  completed (approve)` — or `reject`/`request-redo` back to open, `reopen`.
- **Dedup:** partial unique index `uq_tasks_open_room_title` prevents duplicate
  open room tasks.
- Tasks can target a room, a washroom, or a **specific fixture**
  (`washroom_fixture_uid`, label denormalized for history).

### 3.5 Maintenance ticket lifecycle

`open → assigned → in_progress → (on_hold ↔ resumed) → resolved → closed`
or `cancelled`. `disapprove` kicks a `resolved` ticket back to work.

- Exactly one target: room / dorm / bed / washroom (+optional fixture).
  Bed tickets carry `dorm_id` as location context but flag only the bed;
  dorm tickets flag all non-occupied beds.
- Ticket numbers `MT-YYYY-NNNNN` from a PG sequence; append-only
  `maintenance_ticket_events` timeline (`created|assigned|started|held|
  resumed|resolved|closed|cancelled|edited|commented`); attachments split
  `issue` vs `resolution` kinds.
- Deleting a room/dorm/bed/washroom does **not** delete tickets —
  `ON DELETE SET NULL` preserves history with denormalized names.

### 3.6 Templates & scheduling (`template.py` + arq worker)

- Templates hold full JSONB config: schedule (`next_run_at`), checklist,
  verification (photo_required, min/max_photos, before/after), assignment
  strategy, location targeting, overdue rules, notifications.
- The arq worker runs `generation_tick` every minute: due `active` templates
  expand into tasks/tickets; `template_generations` ledger makes generation
  idempotent (no duplicates on retry/double-run).
- `RUN_EMBEDDED_SCHEDULER` runs the same tick in-process for single-process
  dev; production ownership is the arq worker.
- Ticket→template evidence gate: `resolve()` enforces the template's
  `photo_required`/`min_photos`.

### 3.7 Media & evidence

- `POST /media/uploads` is the single ingestion point — content-type
  allowlist + magic-byte signature check + 10 MB cap + uuid object keys
  (client filenames never trusted).
- Task completion photos, ticket issue/resolution photos, and fixture
  maintenance photos all land here; URLs stored on the domain records.
- Backends: `local` (`UPLOAD_DIR`, served from `/uploads` mount), `s3`
  (S3-compatible incl. Supabase S3), `supabase` (REST API, public bucket).
  `STORAGE_BACKEND=auto` prefers durable stores; dev default `local`.
- `storage_key_from_url()` reverse-maps stored URLs → object keys so delete
  paths can never delete arbitrary objects.

### 3.8 Multi-select / bulk operations (frontend)

- Rooms & beds support checkbox multi-select → bulk checkout / cleaning /
  cleaned / maintenance (one ticket per unit via `POST /work-batches` — or a
  single dorm ticket when the whole dorm is selected).
- Washroom fixtures support multi-select in the detail modal → bulk Assign
  Task, Allocate Maintenance (one ticket per fixture), Needs Cleaning, Mark
  Operational, Out of Service, Clear.
- Full-dorm selection produces ONE dorm ticket; partial selection → per-bed
  tickets.

---

## 4. Frontend Views & User Flows

Role-gated routes (`App.tsx` + `permissions.ts` mirrors backend roles):

| Route | View | Audience |
|-------|------|----------|
| `/admin/*` | Admin dashboard, companies, HR management | super_admin |
| `/property/:uid/zones` | `ZonesView` → `ZoneWorkspace` | manager/admin/employee |
| `/property/:uid/rooms` | `RoomsDormsView` (tabs: Rooms / Dorms / Washrooms / Zones) | manager/admin |
| `/property/:uid/employees` | Employee board + zone assignment | manager/admin |
| `/property/:uid/tasks` | Task list, kanban, approvals | manager/admin |
| `/property/:uid/templates` | Template builder/editor | manager/admin |
| `/property/:uid/maintenance` | Ticket board, detail, timeline | manager/admin |
| `/employee/*` | My tasks, zone board, my tickets | employee |
| `/hr/*` | HR dashboard, employees, task monitoring | human_resource |

**Zone Workspace** (`ZoneWorkspace.tsx`): header (zone name/type/area +
shortcuts to Tasks, Rooms & Dorms, Staff Board) → multi-select toolbar →
Private Rooms grid → Shared Dorms (bed grid led by the dorm's washroom tile)
→ zone-level Washrooms (dorm-owned washrooms excluded — they render inside
their dorm card). Every unit carries a Maintenance quick-action.

**Rooms & Dorms** (`RoomsDormsView.tsx`): tabbed management — rooms (bulk
create range, zone filter, multi-select), dorms (bed grid + washroom facility
tile per dorm), washrooms (registry — the management surface for ALL washrooms
incl. dorm-owned), zones.

**Washroom detail modal** (`WashroomDetailModal.tsx`): washroom layout
schematic with clickable fixture tiles (status dot + label; `out_of_service`
tints red), fixture `···` menu (View Details / Assign Task / Allocate
Maintenance / Mark for Cleaning / Mark Operational / Mark Out of Service),
bulk action bar for selections, recent activity (tasks + tickets), recent
maintenance history, Edit Washroom (managers). Declared-only facilities render
an honest empty state with a Configure action.

**Modal inventory** (shared flows): `CreateMaintenanceModal` (multi-target,
multi-complaint, photo evidence), `ScheduleWashroomMaintenanceModal`
(entire-washroom vs per-fixture scope, batch creates one ticket per fixture,
photo evidence, auto-assign by zone or explicit employee),
`AssignWashroomTaskModal`, `WashroomModal` (create/edit + fixture counts +
custom fixtures), `WashroomDetailModal`, `CreateDormModal`/`BulkCreateDormsModal`
(rows × name/type/washroom/beds/zone), `BulkCreateWashroomsModal`,
`ConfirmationDialog` for deletes.

**State** (`AppContext.tsx`, ~2,200 lines): session + all collections +
mutations; api client `apiFetch` with bearer token + single-shot refresh;
post-mutation refresh patterns (e.g. fixture→operational refreshes the
ticket list; dorm checkout refreshes tasks for automation side-effects).

---

## 5. Data Integrity & Invariants

- `uq_tasks_open_room_title` — no duplicate open room tasks.
- One attached washroom per dorm — unique on `washrooms.dorm_id`
  (partial), enforced at row level AND within bulk batches.
- Per-property unique names: dorm names, washroom names (case-insensitive);
  dorm rename validates the derived washroom name too.
- Occupied rooms/dorms cannot be deleted; occupied beds block dorm delete.
- Employees must be `active` to receive assignment; deactivation unassigns
  their open tasks.
- `SET NULL` FKs on all work references — history survives entity deletion.

## 6. Operations

- **Scheduler:** arq worker owns `generation_tick` (prod);
  `RUN_EMBEDDED_SCHEDULER` for dev/single-process.
- **DB pool:** tuned for remote Supabase RTT (`pool_size`, `max_overflow`,
  recycle; no pre_ping; joinedload on hot paths) — see
  `backend/PERFORMANCE_RCA.md`.
- **Verification:** `cd frontend && npx tsc --noEmit && npm run build`;
  backend `import app.main` (requires `DATABASE_URL`/`SUPABASE_DB_*` +
  `JWT_SECRET_KEY`).
- **Deploy:** Railway (api + worker + Redis) · Vercel (frontend) · Supabase
  (Postgres + Storage) · Docker Compose / nginx for the full stack.
