# AiROS Staff — employee mobile app

React Native + Expo client for the AiROS property-operations backend.
**Staff only** — task execution, checklists, photo evidence, and maintenance
tickets. Management/HR/approval workflows stay in the web app.

## Stack

- Expo SDK 57, React Native 0.86, TypeScript (strict)
- expo-router (file-based navigation)
- expo-secure-store for tokens (refresh token never touches AsyncStorage)
- expo-image-picker for camera/library evidence
- No state library — one session context + per-screen server fetches

## Run

```bash
cd Mobile_frontend
npm install
cp .env.example .env        # set EXPO_PUBLIC_API_URL for local dev
npx expo start
```

API base resolution: `EXPO_PUBLIC_API_URL` → `app.json expo.extra.apiUrl`
(production default: the Railway API). Always include the `/api/v1` suffix.

- iOS simulator: `http://localhost:8000/api/v1`
- Android emulator: `http://10.0.2.2:8000/api/v1`
- Physical device: `http://<lan-ip>:8000/api/v1`
- Production: leave unset — uses the baked app.json default
  (`https://airco-pms-production.up.railway.app/api/v1`).

## Android builds (EAS)

`eas.json` defines `development` / `qa` / `production` profiles. The QA
profile produces an installable APK:

```bash
npx eas-cli login                    # one-time Expo account auth
npx eas-cli build -p android --profile qa   # cloud build → APK download link
```

Local alternative (requires Android SDK + `ANDROID_HOME`):

```bash
npx eas-cli build -p android --profile qa --local
```

## Backend contract (reused, never duplicated)

| Flow | Endpoints |
|---|---|
| Auth | POST /auth/login · POST /auth/refresh · POST /auth/logout · GET /auth/me |
| Tasks | GET /tasks (server-scopes employees) · GET /tasks/{id} · POST /tasks/{id}/start · POST /tasks/{id}/submit |
| Maintenance | GET /maintenance (assigned-or-reported scope) · GET /maintenance/{id} · POST /maintenance · GET /maintenance/eligible-locations · POST /maintenance/{id}/start · POST /maintenance/{id}/resolve |
| Media | POST /media/uploads (multipart → {url,key}) |

Deliberately **not** used (staff-only on the server, employees get 403):
POST /tasks/{id}/complete, /approve, /reject, /reopen, /request-redo,
PATCH /tasks/{id}/assignee, maintenance assign/hold/disapprove/close,
everything under /hr, /templates, /work-batches.

## Structure

```
app/                     expo-router routes
  (auth)/login.tsx       public
  (employee)/            session + role guard
    (tabs)/              Tasks · Maintenance · Profile
    tasks/[id].tsx       detail → start → checklist → evidence → submit
    maintenance/new.tsx  raise ticket (coverage-scoped targets)
    maintenance/[id].tsx detail → start work → resolve
components/              ui kit + TaskCard/TicketCard/Checklist/EvidencePicker
services/                api.ts (fetch+refresh-on-401), auth, tasks, maintenance, media (XHR upload)
stores/session.tsx       auth state only
hooks/                   useFetch + typed data hooks (no global collection cache)
constants/               API config, AiROS colors
types/api.ts             wire types mirroring backend serializers
utils/format.ts          IST formatting + display labels (display-only)
```

## Verification

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
```
