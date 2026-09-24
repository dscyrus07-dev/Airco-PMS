# Frontend API Contract

This document is the **complete API contract** the Management Tool frontend requires from the FastAPI backend. It was derived directly from the actual routes, components, forms, and state operations in `frontend/src` — not from generic conventions. Every endpoint listed here is actively consumed by `src/api/*` or required by a user-facing interaction.

If an endpoint is not listed, the frontend does not need it.

---

## Overview

Management Tool is a multi-tenant property-operations platform. The root entity is a **Company**, which owns **Properties**. Each property contains **Areas** (structural levels), **Zones**, **Rooms**, **Dorms** (with nested **Beds**), **Employees**, and **Tasks**.

Hierarchy:

```
Company
└── Properties
    ├── Areas (floors / structural levels)
    ├── Zones (stay | common | dining | amenities | outdoor | back_of_house)
    │   ├── Rooms (stay zones only)
    │   └── Dorms → Beds (stay zones only)
    ├── Employees (may be assigned to a zone)
    └── Tasks (assigned to employees, optionally scoped to a zone)
```

**Roles:** `super_admin` (company-wide), `property_manager` (single property), `employee` (self-scoped).

## Base URL

```
{VITE_API_URL}
```

Configured via the `VITE_API_URL` environment variable (see `.env.example`). Example: `http://localhost:8000/api/v1`. All paths below are relative to that base.

## Authentication

Bearer token. `POST /auth/login` and `POST /auth/signup` return `{access_token, refresh_token}`; the frontend stores them and sends the access token on every request:

```
Authorization: Bearer <token>
```

Tokens are expected to expire. Any `401` clears the local token and redirects to `/login`.

## Authorization / RBAC

| Role | Scope |
|---|---|
| `super_admin` | Everything within their company: all properties, company settings |
| `property_manager` | Full operational access within their assigned `property_uid` only |
| `employee` | Read own tasks/profile; start & complete own assigned tasks |

Frontend hides disallowed UI but **the backend must enforce authorization**. The frontend correctly surfaces 401/403 responses.

## Common Headers

| Header | Required | Notes |
|---|---|---|
| `Authorization` | All authenticated routes | `Bearer <token>` |
| `Content-Type: application/json` | All JSON bodies | Not sent for `multipart/form-data` |

## Common Response Format

- **Single entity:** the entity object directly.
- **Lists:** paginated envelope `{ "items": [...], "total": n, "page": n, "limit": n }`.
- **Deletes:** `204 No Content`.

## Common Error Format

The frontend parses FastAPI's `detail` envelope:

```json
// Simple errors
{ "detail": "Invalid credentials" }

// Validation errors (422)
{ "detail": [ { "loc": ["body", "email"], "msg": "value is not a valid email address", "type": "value_error.email" } ] }

// Field-targeted conflicts (409) — used for inline form errors
{ "detail": { "message": "An account with this email already exists.", "field": "email" } }
```

The frontend maps `detail.field` (or the last element of `loc`) to the corresponding form field for inline errors.

## HTTP Status Codes

| Code | Frontend behavior |
|---|---|
| 400 | Inline form error / toast with `detail` message |
| 401 | Clear token, redirect to `/login` |
| 403 | Toast: "You do not have permission…" |
| 404 | Toast: "The requested resource was not found." |
| 409 | Inline field error when `field` present, else toast |
| 422 | Inline per-field validation errors |
| 500 | Toast: "A server error occurred. Please try again." |
| timeout/network | Toast: "Could not reach the server…" |

---

# Authentication APIs

## Login

### Method
`POST /auth/login`

### Purpose
Authenticate an existing user with **either email or username** + password. Used by `/login` (`src/components/auth/Login.tsx` via `src/api/auth.ts`).

### Authentication
Not required.

### Request Body
```json
{
  "identifier": "raghav@company.com",
  "password": "Admin@123"
}
```
`identifier` accepts email **or** username — the backend resolves which.

### Response — `200`
```json
{
  "access_token": "eyJhbGciOi...",
  "refresh_token": "opaque-urlsafe-string",
  "token_type": "bearer",
  "user": {
    "uid": "uuid",
    "name": "Raghav Singhal",
    "email": "raghav@company.com",
    "username": "raghav",
    "role": "super_admin",
    "company_uid": "uuid",
    "property_uid": null,
    "employee_uid": null,
    "zone_uid": null,
    "phone": "+91 ...",
    "job_title": "Administrator",
    "company_name": "Acme Hospitality"
  },
  "company": { "company_uid": "uuid", "name": "Acme Hospitality", "brand_name": "Acme", "email": "ops@acme.com", "phone": "+91 ...", "created_at": "..." }
}
```

### Error Responses
- `401` — invalid credentials → `{ "detail": { "message": "Invalid email/username or password.", "code": "INVALID_CREDENTIALS" } }` — identical for wrong password, unknown email, and unknown username
- `403` — account deactivated → `ACCOUNT_INACTIVE`
- `422` — malformed body → per-field `detail[]` errors

### Frontend Usage
On success the frontend stores `access_token` + `refresh_token`, populates `currentUser`/`company`, then redirects by role: `super_admin` → `/admin/properties`, `property_manager` → `/property/{property_uid}/zones`, `employee` → `/employee/tasks`.

### Notes
- Access token: JWT (HS256), 30 min, claims `sub`, `user_id`, `company_id`, `role`, `iat`, `exp`, `type=access`.
- Refresh token: opaque random, stored **hashed** server-side in `refresh_tokens`, 30-day expiry, revocable.
- Successful login updates `users.last_login_at`.
- `user.property_uid` must be set for `property_manager` (and employees) — the frontend locks their entire workspace to it.

**Status: IMPLEMENTED** in `backend/app/api/v1/auth.py`.

---

## Logout

### Method
`POST /auth/logout`

### Purpose
Revoke the supplied refresh token server-side. The client clears both tokens regardless of the response (fire-and-forget).

### Authentication
Not required (the refresh token is the credential being revoked).

### Request Body
```json
{ "refresh_token": "opaque-urlsafe-string" }
```

### Response — `204`

**Status: IMPLEMENTED.**

---

## Refresh Token

