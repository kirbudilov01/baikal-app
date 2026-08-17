# Baikal Backend

Dev backend contour for the mobile app and future admin panel.

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
- `GET /api/statuses` - mobile/admin status dictionary
- `GET /api/admin/reports` - admin queue
- `GET /api/admin/reports/:id` - admin report with event history
- `POST /api/admin/reports/:id/status` - admin status transition
- `GET /admin` - browser admin panel

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

This backend uses a local JSON file for development speed. For production, keep the
same API/status machine but replace storage with Postgres, object storage for
photos, full admin auth/RBAC, audit logs, rate limiting, monitoring, backups,
and CI/CD.

## Render

The repository contains `render.yaml` for a temporary production-like backend.

Blueprint URL:

```text
https://dashboard.render.com/blueprint/new?repo=https://github.com/kirbudilov01/baikal-app
```

After deploy, set the mobile app env `EXPO_PUBLIC_API_BASE_URL` to the Render service URL.
