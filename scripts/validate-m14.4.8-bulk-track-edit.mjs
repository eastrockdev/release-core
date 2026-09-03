import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const service = read("app/lib/bulk-track-edit.server.js");
const action = read("app/lib/api-releases-release-action.server.js");
const admin = read("app/routes/app.release.$releaseId.jsx");
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
need(action, 'intent === "bulk-update-tracks"', "bulk API action missing");
need(admin, "function BulkTrackEditor", "bulk editor UI missing");
need(admin, "Save all track changes", "single bulk save button missing");
need(admin, 'data.set("intent", "bulk-update-tracks")', "bulk UI submission missing");
need(admin, "Edit ISRC in the bulk track editor above.", "detail ISRC workflow was not consolidated");
need(admin, "event.currentTarget.form?.requestSubmit()", "autosave behavior missing");
need(css, ".rc-bulk-track-table-wrap", "bulk table CSS missing");
need(css, ".rc-credit-row--credits-only", "credits-only overlap fix missing");

need(
  m1443,
  "hasBulkAdminIsrcEditor",
  "M14.4.3 validator does not recognize the bulk ISRC correction UI.",
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

if (admin.includes("Save ISRC")) failures.push("Save ISRC buttons still exist");
if (admin.includes('{adminBusy ? "Saving…" : "Save"}')) failures.push("credit Save buttons still exist");

if (failures.length) {
  console.error("ReleaseCore M14.4.8 validation failed:");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log("ReleaseCore M14.4.8 bulk track/streamlined editing validation passed.");
