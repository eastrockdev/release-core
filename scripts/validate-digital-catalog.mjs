import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const products = readFileSync(join(root, "app/lib/shopify-products.server.js"), "utf8");
const bundles = readFileSync(join(root, "app/lib/shopify-bundles.server.js"), "utf8");
const importer = readFileSync(join(root, "app/lib/import-product.server.js"), "utf8");

const failures = [];
function requireText(source, text, label) {
  if (!source.includes(text)) failures.push(label);
}

requireText(products, "RELEASECORE_M134_CATALOG_INTEGRITY", "M13.4 catalog marker");
requireText(products, "originalSource: String(originalSource)", "cover artwork must create Shopify product media from a URL");
requireText(products, 'mediaContentType: "IMAGE"', "cover artwork must be IMAGE media");
requireText(products, 'measurement: { weight: { value: 0, unit: "GRAMS" } }', "music variants must be 0 g");
requireText(products, "requiresShipping: false", "music variants must not require shipping");
requireText(products, "tracked: false", "music variants must not track inventory");
requireText(products, "normalizeShopifyDigitalProduct", "imported-product digital normalizer");
requireText(products, 'productType: "Digital Music Download"', "music product type");
requireText(products, "category: DIGITAL_MUSIC_CATEGORY_ID", "digital music taxonomy category");

requireText(bundles, "attachCoverFileToProduct", "Album/EP artwork helper");
requireText(bundles, "updateVariant", "Album/EP digital variant helper");
requireText(bundles, "DIGITAL_MUSIC_CATEGORY_ID", "Album/EP digital category");

requireText(importer, "RELEASECORE_M134_CATALOG_INTEGRITY", "import override marker");
requireText(importer, "normalizeShopifyDigitalProduct(admin, product.id, { title })", "import must normalize Shopify product");
requireText(importer, "        title,", "Single import must use the override/final title");

if (products.includes("referencesToAdd: [productId]")) {
  failures.push("legacy Shopify Files reference-only artwork path must be removed");
}

if (failures.length) {
  console.error("ReleaseCore M13.4 digital catalog validation failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("ReleaseCore M13.4 digital catalog validation passed.");
