# Frontend API Gaps

Everything below is a frontend requirement discovered during the codebase audit.
**None of these are currently implemented** — this repository is frontend-only and
no FastAPI backend exists yet. `API.md` is the contract to implement against.

## Missing Endpoints

All endpoints in `API.md` are currently unimplemented. Notably:

### Authentication & session — ✅ IMPLEMENTED
- `POST /auth/signup` — atomic company + initial super_admin creation (transactional)
- `POST /auth/login` — email-or-username + password → `{access_token, refresh_token, user, company}`
- `POST /auth/refresh` — opaque refresh token → new access token
- `POST /auth/logout` — revokes the refresh token
- `GET /auth/me` — session restore on reload
- `PATCH /auth/me` — profile self-edit

Remaining unimplemented endpoints:

### Core collections
- `GET/POST /properties`, `GET/PATCH/DELETE /properties/{uid}` — create must also
  provision the Property Manager's login + employee record
- `GET/POST /areas`, `PATCH/DELETE /areas/{uid}`
- `GET/POST /zones`, `PATCH/DELETE /zones/{uid}`
- `GET/POST /rooms`, `POST /rooms/bulk`, `PATCH/DELETE /rooms/{uid}`
- `GET/POST /dorms`, `PATCH/DELETE /dorms/{uid}`
- `POST /dorms/{uid}/checkout`, `POST /dorms/{uid}/mark-cleaning`
- `PATCH /beds/{uid}/status` — returns the containing dorm
- `POST /units/bulk-status` — mixed room+bed checkout/cleaning/available,
  returns updated entities + any automation-generated tasks
- `GET/POST /employees`, `PATCH/DELETE /employees/{uid}`,
  `PATCH /employees/{uid}/zone` (drag-and-drop assignment),
  `POST /employees/{uid}/deactivate` — create must also provision the
  employee's login credential
- `GET/POST /tasks`, `PATCH/DELETE /tasks/{uid}`,
  `POST /tasks/{uid}/start`, `POST /tasks/{uid}/complete`,
  `POST /tasks/{uid}/request-redo`, `PATCH /tasks/{uid}/assignee`
- `POST /media/uploads` — multipart photo upload returning a URL,
  required before task completion

### Missing today even from the old mock layer
- No aggregation/stats endpoints — all dashboard metrics are derived client-side
  from the collection lists. If datasets grow, a `GET /properties/{uid}/overview`
  style aggregate would be needed.
- No department or leave-management endpoints — `Employee.department` is a
  free-form enum and `leave_balance_days`/`leave_status` are read-only fields;
  no leave workflows exist in the UI.

## Missing Backend Fields

Fields the frontend renders that the backend must supply:

- `property.code` (`PROP-001`), `area.code`, `zone.code` — server-generated codes
- `property.manager_employee_uid` — links a property to its manager's employee record
- `employee.username`, `employee.avatar_color`, `employee.leave_balance_days`,
  `employee.leave_status`, `employee.start_date`
- `task.assigned_to_name` — denormalized assignee display name
- `task.created_by_name`, `task.history[]` — audit timeline with actor names,
  timestamps, notes, and photo URLs
- `task.due_date` may be a date or full ISO timestamp — hourly recurrences
  (`hourly`, `every_2_hours`, `every_6_hours`, `every_12_hours`) produce
  timestamps; the frontend's overdue logic depends on this distinction
- `dorm.beds[]` — nested bed objects generated on dorm creation

## Backend-owned behavior the frontend depends on

These were previously simulated client-side and are now **backend responsibilities**:

- **Automation engine** — `task.automation_rule` triggers
  (`bed_available_after_checkout`, `bed_marked_cleaning`, `room_checked_out`)
  must fire when bed/room statuses change and generate new tasks. Frontend
  refreshes tasks after status mutations; `POST /units/bulk-status` and
  `POST /tasks/{uid}/complete` can return generated tasks inline.
- **Repetitive task regeneration** — on completion the backend creates the next
  instance (date- or hour-precision) and returns it as `generated_task`.
- **Cascades** — deleting a property/zone/employee un-assigns or removes
  dependent records; switching a zone away from `stay` un-assigns its units.
- **Credential provisioning** — creating a property (manager) or employee
  (staff) creates their `AuthUser` so they can log in immediately.
- **Password hashing** — plaintext passwords are never stored or returned.
- **Duplicate protection** — `409` with `detail.field` for email/username/
  company-name conflicts; registration must be idempotent.

## Authentication Requirements — ✅ IMPLEMENTED

- JWT access token (30 min, HS256) + opaque refresh token (30 days, stored
  hashed in `refresh_tokens`, revoked on logout).
- `GET /auth/me` restores sessions on reload; the API client auto-refreshes
  once on 401 via `POST /auth/refresh` before giving up the session.
- `user.role`, `user.company_uid`, `user.property_uid`, `user.employee_uid`,
  `user.zone_uid` are present — the frontend derives all scoping from them.
- Signup generates a unique username from the email local part
  (`admin@x.com` → `admin`, collisions → `admin.2`…).
- Passwords are Argon2id-hashed; hashes are never returned.

## Frontend State Notes

- No React Query/server-state library — `AppContext` fetches collections once on
  sign-in (parallel `Promise.all`) and applies mutation responses locally,
  refetching after cascade-prone operations.
- The only `localStorage` key is `mgmt_tool_auth_token` (session token).
- `src/lib/utils.generateId` is used solely for toast notification IDs — never
  for entity IDs; all entity UIDs come from API responses.
- Zone/employee/task filters are currently client-side; the list endpoints
  accept query params so they can move server-side without contract changes.
