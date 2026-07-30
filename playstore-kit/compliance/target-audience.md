# Target audience

- **Target age groups:** 13+, 14+, 15+, 16+, 17+, 18+ (deselect "under 13").
  Reasoning: app is generally usable by anyone old enough to use a phone, but
  it's not marketed to children.
- **Appeal to children?** No.

## Ads declaration

- **Does your app contain ads?** No.
- This is a sadqa-jariah project; the lack of ads is a stated design property.

## Other declarations

- News app: No.
- COVID-19 contact tracing/status app: No.
- Government app: No.
- Financial features: No.

## URLs

- Privacy Policy URL:        `https://takbeertime.com/privacy.html`
- Terms of Use URL:          `https://takbeertime.com/terms.html`
- Account deletion URL:      `https://takbeertime.com/delete-account.html`
  (Play Console → Data Safety → "Account deletion")

In-app account deletion: signed-in users see "Delete account" in the footer
of `index.html`, which opens a confirm modal and calls `DELETE /api/users/me`.
