#!/usr/bin/env node
import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  return fs.readFileSync(path, "utf8");
}

const schema = read("prisma/schema.prisma");
const editor = read(
  "app/routes/app.release_.$releaseId.track.$trackId.jsx",
);
const action = read(
  "app/lib/api-releases-release-action.server.js",
);
const bulk = read(
  "app/lib/bulk-track-edit.server.js",
);
const bulkEditor = read(
  "app/routes/app.release_.$releaseId.tracks.bulk.jsx",
);
const isrc = read("app/lib/isrc.server.js");
const m16 = read(
  "scripts/validate-m16.3-editor-consistency.mjs",
);
const m1721 = read(
  "scripts/validate-m17.2.1-inline-identities.mjs",
);
const migration = read(
  "prisma/migrations/20260904193000_m17_3_1_track_metadata_version/migration.sql",
);
const pkg = JSON.parse(read("package.json"));

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) {
    failures.push(message);
  }
};

if (
  !/\bmetadataVersion\s+Int\s+@default\(0\)/.test(schema)
) {
  failures.push(
    "Track schema is missing metadataVersion Int @default(0).",
  );
}
need(
  migration,
  'ADD COLUMN "metadataVersion" INTEGER NOT NULL DEFAULT 0',
  "Track metadata-version migration is incomplete.",
);

for (const marker of [
  "expectedTrackMetadataVersion",
  "track.metadataVersion",
  "String(track.metadataVersion ?? 0)",
]) {
  need(
    editor,
    marker,
    `Edit Track Info is missing ${marker}.`,
  );
}

need(
  action,
  "expectedTrackMetadataVersion:",
  "Release API does not forward the Track metadata version.",
);

for (const marker of [
  "validExpectedTrackMetadataVersion",
  "expectedTrackMetadataVersion = null",
  "metadataVersion: expectedTrackVersion",
  "metadataVersion: { increment: 1 }",
  "expectedTrackVersion !== null",
  "normalized.length === 1",
]) {
  need(
    bulk,
    marker,
    `Track metadata concurrency service is missing ${marker}.`,
  );
}

if (
  bulk.includes("expectedTrackUpdatedAt") ||
  editor.includes("expectedTrackUpdatedAt")
) {
  failures.push(
    "Legacy Track.updatedAt optimistic-concurrency tokens still exist in the dedicated Track save path.",
  );
}

need(
  bulkEditor,
  '.map((track) => `${track.id}:${track.updatedAt}`)',
  "Bulk editor form identity must remain Track.updatedAt-based.",
);
need(
  bulkEditor,
  "expectedReleaseUpdatedAt",
  "Bulk editor must retain release-scoped optimistic concurrency.",
);

for (const marker of [
  "metadataVersion: { increment: 1 }",
  "assignIsrcToTrack",
  "assignManualIsrcToTrack",
  "correctIsrcForTrack",
]) {
  need(
    isrc,
    marker,
    `ISRC mutation path is missing ${marker}.`,
  );
}

for (const [source, label] of [
  [m16, "M16.3 validator"],
  [m1721, "M17.2.1 validator"],
]) {
  need(
    source,
    "expectedTrackMetadataVersion",
    `${label} still expects the old Track.updatedAt token.`,
  );
  need(
    source,
    "metadataVersion",
    `${label} does not validate metadata-scoped concurrency.`,
  );
}

if (
  pkg?.scripts?.["check:m17.3.1"] !==
  "node scripts/validate-m17.3.1-track-metadata-concurrency.mjs"
) {
  failures.push(
    "package.json is missing check:m17.3.1.",
  );
}

if (
  !String(pkg?.scripts?.check || "").includes(
    "npm run check:m17.3.1",
  )
) {
  failures.push(
    "Full npm run check does not include M17.3.1.",
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M17.3.1 Track metadata concurrency validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M17.3.1 metadata-scoped Track concurrency validation passed.",
);
