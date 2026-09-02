import fs from "node:fs";
import path from "node:path";

const roots = [path.resolve("app/routes"), path.resolve("app/lib")];
const files = [];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (/\.(?:js|jsx)$/.test(entry.name)) files.push(file);
  }
}
for (const root of roots) collect(root);

const failures = [];
const rawServerErrorPatterns = [
  /Response\.json\([\s\S]{0,240}?error\s*:\s*error\s+instanceof\s+Error\s*\?[^\n}]*error\.message/g,
  /Response\.json\([\s\S]{0,240}?error\s*:\s*error\.message/g,
];

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const pattern of rawServerErrorPatterns) {
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split("\n").length;
      failures.push(`${path.relative(process.cwd(), file)}:${line}: raw server error text is returned to the client`);
    }
  }
}


const tenantGuardMarkers = new Map([
  ["app/routes/api.artists.jsx", ["findShopArtist", "findShopContributor"]],
  ["app/routes/api.contributors.jsx", ["findShopContributor"]],
  ["app/routes/api.portal-access.jsx", ["findShopArtist", "findShopRelease"]],
  ["app/routes/api.files.$fileId.jsx", ["findShopReleaseFile"]],
  ["app/routes/api.uploads.stage.jsx", ["findShopRelease"]],
  ["app/routes/api.uploads.complete.jsx", ["findShopRelease"]],
  ["app/routes/api.uploads.master.jsx", ["findShopRelease"]],
  ["app/routes/api.uploads.master.stage.jsx", ["findShopRelease"]],
  ["app/routes/api.uploads.master.complete.jsx", ["findShopRelease"]],
  ["app/routes/api.notifications.jsx", ["findShopSubmissionEvent"]],
  ["app/lib/api-releases-release-action.server.js", ["findShopRelease", "findShopArtist", "findShopContributor"]],
]);
for (const [file, markers] of tenantGuardMarkers) {
  const source = fs.readFileSync(path.resolve(file), "utf8");
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`${file}: tenant guard ${marker} is missing`);
  }
}

const required = [
  "app/lib/http-security.server.js",
  "app/lib/tenant-db.server.js",
];
for (const file of required) {
  if (!fs.existsSync(path.resolve(file))) failures.push(`${file}: required M11.5 security module is missing`);
}

const forbiddenArtifacts = [
  "app/lib/automations.js.pre-client-helper",
  "app/lib/automations.server.js.pre-client-helper",
  "shopify.app.releasecore.toml.pre-railway",
];
for (const file of forbiddenArtifacts) {
  if (fs.existsSync(path.resolve(file))) failures.push(`${file}: stale backup artifact should not ship`);
}

if (failures.length) {
  console.error("ReleaseCore security-boundary validation failed:\n");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Validated server error boundaries across ${files.length} ReleaseCore source files.`);
