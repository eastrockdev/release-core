#!/usr/bin/env node
import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  return fs.readFileSync(path, "utf8");
}

const editorState = read(
  "app/lib/editor-dirty-state.js",
);
const trackInfo = read(
  "app/routes/app.release_.$releaseId.track.$trackId.jsx",
);
const bulkEditor = read(
  "app/routes/app.release_.$releaseId.tracks.bulk.jsx",
);
const releaseApi = read(
  "app/lib/api-releases-release-action.server.js",
);
const bulkService = read(
  "app/lib/bulk-track-edit.server.js",
);
const css = read(
  "app/styles/releasecore-admin.css",
);
const packageJson = JSON.parse(read("package.json"));

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

for (const marker of [
  "useBlocker",
  '"beforeunload"',
  "window.confirm(message)",
  "markDirty",
  "markSaving",
  "markSaved",
  "markError",
  "discardChanges",
]) {
  need(
    editorState,
    marker,
    `Editor dirty-state helper is missing ${marker}.`,
  );
}

for (const [source, label] of [
  [trackInfo, "Edit Track Info"],
  [bulkEditor, "Bulk Edit Tracks"],
]) {
  need(
    source,
    "useEditorDirtyState",
    `${label} does not use the shared dirty-state guard.`,
  );
  need(
    source,
    "editorSaveStateLabel",
    `${label} does not expose an explicit save state.`,
  );
  need(
    source,
    'data.set(\n      "expectedReleaseUpdatedAt"',
    `${label} does not send optimistic-concurrency state.`,
  );
  need(
    source,
    "editor.markSaving()",
    `${label} does not enter Saving state.`,
  );
  need(
    source,
    "editor.markSaved()",
    `${label} does not clear dirty state after success.`,
  );
  need(
    source,
    "editor.markError()",
    `${label} does not keep edits dirty after a failed save.`,
  );
  need(
    source,
    "onChange={editor.markDirty}",
    `${label} does not mark its authoritative form dirty.`,
  );
  need(
    source,
    "rc-editor-save-state",
    `${label} is missing save-state UI.`,
  );
}

need(
  trackInfo,
  "track.updatedAt",
  "Edit Track Info does not key the authoritative form to track version state.",
);
need(
  trackInfo,
  "Role changes save automatically.",
  "Track artist autosave behavior is not explained.",
);
need(
  trackInfo,
  "Role and split changes save automatically.",
  "Credit autosave behavior is not explained.",
);
need(
  trackInfo,
  "!editor.dirty",
  "Edit Track Info Save button is not disabled when there are no changes.",
);

need(
  bulkEditor,
  ".map((track) => `${track.id}:${track.updatedAt}`)",
  "Bulk editor does not build version-aware form identity.",
);
need(
  bulkEditor,
  "!editor.dirty",
  "Bulk editor Save button is not disabled when there are no changes.",
);

need(
  releaseApi,
  "expectedReleaseUpdatedAt:",
  "Release API does not pass optimistic-concurrency state to the bulk track service.",
);
need(
  bulkService,
  "expectedReleaseUpdatedAt",
  "Bulk track service does not accept optimistic-concurrency state.",
);
need(
  bulkService,
  "EDIT_CONFLICT",
  "Bulk track service does not expose a safe edit-conflict response.",
);
need(
  bulkService,
  "tx.release.updateMany",
  "Bulk track service does not claim the expected release version atomically.",
);
need(
  bulkService,
  "updatedAt: expectedUpdatedAt",
  "Bulk track service does not compare the expected release version.",
);

for (const marker of [
  ".rc-editor-save-state",
  ".rc-editor-save-state--dirty",
  ".rc-editor-save-state--saving",
  ".rc-editor-save-state--error",
]) {
  need(
    css,
    marker,
    `Editor save-state CSS is missing ${marker}.`,
  );
}

if (
  packageJson?.scripts?.["check:m16.3"] !==
  "node scripts/validate-m16.3-editor-consistency.mjs"
) {
  failures.push("package.json is missing check:m16.3.");
}
if (
  !String(packageJson?.scripts?.check || "").includes(
    "npm run check:m16.3",
  )
) {
  failures.push(
    "Full npm run check does not include M16.3.",
  );
}

if (failures.length) {
  console.error(
    "ReleaseCore M16.3 editor consistency validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M16.3 save-state / dirty-state / optimistic-edit validation passed.",
);
