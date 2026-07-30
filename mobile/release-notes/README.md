# Play Store release notes ("What's new")

The `auto-release-to-play.yml` workflow attaches release notes to each Play
release. It looks for notes that match the app's `versionName`
(from `mobile/android/app/build.gradle`).

## Multilingual (preferred)

Create a directory named after the version and drop one file per locale, using
**Google Play locale codes** in the filename `whatsnew-<locale>`:

```
mobile/release-notes/
  4.1.1/
    whatsnew-en-US     ← English (US)   — required (Play default)
    whatsnew-ar        ← Arabic
    whatsnew-ur        ← Urdu
    whatsnew-id        ← Indonesian
    whatsnew-bn        ← Bengali
    whatsnew-hi-IN     ← Hindi
    whatsnew-tr-TR     ← Turkish
    whatsnew-fa        ← Persian
    whatsnew-ms        ← Malay
    whatsnew-fr-FR     ← French (France)
```

These ten match the app's in-app languages. Each file is plain text.

## Rules

- **≤ 500 characters per locale** (Play's hard limit). The workflow fails the
  release early if any file is over, naming the offending locale.
- Each locale must be enabled on the **Play Console store listing**
  (Store presence → Main store listing → Manage translations). A valid Play
  locale code that isn't enabled on the listing can cause the upload to reject.
- The locale **must be a real Play language code**, otherwise the Play API
  rejects the upload.

## Legacy fallback

If no `mobile/release-notes/<versionName>/` directory exists, the workflow
falls back to a single `mobile/release-notes/<versionName>.txt` (English only),
and if that's missing too, to a generic "Bug fixes and performance
improvements." note.

## Adding notes for a new release

1. Bump `versionName` in `mobile/android/app/build.gradle`.
2. Create `mobile/release-notes/<versionName>/` with `whatsnew-*` files
   (copy the previous version's directory and edit the text).
3. Commit, then merge `main` → `live` to release.
