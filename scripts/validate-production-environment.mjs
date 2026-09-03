#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function readJson(rel) {
  return JSON.parse(
    fs.readFileSync(path.join(root, rel), "utf8"),
  );
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function tomlString(source, key) {
  return (
    source.match(
      new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"),
    )?.[1] || null
  );
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const requestedProfile =
  argValue("--profile") ||
  process.env.RELEASECORE_DEPLOYMENT_PROFILE ||
  "";

const profileId = String(requestedProfile)
  .trim()
  .toLowerCase();

if (!["releasecore", "east-rock"].includes(profileId)) {
  console.error(
    "ReleaseCore production environment validation failed: choose --profile releasecore or --profile east-rock, or set RELEASECORE_DEPLOYMENT_PROFILE.",
  );
  process.exit(1);
}

const profile = readJson(
  profileId === "east-rock"
    ? "deployments/east-rock.profile.json"
    : "deployments/releasecore.profile.json",
);
const config = read(profile.shopifyConfigFile);

const expected = {
  RELEASECORE_DEPLOYMENT_PROFILE: profile.id,
  RELEASECORE_APP_DISTRIBUTION: profile.distribution,
  SHOPIFY_API_KEY: tomlString(config, "client_id"),
  SHOPIFY_APP_URL: tomlString(config, "application_url"),
};

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

if (process.env.NODE_ENV !== "production") {
  fail("NODE_ENV must equal production.");
}

for (const [key, value] of Object.entries(expected)) {
  if (String(process.env[key] || "").trim() !== String(value || "")) {
    fail(`${key} must equal ${value}.`);
  }
}

for (const key of [
  "SHOPIFY_API_SECRET",
  "DATABASE_URL",
  "RELEASECORE_ENCRYPTION_KEY",
]) {
  if (!String(process.env[key] || "").trim()) {
    fail(`${key} is missing.`);
  }
}

const storageMode = String(
  process.env.RELEASECORE_MASTER_STORAGE || "",
)
  .trim()
  .toUpperCase();

if (storageMode !== "R2") {
  fail("RELEASECORE_MASTER_STORAGE must equal R2 in production.");
}

for (const key of [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
]) {
  if (!String(process.env[key] || "").trim()) {
    fail(`${key} is missing for R2 master storage.`);
  }
}

if (!String(process.env.RELEASECORE_SUPPORT_EMAIL || "").trim()) {
  warn(
    "RELEASECORE_SUPPORT_EMAIL is not set; the public support page may rely only on listing support contact information.",
  );
}

if (profileId === "east-rock") {
  if (
    String(process.env.SHOPIFY_APP_URL || "").replace(/\/+$/, "") !==
    "https://releasecore-er-production.up.railway.app"
  ) {
    fail("East Rock production service is not using the canonical Railway URL.");
  }
} else if (
  String(process.env.SHOPIFY_APP_URL || "").replace(/\/+$/, "") !==
  "https://releasecore-web-production.up.railway.app"
) {
  fail("Generic ReleaseCore production service is not using the canonical Railway URL.");
}

if (warnings.length) {
  console.warn("\nReleaseCore production environment warnings:");
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (failures.length) {
  console.error("\nReleaseCore production environment validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `ReleaseCore ${profileId} production environment validation passed${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.`,
);
