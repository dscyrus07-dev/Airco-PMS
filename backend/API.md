# AiROS API — HR surface

Base: `/api/v1`. All endpoints require a Bearer token.

## Roles

`super_admin` · `property_manager` · `human_resource` · `department_manager` · `employee`

- `human_resource`: workforce management scoped to `user.property_id`. Can
  view/create/update/activate/deactivate employees and read task dashboards
  + timelines. Cannot touch property infrastructure or task allocation.
- `department_manager`: reserved; no dedicated API surface yet.

## HR endpoints — caller must be `human_resource`

| Method | Path | Purpose |
|---|---|---|
| GET | `/hr/dashboard` | Employee KPIs (total/active/inactive/on-leave/departments/new-30d, per-department counts, recent hires). |
| GET | `/hr/employees` | Property-scoped employee list. Query: `zone_uid, department, status, search, page, limit`. |
| POST | `/hr/employees` | Create employee + linked login (`EmployeeCreateRequest`). Same validations/audit as PM flow. |
| PATCH | `/hr/employees/{uid}` | Update HR fields (`EmployeeUpdateRequest`). |
| POST | `/hr/employees/{uid}/activate` | Reactivate — restores login, clears zone/area (explicit reassign required). |
| POST | `/hr/employees/{uid}/deactivate` | Deactivate — disables linked logins, excludes from task allocation. |
| GET | `/hr/employee-logs` | Audit events (`entity_type=employee`). Query: `employee_uid, action, actor, date_from, date_to, page, limit`. |
| GET | `/hr/tasks/dashboard` | Task aggregates for the property: totals by status/type/employee. |
| GET | `/hr/tasks` | Property-scoped task list (read-only projection). Query: `status, task_type, search, page, limit`. |
| GET | `/hr/tasks/{uid}/timeline` | Task + ordered `TaskHistoryEvent` timeline. |

## Admin HR management — caller must be `super_admin`

| Method | Path | Purpose |
|---|---|---|
| POST | `/admin/hr` | Create HR account. Body: `property_uid, name, email, phone?, password(≥8)`. Transactional: property must belong to caller's company; email unique; role `human_resource`; writes `hr_created` audit event. |
| GET | `/admin/hr` | List HR accounts for the caller's company. |
| POST | `/admin/hr/{uid}/toggle` | Activate/deactivate an HR login (`is_active` flip + audit event). |

## Errors

- `401 UNAUTHENTICATED` — missing/expired token.
- `403 FORBIDDEN` — wrong role (e.g. employee → `/hr/*`, HR → manager-only
  endpoints).
- `404 NOT_FOUND` — cross-property entity IDs (IDOR-safe: property scope is
  enforced in the query, not reported as "exists but forbidden").
- `409/422` — `EMAIL_EXISTS`, `VALIDATION_ERROR` (with `field`).

## Property scoping

Non-super-admin users are scoped by `user.property_id` inside
`WorkspaceRepository._company_scope` and `StructureService._property_for_write`
— HR sees only its assigned property. `employee-logs` is likewise filtered by
`audit_events.property_id`.

---

# Resource state — single source of truth

Resource status (`rooms.status`, `dorms.status`, `beds.status`,
`washrooms.status`, `washroom_fixtures.status`) is **authoritative** and is
only ever committed by `ResourceStateService`
(`app/services/resource_state.py`). Every write is validated against the
legal-transition table (`app/domain/transitions.py`) and recorded in the
immutable `resource_state_events` table.

## Canonical states

| Resource | States |
|---|---|
| room | `available` `occupied` `cleaning` `maintenance` |
| dorm | `available` `occupied` `cleaning` `maintenance` (+ `is_active` lifecycle flag — separate column) |
| bed | `available` `occupied` `cleaning` `maintenance` `inactive` |
| washroom | `available` `cleaning` `maintenance` `inactive` |
| fixture | `operational` `maintenance` `inactive` |

Removed values: `needs_cleaning` (now task-driven — assign a cleaning task),
`out_of_service` (→ `inactive`), `active`/`clean`/`dirty`.

## Occupancy

`occupied` requires an open `occupancies` row — enforced by invariant +
partial unique indexes (`uq_occupancies_open_room/_bed`).

| Method | Path | Purpose |
|---|---|---|
| POST | `/rooms/{uid}/check-in` | `{"guest_name"}` → occupancy + room `occupied`. Staff+. |
| POST | `/rooms/{uid}/check-out` | Closes occupancy + queues cleaning task + room → `cleaning` atomically. Staff+. |
| POST | `/beds/{uid}/check-in` | Same for a bed; dorm aggregates to `occupied`. |
| POST | `/beds/{uid}/check-out` | Occupancy close + cleaning task + bed → `cleaning`; dorm derives. |

`PATCH` on rooms/dorms/washrooms **no longer accepts** `status`,
`current_guest`, or `guest_name` — state moves through commands only.

## Administrative transition — super_admin only

`POST /resources/{resource_type}/{uid}/transition` with
`{"to": "<state>", "reason": "..."}` — legal-transition validation still
applies; writes an `admin_override` audit event. `resource_type` ∈
`room|dorm|bed|washroom|fixture`.

## Workflows that drive state

- **Cleaning task START** → resource `cleaning` (`task_start`).
- **Task approve** (super_admin) → `derive()` releases to `available` when
  no blocking work remains (`task_approved`). Reject keeps it blocked.
- **Task delete** → `derive()` — can never strand a resource.
- **Maintenance ticket create** → resource `maintenance` (`ticket_created`).
- **Maintenance close/cancel** (super_admin) → `derive()` release
  (`ticket_closed`). Start/resolve are assignee-enforced for employees.
- **`POST /units/bulk-status`**: `checkout`/`cleaning` are staff actions;
  `available`/`cleaned`/`maintenance` are **super_admin-only** (cleaned
  writes honest `admin_closed` task events — never fabricated approvals).
- **`PATCH /washrooms/{w}/fixtures/{f}`** — super_admin-only fixture
  transition (`operational` also closes blocking fixture tickets).

## Reconciliation (read-only)

`GET /properties/{uid}/reconciliation` reports inconsistencies —
`orphan_occupied`, `orphan_cleaning`, `orphan_maintenance`,
`invalid_state` — without repairing. Corrections go through the transition
API.
