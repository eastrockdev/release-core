import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const service = read("app/lib/bulk-track-edit.server.js");
const action = read("app/lib/api-releases-release-action.server.js");
const admin = read("app/routes/app.release.$releaseId.jsx");
const trackEditor = read("app/routes/app.release_.$releaseId.tracks.jsx");
const css = read("app/styles/releasecore-admin.css");
const m1443 = read("scripts/validate-m14.4.3-isrc-import-admin.mjs");
const m1444 = read("scripts/validate-m14.4.4-credit-mode-collections.mjs");

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

need(service, "bulkUpdateReleaseTracks", "bulk update service missing");
need(service, "data: { isrc: null }", "atomic ISRC swap preparation missing");
need(service, "id: { notIn: targetIds }", "external ISRC conflict guard missing");
need(service, "TRACKS_BULK_UPDATED", "bulk audit event missing");
need(service, "data: { position: -(index + 1) }", "atomic track-order swap preparation missing");
need(service, "data.lyrics = row.lyrics", "lyrics bulk editing missing");
need(action, 'intent === "bulk-update-tracks"', "bulk API action missing");

need(trackEditor, "ReleaseTrackEditor", "dedicated Track editor page missing");
need(trackEditor, "Save all track changes", "single bulk save button missing");
need(trackEditor, 'data.set("intent", "bulk-update-tracks")', "Track editor bulk submission missing");
need(trackEditor, "name={`isrc:${track.id}`}", "Track editor ISRC correction field missing");
need(trackEditor, "name={`lyrics:${track.id}`}", "Track editor lyrics field missing");
need(trackEditor, "name={`position:${track.id}`}", "Track editor order field missing");

need(admin, "TrackEditorLaunch", "release workspace Track editor launch is missing");
need(admin, `/app/release/${"${release.id}"}/tracks`, "release workspace does not route to Track editor");
need(admin, "ISRC is managed in the dedicated Track editor", "release-detail ISRC workflow is not consolidated");
need(admin, "event.currentTarget.form?.requestSubmit()", "autosave behavior missing");
need(css, ".rc-track-editor-grid", "Track editor page CSS missing");
need(css, ".rc-credit-row--credits-only", "credits-only overlap fix missing");

need(
  m1443,
  "hasDedicatedTrackEditor",
  "M14.4.3 validator does not recognize the dedicated Track editor.",
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

if (admin.includes("function BulkTrackEditor")) {
  failures.push("inline/modal BulkTrackEditor still exists in the release workspace");
}
if (admin.includes("Save ISRC")) failures.push("Save ISRC buttons still exist");
if (admin.includes('{adminBusy ? "Saving…" : "Save"}')) failures.push("credit Save buttons still exist");

if (failures.length) {
  console.error("ReleaseCore M14.4.8 validation failed:");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log("ReleaseCore M14.4.8 dedicated track/streamlined editing validation passed.");