### Method
`POST /auth/refresh`

### Purpose
Exchange a valid (unexpired, unrevoked) refresh token for a new access token. The API client calls this automatically once when a request returns `401`, then retries the original request.

### Authentication
Not required — the refresh token itself is the credential.

### Request Body
```json
{ "refresh_token": "opaque-urlsafe-string" }
```

### Response — `200`
```json
{ "access_token": "eyJhbGciOi...", "token_type": "bearer" }
```

### Error Responses
- `401` — invalid/expired/revoked token → `INVALID_REFRESH_TOKEN`; the client clears the session and redirects to `/login`

**Status: IMPLEMENTED.**

---

## Current User

### Method
`GET /auth/me`

### Purpose
Restore a session on page reload and supply `currentUser` + `company` to the app shell. If the token is invalid/expired, return `401` — the frontend stays on public routes.

### Authentication
Required.

### Response — `200`
```json
{ "user": { "...AuthUser" }, "company": { "...Company" } }
```

### Frontend Usage
Called once at app bootstrap by `AppContext` (`src/context/AppContext.tsx`).

**Status: IMPLEMENTED.**

---

## Update Profile

### Method
`PATCH /auth/me`

### Purpose
Edit own name/phone/email. Implemented — see the Profile APIs section below for the full entry.

---

## Register Company (Signup)

### Method
`POST /auth/signup`

### Purpose
Company onboarding from `/signup` (`src/components/auth/Signup.tsx`). Atomically creates the **Company** + the initial `super_admin` **User**, and returns a live session.

### Authentication
Not required.

### Request Body
```json
{
  "company_name": "Acme Hospitality Pvt Ltd",
  "brand_name": "Acme Stays",
  "address": "12 Assi Ghat Road, Varanasi",
  "pin_code": "221005",
  "email": "founder@acme.com",
  "phone": "+91 98100 12345",
  "password": "Secret@123",
  "confirm_password": "Secret@123"
}
```
`phone` may also be sent as `phone_number` (both accepted). `confirm_password` is optional — when present it must equal `password` (422 otherwise).

### Response — `201`
Same shape as Login: `{ "access_token", "refresh_token", "token_type", "user", "company" }` where `user.role === "super_admin"`.

### Username strategy
The signup form has no username field — the backend generates one from the email local part (`admin@acme.com` → `admin`; collisions → `admin.2`, `admin.3`…) and returns it in `user.username`. The user can log in with either their email or that generated username.

### Error Responses
- `409` — duplicate email → `{ "detail": { "message": "An account with this email already exists.", "code": "EMAIL_ALREADY_EXISTS" } }`
- `422` — per-field validation (PIN must be 6 digits, email format, phone format, password ≥ 8 chars, passwords must match)

### Notes
Atomic transaction: company + user + session commit together; any failure rolls back all of them — no orphan companies. DB-level `UNIQUE` constraints on `users.email` and `users.username` are the real guards against races/double-submits.

**Status: IMPLEMENTED.**

---

## Update Profile

### Method
`PATCH /auth/me`

### Purpose
Edit own name/phone/email from `/employee/profile` and `/property/:uid/profile` (`src/components/employee_views/ProfileView.tsx`).

### Authentication
Required. All roles — self only.

### Request Body
```json
{ "name": "New Name", "phone": "+91 ...", "email": "new@mail.com" }
```

### Response — `200` — updated `AuthUser`

### Error Responses
- `409` — email already in use → `{ "field": "email" }`

---

# Company APIs

## Get Company

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`GET /companies/{company_uid}`

### Purpose
Fetch the caller's own company record (settings display).

### Authentication
Required. All roles — own company only.

### Response — `200` — `Company`

---

## Update Company

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`PATCH /companies/{company_uid}`

### Purpose
Organization settings form (`src/components/admin/AdminSettingsView.tsx`): legal name, brand name, ops email, phone.

### Authentication
Required. `super_admin` only.

### Request Body
```json
{ "name": "...", "legal_name": "...", "brand_name": "...", "email": "...", "phone": "...", "address": "...", "pin_code": "..." }
```
All fields optional — send only changed fields.

### Response — `200` — updated `Company`

### Error Responses
- `403` — non-super-admin

---

# Property APIs

## List Properties

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`GET /properties`

### Purpose
The Super Admin property directory (`src/components/properties/PropertiesView.tsx`) — cards showing name, code, location, manager, unit counts. Also feeds the company-scoped views.

### Authentication
Required. `super_admin` (all company properties); `property_manager`/`employee` receive only their own property.

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| search | string | No | Filter by name/code/city |
| status | string | No | `Active` \| `Maintenance` \| `Setup` |
| page | integer | No | Page number (default 1) |
| limit | integer | No | Page size (default 20) |

### Response — `200`
```json
{
  "items": [
    {
      "property_uid": "prop_...",
      "company_uid": "cmp_...",
      "code": "PROP-001",
      "name": "Acme Varanasi",
      "location": "Assi Ghat",
      "city": "Varanasi",
      "state": "UP",
      "status": "Active",
      "manager_name": "Arjun Mehta",
      "manager_email": "arjun@acme.com",
      "manager_phone": "+91 ...",
      "manager_employee_uid": "emp_...",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 1, "page": 1, "limit": 20
}
```

### Frontend Usage
`loadWorkspace()` in `AppContext` fetches this plus all other collections in parallel.

---

## Get Property

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`GET /properties/{property_uid}`

### Purpose
Property detail for deep-links/workspace resolution.

### Authentication
Required. `super_admin` (own company); `property_manager`/`employee` only their `property_uid`.

### Response — `200` — `Property`

### Error Responses
- `403` — property belongs to another company
- `404` — not found

---

## Create Property

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`POST /properties`

### Purpose
"Add Property" modal (`src/components/properties/CreatePropertyModal.tsx`). **Creates the property AND its Property Manager account atomically** — the manager gets a real login credential scoped to the new property.

### Authentication
Required. `super_admin` only.

### Request Body
```json
{
  "name": "Acme Jaipur",
  "location": "MI Road",
  "city": "Jaipur",
  "state": "Rajasthan",
  "manager": {
    "name": "Priya Sharma",
    "email": "priya@acme.com",
    "phone": "+91 ...",
    "username": "priya.pm",
    "password": "Manager@123"
  }
}
```

