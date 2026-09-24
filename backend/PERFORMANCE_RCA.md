# Performance RCA — Management Tool

## Executive Summary

The dominant bottleneck was **not** React rendering or bundle size — it was
**per-request database round trips against remote Supabase Postgres** (~300ms
RTT each), amplified by:

1. SQLAlchemy `echo=True` dumping every statement to a slow Windows console.
2. `pool_pre_ping` paying a full RTT on *every* request.
3. Two-step entity→property authorization lookups doubling RTTs on mutations.
4. `selectinload(User.company)` splitting auth into 2 queries.
5. Cold connection pool — first use of each pooled conn pays TCP+TLS+setup
   (~3.4s measured).
6. Frontend mutations awaiting the ~3s API before updating the UI.

## Measured — Before

| Endpoint (warm-ish) | Latency |
|---|---|
| GET /auth/me | ~2900ms |
| GET /rooms | ~3100ms |
| GET /tasks | ~3500ms |
| GET /maintenance | ~3800ms |
| Workspace burst (8 parallel) | ~5260ms wall |

In-session isolated timing (diagnostic):
- Session checkout (pre_ping + BEGIN + ROLLBACK): ~870ms per request
- Single warm query RTT: ~140ms; typical request = 4-6 sequential RTTs

## Fixes Implemented

### Backend (CRITICAL)
- `echo` now opt-in via `SQL_ECHO` env (default off) — killed console I/O cost
- `pool_pre_ping=False` + `pool_recycle=300` — stale conns recycled at
  checkout without an extra RTT per request
- `joinedload(User.company)` — auth user+company in ONE query (was 2)
- `StructureService._get` — entity + property fetched in a single JOIN query
  (was 2 sequential) — halves RTTs on every structure mutation
- Pool: `pool_size 5→12`, `max_overflow 5→10` — the workspace fires 8 parallel
  list requests; 5 connections queued them
- `GZipMiddleware` (>500B) + `X-Response-Time` header + `[PERF]` request
  logging (dev only)

### Frontend (HIGH)
- **Optimistic mutations with rollback**: room/dorm zone moves, room status,
  bed status — UI reflects the drop instantly; API failure restores state.
  (Employee zone drag was already optimistic.)
- **Route-level code splitting** — all workspace views are `React.lazy` chunks;
  main bundle 371KB, views split 5–47KB each
- `activeTicketForRoom` O(rooms×tickets) scan → memoized `Map<room_uid, ticket>`

## Measured — After (warm pool)

| Endpoint | Before | After |
|---|---|---|
| GET /auth/me | ~2900ms | ~950ms |
| GET /rooms | ~3100ms | ~1300ms |
| GET /tasks | ~3500ms | ~1250ms |
| GET /maintenance | ~3800ms | ~1350ms |
| Workspace burst | ~5260ms | ~1400ms wall |
| PATCH room status | ~3200ms | perceived instant (optimistic) |

## Root-Cause Verdict

- **CRITICAL**: Remote Postgres RTT × sequential queries per request —
  every extra query costs ~300ms. Minimized per-request query count.
- **HIGH**: No optimistic UI on structure mutations — drops felt 3s slow.
- **MEDIUM**: Monolithic bundle loaded before first paint — now split by route.
- **LOW**: per-card ticket scans — now an indexed Map.

## Remaining Bottlenecks (physics / deliberate)

- Supabase free tier is geographically remote: ~300ms RTT is a hard floor.
  Each request still needs auth + data + txn ≈ 3 RTTs (~900-1300ms). A
  same-region DB or Supabase pooler endpoint would cut this further.
- Cold-pool warmup (~3s per fresh connection) still exists on first requests
  after idle — `pool_recycle` keeps this bounded.
- Per-request user lookup is kept (freshness > 300ms); a short-TTL user cache
  is possible but trades revocation latency.
- No TanStack Query — the context store already does targeted cache updates;
  migrating is a larger refactor with modest additional gain at this scale.
