# Play Store Auto Deploy

This repo deploys the Capacitor Android app to Google Play from GitHub Actions.

## Trigger

- Branch: `live`
- Workflow: `.github/workflows/auto-release-to-play.yml`
- Android package: `com.takbeertime.android`
- Default Play track on push: `internal`
- Manual workflow dispatch can target `internal`, `alpha`, `beta`, or
  `production`.

Pushes to `live` that touch mobile/web app files build a signed AAB and upload
it to Google Play. The default `internal` track is intentional: test the build
with internal testers, then promote it to production from Play Console.

## Required GitHub Secrets

Configure these in GitHub repo settings:
`Settings -> Secrets and variables -> Actions`.

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `PLAY_SERVICE_ACCOUNT_JSON`

The Android keystore secrets are produced by the
`Bootstrap Android keystore` workflow if a keystore is not already available.
The `PLAY_SERVICE_ACCOUNT_JSON` secret is the full JSON key for a Google Cloud
service account that has Play Console release permissions for
`com.takbeertime.android`.

Never commit the service account JSON or keystore files.

## Play Console Setup

The Play Console app already exists for `com.takbeertime.android`, so the Play
Developer API can upload updates. The first app creation/upload cannot be done
by the API, but that prerequisite is already satisfied.

The service account used by `PLAY_SERVICE_ACCOUNT_JSON` must be linked under
Play Console API access and granted release permissions for Takbeer Time.

## Related Files

- Firebase identity and local Android paths: `docs/ANDROID_FIREBASE.md`
- Capacitor config: `mobile/capacitor.config.ts`
- Android project: `mobile/android`
