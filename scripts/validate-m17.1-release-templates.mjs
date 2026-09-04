#!/usr/bin/env node
import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  return fs.readFileSync(path, "utf8");
}

const schema = read("prisma/schema.prisma");
const migration = read(
  "prisma/migrations/20260904133000_m17_1_release_templates/migration.sql",
);
const service = read(
  "app/lib/release-templates.server.js",
);
const apiCreate = read(
  "app/routes/api.releases.create.jsx",
);
const apiTemplates = read(
  "app/routes/api.release-templates.jsx",
);
const newRelease = read(
  "app/routes/app.release.new.jsx",
);
const templatesPage = read(
  "app/routes/app.release-templates.jsx",
);
const releaseWorkspace = read(
  "app/routes/app.release.$releaseId.jsx",
);
const settings = read(
  "app/routes/app.settings.jsx",
);
const css = read(
  "app/styles/releasecore-admin.css",
);
const pkg = JSON.parse(read("package.json"));

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) {
    failures.push(message);
  }
};

for (const marker of [
  "model ReleaseTemplate {",
  "@@unique([shop, name])",
  "@@index([shop, updatedAt])",
  "@@index([shop, releaseType])",
]) {
  need(
    schema,
    marker,
    `ReleaseTemplate schema is missing ${marker}.`,
  );
}

for (const marker of [
  'CREATE TABLE "ReleaseTemplate"',
  '"ReleaseTemplate_shop_name_key"',
  '"ReleaseTemplate_shop_updatedAt_idx"',
]) {
  need(
    migration,
    marker,
    `M17.1 migration is missing ${marker}.`,
  );
}

for (const marker of [
  "RELEASE_TEMPLATE_BLUEPRINT_VERSION",
  "RELEASE_TEMPLATE_RESET_POLICY",
  "releaseBlueprintFromRecord",
  "createReleaseTemplate",
  "deleteReleaseTemplate",
  "createDraftFromBlueprint",
  "createDraftFromTemplate",
  "duplicateReleaseDraft",
  "createBlankReleaseDraft",
  "maybeAutoAssignIsrc",
  'status: "DRAFT"',
  'distributionStatus: "NOT_QUEUED"',
  "releaseDate: null",
  "preOrderDate: null",
  "ownerCustomerId: null",
  "shopifyReleaseProductId: null",
  "catalogNumber: null",
  "upc: null",
]) {
  need(
    service,
    marker,
    `Release template service is missing ${marker}.`,
  );
}

for (const resetField of [
  "releaseDate",
  "preOrderDate",
  "preSaveUrl",
  "streamingUrl",
  "upc",
  "catalogNumber",
  "isrc",
  "masterFiles",
  "shopifyProductIds",
  "submissionHistory",
  "distributionState",
  "ownerCustomerId",
]) {
  need(
    service,
    `"${resetField}"`,
    `Release template reset policy is missing ${resetField}.`,
  );
}

for (const marker of [
  "createDraftFromTemplate",
  "duplicateReleaseDraft",
  "createBlankReleaseDraft",
  "templateId",
  "duplicateReleaseId",
]) {
  need(
    apiCreate,
    marker,
    `Release creation API is missing ${marker}.`,
  );
}

for (const marker of [
  'intent === "create"',
  'intent === "delete"',
  "createReleaseTemplate",
  "deleteReleaseTemplate",
  "authenticate.admin",
]) {
  need(
    apiTemplates,
    marker,
    `Release template API is missing ${marker}.`,
  );
}

for (const marker of [
  "Start blank, reuse a template, or duplicate an existing release.",
  "selectedTemplate",
  "duplicateSource",
  "/app/release-templates",
  "templateId",
  "duplicateReleaseId",
  "Create duplicate draft",
  "Create from template",
]) {
  need(
    newRelease,
    marker,
    `New Release reuse UX is missing ${marker}.`,
  );
}

for (const marker of [
  'heading="Release Templates"',
  "Save current release as a template",
  "Use template",
  "Saved templates",
  "/api/release-templates",
]) {
  need(
    templatesPage,
    marker,
    `Release Templates page is missing ${marker}.`,
  );
}

for (const marker of [
  "Duplicate release",
  "Save as template",
  "/app/release/new?duplicate=",
  "/app/release-templates?source=",
]) {
  need(
    releaseWorkspace,
    marker,
    `Release workspace is missing ${marker}.`,
  );
}

need(
  settings,
  "/app/release-templates",
  "Settings does not expose Release Templates.",
);

for (const marker of [
  ".rc-release-reuse-grid",
  ".rc-release-reuse-selected",
  ".rc-release-template-list",
  ".rc-release-template-row",
]) {
  need(
    css,
    marker,
    `M17.1 CSS is missing ${marker}.`,
  );
}

if (
  pkg?.scripts?.["check:m17.1"] !==
  "node scripts/validate-m17.1-release-templates.mjs"
) {
  failures.push(
    "package.json is missing check:m17.1.",
  );
}

if (
  !String(pkg?.scripts?.check || "").includes(
    "npm run check:m17.1",
  )
) {
  failures.push(
    "Full npm run check does not include M17.1.",
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M17.1 release templates / duplication validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M17.1 release templates / sanitized duplication validation passed.",
);
