# ReleaseCore production and Shopify App Store verification

Use this checklist on the exact build that will be submitted to Shopify. Repository checks are necessary but not sufficient: Shopify app configuration and theme extensions are versioned separately from the Railway web application, and webhook trigger commands test endpoint behavior but do not prove that the production app version is subscribed to the topic.

## 1. Freeze and validate the review build

From the ReleaseCore repository root:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run check
git diff --check
```

Do not continue while any command fails.

## 2. Deploy the web application to Railway

Deploy the exact reviewed commit to the production Railway service. `shopify app deploy` does **not** deploy the ReleaseCore web server; it versions Shopify app configuration and extensions only.

Production environment must include the normal ReleaseCore secrets/configuration, including:

- `NODE_ENV=production`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL=https://releasecore-web-production.up.railway.app`
- `DATABASE_URL`
- `RELEASECORE_MASTER_STORAGE=R2`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `RELEASECORE_ENCRYPTION_KEY`
- `RELEASECORE_SUPPORT_EMAIL` when a direct email link should appear on the public support page

Never paste secret values into the App Store review instructions or screenshots.

After Railway reports the deployment healthy, run:

```bash
npm run verify:production
```

The verifier checks the live public home, Privacy Policy, Support page, Shopify-owned install guidance, HTTPS availability, and invalid-HMAC rejection on the compliance and uninstall webhook endpoints.

## 3. Create the Shopify review app version

Select the production ReleaseCore config:

```bash
shopify app config use releasecore
```

Create the version without releasing it first:

```bash
shopify app deploy --no-release --version releasecore-m11-6-review
```

List versions:

```bash
shopify app versions list
```

In Shopify Dev Dashboard → ReleaseCore → Versions, inspect `releasecore-m11-6-review` and confirm it contains:

- production application URL and `/api/auth` redirect;
- `read_customers`, product/file/metaobject/app-proxy scopes declared by ReleaseCore;
- `/webhooks/app/uninstalled`;
- `/webhooks/app/scopes_update`;
- `/webhooks/compliance` with `customers/data_request`, `customers/redact`, and `shop/redact`;
- stable webhook API version `2026-07`;
- ReleaseCore Artist Portal theme app extension.

Only after that inspection, release the version:

```bash
shopify app release --version releasecore-m11-6-review
```

Configuration changes do not become production subscriptions until a Shopify app version containing them is released.

## 4. Verify signed webhook handling

Use Shopify CLI to send signed sample deliveries to the production endpoint:

```bash
shopify app webhook trigger \
  --api-version=2026-07 \
  --address=https://releasecore-web-production.up.railway.app/webhooks/compliance \
  --topic=customers/data_request

shopify app webhook trigger \
  --api-version=2026-07 \
  --address=https://releasecore-web-production.up.railway.app/webhooks/compliance \
  --topic=customers/redact

shopify app webhook trigger \
  --api-version=2026-07 \
  --address=https://releasecore-web-production.up.railway.app/webhooks/compliance \
  --topic=shop/redact
```

The CLI can prompt for any missing authentication details. Do not place the app secret in a shared script or screenshot.

Expected result: each signed delivery receives a 2xx acknowledgement. Privacy processing is persisted first and continues independently so the HTTP acknowledgement is not held open by long-running export/redaction work.

Important: `shopify app webhook trigger` validates the endpoint, **not** the active subscription. Confirm subscriptions separately on the released app version.

## 5. Fresh-store install and reinstall test

Use a clean development store with no ReleaseCore tenant data.

1. Start installation from a Shopify-owned installation/review surface.
2. Confirm ReleaseCore never asks for a `myshopify.com` domain.
3. Accept permissions and confirm OAuth redirects directly into ReleaseCore Admin.
4. Navigate every primary ReleaseCore route.
5. Create an artist and contributor.
6. Create a Single release and Album/EP release.
7. Upload cover artwork and a master WAV.
8. Link a Shopify customer through Portal access.
9. Open Storefront setup and use each relevant Theme Editor deep link.
10. Save a Release Portal/Recent Releases/Artist Profile block and verify it on desktop and mobile.
11. Sign in as the linked storefront customer and confirm tenant/customer ownership restrictions.
12. Submit/review/approve a disposable release and open Distribution.
13. Confirm the Privacy workspace is available.

### Chrome incognito/session-token test

Open a Chrome incognito window, sign into the test Shopify Admin, and open ReleaseCore. Verify the embedded app works without relying on third-party cookies or browser local storage. Repeat a normal navigation and save action.

### Idle uninstall test

This test is intentionally stricter than an immediate uninstall:

1. Install/open ReleaseCore on the disposable test store.
2. Leave the app unused for **at least 65 minutes** so the current expiring offline access token is stale.
3. Without reopening ReleaseCore, uninstall it from Shopify Admin.
4. Confirm `app/uninstalled` receives a successful 2xx delivery and the local shop sessions are removed.
5. Reinstall ReleaseCore and confirm OAuth occurs immediately before the merchant can interact with the app.

This catches uninstall/authentication failures that can be hidden when uninstalling immediately after active app use.

Shopify normally sends the real `shop/redact` event 48 hours after uninstall. For the review build, confirm the active subscription now, exercise the signed endpoint with CLI, and verify a real disposable-store `shop/redact` when the 48-hour event becomes available.

## 6. Protected customer data and Partner Dashboard

Do not submit until the protected customer data request is approved for the customer fields ReleaseCore actually uses.

Confirm:

- Customer protected-data access is approved.
- Name is approved for customer identification during Artist Portal assignment.
- Email is approved for record disambiguation and merchant-enabled transactional notifications.
- Phone/address are not requested.
- Support email is valid and actively monitored.
- Emergency developer contact has current email and phone details.
- Privacy Policy URL is `https://releasecore-web-production.up.railway.app/privacy-policy`.
- Support portal URL is `https://releasecore-web-production.up.railway.app/support` when the listing exposes a support portal.

Use the justifications in `docs/APP-STORE-SUBMISSION.md`.

## 7. Listing and reviewer evidence

Before clicking Submit:

- Primary English listing is complete and factual.
- App name is consistently `ReleaseCore`.
- 1200 × 1200 app icon is uploaded.
- Listing screenshots show the actual current review build.
- Theme-extension screenshots do not contain app promotions/review requests.
- Demo screencast shows onboarding and all core features claimed by the listing.
- Reviewer instructions include a functional storefront test customer and any sample files required for upload testing.
- Test credentials are rechecked immediately before submission.
- No listing field, screenshot, policy URL, or testing instruction references localhost, a tunnel, an expired development domain, or unreleased functionality.

## 8. Final sign-off

Record the evidence before submission:

| Gate | Result / evidence |
| --- | --- |
| `npm run check` | |
| `npm run verify:production` | |
| Railway production deploy commit | |
| Released Shopify version | |
| Compliance topics visible on active version | |
| Signed `customers/data_request` delivery | |
| Signed `customers/redact` delivery | |
| Signed `shop/redact` delivery | |
| Fresh-store install | |
| Chrome incognito/session-token test | |
| 65+ minute idle uninstall | |
| Reinstall/OAuth test | |
| Theme Editor deep links/blocks | |
| Protected customer data approved | |
| Support/emergency contacts verified | |
| App icon/listing/screenshots complete | |
| Screencast/reviewer credentials complete | |

When every row is complete, the ReleaseCore codebase and production deployment are ready for Shopify App Store submission review.
