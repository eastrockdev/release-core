# ReleaseCore M16 — Production workflow hardening

M16 is the dogfooding/operations phase. The goal is not to add App Store marketing features; it is to make ReleaseCore easier to operate every day while East Rock and future merchants expose real workflow friction.

## M16.1 — Operations Center and local preflight

M16.1 introduces a read-only Operations Center at `/app/operations`.

It intentionally uses ReleaseCore's own database and readiness rules instead of running Shopify GraphQL health checks for every dashboard load. External Shopify state remains owned by Distribution → Sync Health.

The Operations Center surfaces:

- active releases that need attention;
- submitted/in-review counts;
- approved releases that are locally ready to distribute;
- releases scheduled in the next seven days;
- changes-requested releases;
- distribution returns for correction;
- latest unresolved Shopify sync failure/warning signals;
- failed notification deliveries;
- approved releases with local readiness blockers;
- upcoming releases that still have readiness blockers;
- optional Artist Portal access advisories.

Every actionable item links to the most specific existing repair surface:

- Edit Track Info for track-level metadata/identifier/file issues;
- Release workspace for release-level readiness or review issues;
- Distribution / Sync Health for Shopify failures;
- Notifications for delivery failures;
- Portal Access for artist/customer-access advisories.

The active-release readiness scan is bounded so the dashboard cannot accidentally become an unbounded catalog query as merchants grow.

## M16 roadmap after M16.1

- **M16.2:** durable background jobs, idempotency, retry state.
- **M16.3:** consistent save/dirty-state behavior across admin editors.
- **M16.4:** production error classification and Recent System Issues.
- **M16.5:** structured in-app user feedback.
- **M16.6:** data hygiene and report-first maintenance tools.
- **M16.7:** pagination/query/performance pass.
- **M16.8:** destructive-action and catalog-safety controls.
- **M16.9:** operational workflow metrics.
