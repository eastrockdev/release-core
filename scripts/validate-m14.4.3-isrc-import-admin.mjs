import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, "utf8");
}

const importer = read("app/lib/import-product.server.js");
const isrcServer = read("app/lib/isrc.server.js");
const action = read("app/lib/api-releases-release-action.server.js");
const admin = read("app/routes/app.release.$releaseId.jsx");
const trackEditor = read("app/routes/app.release.$releaseId.tracks.jsx");
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
need(action, 'intent === "bulk-update-tracks"', "Dedicated Track editor bulk action is missing.");

const hasDedicatedTrackEditor =
  trackEditor.includes("ReleaseTrackEditor") &&
  trackEditor.includes('data.set("intent", "bulk-update-tracks")') &&
  trackEditor.includes("Save all track changes") &&
  trackEditor.includes("name={`isrc:${track.id}`}");

if (!hasDedicatedTrackEditor) {
  failures.push("Dedicated Admin Track editor ISRC correction UI is missing.");
}

need(
  admin,
  `/app/release/${"${release.id}"}/tracks`,
  "Release workspace does not link to the dedicated Track editor.",
);
need(
  admin,
  "readOnly",
  "Release workspace ISRC display is no longer read-only.",
);
need(
  trackEditor,
  "This is the only Admin UI where an",
  "Track editor does not identify itself as the authoritative ISRC correction surface.",
);

if (/name=[\"']isrc[\"']/.test(admin)) {
  failures.push("Release workspace exposes a second editable ISRC input.");
}
if (/name=[\"']isrc[\"']/.test(portal)) {
  failures.push("Artist Portal exposes a named/editable ISRC input.");
}
need(portal, "track.isrc ||", "Artist Portal no longer displays stored ISRCs.");

if (failures.length) {
  console.error("ReleaseCore M14.4.3 validation failed:");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log("ReleaseCore M14.4.3 ISRC import/admin validation passed.");
