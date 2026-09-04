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
  "prisma/migrations/20260904010000_m16_4_system_issues/migration.sql",
);
const errors = read(
  "app/lib/operational-errors.js",
);
const issues = read(
  "app/lib/system-issues.server.js",
);
const security = read(
  "app/lib/http-security.server.js",
);
const authenticatedPost = read(
  "app/lib/authenticated-post.js",
);
const jobs = read(
  "app/lib/operation-jobs.server.js",
);
const operations = read(
  "app/lib/operations-center.server.js",
);
const operationsUi = read(
  "app/routes/app.operations.jsx",
);
const systemIssuesUi = read(
  "app/routes/app.system-issues.jsx",
);
const app = read("app/routes/app.jsx");
const settingsHub = read(
  "app/routes/app.settings.jsx",
);
const packageJson = JSON.parse(
  read("package.json"),
);

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) {
    failures.push(message);
  }
};

need(
  schema,
  "model SystemIssue {",
  "Prisma schema is missing SystemIssue.",
);
need(
  schema,
  "systemIssues",
  "Release does not own related system issues.",
);
need(
  migration,
  'CREATE TABLE "SystemIssue"',
  "SystemIssue migration table is missing.",
);
need(
  migration,
  "shopifyUserErrors",
  "SystemIssue migration does not store Shopify user errors.",
);
need(
  migration,
  "occurrenceCount",
  "SystemIssue migration does not deduplicate repeated failures.",
);

for (const marker of [
  "classifyOperationalError",
  "extractShopifyUserErrors",
  "shopifyMutationError",
  "shouldRecordOperationalIssue",
  "retryable",
  "resolutionFor",
]) {
  need(
    errors,
    marker,
    `Operational error classifier is missing ${marker}.`,
  );
}

for (const marker of [
  "recordSystemIssue",
  "listRecentSystemIssues",
  "countOpenSystemIssues",
  "markSystemIssueResolved",
  "resolveSystemIssuesForOperation",
  "occurrenceCount: { increment: 1 }",
]) {
  need(
    issues,
    marker,
    `System issue service is missing ${marker}.`,
  );
}

for (const marker of [
  "errorClass:",
  "retryable:",
  "resolution:",
  "shopifyUserErrors",
  "recordSystemIssue",
  "shouldRecordOperationalIssue",
]) {
  need(
    security,
    marker,
    `API error response is missing ${marker}.`,
  );
}

if (security.includes("technicalMessage,")) {
  failures.push(
    "API responses must not expose stored technicalMessage.",
  );
}

for (const marker of [
  "error.requestId",
  "error.errorClass",
  "error.retryable",
  "error.resolution",
  "error.shopifyUserErrors",
]) {
  need(
    authenticatedPost,
    marker,
    `Client error transport is missing ${marker}.`,
  );
}

need(
  jobs,
  "recordSystemIssue",
  "Terminal background failures are not recorded as system issues.",
);
need(
  jobs,
  "resolveSystemIssuesForOperation",
  "Recovered background jobs do not resolve their system issue.",
);
need(
  jobs,
  'source: "BACKGROUND_JOB"',
  "Background system issues do not identify their source.",
);

need(
  operations,
  "recentSystemIssues",
  "Operations Center does not load recent system issues.",
);
need(
  operations,
  "openSystemIssues",
  "Operations Center does not count open system issues.",
);
need(
  operationsUi,
  'label="System issues"',
  "Operations UI is missing the System issues metric.",
);
need(
  operationsUi,
  'heading="Recent system issues"',
  "Operations UI is missing the Recent system issues section.",
);

for (const marker of [
  'heading="System Issues"',
  "Recommended resolution",
  "Request reference",
  "Shopify reported",
  'name="issueId"',
  "markSystemIssueResolved",
]) {
  need(
    systemIssuesUi,
    marker,
    `System Issues page is missing ${marker}.`,
  );
}
if (systemIssuesUi.includes("technicalMessage")) {
  failures.push(
    "System Issues UI must not display technicalMessage.",
  );
}

need(
  operationsUi,
  "/app/system-issues",
  "Operations does not link to System Issues.",
);
need(
  settingsHub,
  "/app/system-issues",
  "Settings hub does not expose System Issues.",
);

if (
  packageJson?.scripts?.["check:m16.4"] !==
  "node scripts/validate-m16.4-system-issues.mjs"
) {
  failures.push(
    "package.json is missing check:m16.4.",
  );
}
if (
  !String(
    packageJson?.scripts?.check || "",
  ).includes("npm run check:m16.4")
) {
  failures.push(
    "Full npm run check does not include M16.4.",
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M16.4 production error / system issue validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M16.4 production error classification / Recent System Issues validation passed.",
);
