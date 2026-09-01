# TestFlight release checklist

## Current state

The project is an Expo SDK 57 app with iOS bundle id `ru.baikal.vrukah`.
The bundle id is neutral and must not mention party branding.
It already has native permission text for camera, photo library, and location in `app.json`.

## Required accounts

- Expo account logged in with `eas login`.
- Paid Apple Developer account.
- App Store Connect app created for bundle id `ru.baikal.vrukah`.

## One-time setup

```bash
npm ci
npm run credentials:ios
```

During credentials setup, select the Apple Developer team and let EAS manage the distribution certificate and provisioning profile unless the team already has a required signing setup.

If App Store Connect asks for app data, create the app with:

- Name: `Байкал в наших руках`
- Bundle ID: `ru.baikal.vrukah`
- Platform: iOS
- SKU: `baikal-app`

## First TestFlight build

Set production-like app env first:

```bash
npx eas-cli env:create --environment production --name EXPO_PUBLIC_API_BASE_URL --value https://baikal.46.17.103.26.sslip.io
npx eas-cli env:create --environment production --name EXPO_PUBLIC_ADMIN_ENABLED --value false
npx eas-cli env:create --environment production --name EXPO_PUBLIC_PRIVACY_URL --value https://baikal.46.17.103.26.sslip.io/privacy
npx eas-cli env:create --environment production --name EXPO_PUBLIC_SUPPORT_URL --value https://baikal.46.17.103.26.sslip.io/support
npx eas-cli env:create --environment production --name EXPO_PUBLIC_TERMS_URL --value https://baikal.46.17.103.26.sslip.io/terms
```

For Android builds with native maps, also set:

```bash
npx eas-cli env:create --environment production --name EXPO_GOOGLE_MAPS_API_KEY_ANDROID --value YOUR_ANDROID_MAPS_KEY
```

iOS uses Apple Maps through `react-native-maps` and does not need this Android key for TestFlight.

Run release checks first:

```bash
npm run doctor
./node_modules/.bin/tsc --noEmit
```

```bash
npm run build:ios:production
npm run submit:ios:testflight
```

Or build and submit in one command:

```bash
npm run release:ios:testflight
```

After upload, App Store Connect usually needs several minutes to process the build before it appears in TestFlight.

## What must be real before external testers

- A deployed production backend URL if reports should persist outside the device. Temporary server for TestFlight: `https://baikal.46.17.103.26.sslip.io`.
- Backend env: `ADMIN_TOKEN`, `ALLOWED_ORIGINS`, `MAX_BODY_BYTES`, `SUPPORT_EMAIL`, legal operator variables.
- Registration/login API works through `/api/auth/register`, `/api/auth/login`, and `/api/auth/me`.
- Native map works on iOS/Android; Android production needs `EXPO_GOOGLE_MAPS_API_KEY_ANDROID`.
- Privacy Policy URL.
- Support/contact URL.
- Terms URL.
- Public data deletion page: `https://YOUR_BACKEND_URL/data-deletion`.
- App screenshots for iPhone sizes.
- App Store review notes explaining camera, photo, and location usage.
- Internal tester notes that this is a pre-release build connected to a temporary backend.

## Current known limitation

The app can be built for TestFlight as a functional prototype. For a serious App Store review, the backend, admin workflow, legal pages, and map provider should be production-ready.

## App Store preparation files

- `APP_STORE_READINESS.md` contains the release plan and blockers.
- `APP_PRIVACY_INVENTORY.md` contains draft Privacy Nutrition Label inputs.
- `LEGAL_RELEASE_DRAFT_RU.md` contains legal URLs, App Review notes, and Russian-market checklist.
- `store.config.template.json` contains a safe EAS Metadata template. Copy it to `store.config.json` only after real public URLs and legal owner are ready.

```bash
cp store.config.template.json store.config.json
# Replace all TODO values.
npm run metadata:ios:push
```
