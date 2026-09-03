import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function fail(message) {
  console.error(`ReleaseCore East Rock launch gate failed: ${message}`);
  process.exit(1);
}

function read(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) fail(`${relative} is missing.`);
  return fs.readFileSync(file, "utf8");
}

function tomlString(source, key) {
  return source.match(
    new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"),
  )?.[1] || null;
}

const profile = JSON.parse(read("deployments/east-rock.profile.json"));
if (
  profile?.id !== "east-rock" ||
  profile?.distribution !== "single_merchant"
) {
  fail("East Rock deployment profile is not single_merchant.");
}

if (
  profile?.compatibility?.productMetafields !==
  "east-rock-custom-v1"
) {
  fail("East Rock legacy storefront metafield bridge is not enabled.");
}

const eastRockConfig = read("shopify.app.east-rock.toml");
const genericConfig = read("shopify.app.releasecore.toml");

const eastRockClientId = tomlString(eastRockConfig, "client_id");
const genericClientId = tomlString(genericConfig, "client_id");

if (!eastRockClientId || eastRockClientId === genericClientId) {
  fail("East Rock must use its own Shopify app/client ID.");
}

const name = tomlString(eastRockConfig, "name");
if (!/East Rock/i.test(name || "")) {
  fail("East Rock Shopify config does not identify the East Rock app.");
}

const appUrl = tomlString(eastRockConfig, "application_url");
if (
  !appUrl ||
  !/^https:\/\//i.test(appUrl) ||
  /localhost|127\.0\.0\.1|trycloudflare\.com/i.test(appUrl)
) {
  fail("East Rock application_url must be a permanent HTTPS production URL.");
}

for (const required of [
  "read_orders",
  "write_orders",
  "read_products",
  "write_products",
  "read_files",
  "write_files",
]) {
  if (!eastRockConfig.includes(required)) {
    fail(`East Rock Shopify config is missing required scope ${required}.`);
  }
}

const schema = read("prisma/schema.prisma");
for (const field of [
  "preOrderDate",
  "exclusivePartner",
  "releaseTime",
]) {
  if (!schema.includes(field)) {
    fail(`Release timeline field ${field} is missing.`);
  }
}

if (process.env.RELEASECORE_LAUNCH_STRICT === "1") {
  const expected = {
    RELEASECORE_DEPLOYMENT_PROFILE: "east-rock",
    RELEASECORE_APP_DISTRIBUTION: "single_merchant",
  };

  for (const [key, value] of Object.entries(expected)) {
    if (process.env[key] !== value) {
      fail(`${key} must equal ${value} in the East Rock production service.`);
    }
  }

  for (const key of [
    "SHOPIFY_API_KEY",
    "SHOPIFY_API_SECRET",
    "SHOPIFY_APP_URL",
    "DATABASE_URL",
  ]) {
    if (!String(process.env[key] || "").trim()) {
      fail(`${key} is missing from the East Rock production environment.`);
    }
  }

  if (process.env.SHOPIFY_API_KEY !== eastRockClientId) {
    fail("SHOPIFY_API_KEY does not match shopify.app.east-rock.toml.");
  }

  if (
    String(process.env.SHOPIFY_APP_URL || "").replace(/\/+$/, "") !==
    appUrl.replace(/\/+$/, "")
  ) {
    fail("SHOPIFY_APP_URL does not match the East Rock Shopify configuration.");
  }
}

console.log("ReleaseCore East Rock launch gate passed.");
