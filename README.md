# ReleaseCore

ReleaseCore is a Shopify-embedded music distribution operations platform. It provides merchant-facing release management, artist and contributor records, distribution workflows, identifier assignment, file handling, notifications, automation settings, and a customer-authenticated Artist Portal delivered through a Shopify theme app extension and app proxy.

## Runtime architecture

- **Admin application:** React Router embedded in Shopify Admin.
- **Database:** PostgreSQL through Prisma. Every merchant-owned record is scoped by Shopify shop.
- **Master audio:** Private Cloudflare R2 storage. Large WAV files use multipart uploads; smaller masters use signed single PUT uploads.
- **Merchant files:** Shopify Files stores cover artwork, documents, profile images, and generated browser-friendly audio previews.
- **Storefront:** `extensions/releasecore-artist-portal` provides the Artist Portal/theme blocks. Private portal data is served through authenticated app-proxy routes.
- **Shopify catalog:** ReleaseCore synchronizes track products, category-scoped music metafields, Shopify taxonomy genre data, theme-template defaults, and Online Store publication state through the Admin GraphQL API.

## Requirements

- Node.js `>=20.19 <22 || >=22.12`
- Shopify CLI
- PostgreSQL database reachable through `DATABASE_URL` and `DIRECT_URL`
- Cloudflare R2 credentials when master storage is configured as `R2`

## Local development

Install dependencies and prepare Prisma:

```bash
npm install
npm run setup
```

Start Shopify development:

```bash
npm run dev
```

The Shopify CLI supplies the embedded-app development environment, tunnel, app configuration, and authentication variables.

## Quality gates

Run the complete ReleaseCore validation suite before committing or deploying:

```bash
npm run check
```

The aggregate check runs:

```text
check:graphql       Inline Shopify Admin GraphQL parsing
check:security      Tenant/error-boundary security assertions
check:tenancy       Storefront ownership and master-storage scope assertions
check:compliance    Shopify privacy-webhook and protected-data assertions
check:app-store     Production config, public legal/support, install flow, and submission-readiness assertions
check:catalog       Shopify music-product publication, metadata, taxonomy, and template assertions
check:architecture  Route/domain-service boundary assertions
check:cleanup       Repository and duplicate-helper cleanup assertions
lint                ESLint and accessibility rules
typecheck           React Router type generation + TypeScript
build               Production React Router build
```

`git diff --check` should also be clean before a patch is shipped.

## Environment configuration

Do not commit secrets. ReleaseCore uses these application environment variables in addition to the variables managed by the Shopify CLI/runtime:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL application connection used by Prisma. |
| `DIRECT_URL` | Direct PostgreSQL connection used by Prisma migrations. |
| `RELEASECORE_MASTER_STORAGE` | Master-audio provider. Production must be `R2`; `LOCAL_DEV` is accepted only outside production for local recovery/testing. |
| `R2_ACCOUNT_ID` | Cloudflare account ID used to derive the R2 endpoint when `R2_ENDPOINT` is not supplied. |
| `R2_ENDPOINT` | Optional explicit S3-compatible R2 endpoint. |
| `R2_ACCESS_KEY_ID` | R2 S3 API access key. |
| `R2_SECRET_ACCESS_KEY` | R2 S3 API secret key. |
| `R2_BUCKET` | Private ReleaseCore master-audio bucket. |
| `RELEASECORE_ENCRYPTION_KEY` | Encryption key used for protected ReleaseCore configuration values. |
| `FFMPEG_PATH` | Optional FFmpeg binary override for generated audio previews. |
| `RELEASECORE_SUPPORT_EMAIL` | Optional public support email displayed on `/support`; the App Store listing support email remains configured in Partner Dashboard. |

Shopify application variables such as `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, and scopes are managed by the Shopify app configuration/deployment environment.

### R2 browser uploads

When R2 is enabled, the bucket CORS policy must permit the app's upload origins and expose the `ETag` response header. Multipart completion depends on the browser being able to read each uploaded part's ETag.


## App Store submission readiness

ReleaseCore's public production pages are:

- `https://releasecore-web-production.up.railway.app/privacy-policy`
- `https://releasecore-web-production.up.railway.app/support`

The canonical and legacy Shopify TOML files are intentionally synchronized to the production ReleaseCore app. `npm run check:app-store` fails if the production URL, redirect URL, compliance subscriptions, required scopes, app proxy, public policy/support pages, installation flow, or merchant storefront onboarding drift from the reviewed configuration.

Partner Dashboard work that cannot be automated—support/contact details, protected customer data approval, listing media, screencast, reviewer credentials, and fresh-store review preparation—is documented in `docs/APP-STORE-SUBMISSION.md`. The final deployed-site and review-build procedure is in `docs/PRODUCTION-VERIFICATION.md`.

After the exact review build is deployed to Railway, verify the live endpoints and webhook HMAC rejection with:

```bash
npm run verify:production
```

This live check is intentionally separate from `npm run check`, because repository CI should not depend on the production site already being deployed.

## Important directories

```text
app/routes/                         Embedded admin pages, API endpoints, app proxy, webhooks
app/lib/                            ReleaseCore domain services and shared server/client helpers
app/components/                     Shared admin UI primitives
app/styles/                         ReleaseCore admin design system
extensions/releasecore-artist-portal/  Storefront Artist Portal theme extension
prisma/                             PostgreSQL schema and migrations
scripts/                            Validation and narrowly-scoped maintenance tools
```

## Maintenance tools

`npm run check` is the normal repository gate. Scripts in `scripts/` that are not referenced by package scripts are maintenance utilities and should be run deliberately.

`migrate-localdev-to-r2.mjs` is retained only to migrate legacy `LOCAL_DEV` master WAV rows to R2. It defaults to a dry run and requires an explicit `--commit` flag before it changes storage/database state.

## Security and data boundaries

- Admin routes authenticate through Shopify before reading or mutating merchant data.
- ReleaseCore tenant helpers require the current Shopify shop when resolving merchant-owned records.
- Public API errors return merchant-safe messages and request IDs rather than raw infrastructure exceptions.
- Sensitive storefront data is owner-authenticated through the app proxy; knowledge of a ReleaseCore record ID is not sufficient authorization. Theme Editor previews use local sample data and never bypass customer ownership.
- Master-object deletion verifies the current shop/release/track storage prefix before deleting from R2 or local development storage.
- Production master storage fails closed unless `RELEASECORE_MASTER_STORAGE=R2` and the required R2 credentials are configured.
- Tokens, credentials, signed URL query strings, and other secrets must not be written to application logs.
- Shopify privacy requests are verified through Shopify webhook authentication. Customer data requests are exported for the merchant, customer redactions remove customer identifiers from ReleaseCore records, and shop redactions remove tenant data plus private master objects.

## Deployment

Before deployment:

```bash
npm install
npm run setup
npm run check
git diff --check
```

Deploy the web application to Railway using the production environment's normal release process, then run `npm run verify:production`. Deploy/release Shopify configuration and extensions separately with Shopify CLI. Shopify app versions do not deploy the Railway web server. Follow `docs/PRODUCTION-VERIFICATION.md` for the exact review-build sequence.
