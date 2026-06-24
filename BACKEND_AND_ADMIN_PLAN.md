# Backend, Database, Admin Panel Readiness

## Current State

The mobile app is still a frontend demo. It has local state, local draft saving,
camera/gallery/location flows, and simulated reports. It is not production-ready
until reports, photos, users, statuses, points, and moderation live on a backend.

## What Was Added

A development backend contour now lives in `backend/`.

It includes:
- report creation endpoint for the mobile app;
- public report list endpoint for the mobile app;
- admin report queue endpoint;
- admin report detail endpoint with event history;
- status transition endpoint;
- status state machine with invalid-transition protection;
- tests for the status logic.

## Production Database Model

Recommended production database: Postgres.

Core tables:
- `users`: app users, phone/social auth id, trust level, created date;
- `reports`: category, description, coordinates, current status, points, author;
- `report_photos`: object-storage references, moderation flags;
- `report_events`: append-only history of status changes and admin actions;
- `report_confirmations`: community confirmations with anti-duplicate checks;
- `admin_users`: roles and permissions;
- `admin_assignments`: who owns a report operationally;
- `reward_transactions`: points accrual and spend history;
- `push_tokens`: device tokens for notifications.

## Status Logic

Production status flow:

```text
На модерации -> Передано -> В работе -> Решено
       \             \
        -> Отклонено  -> Отклонено
```

Rules:
- mobile creates only `На модерации`;
- admin can move to `Передано` or `Отклонено`;
- assigned/admin user can move to `В работе`;
- only admin/manager can close as `Решено`;
- every change creates an immutable `report_events` record;
- mobile reads `nextStep` from backend, not hardcoded UI text.

## Admin Panel MVP

Needed screens:
- login;
- moderation queue;
- report detail with photo, map, description and event history;
- status action buttons;
- reject dialog with reason;
- assign responsible organization/person;
- filters by category, district, status, age;
- export/reporting later.

## Mobile Stability Requirements

For a stable mobile app:
- optimistic UI only where safe;
- offline draft queue for report creation;
- retry with backoff for uploads;
- image compression before upload;
- request timeout handling;
- idempotency key for report creation;
- user-friendly failed-send state;
- crash reporting;
- analytics for funnel drop-offs;
- push notifications for status changes;
- feature flags for risky changes.

## Infrastructure Requirements

Production contour:
- API service behind HTTPS;
- Postgres with automated backups;
- object storage for photos;
- CDN or signed URLs for media;
- auth provider or custom OTP auth;
- role-based admin auth;
- logs, metrics, alerts;
- Sentry or equivalent crash/error tracking;
- CI checks and deploy pipeline;
- staging and production environments.

## Russia / Roskomnadzor Requirements

Before processing real user data, the project needs a separate compliance track:

- define the legal operator of personal data;
- prepare and publish privacy policy and user agreement;
- obtain consent/legal basis for phone/email, geolocation, photo upload, report text, push tokens and analytics;
- submit Roskomnadzor personal data processing notification where required;
- store Russian citizens' personal data in databases located in Russia;
- avoid foreign SaaS for raw PII, or handle cross-border transfer notification/assessment before use;
- determine ISPDn protection level under Government Decree No. 1119;
- implement organizational and technical measures under FSTEC Order No. 21;
- keep immutable admin audit logs;
- strip EXIF from photos and moderate/redact images before public display;
- do not publish author identity or precise personal context publicly.

Detailed checklist: `ARCHITECTURE_RU_COMPLIANCE.md`.

## Readiness Score

- UI prototype: high.
- Mobile local flow: medium-high.
- Backend: early scaffold.
- Database: designed conceptually, not production implemented.
- Admin panel: API foundation started, UI not built.
- Production stability: not ready yet.

Next recommended step: connect the mobile app to the development backend through
an API client while keeping local fallback, then build the first admin web panel.
