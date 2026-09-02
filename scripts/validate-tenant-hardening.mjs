import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const proxy = read("app/routes/releasecore-proxy.$.jsx");
if (!proxy.includes("requirePortalCustomer(identity);")) {
  failures.push("releasecore-proxy: storefront loader must require an authenticated customer");
}
if (/previewAll|preview=all|NODE_ENV/.test(proxy)) {
  failures.push("releasecore-proxy: server-side theme preview bypass must not exist");
}

for (const relative of ["app/lib/portal.server.js", "app/lib/automations.server.js"]) {
  if (/previewAll|preview=all/.test(read(relative))) {
    failures.push(`${relative}: tenant-bypassing preview mode must not exist in server code`);
  }
}

for (const relative of [
  "extensions/releasecore-artist-portal/assets/releasecore-portal.js",
  "extensions/releasecore-artist-portal/assets/releasecore-recent.js",
]) {
  if (/preview=all/.test(read(relative))) {
    failures.push(`${relative}: Theme Editor preview must use local sample data instead of the app proxy`);
  }
}

const portal = read("app/lib/portal.server.js");
for (const marker of [
  "where: { id: releaseId, shop, ownerCustomerId: customerId }",
  "where: { shop, ownerCustomerId: customerId }",
  'if (masterStorageProvider() !== "LOCAL_DEV")',
  "deleteMasterStorageObject",
]) {
  if (!portal.includes(marker)) failures.push(`app/lib/portal.server.js: missing tenant hardening marker: ${marker}`);
}

const localUpload = read("app/routes/api.uploads.master.jsx");
if (!localUpload.includes('if (masterStorageProvider() !== "LOCAL_DEV")')) {
  failures.push("api.uploads.master: direct local master route must be disabled unless LOCAL_DEV is explicitly active");
}

const storage = read("app/lib/storage.server.js");
for (const marker of [
  'const production = process.env.NODE_ENV === "production";',
  'throw new Error("ReleaseCore production master storage must be configured as R2.");',
  "assertR2MasterKeyScope(storageKey, scope);",
  "assertLocalMasterKeyScope(storageKey, scope);",
  "export async function deleteMasterStorageObject",
]) {
  if (!storage.includes(marker)) failures.push(`app/lib/storage.server.js: missing storage hardening marker: ${marker}`);
}

const sourceRoots = [path.join(root, "app", "routes"), path.join(root, "app", "lib")];
const sourceFiles = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (/\.(?:js|jsx)$/.test(entry.name)) sourceFiles.push(full);
  }
}
for (const sourceRoot of sourceRoots) collect(sourceRoot);

for (const file of sourceFiles) {
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  if (relative === "app/lib/storage.server.js") continue;
  const source = fs.readFileSync(file, "utf8");
  if (/\bdeleteR2StorageKey\s*\(|\bdeleteLocalStorageKey\s*\(/.test(source)) {
    failures.push(`${relative}: master deletion must go through deleteMasterStorageObject so release/track scope is verified`);
  }
}

if (failures.length) {
  console.error("ReleaseCore tenant-hardening validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ReleaseCore tenant-hardening validation passed.");
