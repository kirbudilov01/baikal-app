# App privacy inventory

This file prepares App Store Connect privacy answers. Re-check before submission against production backend logs, analytics, crash reporting, map SDKs, and any third-party services.

## Current data categories

### User Content

Collected when a user submits a report:

- Report description.
- Report category.
- Report photo if the user adds one.
- Report status history.

Purpose:

- App functionality.
- Moderation and responsible-service routing.

Linked to user:

- Prototype: no account identity in the app UI.
- Production: depends on backend auth decision. If phone/email/account id is added, mark linked to user.

Tracking:

- No tracking planned.

### Location

Collected when a user chooses a location or uses current location:

- Approximate or precise coordinates of the reported problem.
- Human-readable location label.

Purpose:

- App functionality: finding and processing environmental reports.

Linked to user:

- Prototype: not linked to a public profile.
- Production: depends on backend auth and moderation storage.

Tracking:

- No tracking planned.

### Photos or Videos

Collected only when user attaches evidence.

Purpose:

- App functionality and moderation.

Tracking:

- No tracking planned.

### Identifiers

Not currently intentionally collected in the app code.

Production check required:

- Backend request IDs.
- Push notification token if notifications are added.
- Device ID if analytics/crash reporting is added.

### Diagnostics

Not currently intentionally collected.

Production check required:

- Sentry, Firebase Crashlytics, Expo Insights, App Store diagnostics, server logs.

## App Store privacy links

Required:

- Privacy Policy URL: TODO

Optional but recommended:

- Privacy Choices / data deletion URL: TODO
- Support URL: TODO

## Privacy policy must cover

- What data is collected.
- Why photos, location, and descriptions are needed.
- Who can access reports.
- Moderation and responsible-service forwarding.
- Data retention period.
- How a user can request deletion.
- Contact email.
- Legal entity/controller.

## Do not add without updating this file

- Analytics SDK.
- Advertising SDK.
- Crash reporting SDK.
- Push notifications.
- Login/phone/email collection.
- Public comments or public profiles.
- Third-party map SDK that collects data.
