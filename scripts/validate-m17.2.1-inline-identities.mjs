#!/usr/bin/env node
import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  return fs.readFileSync(path, "utf8");
}

const inline = read(
  "app/lib/inline-track-identities.server.js",
);
const action = read(
  "app/lib/api-releases-release-action.server.js",
);
const editor = read(
  "app/routes/app.release_.$releaseId.track.$trackId.jsx",
);
const bulk = read(
  "app/lib/bulk-track-edit.server.js",
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
  "createAndAssignTrackArtist",
  "createAndCreditTrackContributor",
  "ARTIST_ALREADY_EXISTS",
  "CONTRIBUTOR_ALREADY_EXISTS",
  "Switch to Existing artist",
  "Switch to Existing contributor",
  "tx.artist.create",
  "tx.contributor.create",
  "tx.trackArtist.create",
  "tx.trackCredit.create",
  "TRACK_ARTIST_CREATED_INLINE",
  "TRACK_CONTRIBUTOR_CREATED_INLINE",
  "releaseIsEditable",
]) {
  need(
    inline,
    marker,
    `Inline identity service is missing ${marker}.`,
  );
}

for (const marker of [
  'intent === "create-track-artist-inline"',
  'intent === "create-track-contributor-inline"',
  "createAndAssignTrackArtist",
  "createAndCreditTrackContributor",
  "expectedTrackUpdatedAt",
]) {
  need(
    action,
    marker,
    `Release mutation API is missing ${marker}.`,
  );
}

for (const marker of [
  "Existing artist",
  "New artist",
  "Existing contributor",
  "New contributor",
  "create-track-artist-inline",
  "create-track-contributor-inline",
  'name="artistName"',
  'name="contributorName"',
  "expectedTrackUpdatedAt",
  "track.updatedAt",
]) {
  need(
    editor,
    marker,
    `Dedicated Track editor is missing ${marker}.`,
  );
}

for (const marker of [
  "expectedTrackUpdatedAt",
  "validExpectedTrackUpdatedAt",
  "This track changed since this editor loaded.",
  "expectedReleaseUpdatedAt",
  "if (expectedTrackAt && normalized.length === 1)",
]) {
  need(
    bulk,
    marker,
    `Track save conflict handling is missing ${marker}.`,
  );
}

if (
  !editor.includes(
    'className={\`rc-track-info-add-credit\${',
  )
) {
  failures.push(
    "M14.4.5 mode-aware Add Credit marker is missing from Edit Track Info.",
  );
}

for (const marker of [
  ".rc-inline-identity-switch",
  ".rc-inline-identity-form",
]) {
  need(
    css,
    marker,
    `M17.2.1 CSS is missing ${marker}.`,
  );
}

if (
  pkg?.scripts?.["check:m17.2.1"] !==
  "node scripts/validate-m17.2.1-inline-identities.mjs"
) {
  failures.push(
    "package.json is missing check:m17.2.1.",
  );
}

if (
  !String(pkg?.scripts?.check || "").includes(
    "npm run check:m17.2.1",
  )
) {
  failures.push(
    "Full npm run check does not include M17.2.1.",
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M17.2.1 inline identity / dedicated track-save validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M17.2.1 inline identity creation / dedicated track-save validation passed.",
);
