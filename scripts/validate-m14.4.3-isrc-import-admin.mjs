import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, "utf8");
}

const importer = read("app/lib/import-product.server.js");
const isrcServer = read("app/lib/isrc.server.js");
const action = read("app/lib/api-releases-release-action.server.js");
const admin = read("app/routes/app.release.$releaseId.jsx");
const portal = read("extensions/releasecore-artist-portal/assets/releasecore-portal.js");

const failures = [];
const need = (source, text, message) => {
  if (!source.includes(text)) failures.push(message);
};

need(importer, 'mfText(fields, "custom", "single_isrc")', "Importer does not read custom.single_isrc.");
need(importer, 'deploymentProfileId() === "east-rock"', "East Rock custom.single_isrc precedence is missing.");
need(importer, "did not generate a replacement ISRC for this catalog import", "Catalog imports are not explicitly protected from replacement ISRC generation.");

need(isrcServer, "export async function correctIsrcForTrack", "Admin ISRC correction service is missing.");
need(isrcServer, 'type: previousCode ? "ISRC_CORRECTED" : "ISRC_ASSIGNED"', "ISRC correction audit event is missing.");
need(isrcServer, "duplicate && duplicate.id !== track.id", "ISRC uniqueness protection is missing.");

need(action, 'intent === "update-isrc"', "Admin ISRC update action is missing.");
need(action, "correctIsrcForTrack", "Admin ISRC correction service is not wired.");

const hasLegacyAdminIsrcEditor =
  admin.includes("data-admin-isrc") &&
  admin.includes('data.set("intent", "update-isrc")');

const hasBulkAdminIsrcEditor =
  admin.includes("function BulkTrackEditor") &&
  admin.includes('data.set("intent", "bulk-update-tracks")') &&
  admin.includes("Save all track changes") &&
  admin.includes("Edit ISRC in the bulk track editor above.");

if (!hasLegacyAdminIsrcEditor && !hasBulkAdminIsrcEditor) {
  failures.push("Admin ISRC correction UI is missing.");
}

need(
  action,
  'intent === "update-isrc"',
  "Dedicated single-track Admin ISRC correction action is missing.",
);
need(
  action,
  "correctIsrcForTrack",
  "Dedicated single-track Admin ISRC correction service is not wired.",
);

if (hasLegacyAdminIsrcEditor) {
  need(
    admin,
    "adminBusy={busy}",
    "Admin ISRC correction remains locked on approved/imported releases.",
  );
  need(
    admin,
    '"update-isrc": "Saving ISRC…"',
    "Admin ISRC pending state is missing.",
  );
}

if (hasBulkAdminIsrcEditor) {
  need(
    admin,
    'bulk-update-tracks',
    "Bulk Admin ISRC correction intent is missing.",
  );
  need(
    admin,
    "Save all track changes",
    "Bulk Admin ISRC correction save action is missing.",
  );
}

if (/name=["']isrc["']/.test(portal)) {
  failures.push("Artist Portal exposes a named/editable ISRC input.");
}
need(portal, "track.isrc ||", "Artist Portal no longer displays stored ISRCs.");

if (failures.length) {
  console.error("ReleaseCore M14.4.3 validation failed:");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log("ReleaseCore M14.4.3 ISRC import/admin validation passed.");
