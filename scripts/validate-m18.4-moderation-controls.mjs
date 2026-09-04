#!/usr/bin/env node
import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  return fs.readFileSync(path, "utf8");
}

const moderation = read("app/lib/moderation.server.js");
const admin = read("app/routes/app.moderation.jsx");
const appNav = read("app/routes/app.jsx");
const proxy = read("app/routes/releasecore-proxy.$.jsx");
const nativePortal = read(
  "extensions/releasecore-artist-portal/assets/releasecore-dashboard.js",
);
const pkg = JSON.parse(read("package.json"));

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

for (const marker of [
  'PORTAL_EDIT_LOCK_TYPE = "PORTAL_EDIT_LOCK"',
  "releaseCreationDisabledTag",
  "customerReleaseCreationDisabled",
  "applyReleaseCreationModeration",
  "assertCustomerCanCreateRelease",
  "assertReleaseArtistEditable",
  "setReleaseArtistEditLock",
  "setCustomerReleaseCreationDisabled",
  "releaseLifecycleRequest.findFirst",
  "releaseLifecycleRequest.create",
  'type: "PORTAL_EDIT_LOCKED"',
  'type: "PORTAL_EDIT_UNLOCKED"',
  "tagsAdd",
  "tagsRemove",
  'code: "RELEASE_CREATION_DISABLED"',
  'code: "PORTAL_RELEASE_LOCKED"',
]) {
  need(
    moderation,
    marker,
    `Moderation service is missing ${marker}.`,
  );
}

for (const marker of [
  'heading="Moderation"',
  'heading="User release creation"',
  'heading="Release artist editing"',
  'value="set-release-creation"',
  'value="set-release-lock"',
  "customerIsPortalMember",
  "releaseCreationDisabledTag",
  "setCustomerReleaseCreationDisabled",
  "setReleaseArtistEditLock",
]) {
  need(
    admin,
    marker,
    `Moderation admin page is missing ${marker}.`,
  );
}

need(
  appNav,
  '<s-link href="/app/moderation">Moderation</s-link>',
  "Shopify admin navigation does not expose Moderation.",
);

for (const marker of [
  "applyReleaseCreationModeration",
  "assertCustomerCanCreateRelease",
  "assertReleaseArtistEditable",
  "assertRequestReleaseArtistEditable",
  "getReleaseArtistEditLock",
  "artistEditLocked: lock.locked",
  "artistEditLockReason: lock.reason",
  "editable: Boolean(releaseDetail.editable) && !lock.locked",
]) {
  need(
    proxy,
    marker,
    `Artist Portal moderation enforcement is missing ${marker}.`,
  );
}

const releaseLockGuards =
  proxy.match(/assertReleaseArtistEditable\(/g)?.length || 0;
if (releaseLockGuards < 4) {
  failures.push(
    "Artist Portal release lock is not enforced across enough mutation/upload paths.",
  );
}

for (const marker of [
  'release.editable ? "" : "readonly"',
  'release.editable ? "" : "disabled"',
  'release.editable ? "Editable" : "Read only"',
  "${release.editable ? `",
]) {
  need(
    nativePortal,
    marker,
    `Native Artist Portal read-only rendering is missing ${marker}.`,
  );
}

if (
  pkg?.scripts?.["check:m18.4"] !==
  "node scripts/validate-m18.4-moderation-controls.mjs"
) {
  failures.push("package.json is missing check:m18.4.");
}

if (
  !String(pkg?.scripts?.check || "").includes(
    "npm run check:m18.4",
  )
) {
  failures.push("Full npm run check does not include M18.4.");
}

if (failures.length) {
  console.error(
    "ReleaseCore M18.4 moderation controls validation failed:",
  );
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log(
  "ReleaseCore M18.4 release lock / user moderation validation passed.",
);
