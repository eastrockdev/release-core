#!/usr/bin/env node
import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  return fs.readFileSync(path, "utf8");
}

const schema = read("prisma/schema.prisma");
const constants = read("app/lib/catalog-operations.js");
const service = read("app/lib/catalog-operations.server.js");
const api = read("app/routes/api.catalog-operations.$releaseId.jsx");
const admin = read("app/routes/app.release_.$releaseId.catalog-operations.jsx");
const releasePage = read("app/routes/app.release.$releaseId.jsx");
const css = read("app/styles/releasecore-admin.css");
const migration = read(
  "prisma/migrations/20260904210000_m17_4_catalog_operations/migration.sql",
);
const pkg = JSON.parse(read("package.json"));

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) {
    failures.push(message);
  }
};

for (const marker of [
  "model ReleaseLifecycleRequest",
  "lifecycleRequests",
  "requestedBy",
  "effectiveAt",
  "resolutionNote",
  "completedAt",
]) {
  need(
    schema,
    marker,
    `Prisma schema is missing ${marker}.`,
  );
}

for (const marker of [
  'value: "CORRECTION"',
  'value: "UPDATE"',
  'value: "TAKEDOWN"',
  "CATALOG_OPERATION_TRANSITIONS",
  "normalizeManualCatalogNumber",
]) {
  need(
    constants,
    marker,
    `Catalog-operation definitions are missing ${marker}.`,
  );
}

for (const marker of [
  "loadCatalogOperationsWorkspace",
  "setManualCatalogNumber",
  "createCatalogLifecycleRequest",
  "transitionCatalogLifecycleRequest",
  "serializeCatalogOperationsForExport",
  "CATALOG_NUMBER_CORRECTED",
  "CATALOG_NUMBER_ASSIGNED_MANUAL",
  "advanceCatalogSequenceForManualCode",
  'mode: "insensitive"',
]) {
  need(
    service,
    marker,
    `Catalog-operation service is missing ${marker}.`,
  );
}

for (const marker of [
  '"set-catalog-number"',
  '"create-operation"',
  '"transition-operation"',
  '"CHANGE CATALOG NUMBER"',
  '"REQUEST TAKEDOWN"',
  '"COMPLETE TAKEDOWN"',
  "claimHighImpactMutation",
]) {
  need(
    api,
    marker,
    `Catalog-operation API is missing ${marker}.`,
  );
}

for (const marker of [
  'heading="Catalog Operations"',
  "Catalog identifier",
  "Admin override",
  "New catalog operation",
  "Catalog operation history",
  "Request takedown",
  "currentCatalogNumber",
  "promptSafetyConfirmation",
  "event.nativeEvent?.submitter",
  'data.set("nextStatus", nextStatus)',
]) {
  need(
    admin,
    marker,
    `Catalog Operations UI is missing ${marker}.`,
  );
}

need(
  releasePage,
  `/app/release/\${release.id}/catalog-operations`,
  "Release workspace is missing the Catalog operations navigation action.",
);

for (const marker of [
  ".rc-catalog-identifier-panel",
  ".rc-catalog-operation-form",
  ".rc-catalog-operation-card",
  ".rc-catalog-operation-transition",
]) {
  need(
    css,
    marker,
    `Catalog Operations CSS is missing ${marker}.`,
  );
}

for (const marker of [
  'CREATE TABLE "ReleaseLifecycleRequest"',
  '"releaseId"',
  '"trackId"',
  '"status"',
  '"effectiveAt"',
]) {
  need(
    migration,
    marker,
    `M17.4 migration is missing ${marker}.`,
  );
}

if (
  service.includes("admin.graphql") ||
  api.includes("admin.graphql")
) {
  failures.push(
    "M17.4 catalog operations must not directly mutate Shopify.",
  );
}

if (
  pkg?.scripts?.["check:m17.4"] !==
  "node scripts/validate-m17.4-catalog-operations.mjs"
) {
  failures.push("package.json is missing check:m17.4.");
}

if (
  !String(pkg?.scripts?.check || "").includes(
    "npm run check:m17.4",
  )
) {
  failures.push(
    "Full npm run check does not include M17.4.",
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M17.4 catalog operations validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M17.4 corrections / updates / takedowns + manual catalog-number validation passed.",
);
