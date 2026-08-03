# TestFlight release checklist

## Current state

The project is an Expo SDK 56 app with iOS bundle id `ru.newpeople.baikal`.
It already has native permission text for camera, photo library, and location in `app.json`.

## Required accounts

- Expo account logged in with `eas login`.
- Paid Apple Developer account.
- App Store Connect app created for bundle id `ru.newpeople.baikal`.

## One-time setup

```bash
npm ci
npm run credentials:ios
```

During credentials setup, select the Apple Developer team and let EAS manage the distribution certificate and provisioning profile unless the team already has a required signing setup.

If App Store Connect asks for app data, create the app with:

- Name: `Байкал в наших руках`
- Bundle ID: `ru.newpeople.baikal`
- Platform: iOS
- SKU: `baikal-app`

## First TestFlight build

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

- A deployed production backend URL if reports should persist outside the device.
- Real map provider or a clearly marked interactive prototype map.
- Privacy Policy URL.
- Support/contact URL.
- App screenshots for iPhone sizes.
- App Store review notes explaining camera, photo, and location usage.

## Current known limitation

The app can be built for TestFlight as a functional prototype. For a serious App Store review, the backend, admin workflow, legal pages, and map provider should be production-ready.

## App Store preparation files

- `APP_STORE_READINESS.md` contains the release plan and blockers.
- `APP_PRIVACY_INVENTORY.md` contains draft Privacy Nutrition Label inputs.
- `store.config.template.json` contains a safe EAS Metadata template. Copy it to `store.config.json` only after real public URLs and legal owner are ready.

```bash
cp store.config.template.json store.config.json
# Replace all TODO values.
npm run metadata:ios:push
```
