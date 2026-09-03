#!/usr/bin/env node
import process from "node:process";

const PROFILES = {
  releasecore: {
    label: "ReleaseCore",
    url: "https://releasecore-web-production.up.railway.app",
  },
  "east-rock": {
    label: "ReleaseCore — East Rock",
    url: "https://releasecore-er-production.up.railway.app",
  },
};

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const profileId = String(
  argValue("--profile") ||
    process.env.RELEASECORE_DEPLOYMENT_PROFILE ||
    "releasecore",
)
  .trim()
  .toLowerCase();

if (!PROFILES[profileId]) {
  console.error(
    "ReleaseCore production verification requires --profile releasecore or --profile east-rock.",
  );
  process.exit(1);
}

const profile = PROFILES[profileId];
const baseUrl = String(
  process.env.RELEASECORE_PRODUCTION_URL ||
    profile.url,
).replace(/\/$/, "");
const timeoutMs = Number(
  process.env.RELEASECORE_PRODUCTION_TIMEOUT_MS ||
    15000,
);
const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
  console.error(`✗ ${message}`);
}

function pass(message) {
  console.log(`✓ ${message}`);
}

function warn(message) {
  warnings.push(message);
  console.warn(`! ${message}`);
}

async function request(pathname, options = {}) {
  const url = new URL(pathname, `${baseUrl}/`);
  try {
    return await fetch(url, {
      redirect: options.redirect || "follow",
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(
      `${url}: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }
}

async function expectPage(pathname, markers, label) {
  let response;
  try {
    response = await request(pathname);
  } catch (error) {
    fail(`${label} could not be reached (${error.message}).`);
    return null;
  }

  if (response.status !== 200) {
    fail(
      `${label} returned HTTP ${response.status}; expected 200.`,
    );
    return null;
  }

  const body = await response.text();

  for (const marker of markers) {
    if (!body.includes(marker)) {
      fail(
        `${label} is missing expected production content: ${marker}.`,
      );
    }
  }

  for (const forbidden of [
    "example.com",
    "localhost",
    "trycloudflare.com",
    "ngrok-free.app",
  ]) {
    if (body.includes(forbidden)) {
      fail(
        `${label} exposes development/example content (${forbidden}).`,
      );
    }
  }

  pass(`${label} is live over HTTPS.`);
  return body;
}

async function expectInvalidWebhook401(
  pathname,
  topic,
  label,
) {
  let response;
  try {
    response = await request(pathname, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": topic,
        "x-shopify-shop-domain":
          "releasecore-invalid-signature.myshopify.com",
        "x-shopify-webhook-id":
          "00000000-0000-0000-0000-000000000000",
        "x-shopify-hmac-sha256":
          "invalid-releasecore-production-smoke-signature",
      },
      body: JSON.stringify({
        shop_domain:
          "releasecore-invalid-signature.myshopify.com",
      }),
    });
  } catch (error) {
    fail(`${label} could not be reached (${error.message}).`);
    return;
  }

  if (response.status !== 401) {
    fail(
      `${label} returned HTTP ${response.status} for an invalid Shopify HMAC; expected 401.`,
    );
    return;
  }

  pass(
    `${label} rejects invalid Shopify HMAC signatures with 401.`,
  );
}

console.log(
  `ReleaseCore production verification\nProfile: ${profile.label}\nTarget: ${baseUrl}\n`,
);

if (!baseUrl.startsWith("https://")) {
  fail("Production URL must use HTTPS.");
}

if (baseUrl !== profile.url) {
  warn(
    `Using RELEASECORE_PRODUCTION_URL override instead of canonical ${profile.url}.`,
  );
}

const home = await expectPage(
  "/",
  ["ReleaseCore", "Privacy policy", "Support"],
  "Public home",
);
if (home && /name=["']shop["']/.test(home)) {
  fail(
    "Public home still contains a manual Shopify shop-domain input.",
  );
}

await expectPage(
  "/privacy-policy",
  [
    "Privacy policy",
    "Retention, deletion, and privacy requests",
  ],
  "Privacy policy",
);

const support = await expectPage(
  "/support",
  ["Get help with ReleaseCore", "Privacy policy"],
  "Support page",
);
if (support && !support.includes("mailto:")) {
  warn(
    "The public support page has no direct mailto link. Confirm the listing support email is configured and monitored.",
  );
}

const authLogin = await expectPage(
  "/auth/login",
  [
    "Open ReleaseCore from Shopify",
    "does not accept manually entered shop domains",
  ],
  "Shopify-owned install guidance",
);
if (
  authLogin &&
  /name=["']shop["']/.test(authLogin)
) {
  fail(
    "Auth login route contains a manual shop-domain input.",
  );
}

await expectInvalidWebhook401(
  "/webhooks/compliance",
  "customers/data_request",
  "Compliance webhook",
);
await expectInvalidWebhook401(
  "/webhooks/app/uninstalled",
  "app/uninstalled",
  "Uninstall webhook",
);

console.log("\nManual production checks still required:");
console.log(
  "- Validate production environment variables on the deployed Railway service.",
);
console.log(
  "- Confirm the released Shopify app version contains all expected subscriptions and scopes.",
);
console.log(
  "- Trigger signed compliance webhooks with Shopify CLI.",
);
console.log(
  "- Perform a fresh-store install/reinstall and 65+ minute idle uninstall test.",
);
console.log(
  "- Verify Chrome incognito embedded-app usage and Storefront Theme Editor deep links.",
);
if (profileId === "releasecore") {
  console.log(
    "- Confirm protected customer data approval, support contacts, listing media, screencast, pricing, and reviewer credentials in Shopify Dev Dashboard.",
  );
}

if (warnings.length) {
  console.log(
    `\n${warnings.length} warning(s) require manual confirmation.`,
  );
}

if (failures.length) {
  console.error(
    `\nReleaseCore ${profileId} production verification failed with ${failures.length} issue(s).`,
  );
  process.exit(1);
}

console.log(
  `\nReleaseCore ${profileId} production endpoint verification passed.`,
);
