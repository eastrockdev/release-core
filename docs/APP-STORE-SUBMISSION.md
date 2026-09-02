# ReleaseCore Shopify App Store submission runbook

This document covers the remaining Partner Dashboard and reviewer-preparation work that cannot be completed by application code alone. Keep it with the release checklist and update it whenever ReleaseCore's scopes or public URLs change.

## Production configuration

- **App name:** ReleaseCore
- **Production application URL:** `https://releasecore-web-production.up.railway.app`
- **Allowed redirect URL:** `https://releasecore-web-production.up.railway.app/api/auth`
- **Privacy policy URL:** `https://releasecore-web-production.up.railway.app/privacy-policy`
- **Public support page:** `https://releasecore-web-production.up.railway.app/support`
- **Compliance webhook endpoint:** `https://releasecore-web-production.up.railway.app/webhooks/compliance`
- **App proxy:** `/apps/releasecore` → `/releasecore-proxy`
- **Webhook API version:** `2026-07`

Do not submit while any Partner Dashboard URL still contains `example.com`, a development tunnel, localhost, or an expired preview domain.

## Support and developer contacts

Shopify requires a valid **support email address** for public apps. Configure the real monitored ReleaseCore support address in the primary App Store listing. If desired, also set the same address as `RELEASECORE_SUPPORT_EMAIL` in Railway so `/support` exposes a direct mail link.

Before submission, verify:

- Support email is monitored and can receive Shopify-forwarded merchant requests.
- API contact email is current and does not misuse Shopify branding.
- **Emergency developer contact** has a current email address and phone number in Partner account settings.
- `noreply@shopify.com` is allowed by the submission/contact mailbox.

## Protected customer data

ReleaseCore requests `read_customers` because Artist Portal and merchant-configured automation depend on a Shopify customer identity. Complete the Protected customer data request **before** submitting the app for review.

### Protected customer data justification

Use wording equivalent to:

> ReleaseCore uses Shopify Customer records only to associate a merchant-selected Shopify customer with an Artist Portal identity, enforce merchant-configured customer-tag eligibility and automation rules, and route transactional notifications about that customer's own release workflow. Customer data is not used for independent advertising or sold to third parties.

### Name field justification

> ReleaseCore displays the customer's name to the merchant when searching for and assigning an Artist Portal account. The name is required to distinguish similarly named/email-addressed customer records and reduce the risk of assigning private artist access to the wrong customer.

### Email field justification

> ReleaseCore displays the customer's email to the merchant to distinguish customer records during Artist Portal assignment. When the merchant enables transactional notifications, the email can also be used to deliver release-status messages related to that customer's own releases.

Do not request phone or address fields unless a future ReleaseCore feature actually requires them.

### Data protection details to verify in Partner Dashboard

Confirm the answers accurately describe the deployed system:

- Customer access is limited to the minimum fields ReleaseCore uses.
- Tenant-aware authorization prevents one Shopify shop/customer from reading another tenant's private release data.
- Embedded admin requests use Shopify authentication/session tokens.
- Private master audio is stored in private object storage and accessed through scoped ReleaseCore authorization.
- Production traffic uses HTTPS.
- Customer/shop privacy requests are processed through the mandatory Shopify compliance webhooks.
- `shop/redact` deletes tenant records and private master-storage objects.
- Access to production data is limited to people who need it to operate/support the service.

## App listing

Before submission:

- Create the primary English listing.
- Upload a **1200 × 1200** PNG or JPEG app icon.
- Add screenshots that show actual merchant workflows. Do not include reviews/testimonials, promotional pricing outside Shopify's pricing fields, fabricated statistics, or URLs inside screenshots/listing copy.
- Use `ReleaseCore` consistently as the app name.
- Add the Privacy policy URL above.
- Configure the real support email and optional Support portal URL above.
- Describe only functionality that is available in the review build.
- If pricing is introduced, configure it through Shopify's supported pricing/billing surfaces before listing claims are added.

## Reviewer screencast

Record an English screencast (or provide English subtitles) showing the complete onboarding and core workflow. A recommended sequence:

1. Install ReleaseCore from the Shopify-owned installation/review flow.
2. Confirm the app opens directly inside Shopify Admin after OAuth.
3. Open **Settings** and show identifier/publishing configuration.
4. Create a Single release and an Album/EP release.
5. Add tracks, credits, artwork, and a master WAV.
6. Create/select an Artist and use **Portal access** to link the review customer.
7. Open **Storefront setup**, use the Theme Editor deep link, add the Release Portal block, configure it, and save the theme.
8. Sign in to the storefront as the provided test Shopify customer and show that customer's Artist Portal/release workflow.
9. Submit a release, return to Admin, review it, approve it, and open Distribution.
10. Show UPC/catalog/ISRC handling and the distribution status workspace.
11. Show the Privacy workspace so reviewers can see that Shopify privacy requests are tracked and actionable.

## Reviewer test instructions

Provide enough detail that a reviewer can reproduce the screencast without asking for clarification.

### Reviewer test instructions template

- Open the app from Shopify Admin → Apps → ReleaseCore.
- No separate ReleaseCore login is required; Shopify authenticates the embedded admin app.
- Use the supplied Shopify storefront customer credentials to test the Artist Portal.
- In Admin, open Portal access and confirm that the test customer is linked to the review artist.
- Open Storefront setup and use the Release Portal Theme Editor deep link if the review theme does not already contain the block.
- The review customer should see only releases owned by that customer's linked Artist Portal identity.
- Use the provided sample audio/artwork files to test upload behavior if the reviewer needs to exercise file flows.
- Use a dedicated test release for submission/review/distribution testing so production catalog data is not modified.

If the review store requires credentials beyond Shopify Admin access, include functional credentials in the submission and verify them immediately before submitting.

## Fresh-store install test

Before submission, install the exact production app version on a clean development store and verify:

- Installation begins on a Shopify-owned surface; ReleaseCore never asks for a shop domain manually.
- OAuth completes and redirects directly to `/app`.
- Every navigation route loads without exceptions.
- Required scopes are granted and protected customer fields work with the development approval.
- Release creation, artist/customer linking, uploads, submission, review, Distribution, Privacy, and Storefront setup work without pre-existing database records.
- Theme app blocks render in Theme Editor and Online Store on desktop and mobile.
- Uninstall removes app blocks automatically; Shopify's later `shop/redact` request removes ReleaseCore tenant data.
- Reinstall starts with Shopify authentication again.

## Final automated and production gates

From the repository root before deployment:

```bash
npm run check
npm run check:app-store
git diff --check
```

After the exact review build is live on Railway:

```bash
npm run verify:production
```

Then complete the Shopify app-version, signed-webhook, fresh-store, Chrome-incognito, idle-uninstall/reinstall, and reviewer-evidence sequence in `docs/PRODUCTION-VERIFICATION.md`.

Do not submit while any repository, production, or manual review gate is incomplete.
