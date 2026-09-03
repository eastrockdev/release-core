import process from "node:process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
let failed = false;

function fail(message) {
  failed = true;
  console.error(
    `ReleaseCore deployment-profile validation failed: ${message}`,
  );
}

function read(relative) {
  return fs.readFileSync(
    path.join(root, relative),
    "utf8",
  );
}

function exists(relative) {
  return fs.existsSync(
    path.join(root, relative),
  );
}

for (const relative of [
  "deployments/releasecore.profile.json",
  "deployments/east-rock.profile.json",
  "app/lib/deployment-profile.server.js",
  "scripts/releasecore-deployment-profile.mjs",
  "app/shopify.server.js",
]) {
  if (!exists(relative)) {
    fail(`${relative} is missing.`);
  }
}

if (
  exists(
    "deployments/releasecore.profile.json",
  )
) {
  const profile =
    JSON.parse(
      read(
        "deployments/releasecore.profile.json",
      ),
    );

  if (
    profile.id !==
      "releasecore" ||
    profile.distribution !==
      "app_store"
  ) {
    fail(
      "Generic ReleaseCore profile must remain App Store distribution.",
    );
  }
}

if (
  exists(
    "deployments/east-rock.profile.json",
  )
) {
  const profile =
    JSON.parse(
      read(
        "deployments/east-rock.profile.json",
      ),
    );

  if (
    profile.id !==
      "east-rock" ||
    profile.distribution !==
      "single_merchant"
  ) {
    fail(
      "East Rock profile must use SingleMerchant/custom distribution.",
    );
  }

  for (const marker of [
    "East Rock Entertainment",
    "Record Label In-A-Box",
    "RLIAB",
  ]) {
    if (
      !JSON.stringify(
        profile,
      ).includes(
        marker,
      )
    ) {
      fail(
        `East Rock profile is missing ${marker}.`,
      );
    }
  }
}

if (
  exists(
    "app/shopify.server.js",
  )
) {
  const source =
    read(
      "app/shopify.server.js",
    );

  for (const marker of [
    "RELEASECORE_APP_DISTRIBUTION",
    "AppDistribution.SingleMerchant",
    "AppDistribution.AppStore",
    "releaseCoreDistribution",
  ]) {
    if (
      !source.includes(
        marker,
      )
    ) {
      fail(
        `shopify.server.js is missing ${marker}.`,
      );
    }
  }

  if (
    source.includes(
      "distribution: AppDistribution.AppStore,",
    )
  ) {
    fail(
      "Shopify backend is still hard-coded to AppStore distribution.",
    );
  }
}

if (
  exists(
    "package.json",
  )
) {
  const pkg =
    JSON.parse(
      read(
        "package.json",
      ),
    );

  for (const script of [
    "profile:east-rock",
    "profile:releasecore",
    "check:deployment-profile",
  ]) {
    if (
      !pkg.scripts?.[script]
    ) {
      fail(
        `package.json is missing ${script}.`,
      );
    }
  }

  if (
    !String(
      pkg.scripts?.check ||
        "",
    ).includes(
      "npm run check:deployment-profile",
    )
  ) {
    fail(
      "Full check chain is missing deployment-profile validation.",
    );
  }
}

if (failed) process.exit(1);

console.log(
  "ReleaseCore deployment-profile validation passed.",
);
