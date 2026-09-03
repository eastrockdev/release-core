import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, "utf8");
}

const compatibility = read(
  "app/lib/east-rock-compatibility.server.js",
);
const distribution = read(
  "app/lib/distribution.server.js",
);
const admin = read(
  "app/routes/app.release.$releaseId.jsx",
);
const trackInfo = read(
  "app/routes/app.release_.$releaseId.track.$trackId.jsx",
);
const bulkEditor = read(
  "app/routes/app.release_.$releaseId.tracks.bulk.jsx",
);
const css = read("app/styles/releasecore-admin.css");

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

need(
  compatibility,
  "EAST_ROCK_PARENTAL_ADVISORY_CHOICES",
  "East Rock parental-advisory choices are not declared.",
);
for (const value of [
  "Explicit",
  "Non-Explicit",
  "Cleaned Version",
]) {
  need(
    compatibility,
    `"${value}"`,
    `East Rock parental-advisory choice is missing: ${value}`,
  );
}
need(
  compatibility,
  "eastRockParentalAdvisoryValue",
  "East Rock parental-advisory mapper is missing.",
);
need(
  compatibility,
  "eastRockParentalAdvisoryValue(\n        track,",
  "East Rock custom.parental_advisory does not use the exact-choice mapper.",
);
if (compatibility.includes(': "Clean",')) {
  failures.push(
    'East Rock compatibility still writes invalid parental-advisory value "Clean".',
  );
}

need(
  distribution,
  "audio previews generated but Shopify product sync was deferred",
  "Preview generation does not distinguish conversion success from downstream Shopify sync failure.",
);
need(
  distribution,
  "productSyncWarning",
  "Preview generation warning state is missing.",
);
need(
  distribution,
  "Use Sync Shopify Products to retry",
  "Preview sync warning does not give a recovery action.",
);

need(
  admin,
  "function TrackListItem",
  "release track list does not use direct edit rows",
);
need(
  trackInfo,
  "Edit Track Info",
  "individual Edit Track Info page is missing",
);
need(
  bulkEditor,
  "Bulk Edit Tracks",
  "bulk editing is not segregated onto its own multi-track page",
);
need(
  admin,
  'gridTemplateColumns: "minmax(0,1fr)"',
  "Add existing song layout is still using the cramped three-column grid.",
);
need(
  css,
  ".rc-track-detail-hero",
  "Edit Track Info layout CSS is missing.",
);
need(
  css,
  ".rc-bulk-track-card",
  "Bulk Edit Tracks layout CSS is missing.",
);

if (failures.length) {
  console.error(
    "ReleaseCore M14.4.9 validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M14.4.9 UI/Shopify sync validation passed.",
);