### Response — `200` — the created `Property` (with `manager_employee_uid` linking to the created manager's employee record)

### Error Responses
- `409` — manager email/username already exists → `{ "field": "email" | "username" }` (frontend maps `manager.email`/`manager.username` to the inline fields)
- `422` — validation

### Notes
Backend should also create the manager's `Employee` record (department e.g. "Management") so they appear in staff lists, and their `AuthUser` with `role=property_manager`, `property_uid` = new property.

---

## Update Property

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`PATCH /properties/{property_uid}`

### Purpose
Edit property details/status (property card edit actions).

### Authentication
Required. `super_admin`; `property_manager` for their own property (non-structural fields).

### Request Body
```json
{ "name": "...", "location": "...", "city": "...", "state": "...", "status": "Active", "manager_name": "...", "manager_email": "...", "manager_phone": "..." }
```

### Response — `200` — updated `Property`

---

## Delete Property

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`DELETE /properties/{property_uid}`

### Purpose
Delete a property with confirmation (`ConfirmationDialog`).

### Authentication
Required. `super_admin` only.

### Response — `204`

### Notes
**Cascade:** delete/unlink the property's areas, zones, rooms, dorms+beds, tasks; deactivate its employees' access. The frontend refetches the workspace after success.

---

# Area APIs (floors / structural levels)

## List Areas

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`GET /areas`

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| property_uid | string | No | Filter by property (PM scope implied) |

### Response — `200` — `ListResponse<Area>`

```json
{ "items": [ { "area_uid": "area_...", "property_uid": "prop_...", "name": "Ground Floor", "code": "AREA-001", "level_number": 0, "description": "...", "created_at": "..." } ], "total": 1, "page": 1, "limit": 20 }
```

### Frontend Usage
`src/components/zones/ZonesView.tsx` — area grouping; `CreateZoneModal` area select; `CreateAreaModal` computes `level_number = max(existing)+1` client-side and submits it.

---

## Create Area

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`POST /areas`

### Authentication
`super_admin`, `property_manager` (own property).

### Request Body
```json
{ "property_uid": "prop_...", "name": "Rooftop Terrace", "level_number": 4, "description": "..." }
```

### Response — `200` — `Area` (backend assigns `area_uid`, `code`)

---

## Update Area

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`PATCH /areas/{area_uid}` — body: any subset of `name`, `level_number`, `description` → `200` `Area`. Used by the inline edit in `ZonesView`.

---

## Delete Area

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`DELETE /areas/{area_uid}` → `204`. Zones referencing it should have `area_uid` cleared (frontend refetches zones).

---

# Zone APIs

## List Zones

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`GET /areas` → `GET /zones`

### Query Parameters
| Parameter | Type | Required | Description |
|---|---|---|---|
| property_uid | string | No | Scope to a property |

### Response — `200` — `ListResponse<Zone>`
```json
{ "zone_uid": "zone_...", "property_uid": "prop_...", "area_uid": "area_...", "name": "Zone A — River Wing", "code": "ZONE-001", "zone_type": "stay", "floor": "First Floor", "description": "...", "created_at": "..." }
```
`zone_type` ∈ `stay | common | dining | amenities | outdoor | back_of_house`.

### Frontend Usage
Zones view cards, zone workspace, zone selects in modals, employee zone board.

---

## Create Zone

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`POST /zones`

### Request Body
```json
{ "property_uid": "prop_...", "name": "Zone D — Garden", "floor": "Ground Floor", "area_uid": "area_...", "zone_type": "common", "description": "..." }
```

### Response — `200` — `Zone` (backend assigns `zone_uid`, `code`)

---

## Update Zone

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`PATCH /zones/{zone_uid}`

### Request Body
Subset of `name`, `floor`, `area_uid`, `zone_type`, `description`.

### Response — `200` — `Zone`

### Notes
**When `zone_type` changes from `stay` to a non-stay type, the backend must un-assign its rooms/dorms** (`zone_uid → null`) — the frontend refetches rooms/dorms after such an update.

---

## Delete Zone

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`DELETE /zones/{zone_uid}` → `204`. Un-assign rooms, dorms, employees, and tasks referencing it (frontend does a full workspace refresh).

---

# Room APIs

## List Rooms

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`GET /rooms`

### Query Parameters
| Parameter | Type | Required | Description |
|---|---|---|---|
| property_uid | string | No | Scope |
| zone_uid | string | No | Filter by zone (`null`/empty = unassigned) |
| status | string | No | `available` \| `occupied` \| `cleaning` \| `maintenance` |
| search | string | No | Room number |

### Response — `200` — `ListResponse<Room>`
```json
{ "room_uid": "room_...", "property_uid": "prop_...", "zone_uid": "zone_...", "room_number": "101", "type": "Private Room", "area_sqft": 260, "status": "occupied", "bed_count": 1, "cleaning_note": null, "current_guest": "Rahul", "created_at": "..." }
```

---

## Create Room

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`POST /rooms`

### Request Body
```json
{ "property_uid": "prop_...", "room_number": "305", "type": "Private Room", "area_sqft": 260, "bed_count": 1, "zone_uid": "zone_..." }
```

### Response — `200` — `Room`. `zone_uid` must reference a `stay` zone — reject otherwise (`422`).

---

## Bulk Create Rooms

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`POST /rooms/bulk`

### Purpose
Range creation (`src/components/rooms/BulkCreateRoomsModal.tsx`) — e.g. rooms 201–209.

### Request Body
```json
{ "property_uid": "prop_...", "start": 201, "end": 209, "type": "Private Room", "area_sqft": 260, "zone_uid": "zone_..." }
```

### Response — `200`
```json
{
  "created": [ { "...Room" } ],
  "errors": ["Room 203 already exists"]
}
```

### Notes
The modal previews duplicates client-side, but the backend is authoritative — per-number failures go in `errors`.

---

## Update Room

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`PATCH /rooms/{room_uid}`

### Purpose
Single-source endpoint for room edits: details, **status transitions** (`updateRoomStatus` — Check Out → `cleaning`, Clean Room → `available`/`cleaning`), and **zone assignment** (`zone_uid`, `null` = unallocated).

