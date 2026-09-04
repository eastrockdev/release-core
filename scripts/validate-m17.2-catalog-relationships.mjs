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
  "prisma/migrations/20260904153000_m17_2_catalog_relationships/migration.sql",
);
const shared = read(
  "app/lib/catalog-relationships.js",
);
const service = read(
  "app/lib/catalog-relationships.server.js",
);
const api = read(
  "app/routes/api.release-relationships.$releaseId.jsx",
);
const page = read(
  "app/routes/app.release_.$releaseId.relationships.jsx",
);
const releaseWorkspace = read(
  "app/routes/app.release.$releaseId.jsx",
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
  "model ReleaseRelationship {",
  "model TrackRelationship {",
  'catalogRelationships ReleaseRelationship[] @relation("ReleaseRelationshipRelease")',
  'catalogBacklinks',
  '@relation("ReleaseRelationshipRelated")',
  'recordingRelationships TrackRelationship[] @relation("TrackRelationshipTrack")',
  'recordingBacklinks',
  '@relation("TrackRelationshipRelatedTrack")',
  "@@unique([shop, releaseId, relatedReleaseId])",
  "@@unique([releaseRelationshipId, trackId])",
]) {
  need(
    schema,
    marker,
    `Catalog relationship schema is missing ${marker}.`,
  );
}

for (const marker of [
  'CREATE TABLE "ReleaseRelationship"',
  'CREATE TABLE "TrackRelationship"',
  '"ReleaseRelationship_shop_releaseId_relatedReleaseId_key"',
  '"TrackRelationship_releaseRelationshipId_trackId_key"',
  '"ReleaseRelationship_relatedReleaseId_fkey"',
  '"TrackRelationship_relatedTrackId_fkey"',
]) {
  need(
    migration,
    marker,
    `M17.2 migration is missing ${marker}.`,
  );
}

for (const marker of [
  "DELUXE_OF",
  "EXPANDED_OF",
  "REMASTER_OF",
  "CLEAN_VERSION_OF",
  "EXPLICIT_VERSION_OF",
  "INSTRUMENTAL_OF",
  "REISSUE_OF",
  "ANNIVERSARY_OF",
  "REMIX_OF",
  "SAME_RECORDING",
  "NEW_RECORDING",
  "recordingLineageStatus",
  "ReleaseCore will not copy it automatically",
]) {
  need(
    shared,
    marker,
    `Catalog relationship definitions are missing ${marker}.`,
  );
}

for (const marker of [
  "createCatalogRelationship",
  "updateCatalogRelationship",
  "deleteCatalogRelationship",
  "setTrackRecordingRelationship",
  "deleteTrackRecordingRelationship",
  "loadCatalogRelationshipWorkspace",
  "seedTrackLineage",
  "direct catalog cycle",
  "skipDuplicates",
  "CATALOG_RELATIONSHIP_ADDED",
  "RECORDING_LINEAGE_UPDATED",
]) {
  need(
    service,
    marker,
    `Catalog relationship service is missing ${marker}.`,
  );
}

for (const marker of [
  'intent === "add-relationship"',
  'intent === "update-relationship"',
  'intent === "remove-relationship"',
  'intent === "set-track-lineage"',
  'intent === "remove-track-lineage"',
  "authenticate.admin",
]) {
  need(
    api,
    marker,
    `Catalog relationship API is missing ${marker}.`,
  );
}

for (const marker of [
  'heading="Catalog Relationships"',
  "Catalog relationships & editions",
  "Recording lineage",
  "Derived releases",
  "/api/release-relationships/",
  "recordingLineageStatus",
  "candidateCapped",
]) {
  need(
    page,
    marker,
    `Catalog relationships page is missing ${marker}.`,
  );
}

for (const marker of [
  "Catalog relationships",
  "/relationships",
]) {
  need(
    releaseWorkspace,
    marker,
    `Release workspace is missing ${marker}.`,
  );
}

for (const marker of [
  ".rc-catalog-relation-card",
  ".rc-lineage-row",
  ".rc-catalog-source-search",
  ".rc-catalog-backlink",
]) {
  need(
    css,
    marker,
    `M17.2 CSS is missing ${marker}.`,
  );
}

if (
  pkg?.scripts?.["check:m17.2"] !==
  "node scripts/validate-m17.2-catalog-relationships.mjs"
) {
  failures.push(
    "package.json is missing check:m17.2.",
  );
}

if (
  !String(pkg?.scripts?.check || "").includes(
    "npm run check:m17.2",
  )
) {
  failures.push(
    "Full npm run check does not include M17.2.",
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M17.2 catalog relationships / recording lineage validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M17.2 catalog relationships / recording-lineage validation passed.",
);
