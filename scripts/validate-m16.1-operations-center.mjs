#!/usr/bin/env node
import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  return fs.readFileSync(path, "utf8");
}

const service = read("app/lib/operations-center.server.js");
const route = read("app/routes/app.operations.jsx");
const home = read("app/routes/app._index.jsx");
const app = read("app/routes/app.jsx");
const css = read("app/styles/releasecore-admin.css");
const packageJson = JSON.parse(read("package.json"));

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

need(
  service,
  "export async function loadOperationsCenter",
  "Operations Center service is missing.",
);
need(
  service,
  "calculateReleaseReadiness",
  "Operations Center does not reuse ReleaseCore readiness rules.",
);
need(
  service,
  "SHOPIFY_SYNC_FAILED",
  "Operations Center does not inspect recent Shopify sync failures.",
);
need(
  service,
  'where: { status: "FAILED" }',
  "Operations Center does not inspect failed notification deliveries.",
);
need(
  service,
  'release.status === "APPROVED"',
  "Operations Center does not identify approved releases.",
);
need(
  service,
  'release.distributionStatus === "RETURNED_FOR_CORRECTIONS"',
  "Operations Center does not surface distribution corrections.",
);
need(
  service,
  "primaryPortalConnected",
  "Operations Center does not surface Artist Portal access advisories.",
);
need(
  service,
  "releaseLimit = 200",
  "Operations Center is missing a bounded active-release scan.",
);

need(
  route,
  'heading="Operations"',
  "Operations Center route is missing its page heading.",
);
need(
  route,
  'label="Needs attention"',
  "Operations Center is missing the needs-attention metric.",
);
need(
  route,
  'label="Waiting for review"',
  "Operations Center is missing the waiting-review metric.",
);
need(
  route,
  'label="Ready to distribute"',
  "Operations Center is missing the distribution-ready metric.",
);
need(
  route,
  'heading="Scheduled next 7 days"',
  "Operations Center is missing the seven-day schedule.",
);
need(
  route,
  "Nothing on this page",
  "Operations Center does not explain its read-only local preflight behavior.",
);

need(
  app,
  '<s-link href="/app/operations">Operations</s-link>',
  "Admin navigation is missing Operations.",
);
need(
  home,
  'heading="Production operations"',
  "Home does not expose the production operations summary.",
);
need(
  home,
  "operations.stats.needsAttention",
  "Home does not show operations attention state.",
);
need(
  home,
  'navigate("/app/operations")',
  "Home does not link to Operations.",
);

need(
  css,
  ".rc-operations-issue",
  "Operations Center styles are missing.",
);
need(
  css,
  ".rc-operations-list",
  "Operations Center list styles are missing.",
);

if (
  packageJson?.scripts?.["check:m16.1"] !==
  "node scripts/validate-m16.1-operations-center.mjs"
) {
  failures.push("package.json is missing check:m16.1.");
}
if (
  !String(packageJson?.scripts?.check || "").includes(
    "npm run check:m16.1",
  )
) {
  failures.push(
    "Full npm run check does not include M16.1.",
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M16.1 Operations Center validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M16.1 Operations Center / local preflight validation passed.",
);