### Request Body
```json
{ "status": "cleaning", "zone_uid": "zone_...", "current_guest": null, "cleaning_note": "..." }
```

### Response — `200` — `Room`

### Notes
Status transitions may trigger task automation rules (see Automation). Restrict `zone_uid` to stay zones.

---

## Delete Room

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`DELETE /rooms/{room_uid}` → `204`.

---

# Dorm & Bed APIs

## List Dorms

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`GET /dorms` — params: `property_uid`, `zone_uid` → `ListResponse<Dorm>`.

```json
{ "dorm_uid": "dorm_...", "property_uid": "prop_...", "zone_uid": "zone_...", "name": "Ganga Dorm A", "dorm_type": "Mixed Dorm", "washroom": "Attached", "floor": "Ground Floor", "area_sqft": 420, "beds": [ { "bed_uid": "bed_...", "dorm_uid": "dorm_...", "bed_number": "Bed 01", "status": "occupied", "guest_name": "Asha" } ], "created_at": "..." }
```

---

## Create Dorm

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`POST /dorms`

### Request Body
```json
{ "property_uid": "prop_...", "name": "Ganga Dorm B", "dorm_type": "Female Dorm", "washroom": "Attached", "bed_count": 8, "zone_uid": "zone_...", "floor": "First Floor", "area_sqft": 420, "description": "..." }
```

### Response — `200` — `Dorm` **with `beds` auto-generated** (`Bed 01`…`Bed N`, status `available`).

---

## Update Dorm

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`PATCH /dorms/{dorm_uid}` — subset of `name`, `dorm_type`, `washroom`, `zone_uid`, `floor`, `area_sqft`, `description` → `Dorm`. Used for zone reassignment too.

---

## Delete Dorm

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`DELETE /dorms/{dorm_uid}` → `204`. Beds are deleted with it.

---

## Checkout Dorm

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`POST /dorms/{dorm_uid}/checkout`

### Purpose
"Checkout Dorm" — all occupied beds → `cleaning` (guest_name cleared).

### Response — `200` — the updated `Dorm` (with beds)

### Notes
May trigger `room_checked_out`/`bed_marked_cleaning` automation rules → task generation. The frontend refetches tasks after this call.

---

## Mark Dorm Cleaning

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`POST /dorms/{dorm_uid}/mark-cleaning`

### Purpose
"Mark Cleaning" — non-occupied beds → `cleaning` (housekeeping queue).

### Response — `200` — `Dorm`

---

## Update Bed Status

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`PATCH /beds/{bed_uid}/status`

### Purpose
Per-bed explicit actions on the dorm bed grid — `Check out` (occupied→cleaning), `Clean` (cleaning→available / queue cleaning), occupy with optional guest name.

### Request Body
```json
{ "status": "cleaning", "guest_name": "optional guest name when occupying" }
```

### Response — `200` — the **containing `Dorm`** (so nested bed state stays consistent)

---

# Employee APIs

## List Employees

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`GET /employees`

### Query Parameters
| Parameter | Type | Required | Description |
|---|---|---|---|
| property_uid | string | No | Scope to a property |
| zone_uid | string | No | Filter by zone |
| department | string | No | Filter by department |
| status | string | No | `active`/`inactive` (also `Active`/`On Leave`/`Off Duty` legacy) |
| search | string | No | Name/email/uid/job title |

### Response — `200` — `ListResponse<Employee>`
```json
{ "employee_uid": "emp_...", "company_uid": "cmp_...", "property_uid": "prop_...", "zone_uid": "zone_...", "name": "Vikram Sharma", "username": "vikram.sharma", "email": "vikram@acme.com", "phone": "+91 ...", "job_title": "Housekeeper", "department": "Housekeeping", "status": "Active", "avatar_color": "#386641", "leave_balance_days": 12, "leave_status": false, "start_date": "2024-03-01", "created_at": "..." }
```

### Frontend Usage
Zone board (DnD), staff directory, assignee selects, task avatars, AdminEmployeesView.

---

## Create Employee

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`POST /employees`

### Purpose
"Add Staff Member" (`src/components/employees/CreateEmployeeModal.tsx`). Creates the employee record **and** their login credential — they can sign in at `/login` with email/username + password.

### Authentication
`super_admin`, `property_manager` (own property).

### Request Body
```json
{
  "property_uid": "prop_...",
  "name": "Sunita Verma",
  "email": "sunita@acme.com",
  "phone": "+91 ...",
  "username": "sunita.verma",
  "password": "Staff@123",
  "job_title": "Housekeeping Associate",
  "department": "Housekeeping",
  "zone_uid": "zone_...",
  "salary": "22000",
  "shift": "Morning",
  "start_date": "2024-06-01"
}
```

### Response — `200` — `Employee`

### Error Responses
- `409` — email/username taken → `{ "field": "email" | "username" }` (shown inline)

### Notes
Backend creates a corresponding `AuthUser` (`role=employee`, `employee_uid`, `property_uid`, `zone_uid`). Never store or return plaintext passwords.

---

## Update Employee

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`PATCH /employees/{employee_uid}` — subset of `name`, `job_title`, `department`, `phone`, `email`, `zone_uid`, `salary`, `shift`, `status` → `Employee`. Used by the directory edit modal.

---

## Assign Employee to Zone

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`PATCH /employees/{employee_uid}/zone`

### Purpose
Drag-and-drop zone board + dropdown reassignment (`src/components/employees/ZoneBoard.tsx`, `EmployeeDirectory.tsx`).

### Request Body
```json
{ "zone_uid": "zone_..." }
```
`zone_uid: null` → unallocated pool.

### Response — `200` — `Employee`

### Frontend Behavior
Optimistic update with **rollback on error** (the card snaps back if the request fails).

---

## Deactivate Employee

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`POST /employees/{employee_uid}/deactivate` → `200` `Employee`.

### Purpose
"Deactivate Staff" — sets inactive, unassigns zone, preserves task history. Confirmation dialog.

---

## Delete Employee

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`DELETE /employees/{employee_uid}` → `204`. Their tasks become unassigned; their login is revoked (frontend does a full refresh).

---

