# Temporary server deployment status

## Current backend

- Server IP: `46.17.103.26`
- Public API URL: `https://baikal.46.17.103.26.sslip.io`
- Admin panel: `https://baikal.46.17.103.26.sslip.io/admin`
- Legal pages:
  - `https://baikal.46.17.103.26.sslip.io/privacy`
  - `https://baikal.46.17.103.26.sslip.io/support`
  - `https://baikal.46.17.103.26.sslip.io/terms`
  - `https://baikal.46.17.103.26.sslip.io/data-deletion`

## Server layout

- Backend app: `/opt/baikal-app/backend`
- SQLite database: `/var/lib/baikal-app/data/baikal.sqlite`
- Uploaded photos: `/var/lib/baikal-app/uploads`
- Runtime env: `/etc/baikal-backend.env`
- systemd service: `baikal-backend`
- Nginx site: `baikal-backend`

`ADMIN_TOKEN` is stored only in `/etc/baikal-backend.env` on the server. Do not paste it into chats, docs, or commits.

## Verified smoke tests

Checked on the temporary HTTPS backend:

- `GET /health` returns `200`.
- Legal pages return `200`.
- `POST /api/uploads` returns `201`.
- `POST /api/reports` returns `201`.
- `POST /api/reports/:id/confirm` returns `200`.
- `GET /api/me/summary` returns `200`.
- `GET /api/admin/reports` returns `401` without token and `200` with token.
- Admin status flow works:
  - `moderation -> transferred`
  - `transferred -> in_progress`
  - `in_progress -> resolved`

## Useful commands

```bash
ssh -i ~/.ssh/hostkey_ed25519 -o IdentitiesOnly=yes root@46.17.103.26
```

```bash
ssh -i ~/.ssh/hostkey_ed25519 -o IdentitiesOnly=yes root@46.17.103.26 \
  "systemctl status baikal-backend --no-pager"
```

```bash
curl https://baikal.46.17.103.26.sslip.io/health
```

To copy the admin token for your own login, run this locally and keep the value private:

```bash
ssh -i ~/.ssh/hostkey_ed25519 -o IdentitiesOnly=yes root@46.17.103.26 \
  "grep '^ADMIN_TOKEN=' /etc/baikal-backend.env"
```

## EAS env for TestFlight

```bash
npx eas-cli env:create --environment production --name EXPO_PUBLIC_API_BASE_URL --value https://baikal.46.17.103.26.sslip.io
npx eas-cli env:create --environment production --name EXPO_PUBLIC_ADMIN_ENABLED --value false
npx eas-cli env:create --environment production --name EXPO_PUBLIC_PRIVACY_URL --value https://baikal.46.17.103.26.sslip.io/privacy
npx eas-cli env:create --environment production --name EXPO_PUBLIC_SUPPORT_URL --value https://baikal.46.17.103.26.sslip.io/support
npx eas-cli env:create --environment production --name EXPO_PUBLIC_TERMS_URL --value https://baikal.46.17.103.26.sslip.io/terms
```
