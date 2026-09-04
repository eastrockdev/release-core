## ReleaseCore M18.1 — Aura Artist Portal Refinement

- Refined the unified Artist Portal with compact identity presentation, Safari-safe controls, stronger containment, and smoother responsive behavior.
- Added cover-art-reactive Aura treatment to release cards and selected-artist ambience.
- Added three-level Shopify Navigation support to desktop supplemental navigation and the mobile More sheet.

## ReleaseCore M18.0 — Unified Artist Portal

- Added the full Aura storefront artist dashboard with desktop/sidebar and mobile navigation.
- Added ReleaseCore-enforced RLIAB membership authorization and first-time artist onboarding.
- Added Artist publisher name / publisher IPI and read-only legacy customer-profile prefilling.

## ReleaseCore M17.5 — Configurable Credits + Album Associations

- Added merchant-configurable contributor credit roles while preserving the standard ReleaseCore credit roles and publishing semantics.
- Made East Rock Album/EP track products explicitly write `custom.associated_album` immediately after the Shopify parent product is resolved.

# ReleaseCore changelog

## M12 — Shopify catalog publishing

### M12.2 — Album/EP products and Shopify fixed bundles

- Added release-level Album/EP Shopify products built from the already-linked track products using Shopify product fixed bundles.
- Added asynchronous bundle create/update operation persistence and recovery so long-running Shopify bundle jobs can be safely resumed without creating duplicate parent products.
- Added Album/EP price and default publication settings, Album/EP theme-template application on creation, release-product publication controls, and per-release bundle state in Distribution.
- Added release-level music metadata, track list/count, identifiers, URLs, public credits, native Music genre, artwork, SKU, and UPC synchronization to the parent product.
- Added a deterministic single-variant component guard and a standard Album/EP product fallback when a release exceeds Shopify's 30-component fixed-bundle limit.

### M12.1.2 — Music genre + merchant credit preservation hotfix

- Corrected Shopify Music genre synchronization to use the native `shopify.music-genre` `list.metaobject_reference` definition and taxonomy-backed Music genre metaobjects.
- Added read scopes for Shopify metaobject definitions/entries used by native Music genre resolution.
- Changed individualized credit synchronization to preserve merchant-added songwriter/composer/producer/engineer/designer values while ReleaseCore continues managing only the values sourced from its contributor credits.

### M12.1 — Track product hardening and catalog foundations

- Added explicit Shopify Online Store publication lifecycle controls and a merchant-configurable default for newly created track products.
- Added release pre-save and streaming URLs for admin entry, Artist Portal visibility, Shopify sync, and Shopify-product import.
- Reduced public credits to name/role and added separate storefront-readable songwriter, composer, producer, recording/mixing/mastering engineer, and cover-art designer metafields.
- Constrained ReleaseCore product metafield definitions to Shopify's Digital Music Downloads category and added automatic repair for older global definitions.
- Added Shopify Music genre taxonomy matching, additive tag synchronization, stale metafield deletion, HTML-safe descriptions, and earlier Shopify product-link persistence.
- Added separate single-track and Album/EP theme-template defaults, publication scopes, per-track Shopify publication status/actions, and `check:catalog`.

## M11.6 — App Store compliance

### Phase 3 — Production verification and review closure

- Added a live production verifier for public legal/support/install routes and invalid-HMAC webhook rejection.
- Changed compliance webhook handling to persist the privacy request, acknowledge Shopify immediately, and continue long-running export/redaction processing without holding the delivery open.
- Removed unnecessary ReleaseCore app-name branding from buyer-facing theme-extension copy to align with current storefront branding requirements.
- Added GraphQL-only and storefront-branding assertions to App Store readiness validation.
- Added a production/review sign-off runbook covering Railway deployment, Shopify app-version release, signed webhook tests, fresh-store/incognito testing, idle uninstall/reinstall, protected customer data, and reviewer evidence.

### Phase 2 — Submission readiness and merchant onboarding

