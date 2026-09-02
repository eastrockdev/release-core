#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fail = (message) => {
  console.error(`ReleaseCore compliance validation failed: ${message}`);
  process.exitCode = 1;
};

for (const configFile of ["shopify.app.toml", "shopify.app.releasecore.toml"]) {
  const toml = read(configFile);
  for (const topic of ["customers/data_request", "customers/redact", "shop/redact"]) {
    if (!toml.includes(topic)) fail(`${configFile} is missing mandatory compliance topic ${topic}.`);
  }
  if (!/scopes\s*=\s*"[^"]*\bread_customers\b/.test(toml)) {
    fail(`${configFile} must declare read_customers because ReleaseCore queries Shopify Customer data.`);
  }
  if (!toml.includes('uri = "/webhooks/compliance"')) fail(`${configFile} is missing the compliance webhook URI.`);
  if (!/api_version\s*=\s*"2026-07"/.test(toml)) fail(`${configFile} must remain on the stable 2026-07 webhook API version during M11.6.`);
}

const webhook = read("app/routes/webhooks.compliance.jsx");
for (const marker of ["authenticate.webhook", "enqueuePrivacyRequest", "processPrivacyRequestById"]) {
  if (!webhook.includes(marker)) fail(`compliance webhook handler is missing ${marker}.`);
}
if (/await\s+processPrivacyRequestById\s*\(/.test(webhook)) {
  fail("compliance webhook must acknowledge Shopify before long-running privacy processing completes.");
}
if (!webhook.includes("void processPrivacyRequestById")) {
  fail("compliance webhook must start durable privacy processing after enqueue without blocking the HTTP acknowledgement.");
}

const privacy = read("app/lib/privacy.server.js");
for (const marker of ["buildCustomerDataExport", "redactCustomer", "redactShop", "deleteMasterStorageObject"]) {
  if (!privacy.includes(marker)) fail(`privacy service is missing ${marker}.`);
}

const privacyTopics = read("app/lib/privacy.js");
for (const topic of ["customers/data_request", "customers/redact", "shop/redact"]) {
  if (!privacyTopics.includes(topic)) fail(`client-safe privacy topic constants are missing ${topic}.`);
}

const privacyRoute = read("app/routes/app.privacy.jsx");
if (/^import\s+.*privacy\.server/m.test(privacyRoute)) {
  fail("app.privacy.jsx must not statically import privacy.server because the route also renders in the client bundle.");
}
if (!privacyRoute.includes('from "../lib/privacy"')) {
  fail("app.privacy.jsx must read privacy topic constants from the client-safe privacy module.");
}

const shopifyServer = read("app/shopify.server.js");
if (!/expiringOfflineAccessTokens\s*:\s*true/.test(shopifyServer)) {
  fail("expiring offline access tokens must remain enabled for App Store distribution.");
}

const schema = read("prisma/schema.prisma");
if (!schema.includes("model PrivacyRequest")) fail("PrivacyRequest model is missing.");
if (!fs.existsSync(path.join(root, "prisma/migrations/20260902_privacy_compliance/migration.sql"))) {
  fail("privacy compliance migration is missing.");
}

if (!process.exitCode) console.log("ReleaseCore compliance validation passed.");
