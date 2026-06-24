# Архитектура и комплаенс для запуска в РФ

Документ не заменяет юридическое заключение. Это инженерная рамка, чтобы приложение, backend, база данных и админка проектировались сразу с учетом российского рынка, персональных данных и требований регуляторов.

## 1. Текущая готовность

Сейчас проект состоит из:
- Expo mobile app: интерфейс, камера, галерея, геолокация, локальный черновик;
- dev-backend: API заявок, статусы, админские endpoint-ы, история событий;
- dev-хранилище: локальный JSON, только для разработки.

Уровень готовности:
- мобильный UX-прототип: высокий;
- backend-доменная логика: начальный рабочий контур;
- production backend: не готов;
- production БД: не готова;
- админ-панель: backend-выходы есть, UI нет;
- комплаенс РФ: требования описаны, документы/процессы еще нужно внедрить.

## 2. Главный архитектурный принцип

Мобильное приложение не должно быть источником истины.

Источник истины:
- заявки;
- статусы;
- история событий;
- баллы;
- права администраторов;
- модерация;
- публикация на карте;
- уведомления;
- сроки хранения;
- удаления/обезличивания

должны жить на backend и в базе данных.

Мобильное приложение должно:
- создавать черновик локально;
- отправлять заявку с idempotency key;
- показывать состояние с backend;
- работать при плохой сети через retry/queue;
- не хранить лишние персональные данные;
- не показывать публично контакты автора.

## 3. Production-архитектура

```text
iOS / Android app
  -> API Gateway / Backend HTTPS
    -> Auth service
    -> Reports service
    -> Moderation service
    -> Rewards service
    -> Notifications service
    -> Audit/event log
      -> PostgreSQL in Russia
      -> Object storage in Russia
      -> Queue for async jobs
      -> Monitoring / logs / alerts

Admin web panel
  -> Same Backend API
  -> RBAC
  -> Audit trail
```

Recommended stack:
- API: Node.js/NestJS or Fastify, or Go if нужна максимальная простота эксплуатации;
- DB: PostgreSQL hosted in РФ;
- media: S3-compatible object storage in РФ;
- queue: Redis/RabbitMQ/NATS in РФ;
- admin: React web panel behind admin auth;
- monitoring: Sentry/self-hosted или российский аналог, Prometheus/Grafana, centralized logs;
- maps: Yandex Maps / 2GIS for РФ-market compatibility;
- SMS/OTP: российский SMS provider;
- push: APNs/FCM technically unavoidable for iOS/Android, but push payloads must not contain sensitive personal data.

## 4. Персональные данные, которые возникают в продукте

Potential personal data:
- phone/email/user id;
- device id / push token;
- precise geolocation;
- report author id;
- photo metadata;
- uploaded photo if it contains a person, vehicle plate, private property or other identifiable context;
- text description if user writes identifying details;
- admin accounts and audit logs.

High-risk data:
- точная геолокация, если связана с пользователем;
- фото людей: может стать биометрическими ПДн, если используется для идентификации личности;
- EXIF metadata in photos;
- public map pins near private places;
- free-text descriptions.

Product decision:
- public app must show problem, area/status, not author identity;
- exact coordinates should be shown only where it is needed operationally;
- photos must pass moderation/redaction before public display;
- EXIF must be stripped before storing or publishing;
- public publication must avoid personal data unless there is separate lawful basis/consent.

## 5. Требования РФ и Роскомнадзора

### 5.1. Operator status

Before collecting real user data, the operating legal entity likely becomes an operator of personal data.

Required:
- define operator: legal entity / ИП / organization;
- appoint responsible person for personal data processing;
- define purposes, categories of data, retention periods and processors;
- prepare internal local acts;
- submit notification to Роскомнадзор before processing personal data when required.

Source: Roskomnadzor personal data notification form: https://pd.rkn.gov.ru/operators-registry/notification/form/

### 5.2. Consent and legal basis

The app needs clear legal basis for:
- account/contact data;
- geolocation;
- photo upload;
- processing report text;
- push tokens;
- analytics/crash logs;
- publication of report content after moderation;
- transfer to responsible organizations, if applicable.

Implementation:
- privacy policy accessible before submit;
- consent checkbox/action near report submit;
- separate consent for public dissemination if any user-provided content with personal data may be public;
- separate consent/notice for analytics/crash reporting;
- ability to revoke/delete where applicable.

152-ФЗ requires a lawful basis for processing; operator bears burden to prove consent/legal basis. Source: official 152-ФЗ page: https://letters.kremlin.ru/info-service/acts/9

### 5.3. Data localization

For Russian citizens, the primary recording, systematization, accumulation, storage, clarification and extraction of personal data must be performed using databases located in Russia.

Architecture requirement:
- PostgreSQL in РФ;
- object storage in РФ;
- logs containing personal data in РФ;
- backups in РФ;
- admin tools in РФ;
- avoid foreign SaaS storing raw PII unless legally assessed.

### 5.4. Cross-border transfer

If any personal data goes to foreign services, the operator must assess and notify before cross-border transfer where required.

Risk areas:
- APNs/FCM push tokens and push service metadata;
- App Store / Google Play telemetry;
- foreign analytics;
- foreign crash reporting;
- foreign cloud logs;
- email/SMS vendors outside РФ;
- maps/geocoding outside РФ.

Rule for product:
- no personal data in push payloads;
- prefer РФ-hosted analytics/logging;
- if Sentry/foreign SaaS is used, filter PII aggressively and handle cross-border process separately;
- document all processors and transfer destinations.

