import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, "utf8");
}

const trackService = read(
  "app/lib/release-tracks.server.js",
);
const workspace = read(
  "app/lib/release-workspace.server.js",
);
const action = read(
  "app/lib/api-releases-release-action.server.js",
);
const admin = read(
  "app/routes/app.release.$releaseId.jsx",
);
const trackInfo = read(
  "app/routes/app.release_.$releaseId.track.$trackId.jsx",
);

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

need(
  trackService,
  "export async function attachExistingSingleTrack",
  "Existing Single-to-track service is missing.",
);
need(
  trackService,
  'String(source.type || "").toUpperCase() !== "SINGLE"',
  "Existing-track attach does not require a Single source.",
);
need(
  trackService,
  "source.tracks.length !== 1",
  "Existing-track attach does not require exactly one source track.",
);
need(
  trackService,
  "!track.shopifyProductId",
  "Existing-track attach does not require a Shopify song product.",
);
need(
  trackService,
  "releaseFile.updateMany",
  "Track-scoped files do not move with an attached song.",
);
need(
  trackService,
  "releaseReviewItem.updateMany",
  "Track review items do not move with an attached song.",
);
need(
  trackService,
  "releaseId: target.id",
  "Existing song is not moved into the target release.",
);
need(
  trackService,
  "release.delete",
  "Empty imported Single wrapper is not removed after merge.",
);
need(
  trackService,
  "EXISTING_TRACK_ATTACHED",
  "Existing-track merge audit event is missing.",
);

need(
  trackService,
  "export async function deleteDraftTrack",
  "Draft track deletion service is missing.",
);
need(
  trackService,
  'release.status !== "DRAFT"',
  "Track deletion is not restricted to drafts.",
);
need(
  trackService,
  "track.shopifyProductId",
  "Track deletion does not protect Shopify-linked songs.",
);
need(
  trackService,
  "deleteMasterStorageObject",
  "Draft track deletion does not clean private master storage.",
);
need(
  trackService,
  "DRAFT_TRACK_DELETED",
  "Draft track deletion audit event is missing.",
);

need(
  workspace,
  "existingSongs",
  "Release workspace does not expose existing imported songs.",
);
need(
  workspace,
  'type: "SINGLE"',
  "Existing song list is not restricted to Single releases.",
);
need(
  workspace,
  "shopifyProductId: { not: null }",
  "Existing song list is not restricted to Shopify-linked songs.",
);

need(
  action,
  'intent === "attach-existing-track"',
  "Admin API does not handle attaching an existing song.",
);
need(
  action,
  'intent === "delete-track"',
  "Admin API does not handle deleting a draft track.",
);

// Existing-song attachment remains a release-level action.
need(
  admin,
  "Add existing song",
  "Admin release UI is missing the existing-song control.",
);
need(
  admin,
  'data.set("intent", "attach-existing-track")',
  "Admin release UI does not submit existing-song attach.",
);
need(
  admin,
  "existingSongs",
  "Admin release UI does not consume existing song options.",
);

// M15.3.1 moved per-recording destructive actions to Edit Track Info.
need(
  trackInfo,
  "Delete this draft track",
  "Edit Track Info is missing draft-track deletion.",
);
need(
  trackInfo,
  'data.set("intent", "delete-track")',
  "Edit Track Info does not submit draft-track deletion.",
);
need(
  trackInfo,
  "const canDeleteTrack =",
  "Edit Track Info is missing draft-track deletion eligibility checks.",
);
need(
  trackInfo,
  'release.status === "DRAFT"',
  "Track deletion UI is not restricted to draft releases.",
);
need(
  trackInfo,
  'release.type !== "SINGLE"',
  "Track deletion UI does not protect Single releases.",
);
need(
  trackInfo,
  "!track.shopifyProductId",
  "Track deletion UI does not protect Shopify-linked recordings.",
);

if (failures.length) {
  console.error(
    "ReleaseCore M14.4.6 validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M14.4.6 existing-track/draft-delete validation passed.",
);