# Task APIs

## List Tasks

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`GET /tasks`

### Query Parameters
| Parameter | Type | Required | Description |
|---|---|---|---|
| property_uid | string | No | Scope |
| employee_uid | string | No | Assignee filter (employee views pass own uid) |
| zone_uid | string | No | Zone filter |
| status | string | No | `pending`/`in_progress`/`completed`/`overdue`/`scheduled` |
| task_type | string | No | `fixed`/`repetitive`/`automated` |
| search | string | No | Title/description |

### Response — `200` — `ListResponse<Task>`
```json
{
  "task_uid": "task_...",
  "property_uid": "prop_...",
  "zone_uid": "zone_...",
  "employee_uid": "emp_...",
  "assigned_to_name": "Vikram Sharma",
  "title": "Clean Room 101",
  "description": "...",
  "task_type": "repetitive",
  "status": "pending",
  "priority": "high",
  "due_date": "2024-06-01" /* or ISO datetime for hourly recurrences */,
  "due_time": "14:00",
  "created_by_name": "Arjun Mehta",
  "recurrence": "every_6_hours",
  "recurrence_interval_days": null,
  "automation_rule": null,
  "history": [ { "event_uid": "...", "type": "allocated", "at": "...", "actor_name": "Arjun Mehta", "note": null, "photos": [] } ],
  "created_at": "..."
}
```

### Notes
- `due_date` may be a date (`YYYY-MM-DD`) or full ISO timestamp — hourly schedules (`hourly`, `every_2_hours`, `every_6_hours`, `every_12_hours`) produce timestamps; the frontend compares against "now" for overdue detection, and against start-of-day for date-only tasks.
- `automation_rule` present only for `task_type === 'automated'`: `{ "trigger": "bed_available_after_checkout" | "bed_marked_cleaning" | "room_checked_out", "scope_zone_uid": "zone_..." | null, "template_title": "...", "template_description": "...", "assign_to_uid": "emp_..." }`.
- `history` events: `allocated`, `started`, `completed`, `redo_requested`, `reassigned`, `edited`, `auto_generated`. `completed` events carry `photos` (URLs).

---

## Create Task

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`POST /tasks`

### Purpose
"Add Task" modal (`src/components/tasks/CreateTaskModal.tsx`) — all three task types.

### Request Body
```json
{
  "property_uid": "prop_...",
  "title": "Clean Room 101",
  "description": "...",
  "task_type": "fixed",
  "employee_uid": "emp_...",
  "zone_uid": "zone_...",
  "priority": "medium",
  "due_date": "2024-06-01",
  "due_time": "14:00",
  "recurrence": "daily",
  "recurrence_interval_days": 3,
  "automation_rule": { "trigger": "bed_marked_cleaning", "scope_zone_uid": null, "template_title": "Inspect checkout", "assign_to_uid": "emp_..." }
}
```
`recurrence*` only for `repetitive`; `automation_rule` only for `automated` (which has no `due_date`/`employee_uid` — the rule generates instances).

### Response — `200` — `Task` (with initial `allocated`/`auto_generated` history event; backend assigns `task_uid`, `status`, `created_by_name`)

---

## Update Task

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`PATCH /tasks/{task_uid}` — subset of `TaskCreateRequest` fields + `status` → `Task`. Used by the edit modal and `updateTaskStatus`.

---

## Delete Task

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`DELETE /tasks/{task_uid}` → `204`. Removes history + evidence references. Confirmation dialog.

---

## Start Task

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`POST /tasks/{task_uid}/start` → `200` `Task`.

### Purpose
Employee/manager "Start" — `pending`/`overdue` → `in_progress`, appends `started` event.

### Authorization
`employee` may only start tasks assigned to them (`403` otherwise).

---

## Complete Task

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`POST /tasks/{task_uid}/complete`

### Purpose
"Mark Complete" — **requires ≥1 evidence photo URL** (uploaded via `/media/uploads` first). Sets `completed`, appends `completed` event with `photos` + `note`.

### Request Body
```json
{ "photo_urls": ["https://.../evidence/abc.jpg"], "note": "Done — bathroom restocked" }
```

### Response — `200`
```json
{
  "task": { "...Task" },
  "generated_task": { "...Task" }
}
```
`generated_task` is present **only when the completed task is `repetitive`** — the backend computes the next instance (`due_date` + recurrence interval; hourly schedules produce ISO timestamps) and returns it so the frontend can insert it into the list without a refetch.

### Error Responses
- `422` — `photo_urls` empty → inline error on the completion section
- `403` — employee completing someone else's task

---

## Request Task Redo

### Method
`POST /tasks/{task_uid}/request-redo`

### Purpose
Manager review action — reopens a `completed` task to `pending`/`in_progress`, appends `redo_requested` event with `note`.

### Request Body
```json
{ "note": "Bathroom mirror still streaked" }
```

### Response — `200` — `Task`. `super_admin`/`property_manager` only.

---

## Reassign Task

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`PATCH /tasks/{task_uid}/assignee`

### Request Body
```json
{ "employee_uid": "emp_..." }
```
`null` → unassigned.

### Response — `200` — `Task` (appends `reassigned` event; updates `assigned_to_name`)

---

# Unit Bulk-Status API

## Bulk Update Units

**Status: IMPLEMENTED** (backend `app/api/v1/workspace.py`).

### Method
`POST /units/bulk-status`

### Purpose
The multi-select toolbar in `ZoneWorkspace`/`RoomsDormsView` — Bulk Check Out, Queue for Cleaning, Mark Cleaned/Available across mixed room + bed selections.

### Authentication
`super_admin`, `property_manager`.

### Request Body
```json
{
  "action": "checkout" | "cleaning" | "available",
  "property_uid": "prop_...",
  "room_uids": ["room_1", "room_2"],
  "bed_uids": ["bed_1", "bed_2"]
}
```

### Response — `200`
```json
{
  "rooms": [ { "...Room" } ],
  "dorms": [ { "...Dorm with beds" } ],
  "generated_tasks": [ { "...Task" } ]
}
```
`generated_tasks` contains any tasks auto-created by automation rules triggered by these transitions.

