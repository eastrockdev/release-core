import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(
  root,
  "app",
  "lib",
  "customer-downloads.server.js",
);

let failed = false;

function fail(message) {
  failed = true;
  console.error(
    `ReleaseCore customer metadata validation failed: ${message}`,
  );
}

if (!fs.existsSync(sourcePath)) {
  fail("app/lib/customer-downloads.server.js is missing.");
} else {
  const source = fs.readFileSync(sourcePath, "utf8");

  for (const marker of [
    "generatorVersion: 2",
    "release_date:",
    "track_number:",
    "track_total:",
    "disc:",
    "disc_number:",
    "disc_total:",
    "content_advisory:",
    "itunes_advisory:",
    "release_type:",
    "barcode:",
    "publisher:",
    "organization:",
    "comment:",
    "distribution_service:",
    "media_type:",
    '"TRACKTOTAL"',
    '"DISCNUMBER"',
    '"DISCTOTAL"',
    '"CONTENTADVISORY"',
    '"ITUNESADVISORY"',
    '"RELEASEDATE"',
    '"RELEASETYPE"',
    '"BARCODE"',
    '"ORGANIZATION"',
    '"DISTRIBUTEDBY"',
    "stageArtwork",
    'cover.storageProvider === "R2"',
    'cover.storageProvider === "LOCAL_DEV"',
    "copyFile(",
    "encoding_settings=",
    "file_format=",
    '"attached_pic"',
  ]) {
    if (!source.includes(marker)) {
      fail(`customer derivative generator is missing ${marker}.`);
    }
  }

  for (const privateMarker of [
    "metadata.ipi",
    "metadata.pro",
    "metadata.email",
    "metadata.ownership",
  ]) {
    if (source.includes(privateMarker)) {
      fail(
        `private rights/customer data must not be embedded (${privateMarker}).`,
      );
    }
  }
}

if (failed) process.exit(1);

console.log("ReleaseCore customer metadata validation passed.");
