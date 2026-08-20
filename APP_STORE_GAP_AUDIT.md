# App Store gap audit

Date: 2026-08-03

## Executive verdict

The app is close enough to prepare an internal TestFlight build, but it is not ready for App Store Review yet.

Reason: the mobile UI, backend contour, and admin/status logic exist, but production-grade backend, authentication, photo storage, legal/privacy surfaces, support links, moderation safeguards, and App Store metadata are not complete.

## Can Codex upload if account access is provided?

Yes, with safe credential handling:

- Do not paste passwords, 2FA codes, API keys, cookies, or session tokens into chat.
- Use `eas login` and Apple login prompts locally.
- Prefer App Store Connect API key with limited access instead of a personal Apple ID password.
- Store any local key files outside git or in ignored secure paths.
- Never commit `.p8`, session files, credentials JSON, environment files, or screenshots containing private account data.

## Current state

### Mobile app

Present:

- Expo SDK 57 app.
- iOS bundle id: `ru.baikal.vrukah`.
- Camera, gallery, and location permission strings.
- Report creation flow with local fallback.
- Report list/status flow.
- Map interaction prototype.
- Rewards/leaf points prototype.
- Admin tab inside the app for status changes.
- Admin tab is hidden by default and can be enabled only for internal builds.
- Draft persistence with AsyncStorage.
- API base URL is configured through `EXPO_PUBLIC_API_BASE_URL`.

Not production-ready:

- Admin is still implemented inside the app shell and should become a separate protected admin surface before public release.
- Report photos are sent/stored as local URI/string, not uploaded to durable object storage.
- Map is not backed by a real provider/geocoder/router.
- No push notifications for status changes.
- No user account/session model.
- No in-app privacy/support/legal links yet.
- No data deletion/request flow.
- No crash/error monitoring.
- No offline queue/retry semantics beyond local fallback.

### Backend

Present:

- Node HTTP API.
- Local JSON storage.
- Report creation.
- Report list.
- Status dictionary.
- Admin report queue.
- Admin report detail with event history.
- Status transition machine and tests.

Not production-ready:

- Local JSON file storage only.
- Minimal admin token guard exists for `/api/admin/*`; full auth/RBAC is still missing.
- No admin RBAC.
- No database migrations.
- No object storage for photos.
- No rate limiting.
- No audit log immutability.
- No monitoring/alerts.
- No backups.
- No deployment descriptor.
- No privacy/data retention controls.
- CORS allowlist exists through `ALLOWED_ORIGINS`; production values must be configured.
- JSON request size limit exists through `MAX_BODY_BYTES`; photo storage still needs a real upload flow.

### Admin

Present:

- Mobile-web admin tab.
- Summary counters.
- Status action buttons.
- Refresh/sync indicator.

Not production-ready:

- Hidden from public navigation unless `EXPO_PUBLIC_ADMIN_ENABLED=true`.
- Protected only by an internal-build token flow for now; no real login.
- No roles.
- No admin comments/reasons required for rejection.
- No photo review/fullscreen evidence view.
- No duplicate merge flow.
- No export/escalation to responsible services.
- No SLA/priority queue.
- No moderation safeguards for user-submitted text/photos.

## Apple requirement impact

### Privacy policy

Required. Apple requires a privacy policy URL in App Store Connect and an easily accessible privacy policy inside the app.

Action:

- Create public privacy policy URL.
- Add in-app privacy/support/legal section.
- Keep `APP_PRIVACY_INVENTORY.md` synchronized with actual production data.

### Support URL

Required for review quality. Apple expects functional links and up-to-date support contact information.

Action:

- Create public support page.
- Add in-app support contact.

### User-generated content

The app collects user-submitted text/photos/locations. If any user content is publicly visible or broadly distributed, Apple UGC safeguards matter: moderation, reporting inappropriate content, blocking abusive users, and timely responses.

Action:

- Keep reports non-public until moderated.
- Add moderation queue and rejection reasons.
- Add abuse/report/delete request path if public content appears.

### Location and photos

Allowed if purpose is clear and limited.

Action:

- Keep permission text specific.
- Do not collect background location.
- Do not access gallery/camera unless user taps.
- Explain photo/location use in review notes and privacy policy.

### Civic/environmental claims

Risk: users may think the app is an official government channel or that responsible services are guaranteed to act.

Action:

- Avoid misleading copy.
- Say reports are reviewed and forwarded only if there is a real process/partner.
- Add legal/organization disclosure.

### SDK minimum

As of 2026, Apple announced new minimum SDK upload requirements. Before submission, confirm EAS is building with an App Store-accepted Xcode/iOS SDK image.

Action:

- Check EAS build logs before upload.
- If needed, pin/update EAS build image.

## Must-build before App Store Review

### P0

- Production backend deployment.
- PostgreSQL or managed durable database.
- Object storage for photos.
- Auth model for admin.
- Admin access not visible to normal users.
- Privacy policy URL.
- Support URL.
- In-app privacy/support links.
- App Store metadata finalized.
- Real screenshots from production-equivalent build.
- Physical-device smoke test.

### P1

- Push notifications or clear in-app status update model.
- Admin rejection comments.
- Moderation queue filters.
- Rate limiting and request size limits.
- CORS allowlist.
- Monitoring and error logging.
- Backup/restore plan.
- Data deletion process.
- Map provider integration.

### P2

- Better rewards partner logic.
- Reward redemption codes.
- User trust score rules.
- Duplicate report merge.
- Admin analytics dashboard.
- Partner/admin web panel separated from mobile app.

## Recommended next implementation sprint

1. Deploy backend and configure `ADMIN_TOKEN`, `ALLOWED_ORIGINS`, and `MAX_BODY_BYTES`.
2. Add production privacy/support URLs and verify they open in app.
3. Add real admin login/RBAC or move admin to a separate protected web surface.
4. Add photo upload abstraction and object storage.
5. Add real map provider or clearly limit map to internal TestFlight.
6. Add App Store screenshot capture script/checklist.

## Safe upload workflow

1. Developer logs into Expo locally:

```bash
npx eas-cli login
```

2. Apple/App Store Connect access is configured through official prompts or API key.

3. Run checks:

```bash
npm ci
npm run doctor
./node_modules/.bin/tsc --noEmit
```

4. Build:

```bash
npm run build:ios:production
```

5. Submit to TestFlight:

```bash
npm run submit:ios:testflight
```

## Current recommendation

Do not submit to App Store Review yet.

Do submit to internal TestFlight after login/credentials are ready, as long as testers understand it is a functional prototype and not the final public release.
