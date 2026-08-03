# App Store readiness plan

## Release target

Goal: prepare `Байкал в наших руках` for TestFlight first, then App Store Review.

Current bundle id: `ru.newpeople.baikal`

Current technical status:

- Expo SDK 56 app.
- `expo-doctor` must pass before every release.
- iOS permissions are declared for camera, photo library, and location.
- EAS build and submit scripts are available in `package.json`.

## App Store blockers

These must be solved before a real App Store submission:

1. Apple Developer account access.
2. App Store Connect app created for `ru.newpeople.baikal`.
3. Production backend URL.
4. Real map provider or a clearly disclosed prototype state for TestFlight only.
5. Public Privacy Policy URL.
6. Public Support URL.
7. Privacy Nutrition Label answers in App Store Connect.
8. App screenshots for required iPhone/iPad sizes if tablet support remains enabled.
9. Review notes explaining camera, photo, location, moderation, and admin workflow.
10. Final decision on brand/legal owner and copyright string.

## Recommended release sequence

### 1. Internal TestFlight

Use this when the goal is to install the app on real iPhones and test flows.

```bash
npm ci
npm run doctor
npm run build:ios:production
npm run submit:ios:testflight
```

### 2. External TestFlight

Before inviting people outside the team:

- Replace prototype map with production map behavior or label the limitation in tester notes.
- Connect reports to deployed backend.
- Verify camera, gallery, location, report creation, report status, rewards, and admin status flow.
- Add support/privacy URLs in App Store Connect.

### 3. App Store Review

Before App Review:

- Production backend uptime check.
- Moderation/admin route working.
- Content/report abuse flow documented.
- Screenshots captured from real or production-equivalent build.
- Privacy policy and nutrition label match actual backend behavior.

## Technical release commands

```bash
npm run doctor
npm run build:ios:production
npm run submit:ios:testflight
```

One-step build and submit:

```bash
npm run release:ios:testflight
```

Metadata push after App Store Connect app exists and `store.config.json` is created from `store.config.template.json`:

```bash
npm run metadata:ios:push
```

## App Review notes draft

Use this in App Store Connect Review Notes, then adjust after backend is final:

```text
This app lets users report environmental issues near Lake Baikal. Camera and photo library access are used only to attach evidence photos to a report. Location access is used only to choose or attach the problem location. Reports are reviewed by moderators/admins before being forwarded to responsible teams. The app does not contain social networking or public user profiles.
```

## Sources checked

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Apple App Privacy Details: https://developer.apple.com/app-store/app-privacy-details/
- Expo EAS Metadata: https://docs.expo.dev/deploy/app-stores-metadata/
- Expo iOS Submit: https://docs.expo.dev/submit/ios/
