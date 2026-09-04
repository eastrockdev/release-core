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
  "prisma/migrations/20260904090000_m16_8_production_safety/migration.sql",
);
const safety = read(
  "app/lib/production-safety.server.js",
);
const safetyClient = read(
  "app/lib/production-safety-client.js",
);
const authenticatedPost = read(
  "app/lib/authenticated-post.js",
);
const releaseAction = read(
  "app/lib/api-releases-release-action.server.js",
);
const dataApi = read(
  "app/routes/api.data-hygiene.jsx",
);
const fileApi = read(
  "app/routes/api.files.$fileId.jsx",
);
const releaseUi = read(
  "app/routes/app.release.$releaseId.jsx",
);
const trackUi = read(
  "app/routes/app.release_.$releaseId.track.$trackId.jsx",
);
const hygieneUi = read(
  "app/routes/app.data-hygiene.jsx",
);
const safetyPage = read(
  "app/routes/app.production-safety.jsx",
);
const settings = read(
  "app/routes/app.settings.jsx",
);
const startProduction = read(
  "scripts/start-production.mjs",
);
const productionEnv = read(
  "scripts/validate-production-environment.mjs",
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
  "model ProductionMutation {",
  "@@unique([shop, deploymentProfile, requestId])",
  "@@index([shop, deploymentProfile, createdAt])",
]) {
  need(
    schema,
    marker,
    `ProductionMutation schema is missing ${marker}.`,
  );
}

for (const marker of [
  'CREATE TABLE "ProductionMutation"',
  '"ProductionMutation_shop_deploymentProfile_requestId_key"',
]) {
  need(
    migration,
    marker,
    `M16.8 migration is missing ${marker}.`,
  );
}

for (const marker of [
  "productionSafetyReport",
  "assertProductionRuntimeSafety",
  "claimHighImpactMutation",
  "requireSafetyConfirmation",
  "x-releasecore-mutation-id",
  "P2002",
  "PRODUCTION_TARGETS",
]) {
  need(
    safety,
    marker,
    `Production safety service is missing ${marker}.`,
  );
}

need(
  safetyClient,
  "promptSafetyConfirmation",
  "Production safety client confirmation helper is missing.",
);
need(
  authenticatedPost,
  '"X-ReleaseCore-Mutation-Id"',
  "authenticatedPost does not send a mutation replay ID.",
);

for (const marker of [
  "HIGH_IMPACT_RELEASE_INTENTS",
  "claimHighImpactMutation",
  '"approve-release"',
  '"reject-release"',
  '"reopen-draft"',
  '"delete-draft"',
  '"delete-track"',
  '"REOPEN RELEASE"',
  '"DELETE DRAFT"',
  '"DELETE TRACK"',
]) {
  need(
    releaseAction,
    marker,
    `Release mutation safety is missing ${marker}.`,
  );
}

for (const marker of [
  "claimHighImpactMutation",
  '"MERGE ARTIST"',
  '"MERGE CONTRIBUTOR"',
  '"DELETE ARTIST"',
  '"DELETE CONTRIBUTOR"',
]) {
  need(
    dataApi,
    marker,
    `Data Hygiene production safety is missing ${marker}.`,
  );
}

need(
  fileApi,
  "claimHighImpactMutation",
  "File deletion is missing mutation replay protection.",
);
need(
  fileApi,
  'operation: "delete-file"',
  "File deletion is missing its protected operation marker.",
);

for (const [name, source, markers] of [
  [
    "Release workspace",
    releaseUi,
    [
      "promptSafetyConfirmation",
      '"REOPEN RELEASE"',
      '"DELETE DRAFT"',
    ],
  ],
  [
    "Track editor",
    trackUi,
    [
      "promptSafetyConfirmation",
      '"DELETE TRACK"',
    ],
  ],
  [
    "Data Hygiene",
    hygieneUi,
    [
      "promptSafetyConfirmation",
      '"MERGE ARTIST"',
      '"MERGE CONTRIBUTOR"',
      '"DELETE ARTIST"',
      '"DELETE CONTRIBUTOR"',
    ],
  ],
]) {
  for (const marker of markers) {
    need(
      source,
      marker,
      `${name} is missing ${marker}.`,
    );
  }
}

for (const marker of [
  'heading="Production Safety"',
  "Production guard active",
  "Recent protected mutations",
]) {
  need(
    safetyPage,
    marker,
    `Production Safety page is missing ${marker}.`,
  );
}

need(
  settings,
  "/app/production-safety",
  "Settings does not expose Production Safety.",
);

need(
  startProduction,
  "spawnSync",
  "Production supervisor does not revalidate the environment.",
);
need(
  startProduction,
  "validate-production-environment.mjs",
  "Production supervisor does not invoke environment validation.",
);

if (
  !String(pkg?.scripts?.["docker-start"] || "").startsWith(
    "node scripts/validate-production-environment.mjs &&",
  )
) {
  failures.push(
    "docker-start does not validate production safety before Prisma setup.",
  );
}

for (const marker of [
  '"DIRECT_URL"',
  "localhost",
  "127.0.0.1",
]) {
  need(
    productionEnv,
    marker,
    `Production environment validation is missing ${marker}.`,
  );
}

for (const marker of [
  ".rc-safety-state",
  ".rc-safety-check",
  ".rc-safety-grid",
]) {
  need(
    css,
    marker,
    `M16.8 CSS is missing ${marker}.`,
  );
}

if (
  pkg?.scripts?.["check:m16.8"] !==
  "node scripts/validate-m16.8-production-safety.mjs"
) {
  failures.push(
    "package.json is missing check:m16.8.",
  );
}

if (
  !String(pkg?.scripts?.check || "").includes(
    "npm run check:m16.8",
  )
) {
  failures.push(
    "Full npm run check does not include M16.8.",
  );
}


const legacyDockerStartValidators = [];
for (const entry of fs.readdirSync("scripts", {
  withFileTypes: true,
})) {
  if (
    !entry.isFile() ||
    !/^validate-.*\.mjs$/.test(entry.name) ||
    [
      "validate-m15.3-production-readiness.mjs",
      "validate-m16.2-operation-jobs.mjs",
      "validate-m16.8-production-safety.mjs",
    ].includes(entry.name)
  ) {
    continue;
  }

  const validatorSource = read(
    `scripts/${entry.name}`,
  );

  if (
    validatorSource.includes(
      '["docker-start"] !==\n  "npm run setup && node scripts/start-production.mjs"',
    ) ||
    validatorSource.includes(
      '["docker-start", "npm run setup && node scripts/start-production.mjs"]',
    )
  ) {
    legacyDockerStartValidators.push(
      entry.name,
    );
  }
}

if (legacyDockerStartValidators.length) {
  failures.push(
    `Historical validators still hard-code the pre-M16.8 docker-start contract: ${legacyDockerStartValidators.join(", ")}.`,
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M16.8 production safety validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M16.8 production profile / replay / destructive-action safety validation passed.",
);
