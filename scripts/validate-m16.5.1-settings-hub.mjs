#!/usr/bin/env node
import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  return fs.readFileSync(path, "utf8");
}

const app = read("app/routes/app.jsx");
const hub = read("app/routes/app.settings.jsx");
const preferences = read(
  "app/routes/app.settings_.preferences.jsx",
);
const m164 = read(
  "scripts/validate-m16.4-system-issues.mjs",
);
const m165 = read(
  "scripts/validate-m16.5-feedback.mjs",
);
const css = read(
  "app/styles/releasecore-admin.css",
);
const pkg = JSON.parse(read("package.json"));

const legacyDetailedSettingsValidators = [];
for (const entry of fs.readdirSync("scripts", {
  withFileTypes: true,
})) {
  if (
    !entry.isFile() ||
    !/^validate-.*\.mjs$/.test(entry.name) ||
    [
      "validate-app-store-readiness.mjs",
      "validate-route-boundaries.mjs",
      "validate-m16.4-system-issues.mjs",
      "validate-m16.5-feedback.mjs",
      "validate-m16.5.1-settings-hub.mjs",
    ].includes(entry.name)
  ) {
    continue;
  }

  const validatorSource = read(
    `scripts/${entry.name}`,
  );

  const legacySettingsRead =
    validatorSource.match(
      /const\s+([A-Za-z_$][\w$]*)\s*=\s*read\(["']app\/routes\/app\.settings\.jsx["']\);/,
    );

  if (
    legacySettingsRead &&
    !/hub/i.test(legacySettingsRead[1])
  ) {
    legacyDetailedSettingsValidators.push(
      entry.name,
    );
  }
}

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) {
    failures.push(message);
  }
};

for (const href of [
  'href="/app"',
  'href="/app/operations"',
  'href="/app/releases"',
  'href="/app/submissions"',
  'href="/app/distribution"',
  'href="/app/artists"',
  'href="/app/settings"',
]) {
  need(
    app,
    href,
    `Focused sidebar is missing ${href}.`,
  );
}

for (const href of [
  'href="/app/system-issues"',
  'href={feedbackHref}',
  'href="/app/import"',
  'href="/app/purchases"',
  'href="/app/contributors"',
  'href="/app/portal-access"',
  'href="/app/storefront-setup"',
  'href="/app/automation"',
  'href="/app/notifications"',
  'href="/app/privacy"',
]) {
  if (app.includes(href)) {
    failures.push(
      `Low-traffic navigation item still appears in the sidebar: ${href}.`,
    );
  }
}

if (
  app.includes("useLocation") ||
  app.includes("feedbackHref") ||
  app.includes("countOpenSystemIssues")
) {
  failures.push(
    "Sidebar shell still carries state/query work for items moved into Settings.",
  );
}

need(
  hub,
  'heading="Settings"',
  "Settings hub page is missing.",
);
need(
  hub,
  "Settings & tools",
  "Settings hub is missing its app-style intro.",
);

for (const href of [
  "/app/settings/preferences",
  "/app/import",
  "/app/contributors",
  "/app/portal-access",
  "/app/storefront-setup",
  "/app/purchases",
  "/app/automation",
  "/app/notifications",
  "/app/system-issues",
  "/app/feedback?from=%2Fapp%2Fsettings",
  "/app/privacy",
]) {
  need(
    hub,
    href,
    `Settings hub is missing ${href}.`,
  );
}

if (hub.includes("loadSettingsDashboard")) {
  failures.push(
    "Settings hub still loads the large preferences dashboard.",
  );
}

need(
  preferences,
  "loadSettingsDashboard",
  "Release preferences route did not retain the existing settings dashboard.",
);
need(
  preferences,
  'heading="Release Preferences"',
  "Release preferences route is not clearly labeled.",
);

for (const marker of [
  ".rc-settings-hub",
  ".rc-settings-hub-grid",
  ".rc-settings-hub-card",
  ".rc-settings-hub-card--primary",
]) {
  need(
    css,
    marker,
    `Settings hub CSS is missing ${marker}.`,
  );
}

need(
  m164,
  'const settingsHub = read(',
  "M16.4 validator was not evolved for the Settings hub.",
);
need(
  m164,
  '"/app/system-issues"',
  "M16.4 validator no longer verifies System Issues discoverability.",
);
need(
  m165,
  'const settingsHub = read(',
  "M16.5 validator was not evolved for the Settings hub.",
);
need(
  m165,
  '"/app/feedback?from=%2Fapp%2Fsettings"',
  "M16.5 validator no longer verifies Feedback discoverability.",
);

if (
  pkg?.scripts?.["check:m16.5.1"] !==
  "node scripts/validate-m16.5.1-settings-hub.mjs"
) {
  failures.push(
    "package.json is missing check:m16.5.1.",
  );
}
if (
  !String(pkg?.scripts?.check || "").includes(
    "npm run check:m16.5.1",
  )
) {
  failures.push(
    "Full npm run check does not include M16.5.1.",
  );
}


const legacyTopLevelNavigationValidators = [];

for (const entry of fs.readdirSync("scripts", {
  withFileTypes: true,
})) {
  if (
    !entry.isFile() ||
    !/^validate-.*\.mjs$/.test(entry.name) ||
    entry.name ===
      "validate-m16.5.1-settings-hub.mjs"
  ) {
    continue;
  }

  const validatorSource = read(
    `scripts/${entry.name}`,
  );

  if (
    !validatorSource.includes(
      "app/routes/app.jsx",
    ) ||
    validatorSource.includes(
      "app/routes/app.settings.jsx",
    )
  ) {
    continue;
  }

  const movedRoutes = [
    "/app/import",
    "/app/purchases",
    "/app/contributors",
    "/app/portal-access",
    "/app/storefront-setup",
    "/app/automation",
    "/app/notifications",
    "/app/privacy",
    "/app/system-issues",
    "/app/feedback",
  ];

  if (
    movedRoutes.some((route) =>
      validatorSource.includes(
        `href="${route}"`,
      ),
    )
  ) {
    legacyTopLevelNavigationValidators.push(
      entry.name,
    );
  }
}

if (legacyTopLevelNavigationValidators.length) {
  failures.push(
    `Validators still require low-traffic Settings destinations to remain top-level navigation: ${legacyTopLevelNavigationValidators.join(", ")}.`,
  );
}

if (legacyDetailedSettingsValidators.length) {
  failures.push(
    `Detailed-settings validators still target the Settings hub instead of Release Preferences: ${legacyDetailedSettingsValidators.join(", ")}.`,
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M16.5.1 focused navigation / Settings hub validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M16.5.1 focused navigation / card-based Settings hub validation passed.",
);
