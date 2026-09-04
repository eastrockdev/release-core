#!/usr/bin/env node
import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, "utf8");
}

const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/20260904050000_m16_6_data_hygiene/migration.sql");
const service = read("app/lib/data-hygiene.server.js");
const api = read("app/routes/api.data-hygiene.jsx");
const ui = read("app/routes/app.data-hygiene.jsx");
const settingsHub = read("app/routes/app.settings.jsx");
const artist = read("app/routes/app.artist.$artistId.jsx");
const contributor = read("app/routes/app.contributor.$contributorId.jsx");
const css = read("app/styles/releasecore-admin.css");
const pkg = JSON.parse(read("package.json"));

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

need(schema, "relationshipType", "ArtistContributor is missing relationshipType.");
need(schema, "model DataMaintenanceEvent {", "Prisma schema is missing DataMaintenanceEvent.");
need(migration, 'ALTER TABLE "ArtistContributor"', "M16.6 migration does not add relationship type.");
need(migration, 'CREATE TABLE "DataMaintenanceEvent"', "M16.6 migration does not create the maintenance audit table.");

for (const marker of [
  "scanDataHygiene", "previewArtistMerge", "mergeArtistIntoArtist",
  "previewContributorMerge", "mergeContributorIntoContributor",
  "linkArtistContributorIdentity", "deleteUnusedArtist",
  "deleteUnusedContributor", "repairArtistNameCaches", "db.$transaction",
  "SAME_PERSON", "collectionResolution", "ownershipConflicts",
]) need(service, marker, `Data hygiene service is missing ${marker}.`);

for (const marker of [
  'intent === "merge-artist"', 'intent === "merge-contributor"',
  'intent === "link-same-person"', 'intent === "delete-unused-artist"',
  'intent === "delete-unused-contributor"', 'intent === "repair-artist-cache"',
]) need(api, marker, `Data hygiene API is missing ${marker}.`);

for (const marker of [
  'heading="Data Maintenance"', "Possible duplicate artists",
  "Possible duplicate contributors", "Artist ↔ contributor identity",
  "Ownership conflicts require a decision", "Safe cleanup",
  "Recent maintenance", "/api/data-hygiene",
]) need(ui, marker, `Data Maintenance UI is missing ${marker}.`);

need(settingsHub, "/app/data-hygiene", "Settings hub does not expose Data Maintenance.");
need(artist, "/app/data-hygiene?artistSource=", "Artist profile does not expose merge/data maintenance.");
need(contributor, "/app/data-hygiene?contributorSource=", "Contributor profile does not expose merge/data maintenance.");

for (const marker of [
  ".rc-hygiene-metrics", ".rc-hygiene-preview",
  ".rc-hygiene-credit-conflict", ".rc-hygiene-cleanup-grid",
]) need(css, marker, `M16.6 CSS is missing ${marker}.`);

if (pkg?.scripts?.["check:m16.6"] !== "node scripts/validate-m16.6-data-hygiene.mjs") {
  failures.push("package.json is missing check:m16.6.");
}
if (!String(pkg?.scripts?.check || "").includes("npm run check:m16.6")) {
  failures.push("Full npm run check does not include M16.6.");
}

if (failures.length) {
  console.error("ReleaseCore M16.6 data hygiene / identity maintenance validation failed:");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log("ReleaseCore M16.6 data hygiene / artist-contributor identity maintenance validation passed.");
