import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, "utf8");
}

const releaseAdmin = read("app/routes/app.release.$releaseId.jsx");
const trackInfo = read(
  "app/routes/app.release_.$releaseId.track.$trackId.jsx",
);
const bulkEditor = read(
  "app/routes/app.release_.$releaseId.tracks.bulk.jsx",
);
const distribution = read(
  "app/routes/app.distribution_.$releaseId.jsx",
);
const service = read("app/lib/bulk-track-edit.server.js");
const css = read("app/styles/releasecore-admin.css");

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

if (fs.existsSync("app/routes/app.release_.$releaseId.tracks.jsx")) {
  failures.push(
    "legacy combined Track editor route still exists",
  );
}
if (fs.existsSync("app/routes/app.release.$releaseId.tracks.jsx")) {
  failures.push(
    "legacy nested Track editor route still exists",
  );
}

need(
  releaseAdmin,
  "function TrackListItem",
  "release workspace is missing clickable track rows",
);
need(
  releaseAdmin,
  `/app/release/${"${release.id}"}/track/${"${track.id}"}`,
  "release track rows do not open Edit Track Info",
);
need(
  releaseAdmin,
  `/app/release/${"${release.id}"}/tracks/bulk`,
  "multi-track release workspace is missing Bulk Edit Tracks",
);
if (releaseAdmin.includes("function TrackCard")) {
  failures.push(
    "release workspace still contains expandable TrackCard editing",
  );
}
if (releaseAdmin.includes("TrackEditorLaunch")) {
  failures.push(
    "release workspace still contains the old Track editor launch card",
  );
}
if (releaseAdmin.includes("<details style={styles.trackCard}>")) {
  failures.push(
    "release workspace still exposes track editing through a dropdown/details control",
  );
}

need(
  trackInfo,
  'heading="Edit Track Info"',
  "individual Edit Track Info page is missing",
);
need(
  trackInfo,
  'data.set("intent", "bulk-update-tracks")',
  "individual Track Info page does not use atomic track metadata validation",
);
need(
  trackInfo,
  'name="isrc"',
  "individual Track Info page is missing the authoritative ISRC field",
);
need(
  trackInfo,
  'name="lyrics"',
  "individual Track Info page is missing lyrics",
);
need(
  trackInfo,
  "MASTER_WAV",
  "individual Track Info page is missing master-audio management",
);
need(
  trackInfo,
  '"add-track-artist"',
  "individual Track Info page is missing artist assignment",
);
need(
  trackInfo,
  '"add-credit"',
  "individual Track Info page is missing contributor credits",
);
need(
  trackInfo,
  "This is the only Admin field for assigning or correcting",
  "individual Track Info page does not declare authoritative ISRC ownership",
);

need(
  bulkEditor,
  'heading="Bulk Edit Tracks"',
  "multi-track bulk editor page is missing",
);
need(
  bulkEditor,
  'name={`position:${track.id}`}',
  "bulk editor is missing track order",
);
need(
  bulkEditor,
  'name={`title:${track.id}`}',
  "bulk editor is missing title",
);
need(
  bulkEditor,
  'name={`version:${track.id}`}',
  "bulk editor is missing version",
);
need(
  bulkEditor,
  'name={`language:${track.id}`}',
  "bulk editor is missing language",
);
need(
  bulkEditor,
  'name={`explicit:${track.id}`}',
  "bulk editor is missing explicit status",
);
if (bulkEditor.includes('name={`isrc:${track.id}`}')) {
  failures.push(
    "bulk editor exposes a second editable ISRC field",
  );
}
if (bulkEditor.includes('name={`lyrics:${track.id}`}')) {
  failures.push(
    "bulk editor exposes duplicate lyrics editing",
  );
}
need(
  bulkEditor,
  "trackCount < 2",
  "bulk editor is not limited to multi-track releases",
);

need(
  distribution,
  `/app/release/${"${release.id}"}/track/${"${track.id}"}`,
  "Distribution pending-ISRC action does not open the individual Track Info page",
);
if (
  distribution.includes(
    `navigate(\`/app/release/${"${release.id}"}/tracks\`)`,
  )
) {
  failures.push(
    "Distribution still links to the removed combined Track editor",
  );
}

need(
  service,
  "data: { position: -(index + 1) }",
  "atomic track-order swap support is missing",
);
need(
  service,
  "data: { isrc: null }",
  "atomic ISRC correction/swap support is missing",
);

for (const marker of [
  ".rc-track-list-item",
  ".rc-track-detail-hero",
  ".rc-track-info-grid",
  ".rc-bulk-track-card",
  ".rc-bulk-track-fields",
]) {
  need(
    css,
    marker,
    `track editing architecture CSS is missing ${marker}`,
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M15.3.1 track editing architecture validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M15.3.1 Edit Track Info / bulk editing architecture validation passed.",
);
