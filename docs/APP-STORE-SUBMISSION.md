# ReleaseCore Shopify App Store submission runbook

This document covers Partner Dashboard / Shopify Dev Dashboard and reviewer-preparation work that cannot be completed by application code alone.

## Production configuration

- **App name:** ReleaseCore
- **Production application URL:** `https://releasecore-web-production.up.railway.app`
- **Allowed redirect URL:** `https://releasecore-web-production.up.railway.app/api/auth`
- **Privacy policy URL:** `https://releasecore-web-production.up.railway.app/privacy-policy`
- **Public support page:** `https://releasecore-web-production.up.railway.app/support`
- **Compliance webhook endpoint:** `https://releasecore-web-production.up.railway.app/webhooks/compliance`
- **App proxy:** `/apps/releasecore` → `/releasecore-proxy`
- **Stable webhook API version:** `2026-07`
- **M15.3 review version:** `releasecore-m15-3-review`

Do not submit while any URL contains `example.com`, a development tunnel, localhost, or an expired preview domain.

## Support and developer contacts

Shopify requires a valid support email for public apps. Configure the real monitored ReleaseCore support address in the App Store listing. If desired, also set the same address as `RELEASECORE_SUPPORT_EMAIL` in Railway so `/support` exposes a direct mail link.

Before submission, verify:

- support email is monitored;
- API contact email is current;
- **Emergency developer contact** has current email and phone details;
- `noreply@shopify.com` is allowed by the submission/contact mailbox.

## Protected customer data

ReleaseCore requests `read_customers` because Artist Portal and merchant-configured automation depend on Shopify customer identity. Complete the Protected customer data request before submitting.

### Protected customer data justification

> ReleaseCore uses Shopify Customer records only to associate a merchant-selected Shopify customer with an Artist Portal identity, enforce merchant-configured customer-tag eligibility and automation rules, and route transactional notifications about that customer's own release workflow. Customer data is not used for independent advertising or sold to third parties.

### Name field justification

> ReleaseCore displays the customer's name to the merchant when searching for and assigning an Artist Portal account. The name is required to distinguish customer records and reduce the risk of assigning private artist access to the wrong customer.

### Email field justification

> ReleaseCore displays the customer's email to the merchant to distinguish customer records during Artist Portal assignment. When the merchant enables transactional notifications, the email can also be used to deliver release-status messages related to that customer's own releases.

Do not request phone or address unless a future feature actually requires them.

## App listing

Before submission:

- complete the primary English listing;
- upload a **1200 × 1200** PNG or JPEG app icon;
- add screenshots showing the actual current build;
- use `ReleaseCore` consistently;
- add the Privacy Policy URL above;
- configure the monitored support email and optional support portal;
- describe only functionality available in the review build;
- configure any pricing through Shopify-supported billing/pricing surfaces before making listing claims.

## Reviewer screencast

Recommended sequence:

1. Install ReleaseCore from Shopify's installation/review flow.
2. Confirm the app opens in Shopify Admin after OAuth.
3. Open Settings.
4. Create a Single and Album/EP.
5. Open the Edit Track Info page and show Single ISRC assignment/correction.
6. Add tracks, credits, artwork, and master WAV.
7. Create/select an Artist and link the review customer through Portal access.
8. Open Storefront setup and add/save Release Portal in Theme Editor.
9. Sign into storefront as the provided test customer and show Artist Portal access.
10. Submit, review, approve, and open Distribution.
11. Show UPC/catalog/ISRC handling.
12. Generate an audio preview.
13. Show Shopify product/Album bundle sync and Sync Health.
14. Show release-level Storefront publication preview without modifying real merchant catalog data.
15. Show Privacy workspace.

## Reviewer test instructions

- Open Shopify Admin → Apps → ReleaseCore.
- No separate ReleaseCore login is required.
- Use supplied storefront customer credentials for Artist Portal.
- In Admin, open Portal access and confirm the customer is linked to the review artist.
- Use Storefront setup for Theme Editor deep links.
- The review customer should see only releases allowed by that customer's Artist Portal access.
- Use provided sample audio/artwork for upload testing.
- Use a disposable release for submission/distribution tests.
- Use the Edit Track Info page for ISRC assignment/correction.
- Use Sync Health to inspect Shopify product/preview/publication state.

## Create the review version

From the reviewed repository tree:

```bash
npm run check
npm run check:m15.3
git diff --check

shopify app config use releasecore
shopify app deploy --no-release --version releasecore-m15-3-review
```

Inspect the generated version before release. Create review versions with `--no-release`; do not permit deletions unless an extension/config deletion is intentional and manually reviewed.

Then complete signed-webhook, fresh-store, Chrome-incognito, idle-uninstall/reinstall, Theme Editor, and reviewer-evidence checks from `docs/PRODUCTION-VERIFICATION.md`.

Do not submit while any automated or manual review gate is incomplete.
