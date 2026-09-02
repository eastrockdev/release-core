import fs from "node:fs";
import path from "node:path";

const failures = [];

const presentationRoutes = [
  "app/routes/app.release.$releaseId.jsx",
  "app/routes/app.settings.jsx",
  "app/routes/app.distribution_.$releaseId.jsx",
  "app/routes/app.automation.jsx",
];

const transportRoutes = [
  "app/routes/api.distribution.$releaseId.jsx",
  "app/routes/api.automation.jsx",
];

const requiredServices = [
  "app/lib/release-workspace.server.js",
  "app/lib/settings-dashboard.server.js",
  "app/lib/distribution-workspace.server.js",
  "app/lib/distribution.server.js",
  "app/lib/automation-settings.server.js",
];

function read(file) {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) {
    failures.push(`${file}: required architecture file is missing`);
    return "";
  }
  return fs.readFileSync(absolute, "utf8");
}

for (const file of requiredServices) read(file);

for (const file of presentationRoutes) {
  const source = read(file);
  if (/from\s+["']\.\.\/db\.server["']/.test(source) || /\bdb\./.test(source)) {
    failures.push(`${file}: presentation route contains direct Prisma access`);
  }
}

for (const file of transportRoutes) {
  const source = read(file);
  if (/from\s+["']\.\.\/db\.server["']/.test(source) || /\bdb\./.test(source)) {
    failures.push(`${file}: transport route contains direct Prisma access`);
  }
}

const distributionRoute = read("app/routes/api.distribution.$releaseId.jsx");
if (!distributionRoute.includes("performDistributionAction")) {
  failures.push("app/routes/api.distribution.$releaseId.jsx: distribution domain service is not wired");
}

const automationRoute = read("app/routes/api.automation.jsx");
if (!automationRoute.includes("performAutomationSettingsAction")) {
  failures.push("app/routes/api.automation.jsx: automation domain service is not wired");
}

const distributionService = read("app/lib/distribution.server.js");
if (!distributionService.includes("findShopRelease")) {
  failures.push("app/lib/distribution.server.js: tenant-scoped release lookup is missing");
}
if (!distributionService.includes("db.$transaction")) {
  failures.push("app/lib/distribution.server.js: expected transaction boundaries are missing");
}

if (failures.length) {
  console.error("ReleaseCore route-boundary validation failed:\n");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Validated ReleaseCore presentation, transport, and domain-service boundaries.");
