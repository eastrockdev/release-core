#!/usr/bin/env node
import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  return fs.readFileSync(path, "utf8");
}

const schema = read("prisma/schema.prisma");
const migration = read(
  "prisma/migrations/20260904180000_m17_3_delivery_plans/migration.sql",
);
const definitions = read(
  "app/lib/delivery-plan.js",
);
const service = read(
  "app/lib/delivery-plan.server.js",
);
const api = read(
  "app/routes/api.delivery-plan.$releaseId.jsx",
);
const page = read(
  "app/routes/app.distribution_.$releaseId.delivery-plan.jsx",
);
const distribution = read(
  "app/routes/app.distribution_.$releaseId.jsx",
);
const css = read(
  "app/styles/releasecore-admin.css",
);
const pkg = JSON.parse(read("package.json"));

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) {
    failures.push(message);
  }
};

for (const marker of [
  "model ReleaseDeliveryPlan {",
  "model ReleaseDeliveryChannel {",
  "deliveryPlan",
  "@@unique([planId, channelKey])",
  "@@index([shop, updatedAt])",
]) {
  need(
    schema,
    marker,
    `M17.3 schema is missing ${marker}.`,
  );
}

for (const marker of [
  'CREATE TABLE "ReleaseDeliveryPlan"',
  'CREATE TABLE "ReleaseDeliveryChannel"',
  '"ReleaseDeliveryPlan_releaseId_key"',
  '"ReleaseDeliveryChannel_planId_channelKey_key"',
  '"ReleaseDeliveryPlan_releaseId_fkey"',
]) {
  need(
    migration,
    marker,
    `M17.3 migration is missing ${marker}.`,
  );
}

for (const marker of [
  "ALL",
  "INCLUDE_ONLY",
  "EXCLUDE",
  "SOCIAL_ONLY",
  "WORLDWIDE",
  "INCLUDE",
  "EXCLUDE",
  "TikTok",
  "Instagram / Facebook",
  "YouTube Content ID",
  "TERRITORIES",
  "baseChannelEnabled",
]) {
  need(
    definitions,
    marker,
    `Delivery-plan definitions are missing ${marker}.`,
  );
}

for (const marker of [
  "buildEffectiveDeliveryPlan",
  "loadReleaseDeliveryPlan",
  "saveReleaseDeliveryPlan",
  "saveReleaseDeliveryChannel",
  "removeReleaseDeliveryChannel",
  "serializeDeliveryPlanForExport",
  "DELIVERY_PLAN_UPDATED",
  "DELIVERY_CHANNEL_UPDATED",
  "exclusiveHoldback",
  'availability:',
  'exclusiveEnabled:',
]) {
  need(
    service,
    marker,
    `Delivery-plan service is missing ${marker}.`,
  );
}

for (const marker of [
  'intent === "save-plan"',
  'intent === "save-channel"',
  'intent === "remove-channel"',
  "authenticate.admin",
]) {
  need(
    api,
    marker,
    `Delivery-plan API is missing ${marker}.`,
  );
}

for (const marker of [
  'heading="Delivery Plan"',
  "Advanced store & territory availability",
  "Platform availability",
  "Territory availability",
  "Exclusive window",
  "Store-specific release date",
  "Platform exceptions",
  "/api/delivery-plan/",
]) {
  need(
    page,
    marker,
    `Delivery-plan page is missing ${marker}.`,
  );
}

need(
  distribution,
  "Delivery plan",
  "Distribution workspace does not link to Delivery Plan.",
);
need(
  distribution,
  "/delivery-plan",
  "Distribution workspace Delivery Plan route is missing.",
);

for (const marker of [
  ".rc-delivery-plan-form",
  ".rc-delivery-channel-grid",
  ".rc-delivery-exception-form",
  ".rc-delivery-exception-row",
]) {
  need(
    css,
    marker,
    `M17.3 CSS is missing ${marker}.`,
  );
}

if (
  pkg?.scripts?.["check:m17.3"] !==
  "node scripts/validate-m17.3-delivery-plans.mjs"
) {
  failures.push(
    "package.json is missing check:m17.3.",
  );
}

if (
  !String(pkg?.scripts?.check || "").includes(
    "npm run check:m17.3",
  )
) {
  failures.push(
    "Full npm run check does not include M17.3.",
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M17.3 advanced delivery-plan validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M17.3 advanced store / territory delivery-plan validation passed.",
);
