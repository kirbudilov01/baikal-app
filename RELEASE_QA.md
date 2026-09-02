# Release QA

Date: 2026-09-02

## Scope

Release package for the next meaningful TestFlight update:

- first launch onboarding
- username/password auth without email
- report creation flow
- map markers and empty state
- admin status transition
- rewards and promo-code backend sync
- GitHub Pages web preview

## Verified Locally

- `npx tsc --noEmit` passed.
- `node --test backend/src/api.test.mjs` passed.
- `npm run build:web:pages` passed.
- Backend test covers auth, report creation, upload, confirmation, admin status transition, users, rewards, promo codes, global promo codes, legal pages, and CSV export.

## Verified On Public Backend

Backend URL: `https://baikal.46.17.103.26.sslip.io`

- `GET /api/reports` returns 4 public Baikal cases.
- Admin login returns `200`.
- Unauthenticated `GET /api/admin/db` returns `401`.
- Authenticated `GET /api/admin/db` returns `200`.
- Current admin DB snapshot after QA cleanup: 4 reports, 1 user, 2 promo codes.
- `GET /terms`, `GET /privacy`, and `GET /support` return `200`.
- Admin status transition smoke passed with a temporary report:
  - created temporary report `BR-SMOKE-STATUS`
  - changed status `moderation -> transferred` through admin API
  - removed the temporary report after verification

## Verified On Public Web Preview

Web preview: `https://kirbudilov01.github.io/baikal-app/`

- GitHub Pages branch contains the latest web bundle.
- Asset URLs use `/baikal-app/...` base path.
- Hero image and MaterialCommunityIcons font return `200`.
- Mobile browser smoke passed:
  - onboarding opens
  - next buttons work
  - registration screen opens
  - checkbox enables profile creation
  - profile creation opens the home screen
  - home screen loads real backend reports
  - console errors: 0 in the latest cache-busted smoke

## Current Public Seed Cases

The public backend was cleaned from test reports and now starts with public-source cases:

- `BR-2026-0819` - Недействительная сделка с лесом
- `BR-2026-0817` - Реконструкция очистных сооружений
- `BR-2026-0812` - Незаконные объекты у воды
- `BR-2026-0811` - Свалки в водоохранной зоне

## Remaining Risks Before App Store

- Native map must be checked in TestFlight on a real iPhone because web preview and `react-native-maps` differ.
- Legal pages are functional drafts; final App Store release needs approved legal text.
- Push notifications are not implemented yet.
- Password recovery is not implemented yet.
- Moderation operations exist, but there is no role-based admin model yet.

## TestFlight Rule

Do not submit micro-updates. Submit only a meaningful release package after this checklist is green.

## Next Native QA

Run on TestFlight before marking the native release ready:

- install fresh app on iPhone
- confirm onboarding appears only on first launch
- register a new username/password account
- create a report with camera photo
- choose current location and manually adjust the map point
- verify the report appears in the admin panel
- change the report status in admin
- pull to refresh or reopen app and verify status changed
- claim an available bonus
- verify promo code appears both in the app and admin panel