Source: Roskomnadzor cross-border transfer form notes the pre-transfer notification requirement since 1 March 2023: https://pd.rkn.gov.ru/cross-border-transmission/form2/

### 5.5. Protection level for ISPDn

The backend will be an information system processing personal data. Production launch requires determining protection level under Government Decree №1119 and implementing measures under FSTEC Order №21.

Engineering inputs needed:
- data categories;
- number of subjects;
- whether special/biometric data is processed;
- threat model type;
- public/non-public access;
- admin access model;
- processors and infrastructure.

Sources:
- Government Decree №1119: https://www.consultant.ru/document/cons_doc_LAW_137356/
- FSTEC Order №21: https://www.consultant.ru/document/cons_doc_LAW_146520/

## 6. Product requirements for compliance

Mobile app must include:
- privacy policy link on onboarding/profile/report submit;
- terms/user agreement;
- explicit consent before first real report submit;
- camera/photo/location permission copy matching actual use;
- report deletion/request support path;
- “my data” support path;
- public anonymity explanation;
- no raw personal details in public map/list;
- offline draft warning if data stays on device;
- age/legal capacity decision.

Backend must include:
- auth;
- RBAC;
- immutable audit log;
- status transition rules;
- data retention rules;
- soft delete / anonymization;
- admin action reason;
- export for RKN/legal request;
- PII redaction in logs;
- rate limiting;
- abuse protection;
- backups;
- monitoring.

Admin panel must include:
- login and role checks;
- moderation queue;
- report detail with photo, coordinates, text, event history;
- status action buttons with allowed transitions only;
- reject reason;
- public/private visibility flag;
- photo redaction/blur workflow;
- assignment to responsible organization;
- audit trail visible to supervisors;
- filters and SLA counters.

## 7. Database schema target

Core tables:
- `users`: id, phone/email hash, auth provider id, trust level, created_at;
- `user_consents`: user_id, consent_type, version, accepted_at, revoked_at, source;
- `reports`: id, author_id, category, description, coordinates, status, public_visibility, created_at, updated_at;
- `report_photos`: report_id, storage_key, public_storage_key, exif_stripped, moderation_status;
- `report_events`: report_id, event_type, status_from, status_to, actor_id, comment, created_at;
- `report_confirmations`: report_id, user_id, coordinates, created_at;
- `admin_users`: id, role, status, mfa_enabled;
- `admin_assignments`: report_id, admin_id, organization_id;
- `reward_transactions`: user_id, report_id, type, amount, reason;
- `push_tokens`: user_id, platform, token_hash, provider, created_at, revoked_at;
- `audit_logs`: actor_id, action, entity_type, entity_id, ip, user_agent, created_at.

Indexes:
- reports by status/category/created_at;
- geospatial index for coordinates;
- report_events by report_id/created_at;
- unique idempotency key for report creation;
- unique confirmation per user/report.

## 8. Stable mobile behavior

To make the app feel “never falling”:
- local draft is always saved;
- report submission creates local pending item;
- upload photo with retry/backoff;
- use idempotency key to avoid duplicate reports;
- show pending/sent/failed state;
- sync status in background;
- cache latest reports;
- never block UI on slow network without feedback;
- show precise error states;
- compress images before upload;
- strip EXIF before upload or on backend;
- handle backend maintenance gracefully.

## 9. Backend reliability requirements

Minimum production bar:
- HTTPS only;
- request validation;
- auth and RBAC;
- rate limiting;
- structured logs with PII filtering;
- idempotency for `POST /reports`;
- object storage signed upload flow;
- DB migrations;
- backups and restore drills;
- health/readiness endpoints;
- monitoring and alerts;
- admin audit log;
- CI tests;
- staging environment;
- blue-green or rolling deploys;
- incident runbook.

## 10. Russian market checklist

Distribution:
- App Store;
- Google Play if available for target audience;
- RuStore for Android РФ market;
- direct APK only as fallback, with signing/security warning.

Infrastructure:
- host API/DB/media/logs/backups in РФ;
- choose vendors that provide documents for ПДн processing;
- avoid foreign analytics by default;
- keep push payloads anonymous.

Legal/docs:
- privacy policy;
- personal data processing consent;
- user agreement;
- consent for geolocation/photo processing;
- public-content consent if needed;
- data deletion/support process;
- RKN notification;
- cross-border notification if applicable;
- internal PDn policy and responsible person order.

## 11. Implementation roadmap

### Phase 1. Architecture hardening

- Replace dev JSON with Postgres schema/migrations.
- Add API contracts/types shared with mobile.
- Add idempotency key and validation.
- Add auth model.
- Add local API client in mobile with demo fallback.

### Phase 2. Admin MVP

- Web admin panel.
- Queue by status.
- Detail page.
- Status actions.
- Event history.
- Reject reasons.
- Assignment.

### Phase 3. Media and privacy

- Signed photo upload.
- EXIF stripping.
- Photo moderation state.
- Public/private report visibility.
- Redaction workflow.

### Phase 4. Compliance readiness

- Privacy policy/user agreement screens.
- Consent registry.
- Data retention/deletion.
- Audit logs.
- RKN notification data pack.
- ISPDn threat model input pack.

### Phase 5. Production reliability

- PostgreSQL backups.
- Monitoring/alerts.
- Sentry or local equivalent.
- CI/CD.
- Load testing.
- Security review.
- Staging/prod split.

