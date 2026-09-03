import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, "utf8");
}

const compatibility = read("app/lib/east-rock-compatibility.server.js");
const distribution = read("app/lib/distribution.server.js");
const admin = read("app/routes/app.release.$releaseId.jsx");
const trackEditor = read("app/routes/app.release.$releaseId.tracks.jsx");
const css = read("app/styles/releasecore-admin.css");

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

need(compatibility, "EAST_ROCK_PARENTAL_ADVISORY_CHOICES", "East Rock parental-advisory choices are not declared.");
for (const value of ["Explicit", "Non-Explicit", "Cleaned Version"]) {
  need(compatibility, `"${value}"`, `East Rock parental-advisory choice is missing: ${value}`);
}
need(compatibility, "eastRockParentalAdvisoryValue", "East Rock parental-advisory mapper is missing.");
need(
  compatibility,
  "eastRockParentalAdvisoryValue(\n        track,",
  "East Rock custom.parental_advisory does not use the exact-choice mapper.",
);
if (compatibility.includes(': "Clean",')) {
  failures.push('East Rock compatibility still writes invalid parental-advisory value "Clean".');
}

need(
  distribution,
  "audio previews generated but Shopify product sync was deferred",
  "Preview generation does not distinguish conversion success from downstream Shopify sync failure.",
);
need(distribution, "productSyncWarning", "Preview generation warning state is missing.");
need(distribution, "Use Sync Shopify Products to retry", "Preview sync warning does not give a recovery action.");

need(admin, "TrackEditorLaunch", "Track editor launch action is missing.");
need(trackEditor, "Dedicated track workspace", "Bulk editing is not segregated onto its own page.");
need(trackEditor, "Save all track changes", "Dedicated Track editor save action is missing.");
need(
  admin,
  'gridTemplateColumns: "minmax(0,1fr)"',
  "Add existing song layout is still using the cramped three-column grid.",
);
need(css, ".rc-track-editor-grid", "Dedicated Track editor CSS is missing.");
need(css, ".rc-track-editor-card", "Dedicated Track editor card layout is missing.");

if (failures.length) {
  console.error("ReleaseCore M14.4.9 validation failed:");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log("ReleaseCore M14.4.9 UI/Shopify sync validation passed.");
