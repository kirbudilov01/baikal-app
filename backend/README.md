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

## API

- `GET /api/reports` - mobile list of reports
- `POST /api/reports` - create report from mobile app
- `GET /api/statuses` - mobile/admin status dictionary
- `GET /api/admin/reports` - admin queue
- `GET /api/admin/reports/:id` - admin report with event history
- `POST /api/admin/reports/:id/status` - admin status transition

Admin endpoints require `ADMIN_TOKEN` in production:

```bash
curl http://localhost:4000/api/admin/reports \
  -H "x-admin-token: $ADMIN_TOKEN"
```

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