- Reconciled the canonical and production Shopify TOML configuration onto the actual ReleaseCore App Store app, production Railway URL, stable webhook version, required scopes, compliance subscriptions, and app proxy.
- Removed the Shopify starter public shop-domain login form and replaced it with a ReleaseCore public landing page that relies on Shopify-owned installation/authentication flows.
- Added public Privacy Policy and Support routes suitable for the App Store listing.
- Added merchant-facing Storefront setup with Theme Editor deep links for Release Portal, Recent Releases, and Artist Profile app blocks.
- Added App Home onboarding, an App Store submission runbook, `check:app-store`, and CI coverage for submission-readiness regressions.

### Phase 1.1 — Privacy route client/server boundary hotfix

- Moved privacy topic constants into a client-safe shared module so the Privacy admin route no longer pulls `privacy.server.js` into the browser bundle.
- Made server-only privacy processors lazy imports inside route loaders/actions and added a compliance regression check for the boundary.

### Phase 1 — Privacy webhooks and protected customer data

- Added the three mandatory Shopify compliance webhook topics: `customers/data_request`, `customers/redact`, and `shop/redact`.
- Added durable privacy-request records, customer-data exports, customer redaction, and full shop redaction including private master storage cleanup.
- Added an authenticated Privacy admin queue with downloadable customer-data exports and retry controls.
- Declared the `read_customers` scope required by ReleaseCore customer search/notification features.
- Added `check:compliance` and CI coverage while preserving expiring offline access tokens.

## M11.5 — Product hardening

### Phase 4 — Tenant/security closure

- Removed the server-side Theme Editor `preview=all` data bypass and replaced it with local sample preview cards.
- Made storefront portal reads require a signed-in customer on every app-proxy data/audio endpoint.
- Scoped master-object deletion to the current shop, release, and track before R2/local cleanup can run.
- Made production master storage fail closed unless Cloudflare R2 is explicitly configured.
- Added `check:tenancy` and CI coverage for these boundaries.

### Phase 3 — Repository cleanup and quality gates

- Centralized best-effort Shopify Files cleanup and removed duplicated `fileDelete` implementations.
- Removed obsolete Shopify starter-template routes, declarative demo schema, and completed SQLite-to-PostgreSQL migration tooling.
- Replaced the inherited Shopify template README/changelog with ReleaseCore-specific repository documentation.
- Removed dead helpers and cleaned stale lint exceptions, empty catches, unused values, and obsolete development wording.
- Added cleanup validation and made lint part of the aggregate local/CI quality gate.

### Phase 2.2 — Credits & publishing responsive hotfix

- Prevented contributor-credit rows from overflowing the Shopify embedded-app canvas.
- Made credit controls and actions responsive without changing publishing ownership logic.

### Phase 2.1 — Contextual action feedback

- Moved admin action feedback into the section where the action occurs.
- Preserved scroll position across revalidation and strengthened upload/progress visibility.

### Phase 2 — Domain-service extraction

- Moved release, settings, distribution, and automation server behavior out of route components into domain services.
- Expanded transaction boundaries for multi-record writes while preserving existing workflows.

### Phase 1 — Security and tenant boundaries

- Added tenant-scoped database helpers, merchant-safe error responses, request IDs, and sanitized server diagnostics.
- Added security-boundary validation and CI coverage.

## M11.4 — Cross-browser design system

- Standardized admin controls, buttons, form states, focus treatment, dates, mobile touch targets, reduced motion, and high-contrast behavior.
- Completed Safari, Chromium, Firefox, mobile-browser, and storefront hardening passes.

## M11.3 — ISRC assignment modes

- Added ReleaseCore-assigned and administrator/aggregator-provided ISRC workflows without overwriting existing identifiers.

## M11.2 — Merchant-facing UX and copy

- Standardized merchant terminology, status language, empty states, and admin presentation.

## M11.1 — Multipart master WAV uploads

- Added resilient Cloudflare R2 multipart uploads for large master WAV files with part retries, completion verification, and safe replacement behavior.
