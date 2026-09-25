# Management Tool API

FastAPI backend for the Management Tool property & operations platform.
The frontend contract lives in `../frontend/API.md` — business endpoints
are implemented against that contract in the next phase. This directory
contains the infrastructure foundation: configuration, async database
access, migrations, health checks, logging, and error handling.

## Stack

- Python 3.11+
- FastAPI + Uvicorn
- SQLAlchemy 2.x (async) + asyncpg
- Alembic (async migrations)
- Pydantic 2 + pydantic-settings
- Supabase PostgreSQL (direct connection)

## Layout

```
app/
├── main.py                  # FastAPI app, lifespan, health endpoints, CORS
├── core/
│   ├── config.py            # pydantic-settings — single source of config
│   ├── database.py          # AsyncEngine, async_sessionmaker, get_db dep
│   ├── logging.py           # app logging (never logs secrets)
│   ├── exceptions.py        # consistent error envelope + handlers
│   └── security.py          # auth primitives (next phase)
├── api/v1/router.py         # versioned API aggregator
├── dependencies/            # shared FastAPI deps (re-exports get_db)
├── models/                  # SQLAlchemy models (next phase)
├── schemas/                 # Pydantic DTOs (next phase)
├── repositories/            # data access (next phase)
├── services/                # business logic (next phase)
└── utils/
alembic/                     # migration environment (URL from settings, not ini)
tests/test_health.py         # /health + /health/db
```

## Setup

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env   # then fill in SUPABASE_DB_PASSWORD etc.
```

## Environment variables

| Variable | Purpose | Sensitivity |
|---|---|---|
| `APP_NAME`, `APP_ENV`, `DEBUG` | app metadata | public |
| `API_V1_PREFIX` | `/api/v1` mount point | public |
| `SUPABASE_DB_HOST/PORT/NAME/USER` | DB coordinates | public |
| `SUPABASE_DB_PASSWORD` | DB password — injected into the URL at runtime | **secret** |
| `DATABASE_URL` | optional full override (`postgresql+asyncpg://…`) | **secret** |
| `DB_POOL_*` | pool size / overflow / recycle / timeout | public |
| `SUPABASE_URL` | project URL | public |
| `SUPABASE_PUBLISHABLE_KEY` | client-safe key | public |
| `SUPABASE_SECRET_KEY` | service-role key — **server only, never returned by any endpoint** | **secret** |
| `SUPABASE_STORAGE_S3_URL` | S3-compatible storage endpoint | public |
| `CORS_ORIGINS` | comma-separated allowed origins | public |

## Run

```bash
uvicorn app.main:app --reload
```

- API root: `http://localhost:8000`
- Health: `GET /health` → `{"status":"ok", ...}`
- DB health: `GET /health/db` → `{"status":"ok","database":"connected"}`
- OpenAPI: `GET /docs` (dev only — disabled when `APP_ENV=production`)

## Auth endpoints (implemented)

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/auth/signup` | Company + initial SUPER_ADMIN in one transaction |
| `POST /api/v1/auth/login` | Email **or** username + password → access + refresh tokens |
| `POST /api/v1/auth/refresh` | Exchange refresh token for a new access token |
| `POST /api/v1/auth/logout` | Revoke the refresh token |
| `GET /api/v1/auth/me` | Current user + company (session restore) |
| `PATCH /api/v1/auth/me` | Update own name / phone / email |

Passwords are Argon2id-hashed (`password_hash` never leaves the DB layer).
Access tokens are 30-min HS256 JWTs; refresh tokens are opaque strings stored
as SHA-256 hashes in `refresh_tokens` and revoked on logout.

New env vars: `JWT_SECRET_KEY` (required — generate with
`python -c "import secrets; print(secrets.token_urlsafe(48))"`),
`JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS`.

## Unified dev startup

From the repository root: `python main.py` starts this backend (:8000) and
the Vite frontend (:3000) together; CTRL+C stops both.

## Migrations

```bash
alembic revision --autogenerate -m "message"
alembic upgrade head
alembic current
```

Alembic reads the database URL from `app.core.config.settings` — `alembic.ini`
contains no credentials.

## Tests

```bash
pytest
```

`tests/test_health.py` exercises `/health` and real PostgreSQL connectivity
via `/health/db`.

## Security notes

- `.env` is gitignored; `.env.example` carries placeholders only.
- Secrets (`SUPABASE_DB_PASSWORD`, `SUPABASE_SECRET_KEY`) are server-only —
  never logged, never returned by endpoints, never shipped to the frontend.
- CORS is explicit via `CORS_ORIGINS` — no `*` wildcard.
- Error responses use a consistent `{ "error": { code, message } }` envelope;
  raw tracebacks are never exposed in production.

## Deployment

- Backend: Railway (service "Airco PMS" + "worker", root dir /backend, auto-deploys on push to main)
- Frontend: Vercel (project airco-pms, auto-deploys on push to main)
- Database: Supabase PostgreSQL (session pooler for IPv4)
- Storage: Supabase Storage S3 (bucket: uploads)
- Redis: Railway Redis (cache, rate limiting, arq job queue)
