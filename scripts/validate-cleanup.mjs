import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function collect(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...collect(full));
    else if (/\.(?:js|jsx|mjs|cjs)$/.test(entry.name)) output.push(full);
  }
  return output;
}

const appRoot = path.join(root, "app");
const extensionRoot = path.join(root, "extensions");
const sourceFiles = [
  ...(fs.existsSync(appRoot) ? collect(appRoot) : []),
  ...(fs.existsSync(extensionRoot) ? collect(extensionRoot) : []),
];

const obsoleteTemplateRoute = path.join(root, "app", "routes", "app.additional.jsx");
if (fs.existsSync(obsoleteTemplateRoute)) {
  failures.push("app/routes/app.additional.jsx: obsolete Shopify template route is still present");
}

const obsoleteMigration = path.join(root, "scripts", "migrate-sqlite-to-neon.mjs");
if (fs.existsSync(obsoleteMigration)) {
  failures.push("scripts/migrate-sqlite-to-neon.mjs: completed SQLite migration utility is still present");
}

const shopifyConfigPath = path.join(root, "shopify.app.toml");
if (fs.existsSync(shopifyConfigPath)) {
  const config = fs.readFileSync(shopifyConfigPath, "utf8");
  if (/product\.metafields\.app\.demo_info|metaobjects\.app\.example/.test(config)) {
    failures.push("shopify.app.toml: obsolete Shopify starter-template demo definitions are still present");
  }
}

const readmePath = path.join(root, "README.md");
if (fs.existsSync(readmePath)) {
  const readme = fs.readFileSync(readmePath, "utf8");
  if (/^# Shopify App Template - React Router/m.test(readme)) {
    failures.push("README.md: Shopify starter-template documentation is still present");
  }
}

for (const file of sourceFiles) {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, "utf8");
  if (/catch\s*\{\s*\}/m.test(source)) {
    failures.push(`${relative}: contains an empty catch block`);
  }
  if (/\bbestEffortDeleteShopifyFile\b|\bdeleteShopifyFile\s*\(/.test(source)) {
    failures.push(`${relative}: duplicates the shared Shopify Files cleanup helper`);
  }
}

const allowedFileDeleteModules = new Set([
  "app/lib/shopify-files.server.js",
  "app/routes/api.files.$fileId.jsx",
]);
for (const file of sourceFiles) {
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  if (allowedFileDeleteModules.has(relative)) continue;
  const source = fs.readFileSync(file, "utf8");
  if (/\bfileDelete\s*\(/.test(source)) {
    failures.push(`${relative}: Shopify fileDelete should use app/lib/shopify-files.server.js unless deletion is the explicit API action`);
  }
}

if (failures.length) {
  console.error("ReleaseCore cleanup validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ReleaseCore cleanup validation passed.");
