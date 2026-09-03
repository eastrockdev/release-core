import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
let failed = false;
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));
const fail = (message) => {
  failed = true;
  console.error(`ReleaseCore import duplicate guard validation failed: ${message}`);
};

for (const relative of [
  "app/routes/app.import.jsx",
  "app/lib/import-product.server.js",
]) {
  if (!exists(relative)) fail(`${relative} is missing.`);
}

if (exists("app/routes/app.import.jsx")) {
  const source = read("app/routes/app.import.jsx");
  for (const marker of [
    "useLoaderData",
    "importedProducts",
    "shopifyReleaseProductId",
    "shopifyProductId",
    "already imported",
    "existingReleaseId",
    "Open existing release",
  ]) {
    if (!source.includes(marker)) fail(`Importer UI is missing ${marker}.`);
  }
}

if (exists("app/lib/import-product.server.js")) {
  const source = read("app/lib/import-product.server.js");
  if (!source.includes("throw publicError(")) {
    fail("Import service does not throw on duplicate import.");
  }
  if (!source.includes("This Shopify product has already been imported into ReleaseCore.")) {
    fail("Import service is missing the duplicate import conflict message.");
  }
  if (!source.includes("status: 409")) {
    fail("Duplicate import rejection is not HTTP 409.");
  }
}

if (failed) process.exit(1);
console.log("ReleaseCore import duplicate guard validation passed.");
