# Takbeer Time — Play Store submission kit

Generated from `PLAY-STORE-CHECKLIST.md` plus the live policy pages and
launcher icon master. Drop-in for the Play Console listing fields.

## What's in here

```
playstore-kit/
├── store-listing/
│   ├── app-name.txt                  → Listing → App name
│   ├── short-description.txt         → Listing → Short description (80 char max)
│   ├── full-description.txt          → Listing → Full description (~4000 char max)
│   ├── contact.txt                   → Listing → Contact details
│   └── category-and-tags.txt         → Listing → Category & tags + app identity
├── icons/
│   ├── store-icon-512.png            → Listing → App icon (512×512, required)
│   └── source-icon-1024.png          ← Master, in case you re-export
├── policies/
│   ├── privacy.html                  ← Already live at takbeertime.com/privacy.html
│   ├── terms.html                    ← Already live at takbeertime.com/terms.html
│   └── delete-account.html           ← Already live at takbeertime.com/delete-account.html
├── compliance/
│   ├── data-safety.md                → Play Console → App content → Data safety
│   ├── permissions-audit.md          → Reference for runtime-permission justifications
│   ├── content-rating.md             → Play Console → Content rating questionnaire
│   └── target-audience.md            → Play Console → Target audience + Ads declaration
└── still-required/
    └── README.md                     ← Things NOT in the zip that you must produce
```

## What's NOT in here, and why

1. **Signed AAB.** Has to be built with your private keystore. Step-by-step
   in `still-required/README.md`. Never bundle a keystore in a zip.
2. **Feature graphic (1024×500).** No designed asset exists yet.
3. **Screenshots.** Have to be captured from a running build on a phone.
4. **Test account credentials.** You provision these yourself for the
   review team.

See `still-required/README.md` for the full punch list.

## Quick checklist when uploading

1. Play Console → Create app → fill in app-name, default language, free, etc.
2. Listing → paste contents of `store-listing/*.txt` into the matching fields.
3. Listing → upload `icons/store-icon-512.png` as the app icon.
4. Listing → upload your feature graphic + screenshots (you produce these).
5. Policy → enter the three URLs from `compliance/target-audience.md`.
6. Data safety → answer per `compliance/data-safety.md`.
7. Content rating → run the IARC questionnaire using `compliance/content-rating.md`.
8. Target audience → use `compliance/target-audience.md`.
9. App access → enter test credentials (you provision).
10. Production track → upload AAB (you build).
11. Submit for review.

## Source of truth

The full master checklist this kit was generated from is
`PLAY-STORE-CHECKLIST.md` at the repo root. Keep that updated as
items get resolved; this kit is a snapshot.
