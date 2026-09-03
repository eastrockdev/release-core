# ReleaseCore production and Shopify App Store verification

Use this checklist on the exact M15.3 release candidate. Repository checks are necessary but not sufficient: the Railway web application and Shopify app configuration/extensions are separate deployment surfaces.

## 1. Freeze and validate the release candidate

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run check
git diff --check
```

Do not continue while any command fails.

The M15.3-specific static gate is also available directly:

```bash
npm run check:m15.3
```

## 2. Validate production environment contracts

Run against the actual environment variables configured for each Railway service.

Generic ReleaseCore:

```bash
npm run check:production-env:releasecore
```

East Rock:

```bash
npm run check:production-env:east-rock
```

Both services must use `NODE_ENV=production`, the correct profile-specific Shopify credentials/URL, production database, encryption key, and R2 master storage.

## 3. Deploy the web applications to Railway

Deploy the exact reviewed commit to each applicable Railway production service.

`shopify app deploy` does **not** deploy the ReleaseCore web server.

After Railway reports healthy deployments:

```bash
npm run verify:production:releasecore
npm run verify:production:east-rock
```

The verifier checks public home, Privacy Policy, Support, Shopify-owned install guidance, HTTPS, and invalid-HMAC rejection for compliance and uninstall webhook endpoints.

## 4. Create the generic Shopify review version

Use the stable `2026-07` API configuration.

```bash
shopify app config use releasecore
shopify app deploy --no-release --allow-updates --version releasecore-m15-3-review
shopify app versions list
```

In Shopify Dev Dashboard → ReleaseCore → Versions, inspect `releasecore-m15-3-review` and confirm:

- production application URL and `/api/auth` redirect;
- required customer/product/file/metaobject/publication/order/app-proxy scopes;
- `/webhooks/app/uninstalled`;
- `/webhooks/app/scopes_update`;
- `orders/paid`, `orders/cancelled`, and `refunds/create`;
- `/webhooks/compliance` with `customers/data_request`, `customers/redact`, and `shop/redact`;
- stable webhook API version `2026-07`;
- ReleaseCore Artist Portal theme app extension.

Only after inspection, release the reviewed version through Shopify CLI or Dev Dashboard.

## 5. Deploy East Rock Shopify configuration

East Rock is a separate single-merchant deployment and must never use the generic ReleaseCore client ID or Railway URL.

```bash
shopify app config use east-rock
shopify app deploy --no-release --allow-updates --version releasecore-east-rock-m15-3
```

Inspect the generated version before release and confirm its client/app identity, `https://releasecore-er-production.up.railway.app`, required operational scopes, app proxy, and webhook subscriptions.

Do not use `--allow-deletes` for routine releases.

## 6. Verify signed webhook handling

Use Shopify CLI to send signed sample deliveries to the relevant production endpoint.

Generic example:

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

Repeat against the East Rock production endpoint when validating that deployment.

Expected result: each signed delivery receives a 2xx acknowledgement.

Webhook trigger commands validate endpoint behavior; they do not prove the active released app version is subscribed. Confirm subscriptions separately.

## 7. Fresh-store install and reinstall test

Use a clean development store with no ReleaseCore tenant data.

1. Start installation from a Shopify-owned surface.
2. Confirm ReleaseCore never asks for a `myshopify.com` domain.
3. Accept permissions and confirm OAuth redirects into embedded Admin.
4. Navigate every primary route.
5. Create an artist and contributor.
6. Create a Single and Album/EP.
7. Open the Edit Track Info page and assign/correct a Single ISRC.
8. Upload artwork and a master WAV.
9. Link a Shopify customer through Portal access.
10. Open Storefront setup and use Theme Editor deep links.
11. Verify Release Portal, Recent Releases, and Artist Profile on desktop/mobile.
12. Submit/review/approve a disposable release.
13. Generate audio previews.
14. Sync Shopify products and Album/EP bundle.
15. Confirm Sync Health and targeted recovery.
16. Exercise Storefront publication preview and a safe publication mode.
17. Confirm the Privacy workspace.

### Chrome incognito/session-token test

Open Chrome incognito, sign into the test Shopify Admin, and use ReleaseCore without relying on third-party cookies or browser local storage. Repeat navigation and one save action.

### Idle uninstall test

1. Install/open ReleaseCore on a disposable store.
2. Leave it unused for at least 65 minutes.
3. Without reopening ReleaseCore, uninstall it.
4. Confirm `app/uninstalled` receives 2xx and local sessions are removed.
5. Reinstall and confirm Shopify authentication occurs before app interaction.

Shopify normally sends the real `shop/redact` later. Confirm the active subscription now, exercise the signed endpoint with CLI, and verify the real disposable-store event when available.

## 8. Protected customer data and App Store controls

Do not submit generic ReleaseCore until:

- protected customer data access is approved;
- Name and Email field justifications match actual usage;
- phone/address are not requested without a real feature need;
- support email is monitored;
- emergency developer contact is current;
- Privacy Policy URL is `https://releasecore-web-production.up.railway.app/privacy-policy`;
- Support URL is `https://releasecore-web-production.up.railway.app/support`.

Use `docs/APP-STORE-SUBMISSION.md` for the submission copy.

## 9. Final sign-off

| Gate | Result / evidence |
| --- | --- |
| `npm run check` | |
| `npm run check:m15.3` | |
| Generic production env validation | |
| East Rock production env validation | |
| Generic production endpoint verification | |
| East Rock production endpoint verification | |
| Generic Railway commit | |
| East Rock Railway commit | |
| Generic Shopify version | |
| East Rock Shopify version | |
| Compliance/uninstall/order subscriptions | |
| Signed compliance deliveries | |
| Fresh-store install | |
| Chrome incognito/session-token test | |
| 65+ minute idle uninstall | |
| Reinstall/OAuth test | |
| Theme Editor deep links/blocks | |
| Edit Track Info Single ISRC correction | |
| Audio preview + Shopify sync | |
| Sync Health targeted recovery | |
| Publication orchestration | |
| East Rock compatibility smoke test | |
| Protected customer data approved | |
| Support/emergency contacts verified | |
| App icon/listing/screenshots complete | |
| Screencast/reviewer credentials complete | |

When every applicable row is complete, the current ReleaseCore release candidate is ready for production/App Store sign-off.
