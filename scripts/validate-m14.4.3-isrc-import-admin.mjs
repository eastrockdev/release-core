import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, "utf8");
}

const importer = read("app/lib/import-product.server.js");
const isrcServer = read("app/lib/isrc.server.js");
const action = read("app/lib/api-releases-release-action.server.js");
const admin = read("app/routes/app.release.$releaseId.jsx");
const trackInfo = read(
  "app/routes/app.release_.$releaseId.track.$trackId.jsx",
);
const portal = read(
  "extensions/releasecore-artist-portal/assets/releasecore-portal.js",
);

const failures = [];
const need = (source, text, message) => {
  if (!source.includes(text)) failures.push(message);
};

need(
  importer,
  'mfText(fields, "custom", "single_isrc")',
  "Importer does not read custom.single_isrc.",
);
need(
  importer,
  'deploymentProfileId() === "east-rock"',
  "East Rock custom.single_isrc precedence is missing.",
);
need(
  importer,
  "did not generate a replacement ISRC for this catalog import",
  "Catalog imports are not explicitly protected from replacement ISRC generation.",
);

need(
  isrcServer,
  "export async function correctIsrcForTrack",
  "Admin ISRC correction service is missing.",
);
need(
  isrcServer,
  'type: previousCode ? "ISRC_CORRECTED" : "ISRC_ASSIGNED"',
  "ISRC correction audit event is missing.",
);
need(
  isrcServer,
  "duplicate && duplicate.id !== track.id",
  "ISRC uniqueness protection is missing.",
);

need(
  action,
  'intent === "update-isrc"',
  "Admin ISRC correction action is missing.",
);
need(
  action,
  "correctIsrcForTrack",
  "Admin ISRC correction service is not wired.",
);
need(
  action,
  'intent === "bulk-update-tracks"',
  "Atomic track update action is missing.",
);

const hasDedicatedTrackInfo =
  trackInfo.includes('heading="Edit Track Info"') &&
  trackInfo.includes(
    'data.set("intent", "bulk-update-tracks")',
  ) &&
  trackInfo.includes('name="isrc"') &&
  trackInfo.includes(
    "This is the only Admin field for assigning or correcting",
  );

if (!hasDedicatedTrackInfo) {
  failures.push(
    "Dedicated Admin Edit Track Info ISRC correction UI is missing.",
  );
}

need(
  admin,
  `/app/release/${"${release.id}"}/track/${"${track.id}"}`,
  "Release workspace track rows do not open Edit Track Info.",
);

if (/name=["']isrc["']/.test(admin)) {
  failures.push(
    "Release workspace exposes a second editable ISRC input.",
  );
}
if (/name=["']isrc["']/.test(portal)) {
  failures.push(
    "Artist Portal exposes a named/editable ISRC input.",
  );
}
need(
  portal,
  "track.isrc ||",
  "Artist Portal no longer displays stored ISRCs.",
);

if (failures.length) {
  console.error(
    "ReleaseCore M14.4.3 validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M14.4.3 ISRC import/admin validation passed.",
);
