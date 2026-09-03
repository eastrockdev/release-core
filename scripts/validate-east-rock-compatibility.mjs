import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
let failed = false;

const exists = (relative) =>
  fs.existsSync(
    path.join(
      root,
      relative,
    ),
  );

const read = (relative) =>
  fs.readFileSync(
    path.join(
      root,
      relative,
    ),
    "utf8",
  );

const fail = (message) => {
  failed = true;
  console.error(
    `ReleaseCore East Rock compatibility validation failed: ${message}`,
  );
};

for (const relative of [
  "app/lib/east-rock-compatibility.server.js",
  "app/lib/shopify-products.server.js",
  "deployments/east-rock.profile.json",
]) {
  if (!exists(relative)) {
    fail(
      `${relative} is missing.`,
    );
  }
}

if (
  exists(
    "app/lib/east-rock-compatibility.server.js",
  )
) {
  const source =
    read(
      "app/lib/east-rock-compatibility.server.js",
    );

  for (const marker of [
    "deploymentProfileId",
    'namespace: "custom"',
    "buildEastRockTrackProductMetafields",
    "eastRockDistributionStatusValue",
    '"Pending Review"',
    '"In-Review"',
    '"Submitted"',
    '"Rejected"',
    '"Approved"',
    '"Live"',
    '"Takedown"',
    '"Copyright"',
    '"download_format"',
    '"audio_preview"',
    '"artist_primary"',
    '"artist_featured"',
    '"release_date"',
    '"release_type"',
    '"release_upc"',
    '"single_isrc"',
    '"song_producer"',
    '"streaming_url"',
    '"track_album_order_number"',
  ]) {
    if (
      !source.includes(
        marker,
      )
    ) {
      fail(
        `compatibility service is missing ${marker}.`,
      );
    }
  }
}

if (
  exists(
    "app/lib/shopify-products.server.js",
  )
) {
  const source =
    read(
      "app/lib/shopify-products.server.js",
    );

  for (const marker of [
    "buildEastRockTrackProductMetafields",
    "...buildEastRockTrackProductMetafields",
  ]) {
    if (
      !source.includes(
        marker,
      )
    ) {
      fail(
        `Shopify track product sync is missing ${marker}.`,
      );
    }
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
    profile?.id !==
    "east-rock"
  ) {
    fail(
      "East Rock deployment profile is invalid.",
    );
  }

  if (
    profile?.compatibility?.productMetafields !==
    "east-rock-custom-v1"
  ) {
    fail(
      "East Rock deployment profile does not enable legacy product metafield compatibility.",
    );
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  "ReleaseCore East Rock compatibility validation passed.",
);
