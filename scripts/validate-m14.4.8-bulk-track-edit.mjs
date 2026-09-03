import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const service = read("app/lib/bulk-track-edit.server.js");
const action = read(
  "app/lib/api-releases-release-action.server.js",
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
const m1443 = read(
  "scripts/validate-m14.4.3-isrc-import-admin.mjs",
);
const m1444 = read(
  "scripts/validate-m14.4.4-credit-mode-collections.mjs",
);

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

need(
  service,
  "bulkUpdateReleaseTracks",
  "bulk update service missing",
);
need(
  service,
  "data: { isrc: null }",
  "atomic ISRC swap preparation missing",
);
need(
  service,
  "id: { notIn: targetIds }",
  "external ISRC conflict guard missing",
);
need(
  service,
  "TRACKS_BULK_UPDATED",
  "bulk audit event missing",
);
need(
  service,
  "data: { position: -(index + 1) }",
  "atomic track-order swap preparation missing",
);
need(
  service,
  "data.lyrics = row.lyrics",
  "lyrics persistence support missing",
);
need(
  action,
  'intent === "bulk-update-tracks"',
  "bulk API action missing",
);

need(
  trackInfo,
  'heading="Edit Track Info"',
  "individual Track Info page missing",
);
need(
  trackInfo,
  'name="isrc"',
  "individual Track Info ISRC field missing",
);
need(
  trackInfo,
  'name="lyrics"',
  "individual Track Info lyrics field missing",
);
need(
  trackInfo,
  "MASTER_WAV",
  "individual Track Info master management missing",
);
need(
  trackInfo,
  '"add-track-artist"',
  "individual Track Info artist management missing",
);
need(
  trackInfo,
  '"add-credit"',
  "individual Track Info credit management missing",
);

need(
  bulkEditor,
  'heading="Bulk Edit Tracks"',
  "multi-track bulk editor page missing",
);
need(
  bulkEditor,
  "Save all track changes",
  "bulk editor save action missing",
);
need(
  bulkEditor,
  'data.set("intent", "bulk-update-tracks")',
  "bulk editor submission missing",
);
need(
  bulkEditor,
  'name={`position:${track.id}`}',
  "bulk editor order field missing",
);
need(
  bulkEditor,
  'name={`title:${track.id}`}',
  "bulk editor title field missing",
);
need(
  bulkEditor,
  'name={`version:${track.id}`}',
  "bulk editor version field missing",
);
need(
  bulkEditor,
  'name={`language:${track.id}`}',
  "bulk editor language field missing",
);
need(
  bulkEditor,
  'name={`explicit:${track.id}`}',
  "bulk editor explicit field missing",
);

if (bulkEditor.includes('name={`isrc:${track.id}`}')) {
  failures.push(
    "bulk editor exposes duplicate ISRC editing",
  );
}
if (bulkEditor.includes('name={`lyrics:${track.id}`}')) {
  failures.push(
    "bulk editor exposes duplicate lyrics editing",
  );
}

need(
  admin,
  "function TrackListItem",
  "release workspace clickable track rows are missing",
);
if (admin.includes("function TrackCard")) {
  failures.push(
    "release workspace still contains inline TrackCard editing",
  );
}
if (admin.includes("TrackEditorLaunch")) {
  failures.push(
    "release workspace still contains the old Track editor launch",
  );
}
need(
  admin,
  "event.currentTarget.form?.requestSubmit()",
  "autosave behavior missing",
);
need(
  css,
  ".rc-track-info-grid",
  "Edit Track Info CSS missing",
);
need(
  css,
  ".rc-bulk-track-fields",
  "bulk editor CSS missing",
);
need(
  css,
  ".rc-credit-row--credits-only",
  "credits-only overlap fix missing",
);

need(
  m1443,
  "hasDedicatedTrackInfo",
  "M14.4.3 validator does not recognize Edit Track Info.",
);

if (m1444.includes("<button disabled={adminBusy}")) {
  failures.push(
    "M14.4.4 validator still requires a per-credit Save button.",
  );
}
need(
  m1444,
  "event.currentTarget.form?.requestSubmit()",
  "M14.4.4 validator does not recognize autosaving Admin credit controls.",
);

if (admin.includes("Save ISRC")) {
  failures.push("Save ISRC buttons still exist");
}
if (admin.includes('{adminBusy ? "Saving…" : "Save"}')) {
  failures.push("credit Save buttons still exist");
}

if (failures.length) {
  console.error(
    "ReleaseCore M14.4.8 validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M14.4.8 track editing validation passed.",
);
