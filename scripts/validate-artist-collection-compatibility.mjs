import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const target = path.join(
  root,
  "app/lib/shopify-artist-collections.server.js",
);

let failed = false;

function fail(message) {
  failed = true;
  console.error(
    `ReleaseCore artist collection compatibility validation failed: ${message}`,
  );
}

if (!fs.existsSync(target)) {
  fail("app/lib/shopify-artist-collections.server.js is missing.");
} else {
  const source = fs.readFileSync(target, "utf8");

  if (
    !source.includes(
      'import { deploymentProfileId } from "./deployment-profile.server";',
    )
  ) {
    fail("deployment profile detection is not imported.");
  }

  if (
    !source.includes(
      'deploymentProfileId() === "east-rock"',
    )
  ) {
    fail("East Rock-only legacy collection mapping is missing.");
  }

  if (
    !source.includes(
      'value: "Artist"',
    )
  ) {
    fail('East Rock custom.collection_type is not written as "Artist".');
  }

  const customBlock =
    /namespace:\s*"custom"[\s\S]{0,160}?key:\s*"collection_type"[\s\S]{0,160}?value:\s*"Artist"/m;

  if (!customBlock.test(source)) {
    fail(
      'custom.collection_type is not mapped to the allowed East Rock choice "Artist".',
    );
  }

  const canonicalBlock =
    /namespace:\s*"releasecore"[\s\S]{0,160}?key:\s*"collection_type"[\s\S]{0,160}?value:\s*"artist"/m;

  if (!canonicalBlock.test(source)) {
    fail(
      'Canonical releasecore.collection_type must remain lowercase "artist".',
    );
  }

  if (
    source.includes(
      'namespace: "custom",\n        key: "collection_type",\n        type: "single_line_text_field",\n        value: "artist"',
    )
  ) {
    fail(
      "The invalid lowercase East Rock custom.collection_type mapping is still present.",
    );
  }
}

if (failed) process.exit(1);

console.log(
  "ReleaseCore artist collection compatibility validation passed.",
);
