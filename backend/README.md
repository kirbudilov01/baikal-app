# Baikal Backend

Backend contour for the mobile app, browser admin panel, TestFlight demo, and future production API.

## Run

```bash
cd backend
npm start
```

For local admin testing without a token:

```bash
ALLOW_UNSAFE_LOCAL_ADMIN=true npm start
```

Health check:

```bash
curl http://localhost:4000/health
```

Admin panel:

```text
http://localhost:4000/admin
```

## API

- `GET /api/reports` - mobile list of reports
- `POST /api/reports` - create report from mobile app
- `POST /api/reports/:id/confirm` - confirm a visible report from the map
- `GET /api/statuses` - mobile/admin status dictionary
- `GET /api/rewards` - reward catalog
- `POST /api/rewards/:id/claim` - issue a one-time demo reward code
- `GET /api/me/summary` - demo profile balance and reward availability
- `GET /api/admin/reports` - admin queue
- `GET /api/admin/reports/:id` - admin report with event history
- `POST /api/admin/reports/:id/status` - admin status transition
- `GET /admin` - browser admin panel
- `GET /privacy` - public privacy policy draft
- `GET /support` - public support page
- `GET /terms` - public terms draft
- `GET /data-deletion` - public data deletion process

Admin endpoints require `ADMIN_TOKEN` in production:

```bash
curl http://localhost:4000/api/admin/reports \
  -H "x-admin-token: $ADMIN_TOKEN"
```

The browser admin panel stores the token in local browser storage. Use it only on trusted devices.

## Environment

See `.env.example`.

- `NODE_ENV=production` - enables production assumptions.
- `ADMIN_TOKEN` - required for `/api/admin/*` unless unsafe local mode is enabled.
- `ALLOW_UNSAFE_LOCAL_ADMIN=true` - local development only.
- `ALLOWED_ORIGINS` - comma-separated CORS allowlist.
- `MAX_BODY_BYTES` - JSON body size limit.
- `DB_PATH` - SQLite database path. On Render this is `/var/data/baikal.sqlite`.
- `SUPPORT_EMAIL` - public support contact shown on legal pages.
- `LEGAL_OPERATOR_NAME`, `LEGAL_OPERATOR_ADDRESS`, `LEGAL_OPERATOR_INN` - legal operator placeholders for public pages.
- `DATA_HOSTING_NOTE` - data hosting/legal localization note.

## Status Flow

```text
На модерации -> Передано -> В работе -> Решено
       \             \
        -> Отклонено  -> Отклонено
```

The backend rejects invalid transitions. For example, a report cannot jump directly
from `moderation` to `resolved`, and terminal statuses cannot be reopened without
a separate future escalation flow.

## Production Notes

This backend uses SQLite for the temporary TestFlight/pilot server. On Render it
is configured with a persistent disk, so reports survive normal restarts and
redeploys. For public production, keep the same API/status machine but move to
managed Postgres in an approved region, add object storage for photos, full admin
auth/RBAC, rate limiting, monitoring, backups, and CI/CD.

## Render

The repository contains `render.yaml` for a temporary production-like backend.

Blueprint URL:

```text
https://dashboard.render.com/blueprint/new?repo=https://github.com/kirbudilov01/baikal-app
```

After deploy, set the mobile app env `EXPO_PUBLIC_API_BASE_URL` to the Render service URL.
Also set:

```text
EXPO_PUBLIC_PRIVACY_URL=https://YOUR_BACKEND_URL/privacy
EXPO_PUBLIC_SUPPORT_URL=https://YOUR_BACKEND_URL/support
EXPO_PUBLIC_TERMS_URL=https://YOUR_BACKEND_URL/terms
```
