#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    failures.push(`Missing ${rel}`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function expect(rel, needle, label = needle) {
  if (!read(rel).includes(needle)) failures.push(`${rel}: missing ${label}`);
}

expect("prisma/schema.prisma", "emailDeliveryProvider", "emailDeliveryProvider field");
expect("prisma/schema.prisma", "resendApiKeyEncrypted", "encrypted Resend API key field");
expect(
  "prisma/migrations/20260904230000_resend_email_delivery/migration.sql",
  '"emailDeliveryProvider"',
  "Resend migration",
);
expect("app/lib/resend.server.js", "https://api.resend.com/emails", "Resend Email API endpoint");
expect("app/lib/resend.server.js", "Authorization: `Bearer ${apiKey}`", "Bearer API authentication");
expect("app/lib/resend.server.js", "reply_to", "Reply-To support");
expect("app/lib/email-delivery.server.js", "sendAutomationEmail", "provider dispatcher");
expect("app/lib/email-delivery.server.js", "EMAIL_DELIVERY_PROVIDERS.RESEND", "Resend dispatch");
expect("app/lib/automation-settings.server.js", "encryptResendApiKey", "encrypted Resend settings persistence");
expect("app/lib/automation-settings.server.js", "resendApiKeyStored", "stored API key indicator");
expect("app/lib/automation-settings.server.js", 'intent === "test-email-provider"', "provider-aware connection test");
expect("app/lib/automations.server.js", "sendAutomationEmail", "workflow provider dispatch");
expect("app/routes/app.automation.jsx", "RELEASECORE_RESEND_API_V100", "Resend Automation UI marker");
expect("app/routes/app.automation.jsx", "Resend API (recommended)", "Resend provider selector");
expect("app/routes/app.automation.jsx", "resendApiKey", "Resend API key form");
expect("app/routes/app.automation.jsx", "Enable email delivery", "generic email enable toggle");
expect("app/routes/app.automation.jsx", 'form.set("intent", "test-email-provider")', "provider-aware test action");

if (failures.length) {
  console.error("ReleaseCore Resend API v1.0.0 validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ReleaseCore Resend API v1.0.0 validation passed.");