### Notes
- `checkout` applies to `occupied` units → `cleaning`.
- `cleaning` queues units for housekeeping → `cleaning`.
- `available` marks `cleaning` units finished → `available`.
- Invalid transitions should be skipped server-side (return the entity unchanged).

---

# Media APIs

## Upload Evidence Photo

### Method
`POST /media/uploads`

### Purpose
Task-completion evidence. The drawer collects `File` objects; `completeTask` uploads each first, then passes the returned URLs to `/tasks/{uid}/complete`.

### Authentication
Required.

### Request
`multipart/form-data` — field `file` (image/*).

### Response — `200`
```json
{ "url": "https://cdn.example.com/uploads/abc123.jpg" }
```

### Error Responses
- `413` — file too large
- `415` — unsupported media type
- `422` — missing/invalid file

---

# Pagination

All `ListResponse` endpoints accept `page` (1-based, default 1) and `limit` (default 20, max 100). The frontend currently loads full collections for client-side filtering — the envelope fields exist so pagination can be adopted without contract changes.

# Filtering & Sorting

Query params documented per-endpoint (`search`, `status`, `task_type`, `zone_uid`, `department`, `property_uid`, `employee_uid`). The frontend currently filters client-side after fetching; these params exist so the same filters can move server-side for large datasets. No sort params are required today — the frontend orders locally (areas by `level_number`, tasks newest-first).

# Validation

| Field | Rule |
|---|---|
| password | ≥ 8 characters |
| email | RFC email format |
| pin_code | 6 digits (IN) |
| phone | non-empty; loose international format |
| room_number | unique within property (bulk returns per-item errors) |
| photo_urls | ≥ 1 URL on task completion |

# Error Handling

Frontend contract: `detail` string → toast/inline; `detail[]` (422) → per-field `loc` mapping; `detail.field` (409) → single-field inline. 401 → global session-expired redirect. Everything else → toast with `detail` or a status-appropriate fallback. Never render raw stack traces.

---

# Frontend API Dependency Matrix

| Frontend Route | Feature | API | Method | Auth | Role |
|---|---|---|---|---|---|
| `/` (landing) | Static marketing only | — | — | No | public |
| `/login` | Sign in | `/auth/login` | POST | No | public |
| `/login` | Session restore | `/auth/me` | GET | Yes | all |
| `/signup` | Company registration | `/auth/signup` | POST | No | public |
| app shell | Silent re-auth on 401 | `/auth/refresh` | POST | No | all |
| app shell | Workspace bootstrap (7 lists) | `/properties`, `/areas`, `/zones`, `/rooms`, `/dorms`, `/employees`, `/tasks` | GET | Yes | all |
| app shell | Sign out (revoke refresh token) | `/auth/logout` | POST | No | all |
| `/admin/properties` | Property directory | `/properties` | GET | Yes | super_admin |
| `/admin/properties` | Create property + PM account | `/properties` | POST | Yes | super_admin |
| `/admin/properties` | Edit property | `/properties/{uid}` | PATCH | Yes | super_admin |
| `/admin/properties` | Delete property | `/properties/{uid}` | DELETE | Yes | super_admin |
| `/admin/employees` | Company staff roster | `/employees` | GET | Yes | super_admin |
| `/admin/settings` | Org identity form | `/companies/{uid}` | PATCH | Yes | super_admin |
| `/admin/settings` | Workspace stats + refresh | all list endpoints | GET | Yes | super_admin |
| `/property/:uid/zones` | Zone board + areas | `/areas`, `/zones` | GET | Yes | sa + pm |
| `/property/:uid/zones` | Create area/zone | `/areas`, `/zones` | POST | Yes | sa + pm |
| `/property/:uid/zones` | Edit/delete area/zone | `/areas/{uid}`, `/zones/{uid}` | PATCH/DELETE | Yes | sa + pm |
| `/property/:uid/zones` (workspace) | Rooms/dorms/beds | `/rooms`, `/dorms` | GET | Yes | sa + pm |
| `/property/:uid/zones` (workspace) | Room check out / clean | `/rooms/{uid}` | PATCH | Yes | sa + pm |
| `/property/:uid/zones` (workspace) | Bed check out / clean | `/beds/{uid}/status` | PATCH | Yes | sa + pm |
| `/property/:uid/zones` (workspace) | Dorm checkout / cleaning | `/dorms/{uid}/checkout`, `/dorms/{uid}/mark-cleaning` | POST | Yes | sa + pm |
| `/property/:uid/zones` (workspace) | Multi-select bulk ops | `/units/bulk-status` | POST | Yes | sa + pm |
| `/property/:uid/zones` (workspace) | Zone tasks | `/tasks` | GET | Yes | sa + pm |
| `/property/:uid/employees` | Zone board DnD | `/employees/{uid}/zone` | PATCH | Yes | sa + pm |
| `/property/:uid/employees` | Staff directory | `/employees` | GET | Yes | sa + pm |
| `/property/:uid/employees` | Add staff (+credential) | `/employees` | POST | Yes | sa + pm |
| `/property/:uid/employees` | Edit/deactivate/assign | `/employees/{uid}`, `/employees/{uid}/zone`, `/employees/{uid}/deactivate` | PATCH/POST | Yes | sa + pm |
| `/property/:uid/rooms` | Rooms & dorms lists | `/rooms`, `/dorms` | GET | Yes | sa + pm |
| `/property/:uid/rooms` | Create room / bulk / dorm | `/rooms`, `/rooms/bulk`, `/dorms` | POST | Yes | sa + pm |
| `/property/:uid/rooms` | Status, zone assign, delete | `/rooms/{uid}`, `/dorms/{uid}`, `/beds/{uid}/status` | PATCH/DELETE | Yes | sa + pm |
| `/property/:uid/tasks` | Task list + filters | `/tasks` | GET | Yes | sa + pm |
| `/property/:uid/tasks` | Create/edit/delete task | `/tasks`, `/tasks/{uid}` | POST/PATCH/DELETE | Yes | sa + pm |
| `/property/:uid/tasks` | Start / complete / redo / reassign | `/tasks/{uid}/start`, `/complete`, `/request-redo`, `/assignee` | POST/PATCH | Yes | sa + pm (+emp own) |
| `/property/:uid/tasks` | Evidence upload | `/media/uploads` | POST | Yes | all |
| `/property/:uid/profile` | View/edit own profile | `/auth/me` | GET/PATCH | Yes | all |
| `/employee/tasks` | Own task list | `/tasks?employee_uid=` | GET | Yes | employee |
| `/employee/tasks` | Start / complete own task | `/tasks/{uid}/start`, `/complete` | POST | Yes | employee (own) |
| `/employee/profile` | Profile + zone scope | `/auth/me`, `/zones`, `/employees` | GET/PATCH | Yes | employee |

---

# Maintenance Tickets (implemented)

Ticket-based workflow — creating a ticket atomically flips the room to
`maintenance`; every state change appends a `maintenance_ticket_events` row.

**Statuses:** `open → assigned → in_progress → resolved → closed` (+ `on_hold`, `cancelled`)
**Ticket numbers:** `MT-YYYY-NNNNN` — generated server-side from a PostgreSQL
sequence, immutable once issued.
**Priorities:** `low | medium | high | critical`

## Create Maintenance Ticket
### Method
`POST /maintenance`
### Purpose
Opens a maintenance ticket for a room. In the same transaction the room's
status becomes `maintenance` — both succeed or neither does.
### Authentication
`super_admin` or `property_manager`
### Request Body
```json
{
  "property_uid": "uuid",
  "room_uid": "uuid",
  "maintenance_type": "plumbing",
  "issue": "Bathroom tap leaking",
  "description": "optional",
  "priority": "high",
  "due_date": "2026-09-25",
  "attachment_urls": ["/uploads/photo.jpg"]
}
```
### Response — `201` — `MaintenanceTicket` (`status: "open"`, `ticket_number`, `events[]`, `attachments[]`)
### Errors — `404` room/property · `422` validation

## List Maintenance Tickets
`GET /maintenance` — query: `property_uid`, `room_uid`, `status`, `priority`,
`assigned_to`, `search` (ticket number / issue / room). Company/property
scoped server-side. Response: `{ items, total }` sorted newest-first.

## Get Ticket
`GET /maintenance/{ticket_uid}` — full ticket with events + attachments.

## Update Ticket
`PATCH /maintenance/{ticket_uid}` — edit `maintenance_type`, `issue`,
`description`, `priority`, `due_date`, `assigned_to`, or `status: "cancelled"`
(cancel releases the room to `available`). Closed/cancelled → `409`.

## Assign
`POST /maintenance/{ticket_uid}/assign` — `{ "employee_uid": "uuid" | null }` →
`assigned`. Employee must belong to the ticket's property.

## Start / Hold
`POST /maintenance/{ticket_uid}/start` → `in_progress` (from open/assigned/on_hold)
`POST /maintenance/{ticket_uid}/hold` — `{ "note"?: "…" }` → `on_hold`

## Resolve
`POST /maintenance/{ticket_uid}/resolve` — `{ "resolution_notes": "…", "photo_urls": [] }` →
`resolved` + `resolved_at`. Notes required. Room → `cleaning` (not blindly
`available` — post-maintenance work needs cleaning).

## Close
`POST /maintenance/{ticket_uid}/close` — only `resolved` tickets → `closed` +
`closed_at`. Room released to `cleaning` if still `maintenance`.

## Room Maintenance History
`GET /rooms/{room_uid}/maintenance` — all tickets ever raised for the room,
newest-first, with timelines.

# Task Ticket Workflow (implemented)

Every task now carries `ticket_number` (`TASK-YYYY-NNNNN`, PostgreSQL
sequence), `supervisor_uid`/`supervisor_name`, `room_uid`/`room_number`,
`submitted_at`, `completed_at`.

**Statuses:** `pending (open) → assigned → in_progress → submitted →
approved → completed` — rejected submissions → `reopened`.

`POST /tasks` accepts `supervisor_uid` + `room_uid`; a task with an assignee
starts `assigned` instead of `pending`.

## Submit
`POST /tasks/{task_uid}/submit` — `{ "note"?, "photo_urls": [] }` — assignee
submits finished work → `submitted`. Employees may only submit their own tasks.

## Approve
`POST /tasks/{task_uid}/approve` — `{ "note"? }` — staff only → `completed`.
Repetitive tasks return `{ task, generated_task }` (next instance). The
assignee cannot self-approve (403).

## Reject
`POST /tasks/{task_uid}/reject` — `{ "reason": "…" }` (required) — staff only →
`reopened`, reason recorded in history.

## Reopen
`POST /tasks/{task_uid}/reopen` — `{ "note"? }` — staff only. Completed /
cancelled / rejected tasks return to `assigned`/`pending`.

History event types added: `submitted`, `approved`, `rejected`, `reopened`.

# Work Allocation Engine

Zone-based persistent round-robin allocation shared by maintenance tickets
and tasks. The backend owns every assignment decision — the frontend never
chooses an employee automatically.

## Model

- `zone_allocation_state` — one row per zone holding the round-robin pointer
  (`last_assigned_employee_id`, `version`). Selected `FOR UPDATE` during
  allocation, so concurrent batches cannot land on the same slot.
- `work_allocation_batches` — one row per allocation operation
  (`WB-YYYY-NNNNN`). A single ticket is a batch of one. One zone + one batch
  = one employee; the pointer advances once per batch, never per ticket.
- `work_allocation_history` — audit row per ticket per decision
  (`round_robin` | `manual` | `reassign`).

Eligibility: employee is `Active`, belongs to the property, is assigned to
the ticket's zone, is not on leave, and is not the property manager account.
No eligible employee (or no zone) → ticket stays `unassigned` with
`allocation_reason` = `no_eligible_employee` | `no_zone`.

Ticket fields added (maintenance + task): `zone_uid`, `allocation_batch_id`,
`allocation_status` (`auto_assigned` | `manually_assigned` | `unassigned`),
`allocation_method`, `allocation_reason`.

## POST /work-batches — grouped ticket creation

Staff only. Creates N tickets as one allocation operation. Tickets are
grouped by their server-resolved zone (room/dorm/bed → current zone — never
trusted from the payload); each zone group gets ONE employee via the
round-robin pointer.

```json
{
  "property_uid": "…",
  "tickets": [
    { "kind": "maintenance", "room_uid": "…",
      "maintenance_type": "plumbing", "issue": "Tap leaking",
      "priority": "high", "due_date": "…", "attachment_urls": [] },
    { "kind": "maintenance", "bed_uid": "…",
      "maintenance_type": "furniture", "issue": "Bunk ladder loose" }
  ]
}
```

Response `201`:

```json
{
  "batches": [
    {
      "batch_id": "…", "batch_number": "WB-2026-00021",
      "zone_uid": "…", "zone_name": "Zone B",
      "employee_uid": "…", "employee_name": "Rahul",
      "work_type": "maintenance",
      "allocation_status": "auto_assigned", "allocation_reason": null,
      "tickets": [ /* full MaintenanceTicket objects */ ]
    }
  ],
  "total": 1
}
```

Mixed-zone submissions are auto-split — one batch per zone, each with its
own employee and one pointer advance.

## GET /work-batches/{batch_id}

Batch + its tickets (maintenance and task).

## GET /properties/{property_uid}/work-batches

Latest 100 batches for the property with their tickets.

## Automatic assignment on create

- `POST /maintenance` — single ticket = batch of one; zone resolved from the
  target's current zone at creation; auto-assigns when eligible.
- `POST /tasks` — `task_type: "fixed"` without `employee_uid` → zone
  round-robin (explicit `employee_uid` = manual assignment, recorded as such).
- `POST /maintenance/{id}/assign` and `PATCH /tasks/{id}` employee change —
  manual reassign, audited (`previous_employee_*` recorded); never moves the
  round-robin pointer.

---

## Work Templates & Scheduler

Reusable operational definitions (cleaning, inspections, checklists…). The
backend scheduler owns generation — the frontend only configures. Generated
work carries `template_id` + `template_version`; dynamic scopes
("all rooms in Zone B") resolve against current structure, and automatic
assignment reuses the shared WorkAllocationService (one batch per zone).

### Endpoints

- `POST   /templates` — create (staff)
- `GET    /templates?property_uid=&status=&template_type=&category=&search=`
- `GET    /templates/{id}`
- `PATCH  /templates/{id}` — edits bump `version` + snapshot prior config
- `DELETE /templates/{id}` — only draft/archived (pause first otherwise)
- `POST   /templates/{id}/activate | /pause | /resume | /archive | /duplicate`
- `GET    /templates/{id}/history` — generation ledger rows
- `GET    /templates/{id}/generated-work` — `{ tasks, maintenance }`
- `POST   /templates/generate-due` — scheduler tick (staff); also runs every
  60s via the app background loop. Idempotent via the
  `template_generations(template_id, occurrence_key)` unique ledger.

### Create payload

```json
{
  "property_uid": "…", "name": "Daily Room Inspection",
  "template_type": "inspection", "category": "housekeeping",
  "priority": "medium", "duration_minutes": 30, "status": "active",
  "assignment": {"mode": "automatic", "method": "zone_round_robin"},
  "location":   {"scope": "zone", "zone_uid": "…", "target": "rooms"},
  "schedule":   {"kind": "recurring", "frequency": "daily",
                 "time": "10:00", "timezone": "Asia/Kolkata",
                 "start_date": "2026-10-01", "end_date": null},
  "checklist": [{"title": "Check room lighting", "required": true}],
  "verification": {"checklist_required": true, "photo_required": true,
                   "supervisor_approval": false},
  "overdue": {"actions": ["mark_overdue", "notify_supervisor"],
              "threshold_minutes": 30},
  "notifications": {"notify_on_assignment": true, "notify_on_overdue": true}
}
```

- `assignment.mode`: `team` (+`team`, optional `supervisor_uid`),
  `individual` (+`employee_uid`), or `automatic` (+`method` —
  `zone_round_robin` uses the allocation engine).
- `location.scope`: `property` | `zone` (+`zone_uid`, `target`:
  `rooms|dorms|beds|units`) | `area` | `rooms`/`dorms`/`beds` (+uid lists).
- `schedule`: `one_time` (`date`,`time`,`end_time`) or `recurring` —
  `hourly` (`every`, `start_time`, `window_end`), `daily` (`every`, `time`),
  `weekly` (`weekdays` 0=Mon–6=Sun, `time`), `monthly` (`day_of_month` or
  `relative_week`+`relative_weekday`, `time`), `custom` (`every`,
  `custom_unit`: `days|weeks|months`). `start_date`/`end_date` bound the run.
- `status`: `draft` (no generation) → `active` → `paused` → `archived`.
- `template_type: "maintenance"` generates maintenance tickets; other types
  generate tasks.

---

## Today's Tasks vs Task History

Two different read models — never the same query:

- **Today's Tasks** = "what work is supposed to happen today" — generated
  task instances PLUS scheduled template occurrences not yet generated.
- **Task History** = actual generated task instances only.

### GET /tasks/today?property_uid=

```json
{
  "date": "2026-09-23",
  "summary": {"total_planned": 32, "generated": 24, "pending_generation": 8,
              "assigned": 21, "in_progress": 6, "completed": 12, "overdue": 3},
  "items": [{
    "item_type": "occurrence",               // or "task"
    "occurrence_key": "<iso>|<target>",
    "generation_state": "pending_generation", // or generated | failed
    "work_status": null,                      // only set once generated
    "template_uid": "…", "template_name": "…",
    "scheduled_at": "…", "zone_name": "…", "target_label": "Room 101",
    "task_uid": null, "ticket_number": null, "assignee": null
  }]
}
```

Employees only see occurrences/tasks assigned to them.

### GET /tasks/history

Filters: `property_uid, date_from, date_to, zone_uid, room_uid,
employee_uid, status, priority, task_type, source (template|recurring|
manual), template_uid, search (id/title/employee/room), page, page_size`.
Returns `{items, pagination: {page, page_size, total, total_pages}}` —
server-side filtered and paginated.

### POST /templates/{id}/generate-occurrence

`{"occurrence_key": "<iso>|<target>"}` — "Generate Now" for one scheduled
occurrence: validates, expands the target, creates the task, runs the
shared allocation engine, writes the ledger row. 422 if already generated.
