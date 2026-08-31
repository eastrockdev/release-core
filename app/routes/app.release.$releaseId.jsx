import { useState } from "react";
import { Link, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  ARTIST_ROLES,
  CREDIT_ROLES,
  GENRES,
  LANGUAGES,
  artistRoleLabel,
  creditRoleLabel,
  contributorDisplayName,
  dateInputValue,
  formatDate,
  isPublishingRole,
  trackNeedsTitle,
  typeLabel,
} from "../lib/releasecore";
import { FILE_KINDS, fileKindLabel, formatBytes } from "../lib/releasecore-files";
import { authenticatedPost } from "../lib/authenticated-post";
import { uploadReleaseCoreFile, validateCoverArtworkDimensions } from "../lib/upload-file";
import { calculateReleaseReadiness, releaseCanSubmit, releaseIsEditable, statusLabel, statusTone } from "../lib/workflow";

async function getOwnedRelease(id, shop, include = {}) {
  return db.release.findFirst({ where: { id, shop }, include });
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const [release, artists, contributors, settings] = await Promise.all([
    getOwnedRelease(params.releaseId, session.shop, {
      artists: { include: { artist: true }, orderBy: { position: "asc" } },
      files: { where: { trackId: null }, orderBy: { createdAt: "desc" } },
      tracks: {
        orderBy: { position: "asc" },
        include: {
          artists: { include: { artist: true }, orderBy: { position: "asc" } },
          credits: { include: { contributor: true }, orderBy: { createdAt: "asc" } },
          files: { orderBy: { createdAt: "desc" } },
        },
      },
      events: { orderBy: { createdAt: "desc" }, take: 20 },
      reviewItems: { include: { track: true }, orderBy: { createdAt: "desc" } },
    }),
    db.artist.findMany({ where: { shop: session.shop }, orderBy: { name: "asc" } }),
    db.contributor.findMany({ where: { shop: session.shop }, orderBy: { legalName: "asc" } }),
    db.appSettings.findUnique({ where: { shop: session.shop } }),
  ]);
  if (!release) throw new Response("Release not found", { status: 404 });
  const isrcConfigured = Boolean(settings?.countryCode && /^[A-Z]{2}$/.test(settings.countryCode) && settings?.registrantCode && /^[A-Z0-9]{3}$/.test(settings.registrantCode));
  return { release, artists, contributors, isrcSettings: { configured: isrcConfigured, autoAssign: settings?.autoAssignIsrc ?? true }, workflowSettings: settings || {} };
};

function StatusPill({ children, tone = "neutral" }) {
  const palette = tone === "good"
    ? { background: "#eaf7ee", color: "#176c37" }
    : tone === "bad"
      ? { background: "#fff1f0", color: "#8e1f0b" }
      : tone === "warn"
        ? { background: "#fff4df", color: "#8a5700" }
        : tone === "info"
          ? { background: "#eaf2ff", color: "#174ea6" }
          : { background: "#f1f1f1", color: "#4a4a4a" };
  return <span style={{ ...styles.pill, ...palette }}>{children}</span>;
}

function Field({ label, help, children }) {
  return <label style={styles.field}><span style={styles.fieldLabel}>{label}</span>{children}{help ? <span style={styles.help}>{help}</span> : null}</label>;
}

function Select({ name, defaultValue = "", options, placeholder = "Select" }) {
  return <select name={name} defaultValue={defaultValue} style={styles.input}><option value="">{placeholder}</option>{defaultValue && !options.includes(defaultValue) ? <option value={defaultValue}>{defaultValue}</option> : null}{options.map((value) => <option key={value} value={value}>{value}</option>)}</select>;
}

function RoleSelect({ name = "role", defaultValue = "PRIMARY" }) {
  return <select name={name} defaultValue={defaultValue} style={styles.compactInput}>{ARTIST_ROLES.map((role) => <option key={role} value={role}>{artistRoleLabel(role)}</option>)}</select>;
}

function CreditRoleSelect({ defaultValue = "SONGWRITER" }) {
  return <select name="role" defaultValue={defaultValue} style={styles.compactInput}>{CREDIT_ROLES.map((role) => <option key={role} value={role}>{creditRoleLabel(role)}</option>)}</select>;
}

function FileCard({ file, removeFile, busy, compact = false }) {
  return <div style={compact ? styles.fileCardCompact : styles.fileCard}>
    <div style={{ minWidth: 0 }}>
      <div style={styles.fileName}>{file.filename}</div>
      <div style={styles.fileMeta}>{fileKindLabel(file.kind)} · {formatBytes(file.sizeBytes)} · {String(file.status || "Uploaded").toLowerCase()}</div>
    </div>
    <div style={styles.rowActions}>
      {file.url ? <a href={file.url} target="_blank" rel="noreferrer" style={styles.fileLink}>View</a> : null}
      <button type="button" disabled={busy} style={styles.dangerButton} onClick={() => removeFile(file.id)}>Remove</button>
    </div>
  </div>;
}

function UploadControl({ label, help, accept, kind, trackId, uploadFile, busy, progress }) {
  return <div style={styles.uploadPanel}>
    <div style={{ minWidth: 0 }}>
      <div style={styles.uploadLabel}>{label}</div>
      <div style={styles.uploadHelp}>{help}</div>
      {progress ? <div style={styles.progressWrap}><div style={{ ...styles.progressBar, width: `${progress.percent || 0}%` }} /><span>{progress.phase === "preparing" ? "Preparing…" : progress.phase === "finalizing" ? "Finalizing…" : progress.phase === "done" ? "Uploaded" : `Uploading ${progress.percent || 0}%`}</span></div> : null}
    </div>
    <label style={{ ...styles.secondaryButton, display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: busy ? .6 : 1 }}>
      {busy ? "Working…" : "Choose file"}
      <input
        type="file"
        accept={accept}
        disabled={busy}
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) uploadFile({ file, kind, trackId });
        }}
      />
    </label>
  </div>;
}

function ReleaseArtists({ release, artists, mutate, busy }) {
  return <s-section heading="Release artists">
    <div style={styles.sectionIntro}>Assign the artist identities credited at the release level. Track-level featured artists are managed inside each song.</div>
    {release.artists.length ? <div style={styles.assignmentList}>{release.artists.map((assignment) => <form key={assignment.id} style={styles.assignmentRow} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); data.set("intent", "update-release-artist"); data.set("assignmentId", assignment.id); mutate(data); }}><div style={{ minWidth: 0 }}><strong>{assignment.artist.name}</strong><div style={styles.micro}>{assignment.artist.legalName || "Artist identity"}</div></div><RoleSelect defaultValue={assignment.role} /><div style={styles.rowActions}><button disabled={busy} style={styles.tinyButton}>Save</button><button type="button" disabled={busy} style={styles.dangerButton} onClick={() => { const data = new FormData(); data.set("intent", "remove-release-artist"); data.set("assignmentId", assignment.id); mutate(data); }}>Remove</button></div></form>)}</div> : <div style={styles.emptyInline}>No release artists assigned yet.</div>}
    {artists.length ? <form style={styles.addRow} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); data.set("intent", "add-release-artist"); mutate(data); }}><select name="artistId" required style={styles.input}><option value="">Choose artist…</option>{artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}</select><RoleSelect /><button disabled={busy} style={styles.secondaryButton}>Add artist</button></form> : <div style={styles.directoryPrompt}>Create an artist in <Link to="/app/artists">Artists</Link> before assigning release credits.</div>}
  </s-section>;
}

function ReleaseAssets({ release, uploadFile, removeFile, busy, uploadState, requireSplitSheet = false }) {
  const cover = release.files.find((file) => file.kind === FILE_KINDS.COVER_ART);
  const splitSheet = release.files.find((file) => file.kind === FILE_KINDS.SPLIT_SHEET);
  const supporting = release.files.filter((file) => file.kind === FILE_KINDS.SUPPORTING_DOCUMENT);
  return <s-section heading="Release files">
    <div style={styles.sectionIntro}>Store the release-level artwork and documentation that travels with the distribution project.</div>
    <div style={styles.assetGrid}>
      <div style={styles.assetCard}>
        <div style={styles.assetHeading}><div><div style={styles.subheading}>Cover artwork</div><div style={styles.subcopy}>JPG or PNG, square, at least 3000×3000px.</div></div><StatusPill tone={cover ? "good" : "warn"}>{cover ? "Uploaded" : "Required"}</StatusPill></div>
        {cover?.url ? <img src={cover.url} alt="Release cover" style={styles.coverPreview} /> : null}
        {cover ? <FileCard file={cover} removeFile={removeFile} busy={busy} compact /> : null}
        <UploadControl label={cover ? "Replace artwork" : "Upload artwork"} help="ReleaseCore validates dimensions in the browser before upload." accept="image/jpeg,image/png,.jpg,.jpeg,.png" kind={FILE_KINDS.COVER_ART} uploadFile={uploadFile} busy={busy} progress={uploadState?.kind === FILE_KINDS.COVER_ART ? uploadState : null} />
      </div>
      <div style={styles.assetCard}>
        <div style={styles.assetHeading}><div><div style={styles.subheading}>Split sheet</div><div style={styles.subcopy}>{requireSplitSheet ? "Required release-level songwriter ownership documentation." : "Optional release-level songwriter ownership documentation."}</div></div><StatusPill tone={splitSheet ? "good" : requireSplitSheet ? "warn" : "neutral"}>{splitSheet ? "Uploaded" : requireSplitSheet ? "Required" : "Optional"}</StatusPill></div>
        {splitSheet ? <FileCard file={splitSheet} removeFile={removeFile} busy={busy} compact /> : null}
        <UploadControl label={splitSheet ? "Replace split sheet" : "Upload split sheet"} help="PDF only. This supports the structured publishing credits entered on each track." accept="application/pdf,.pdf" kind={FILE_KINDS.SPLIT_SHEET} uploadFile={uploadFile} busy={busy} progress={uploadState?.kind === FILE_KINDS.SPLIT_SHEET ? uploadState : null} />
      </div>
    </div>
    <div style={styles.subsection}>
      <div style={styles.subheading}>Supporting documents</div><div style={styles.subcopy}>Optional PDFs or images such as licensing documentation, sample clearances, or other release notes.</div>
      {supporting.length ? <div style={styles.assignmentList}>{supporting.map((file) => <FileCard key={file.id} file={file} removeFile={removeFile} busy={busy} />)}</div> : <div style={styles.emptyInline}>No supporting documents uploaded.</div>}
      <UploadControl label="Add supporting document" help="PDF, JPG, or PNG. Multiple supporting files are allowed." accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" kind={FILE_KINDS.SUPPORTING_DOCUMENT} uploadFile={uploadFile} busy={busy} progress={uploadState?.kind === FILE_KINDS.SUPPORTING_DOCUMENT ? uploadState : null} />
    </div>
  </s-section>;
}

function TrackCard({ track, index, count, mutate, busy, artists, contributors, uploadFile, removeFile, uploadState, isrcConfigured }) {
  const complete = !trackNeedsTitle(track);
  const writerCredits = track.credits.filter((credit) => isPublishingRole(credit.role));
  const publishingTotal = writerCredits.reduce((sum, credit) => sum + (credit.ownershipPercent || 0), 0);
  const publishingTone = publishingTotal === 100 ? "good" : publishingTotal > 0 ? "warn" : "neutral";
  const master = track.files.find((file) => file.kind === FILE_KINDS.MASTER_WAV);
  const lyricsReady = track.language === "Instrumental / No linguistic content" || Boolean(track.lyrics?.trim());
  const move = (intent) => { const data = new FormData(); data.set("intent", intent); data.set("trackId", track.id); mutate(data); };

  return <details style={styles.trackCard}>
    <summary style={styles.trackSummary}>
      <div style={styles.trackNumber}>{String(index + 1).padStart(2, "0")}</div>
      <div style={{ minWidth: 0 }}><div style={styles.trackTitle}>{track.title || "Untitled Track"}</div><div style={styles.trackMeta}>{track.version || "Original version"}{track.language ? ` · ${track.language}` : ""}{track.explicit ? " · Explicit" : " · Clean / not marked explicit"}</div></div>
      <div style={styles.trackSummaryRight}><StatusPill tone={complete ? "good" : "warn"}>{complete ? "Basics saved" : "Needs title"}</StatusPill><StatusPill tone={track.isrc ? "good" : isrcConfigured ? "warn" : "neutral"}>{track.isrc ? track.isrc : isrcConfigured ? "Needs ISRC" : "ISRC not configured"}</StatusPill><StatusPill tone={master ? "good" : "warn"}>{master ? "Master uploaded" : "Needs master"}</StatusPill><StatusPill tone={track.artists.length ? "good" : "warn"}>{track.artists.length} artist{track.artists.length === 1 ? "" : "s"}</StatusPill><StatusPill tone={publishingTone}>{publishingTotal}% publishing</StatusPill><span style={styles.expandHint}>Edit</span></div>
    </summary>
    <div style={styles.trackBody}>
      <div style={styles.trackToolbar}><div><div style={styles.smallEyebrow}>Track {index + 1}</div><div style={{ fontWeight: 700 }}>Song workspace</div></div><div style={{ display: "flex", gap: 8 }}><button type="button" onClick={() => move("move-up")} disabled={busy || index === 0} style={styles.iconButton}>↑</button><button type="button" onClick={() => move("move-down")} disabled={busy || index === count - 1} style={styles.iconButton}>↓</button></div></div>

      <div style={styles.subsection}>
        <div style={styles.subheading}>Basic details</div>
        <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); data.set("intent", "update-track"); data.set("trackId", track.id); mutate(data); }}>
          <div style={styles.formGrid}>
            <Field label="Track title" help="Use the song title only. Version information has its own field."><input name="title" defaultValue={track.title === "Untitled Track" ? "" : track.title} placeholder="Song title" style={styles.input} /></Field>
            <Field label="Version / subtitle" help="Examples: Remix, Acoustic, Radio Edit. Leave blank for the original version."><input name="version" defaultValue={track.version || ""} placeholder="Original version" style={styles.input} /></Field>
            <Field label="Language"><Select name="language" defaultValue={track.language || ""} options={LANGUAGES} placeholder="Choose language" /></Field>
            <Field label="ISRC" help={track.isrc ? "Assigned automatically by ReleaseCore. Existing ISRCs are permanent and are not rewritten when settings change." : isrcConfigured ? "ReleaseCore will assign the next available ISRC automatically. You can also assign all missing codes from the tracklist header." : "Configure your Country Code and Registrant Code in Settings before ReleaseCore can assign an ISRC."}><div style={styles.readonlyField}>{track.isrc ? track.isrc : isrcConfigured ? "Automatic · Waiting for assignment" : "Automatic · Configure Settings"}</div></Field>
          </div>
          <label style={styles.checkRow}><input type="checkbox" name="explicit" defaultChecked={track.explicit} /><span><strong>Explicit content</strong><span style={styles.checkHelp}> Mark this track explicit if its lyrical or audio content requires an explicit designation.</span></span></label>
          <div style={styles.trackFooter}><button disabled={busy} style={styles.secondaryButton}>{busy ? "Saving…" : "Save basic details"}</button></div>
        </form>
      </div>

      <div style={styles.subsection}>
        <div style={styles.assetHeading}><div><div style={styles.subheading}>Audio master</div><div style={styles.subcopy}>Upload the final uncompressed WAV that should be delivered for this recording.</div></div><StatusPill tone={master ? "good" : "warn"}>{master ? "Ready" : "Required"}</StatusPill></div>
        {master ? <FileCard file={master} removeFile={removeFile} busy={busy} /> : <div style={styles.emptyInline}>No master WAV uploaded.</div>}
        <UploadControl label={master ? "Replace master WAV" : "Upload master WAV"} help="WAV only. Maximum 500 MB. Masters are stored privately and are never exposed as permanent public files." accept="audio/wav,audio/x-wav,.wav" kind={FILE_KINDS.MASTER_WAV} trackId={track.id} uploadFile={uploadFile} busy={busy} progress={uploadState?.trackId === track.id && uploadState?.kind === FILE_KINDS.MASTER_WAV ? uploadState : null} />
      </div>

      <div style={styles.subsection}>
        <div style={styles.assetHeading}><div><div style={styles.subheading}>Lyrics</div><div style={styles.subcopy}>Enter the complete lyrics exactly as performed. Instrumental tracks can leave this blank when the language is marked accordingly.</div></div><StatusPill tone={lyricsReady ? "good" : "warn"}>{lyricsReady ? "Ready" : "Missing"}</StatusPill></div>
        <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); data.set("intent", "update-lyrics"); data.set("trackId", track.id); mutate(data); }}>
          <textarea name="lyrics" defaultValue={track.lyrics || ""} placeholder="Paste complete lyrics here…" style={styles.textarea} />
          <div style={styles.trackFooter}><button disabled={busy} style={styles.secondaryButton}>{busy ? "Saving…" : "Save lyrics"}</button></div>
        </form>
      </div>

      <div style={styles.subsection}>
        <div style={styles.subheading}>Artists</div><div style={styles.subcopy}>Primary and featured artist identities for this recording.</div>
        {track.artists.length ? <div style={styles.assignmentList}>{track.artists.map((assignment) => <form key={assignment.id} style={styles.assignmentRow} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); data.set("intent", "update-track-artist"); data.set("trackId", track.id); data.set("assignmentId", assignment.id); mutate(data); }}><div style={{ minWidth: 0 }}><strong>{assignment.artist.name}</strong><div style={styles.micro}>{assignment.artist.legalName || "Artist identity"}</div></div><RoleSelect defaultValue={assignment.role} /><div style={styles.rowActions}><button disabled={busy} style={styles.tinyButton}>Save</button><button type="button" disabled={busy} style={styles.dangerButton} onClick={() => { const data = new FormData(); data.set("intent", "remove-track-artist"); data.set("trackId", track.id); data.set("assignmentId", assignment.id); mutate(data); }}>Remove</button></div></form>)}</div> : <div style={styles.emptyInline}>No artists assigned to this track.</div>}
        {artists.length ? <form style={styles.addRow} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); data.set("intent", "add-track-artist"); data.set("trackId", track.id); mutate(data); }}><select name="artistId" required style={styles.input}><option value="">Choose artist…</option>{artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}</select><RoleSelect /><button disabled={busy} style={styles.secondaryButton}>Add artist</button></form> : <div style={styles.directoryPrompt}>No artist identities yet. <Link to="/app/artists">Add artists</Link>.</div>}
      </div>

      <div style={styles.subsection}>
        <div style={styles.creditHeading}><div><div style={styles.subheading}>Credits & publishing</div><div style={styles.subcopy}>Credit reusable contributors, then assign publishing ownership to songwriter/composer rows.</div></div><StatusPill tone={publishingTone}>{publishingTotal}% songwriter ownership</StatusPill></div>
        {track.credits.length ? <div style={styles.assignmentList}>{track.credits.map((credit) => <form key={credit.id} style={styles.creditRow} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); data.set("intent", "update-credit"); data.set("trackId", track.id); data.set("creditId", credit.id); mutate(data); }}><div style={{ minWidth: 0 }}><strong>{contributorDisplayName(credit.contributor)}</strong><div style={styles.micro}>{credit.contributor.legalName}{credit.contributor.pro ? ` · ${credit.contributor.pro}` : ""}{credit.contributor.ipi ? ` · IPI ${credit.contributor.ipi}` : ""}</div></div><CreditRoleSelect defaultValue={credit.role} /><input name="ownershipPercent" type="number" min="0" max="100" step="0.01" defaultValue={credit.ownershipPercent ?? ""} placeholder="Split %" style={styles.percentInput} /><div style={styles.rowActions}><button disabled={busy} style={styles.tinyButton}>Save</button><button type="button" disabled={busy} style={styles.dangerButton} onClick={() => { const data = new FormData(); data.set("intent", "remove-credit"); data.set("trackId", track.id); data.set("creditId", credit.id); mutate(data); }}>Remove</button></div></form>)}</div> : <div style={styles.emptyInline}>No contributors credited yet.</div>}
        {contributors.length ? <form style={styles.creditAddRow} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); data.set("intent", "add-credit"); data.set("trackId", track.id); mutate(data); }}><select name="contributorId" required style={styles.input}><option value="">Choose contributor…</option>{contributors.map((contributor) => <option key={contributor.id} value={contributor.id}>{contributorDisplayName(contributor)} — {contributor.legalName}</option>)}</select><CreditRoleSelect /><input name="ownershipPercent" type="number" min="0" max="100" step="0.01" placeholder="Split %" style={styles.percentInput} /><button disabled={busy} style={styles.secondaryButton}>Add credit</button></form> : <div style={styles.directoryPrompt}>No contributor records yet. <Link to="/app/contributors">Add contributors</Link>.</div>}
        <div style={styles.splitHelp}>Ownership is only stored for Songwriter and Composer credits. ReleaseCore prevents the publishing total from exceeding 100%.</div>
      </div>

      <div style={styles.futureSections}><span>Delivery</span><span>DSP validation</span></div><div style={styles.futureHelp}>Milestone 5 adds automatic identifiers and organization defaults. Delivery routing and DSP-specific validation come later.</div>
    </div>
  </details>;
}


function WorkflowPanel({ release, readiness, mutate, busy }) {
  const editable = releaseIsEditable(release.status);
  const canSubmit = releaseCanSubmit(release.status);
  const openItems = release.reviewItems.filter((item) => item.status === "OPEN");
  const send = (intent, extras = {}) => {
    const data = new FormData();
    data.set("intent", intent);
    Object.entries(extras).forEach(([key, value]) => data.set(key, value));
    mutate(data);
  };

  return <s-section heading="Submission workflow">
    <div style={styles.workflowHeader}>
      <div>
        <div style={styles.smallEyebrow}>Current status</div>
        <div style={styles.workflowStatus}>
          <StatusPill tone={statusTone(release.status)}>{statusLabel(release.status)}</StatusPill>
          {release.lastSubmittedAt ? <span style={styles.muted}>Last submitted {new Date(release.lastSubmittedAt).toLocaleString()}</span> : null}
        </div>
      </div>
      <div style={styles.workflowActions}>
        {canSubmit ? <button type="button" disabled={busy || !readiness.ready || openItems.length > 0} onClick={() => send("submit-release")} style={styles.primaryButton}>{release.submittedAt ? "Resubmit for review" : "Submit for review"}</button> : null}
        {release.status === "SUBMITTED" ? <button type="button" disabled={busy} onClick={() => send("start-review")} style={styles.primaryButton}>Start review</button> : null}
        {["SUBMITTED", "IN_REVIEW", "APPROVED", "REJECTED"].includes(release.status) ? <button type="button" disabled={busy} onClick={() => send("reopen-draft")} style={styles.secondaryButton}>Reopen draft</button> : null}
      </div>
    </div>

    {canSubmit && !readiness.ready ? <div style={styles.workflowWarning}>
      <strong>Not ready to submit.</strong>
      <div style={styles.blockerList}>{readiness.blockers.slice(0, 8).map((item, index) => <div key={`${item.code}-${item.trackId || index}`}>• {item.message}</div>)}</div>
      {readiness.blockers.length > 8 ? <div style={styles.micro}>+ {readiness.blockers.length - 8} more readiness items</div> : null}
    </div> : null}
    {canSubmit && openItems.length ? <div style={styles.workflowWarning}><strong>{openItems.length} change request{openItems.length === 1 ? "" : "s"} still open.</strong> Resolve them before resubmitting.</div> : null}
    {!editable && ["SUBMITTED", "IN_REVIEW"].includes(release.status) ? <div style={styles.workflowInfo}>Release metadata is locked while this submission is under review. Request changes or reopen the draft before editing.</div> : null}
    {release.status === "APPROVED" ? <div style={styles.workflowGood}>Approved. This release is ready for the downstream automation and product-creation layer.</div> : null}
    {release.status === "REJECTED" ? <div style={styles.workflowBad}>Rejected. Reopen the release as a draft if it should be revised and submitted again.</div> : null}

    {release.reviewItems.length ? <div style={styles.reviewItems}>
      <div style={styles.subheading}>Change requests</div>
      {release.reviewItems.map((item) => <div key={item.id} style={{ ...styles.reviewItem, ...(item.status === "RESOLVED" ? styles.reviewResolved : {}) }}>
        <div style={{ minWidth: 0 }}>
          <div style={styles.reviewItemTitle}>{item.track ? `Track ${item.track.position}: ${item.track.title}` : "Release-level change"}</div>
          <div style={styles.reviewMessage}>{item.message}</div>
          <div style={styles.micro}>{item.status === "RESOLVED" ? `Resolved${item.resolvedAt ? ` ${new Date(item.resolvedAt).toLocaleString()}` : ""}` : `Requested ${new Date(item.createdAt).toLocaleString()}`}</div>
        </div>
        {item.status === "OPEN" && editable ? <button type="button" disabled={busy} style={styles.tinyButton} onClick={() => send("resolve-review-item", { reviewItemId: item.id })}>Mark resolved</button> : <StatusPill tone={item.status === "RESOLVED" ? "good" : "warn"}>{item.status === "RESOLVED" ? "Resolved" : "Open"}</StatusPill>}
      </div>)}
    </div> : null}

    {["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(release.status) ? <div style={styles.reviewFormWrap}>
      <div style={styles.subheading}>Staff review action</div>
      <form onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        data.set("intent", "request-changes");
        mutate(data).then?.(() => form.reset());
      }}>
        <div style={styles.reviewFormGrid}>
          <select name="reviewTrackId" style={styles.input}><option value="">Release-level change</option>{release.tracks.map((track) => <option key={track.id} value={track.id}>Track {track.position} — {track.title}</option>)}</select>
          <textarea name="message" required placeholder="Describe exactly what needs to be corrected…" style={styles.reviewTextarea} />
        </div>
        <div style={styles.sectionFooter}><button disabled={busy} style={styles.secondaryButton}>Request changes</button></div>
      </form>
      {["SUBMITTED", "IN_REVIEW"].includes(release.status) ? <div style={styles.decisionGrid}>
        <button type="button" disabled={busy || !readiness.ready || openItems.length > 0} onClick={() => send("approve-release")} style={styles.approveButton}>Approve release</button>
        <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); data.set("intent", "reject-release"); mutate(data); }} style={styles.rejectForm}>
          <input name="message" required placeholder="Reason for rejection" style={styles.input} />
          <button disabled={busy} style={styles.rejectButton}>Reject</button>
        </form>
      </div> : null}
    </div> : null}
  </s-section>;
}

function EventHistory({ events }) {
  return <s-section heading="Status history">
    {events.length ? <div style={styles.timeline}>{events.map((event) => <div key={event.id} style={styles.timelineRow}>
      <div style={styles.timelineDot} />
      <div>
        <div style={styles.timelineTitle}>{String(event.type || "EVENT").replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())}</div>
        <div style={styles.timelineMeta}>{new Date(event.createdAt).toLocaleString()}{event.fromStatus && event.toStatus ? ` · ${statusLabel(event.fromStatus)} → ${statusLabel(event.toStatus)}` : ""}</div>
        {event.message ? <div style={styles.timelineMessage}>{event.message}</div> : null}
      </div>
    </div>)}</div> : <div style={styles.emptyInline}>No workflow activity yet.</div>}
  </s-section>;
}

export default function ReleaseWorkspace() {
  const { release, artists, contributors, isrcSettings, workflowSettings } = useLoaderData();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [uploadState, setUploadState] = useState(null);

  const readiness = calculateReleaseReadiness(release, workflowSettings);
  const { titledTracks, artistReady, publishingReady, masterReady, lyricsReady, artworkReady, isrcReady } = readiness.checks;
  const editable = releaseIsEditable(release.status);
  const canAddTrack = release.type !== "SINGLE" && editable;

  const mutate = async (formData) => {
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      const result = await authenticatedPost(shopify, `/api/releases/${release.id}`, formData);
      setNotice({ tone: "good", message: result.message || "Saved." });
      await revalidator.revalidate();
    } catch (error) {
      console.error("ReleaseCore: release save request failed", error);
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : "ReleaseCore could not save this change." });
    } finally { setBusy(false); }
  };

  const addTrack = () => { const data = new FormData(); data.set("intent", "add-track"); mutate(data); };
  const assignMissingIsrcs = () => { const data = new FormData(); data.set("intent", "assign-missing-isrcs"); mutate(data); };

  const uploadFile = async ({ file, kind, trackId = "" }) => {
    if (busy) return;
    setBusy(true); setNotice(null); setUploadState({ kind, trackId, phase: "preparing", percent: 0 });
    try {
      if (kind === FILE_KINDS.COVER_ART) await validateCoverArtworkDimensions(file);
      const result = await uploadReleaseCoreFile({
        shopify,
        releaseId: release.id,
        trackId,
        kind,
        file,
        onStage: (state) => setUploadState({ kind, trackId, ...state }),
      });
      setNotice({ tone: "good", message: result.message || `${file.name} uploaded.` });
      await revalidator.revalidate();
    } catch (error) {
      console.error("ReleaseCore: file upload failed", error);
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : "ReleaseCore could not upload this file." });
    } finally {
      setBusy(false);
      setTimeout(() => setUploadState(null), 500);
    }
  };

  const removeFile = async (fileId) => {
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      const data = new FormData();
      const result = await authenticatedPost(shopify, `/api/files/${fileId}`, data);
      setNotice({ tone: "good", message: result.message || "File removed." });
      await revalidator.revalidate();
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : "ReleaseCore could not remove this file." });
    } finally { setBusy(false); }
  };

  return <s-page heading={release.title}>
    <s-button slot="secondary-actions" onClick={()=>navigate("/app/releases")}>All releases</s-button>{(release.status === "APPROVED" || (release.distributionStatus && release.distributionStatus !== "NOT_QUEUED")) ? <s-button slot="secondary-actions" onClick={()=>navigate(`/app/distribution/${release.id}`)}>Distribution</s-button> : null}
    <s-section><div style={styles.workspaceHeader}><div><div style={styles.eyebrow}>Release workspace</div><div style={styles.workspaceTitleLine}><span style={styles.workspaceTitle}>{release.title}</span><StatusPill>{typeLabel(release.type)}</StatusPill><StatusPill tone={statusTone(release.status)}>{statusLabel(release.status)}</StatusPill></div><div style={styles.workspaceMeta}>{release.artistName || "Artist not set"} · {release.tracks.length} {release.tracks.length === 1 ? "track" : "tracks"} · Release date {formatDate(release.releaseDate)}</div></div><div style={styles.saveState}>{busy ? "Working…" : editable ? "Changes saved in ReleaseCore" : "Release locked by workflow"}</div></div></s-section>
    {notice?.tone === "good" ? <div style={styles.noticeGood}>{notice.message}</div> : null}{notice?.tone === "bad" ? <div style={styles.noticeBad}>{notice.message}</div> : null}

    <WorkflowPanel release={release} readiness={readiness} mutate={mutate} busy={busy} />

    <s-section heading="Release details"><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); data.set("intent", "update-release"); mutate(data); }}><div style={styles.formGrid}><Field label="Release title"><input name="title" defaultValue={release.title} style={styles.input} /></Field><Field label="Primary genre"><Select name="primaryGenre" defaultValue={release.primaryGenre || ""} options={GENRES} placeholder="Choose genre" /></Field><Field label="Release date"><input name="releaseDate" type="date" defaultValue={dateInputValue(release.releaseDate)} style={styles.input} /></Field></div><div style={styles.sectionFooter}><button disabled={busy || !editable} style={styles.secondaryButton}>{busy ? "Saving…" : editable ? "Save release details" : "Locked during review"}</button></div></form></s-section>

    <ReleaseArtists release={release} artists={artists} mutate={mutate} busy={busy || !editable} />
    <ReleaseAssets release={release} uploadFile={uploadFile} removeFile={removeFile} busy={busy || !editable} uploadState={uploadState} requireSplitSheet={workflowSettings?.requireSplitSheet ?? false} />

    <s-section heading="Tracklist"><div style={styles.tracklistIntro}><div><div style={{ fontWeight: 700, marginBottom: 4 }}>{titledTracks} of {release.tracks.length} tracks named</div><div style={styles.muted}>Expand a song to manage metadata, master audio, lyrics, artists, contributors and publishing splits.</div></div><div style={styles.tracklistActions}>{isrcSettings.configured && isrcReady < release.tracks.length ? <button type="button" disabled={busy || !editable} onClick={assignMissingIsrcs} style={styles.secondaryButton}>Assign missing ISRCs</button> : !isrcSettings.configured ? <s-button onClick={() => navigate("/app/settings")}>Configure ISRC</s-button> : null}{release.type === "SINGLE" ? <StatusPill>Single · 1 track</StatusPill> : editable ? <button type="button" disabled={busy} onClick={addTrack} style={styles.primaryButton}>+ Add track</button> : <StatusPill tone="info">Tracklist locked</StatusPill>}</div></div><div style={{ display: "grid", gap: 10, marginTop: 16 }}>{release.tracks.map((track, index) => <TrackCard key={track.id} track={track} index={index} count={release.tracks.length} mutate={mutate} busy={busy || !editable} artists={artists} contributors={contributors} uploadFile={uploadFile} removeFile={removeFile} uploadState={uploadState} isrcConfigured={isrcSettings.configured} />)}</div>{canAddTrack ? <div style={styles.addBottom}><button type="button" disabled={busy} onClick={addTrack} style={styles.addTrackGhost}>+ Add another track</button></div> : null}</s-section>

    <EventHistory events={release.events} />

    <s-section slot="aside" heading="Release readiness"><div style={styles.readinessRow}><span>Format</span><strong>{typeLabel(release.type)}</strong></div><div style={styles.readinessRow}><span>Cover artwork</span><strong>{artworkReady ? "Ready" : "Missing"}</strong></div><div style={styles.readinessRow}><span>Tracks named</span><strong>{titledTracks}/{release.tracks.length}</strong></div><div style={styles.readinessRow}><span>ISRC assigned</span><strong>{isrcReady}/{release.tracks.length}{workflowSettings?.requireIsrc === false ? " · optional" : ""}</strong></div><div style={styles.readinessRow}><span>Master WAVs</span><strong>{masterReady}/{release.tracks.length}</strong></div><div style={styles.readinessRow}><span>Lyrics / instrumental</span><strong>{lyricsReady}/{release.tracks.length}{workflowSettings?.requireLyrics === false ? " · optional" : ""}</strong></div><div style={styles.readinessRow}><span>Tracks with artists</span><strong>{artistReady}/{release.tracks.length}</strong></div><div style={styles.readinessRow}><span>Publishing at 100%</span><strong>{publishingReady}/{release.tracks.length}{workflowSettings?.requirePublishing === false ? " · optional" : ""}</strong></div><div style={styles.readinessRow}><span>Directory</span><strong>{artists.length} artists · {contributors.length} contributors</strong></div><div style={styles.asideHelp}>{readiness.ready ? "All required release data is ready for submission." : `${readiness.blockers.length} readiness item${readiness.blockers.length === 1 ? "" : "s"} remain before this release can be submitted.`}</div></s-section>
  </s-page>;
}

const styles = {
  workspaceHeader: { display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-end", flexWrap: "wrap" }, eyebrow: { fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#6d7175", marginBottom: 7 }, workspaceTitleLine: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 7 }, workspaceTitle: { fontSize: 23, fontWeight: 700, color: "#202223" }, workspaceMeta: { fontSize: 13, color: "#6d7175" }, saveState: { fontSize: 12, color: "#8c9196" },
  pill: { display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "4px 9px", fontSize: 11, lineHeight: 1, fontWeight: 700 }, noticeGood: { maxWidth: 1000, margin: "0 auto 12px", borderRadius: 8, background: "#eaf7ee", color: "#176c37", padding: "10px 13px", fontSize: 13 }, noticeBad: { maxWidth: 1000, margin: "0 auto 12px", borderRadius: 8, background: "#fff1f0", color: "#8e1f0b", padding: "10px 13px", fontSize: 13 },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }, field: { display: "block", minWidth: 0 }, fieldLabel: { display: "block", fontSize: 12, fontWeight: 650, marginBottom: 6, color: "#303030" }, input: { display: "block", width: "100%", boxSizing: "border-box", height: 40, border: "1px solid #8c9196", borderRadius: 8, padding: "0 11px", font: "inherit", color: "#202223", background: "#fff" }, compactInput: { display: "block", width: "100%", boxSizing: "border-box", height: 36, border: "1px solid #8c9196", borderRadius: 8, padding: "0 9px", font: "inherit", background: "#fff" }, percentInput: { display: "block", width: "100%", boxSizing: "border-box", height: 36, border: "1px solid #8c9196", borderRadius: 8, padding: "0 9px", font: "inherit", background: "#fff" }, readonlyField: { height: 40, boxSizing: "border-box", display: "flex", alignItems: "center", padding: "0 11px", borderRadius: 8, border: "1px solid #e1e3e5", background: "#f6f6f7", color: "#6d7175", fontSize: 12 }, textarea: { display: "block", width: "100%", minHeight: 180, boxSizing: "border-box", border: "1px solid #8c9196", borderRadius: 8, padding: 11, resize: "vertical", font: "inherit", lineHeight: 1.45, background: "#fff" }, help: { display: "block", color: "#6d7175", fontSize: 11, lineHeight: 1.35, marginTop: 6 }, sectionFooter: { display: "flex", justifyContent: "flex-end", marginTop: 16 },
  primaryButton: { appearance: "none", border: "1px solid #303030", borderRadius: 8, background: "#303030", color: "#fff", minHeight: 36, padding: "0 14px", font: "inherit", fontWeight: 650, cursor: "pointer" }, secondaryButton: { appearance: "none", border: "1px solid #8c9196", borderRadius: 8, background: "#fff", color: "#303030", minHeight: 36, padding: "0 14px", font: "inherit", fontWeight: 650, cursor: "pointer" }, tinyButton: { appearance: "none", border: "1px solid #8c9196", borderRadius: 7, background: "#fff", minHeight: 32, padding: "0 10px", font: "inherit", fontSize: 12, fontWeight: 650, cursor: "pointer" }, dangerButton: { appearance: "none", border: "none", background: "transparent", color: "#b42318", minHeight: 32, padding: "0 6px", font: "inherit", fontSize: 12, cursor: "pointer" },
  sectionIntro: { fontSize: 13, color: "#6d7175", marginBottom: 14, lineHeight: 1.45 }, tracklistIntro: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }, tracklistActions: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }, muted: { color: "#6d7175", fontSize: 13 }, trackCard: { border: "1px solid #dedede", borderRadius: 12, background: "#fff", overflow: "hidden" }, trackSummary: { listStyle: "none", cursor: "pointer", padding: 15, display: "grid", gridTemplateColumns: "42px minmax(0,1fr) auto", gap: 12, alignItems: "center" }, trackNumber: { width: 36, height: 36, borderRadius: 9, display: "grid", placeItems: "center", background: "#f4f4f4", color: "#5c5f62", fontSize: 12, fontWeight: 750 }, trackTitle: { fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 3 }, trackMeta: { fontSize: 12, color: "#6d7175", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, trackSummaryRight: { display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }, expandHint: { fontSize: 12, color: "#6d7175" }, trackBody: { borderTop: "1px solid #ededed", padding: 16, background: "#fafafa" }, trackToolbar: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 14 }, smallEyebrow: { fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 750, color: "#8c9196", marginBottom: 3 }, iconButton: { width: 34, height: 34, border: "1px solid #c9cccf", borderRadius: 8, background: "#fff", color: "#303030", fontSize: 16, cursor: "pointer" }, checkRow: { display: "flex", gap: 9, alignItems: "flex-start", marginTop: 14, fontSize: 12, color: "#303030" }, checkHelp: { color: "#6d7175", fontWeight: 400 }, trackFooter: { display: "flex", justifyContent: "flex-end", marginTop: 16 }, subsection: { borderTop: "1px solid #e5e5e5", paddingTop: 17, marginTop: 17 }, subheading: { fontSize: 14, fontWeight: 750, color: "#303030", marginBottom: 4 }, subcopy: { fontSize: 11, color: "#6d7175", lineHeight: 1.4, marginBottom: 12 },
  assignmentList: { display: "grid", gap: 8 }, assignmentRow: { display: "grid", gridTemplateColumns: "minmax(160px,1fr) minmax(120px,170px) auto", gap: 10, alignItems: "center", border: "1px solid #e3e3e3", borderRadius: 9, padding: 10, background: "#fff" }, creditRow: { display: "grid", gridTemplateColumns: "minmax(180px,1fr) minmax(150px,190px) 100px auto", gap: 10, alignItems: "center", border: "1px solid #e3e3e3", borderRadius: 9, padding: 10, background: "#fff" }, addRow: { display: "grid", gridTemplateColumns: "minmax(200px,1fr) minmax(120px,170px) auto", gap: 10, alignItems: "end", marginTop: 10 }, creditAddRow: { display: "grid", gridTemplateColumns: "minmax(200px,1fr) minmax(150px,190px) 100px auto", gap: 10, alignItems: "end", marginTop: 10 }, rowActions: { display: "flex", gap: 5, alignItems: "center", justifyContent: "flex-end" }, micro: { fontSize: 10, color: "#8c9196", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, emptyInline: { fontSize: 12, color: "#8c9196", border: "1px dashed #d5d7d9", borderRadius: 9, padding: 12, background: "#fff" }, directoryPrompt: { fontSize: 12, color: "#6d7175", padding: "8px 0" }, creditHeading: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }, splitHelp: { fontSize: 10, color: "#8c9196", marginTop: 8, lineHeight: 1.4 }, futureSections: { display: "flex", flexWrap: "wrap", gap: 7, marginTop: 18 }, futureHelp: { color: "#8c9196", fontSize: 11, lineHeight: 1.4, marginTop: 7 }, addBottom: { display: "flex", justifyContent: "center", paddingTop: 14 }, addTrackGhost: { appearance: "none", border: "1px dashed #aeb4b9", borderRadius: 9, background: "transparent", color: "#303030", minHeight: 38, padding: "0 18px", font: "inherit", fontWeight: 650, cursor: "pointer" }, readinessRow: { display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid #ededed", fontSize: 13 }, asideHelp: { fontSize: 12, color: "#6d7175", lineHeight: 1.45, marginTop: 14 },
  assetGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }, assetCard: { border: "1px solid #e1e3e5", borderRadius: 11, padding: 14, background: "#fafafa" }, assetHeading: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }, coverPreview: { width: 124, height: 124, objectFit: "cover", borderRadius: 10, margin: "10px 0", border: "1px solid #ddd" }, uploadPanel: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", border: "1px dashed #c9cccf", borderRadius: 10, padding: 12, marginTop: 10, background: "#fff" }, uploadLabel: { fontSize: 12, fontWeight: 700, color: "#303030", marginBottom: 3 }, uploadHelp: { fontSize: 11, color: "#6d7175", lineHeight: 1.4, maxWidth: 580 }, progressWrap: { position: "relative", marginTop: 8, minWidth: 210, height: 22, borderRadius: 999, background: "#f1f1f1", overflow: "hidden", fontSize: 10, display: "flex", alignItems: "center", padding: "0 8px", boxSizing: "border-box" }, progressBar: { position: "absolute", inset: "0 auto 0 0", background: "#d8f3df", transition: "width .15s ease" }, fileCard: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: "1px solid #e3e3e3", borderRadius: 9, padding: 10, background: "#fff" }, fileCardCompact: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, border: "1px solid #e3e3e3", borderRadius: 9, padding: 9, background: "#fff", marginTop: 8 }, fileName: { fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 420 }, fileMeta: { fontSize: 10, color: "#8c9196", marginTop: 3 }, fileLink: { fontSize: 12, color: "#005bd3", textDecoration: "none" },

  workflowHeader: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" },
  workflowStatus: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }, workflowActions: { display: "flex", gap: 8, flexWrap: "wrap" },
  workflowWarning: { marginTop: 14, border: "1px solid #f0c36a", background: "#fff8e8", color: "#6d4c00", borderRadius: 10, padding: 12, fontSize: 12, lineHeight: 1.45 },
  workflowInfo: { marginTop: 14, border: "1px solid #b7cff5", background: "#f1f6ff", color: "#174ea6", borderRadius: 10, padding: 12, fontSize: 12 },
  workflowGood: { marginTop: 14, border: "1px solid #b8dfc2", background: "#eef9f1", color: "#176c37", borderRadius: 10, padding: 12, fontSize: 12 },
  workflowBad: { marginTop: 14, border: "1px solid #efb8b3", background: "#fff3f1", color: "#8e1f0b", borderRadius: 10, padding: 12, fontSize: 12 },
  blockerList: { display: "grid", gap: 3, marginTop: 6 }, reviewItems: { display: "grid", gap: 8, marginTop: 18 },
  reviewItem: { border: "1px solid #e3e3e3", borderRadius: 10, padding: 12, display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", background: "#fff" },
  reviewResolved: { opacity: .66, background: "#fafafa" }, reviewItemTitle: { fontSize: 12, fontWeight: 750, color: "#303030", marginBottom: 4 }, reviewMessage: { fontSize: 12, color: "#45484b", lineHeight: 1.45 },
  reviewFormWrap: { borderTop: "1px solid #e5e5e5", paddingTop: 18, marginTop: 18 }, reviewFormGrid: { display: "grid", gridTemplateColumns: "minmax(180px,240px) minmax(260px,1fr)", gap: 10, alignItems: "start" },
  reviewTextarea: { display: "block", width: "100%", minHeight: 82, boxSizing: "border-box", border: "1px solid #8c9196", borderRadius: 8, padding: 10, font: "inherit", resize: "vertical" },
  decisionGrid: { display: "grid", gridTemplateColumns: "auto minmax(300px,1fr)", gap: 12, alignItems: "center", marginTop: 18, paddingTop: 16, borderTop: "1px solid #ededed" },
  approveButton: { appearance: "none", border: "1px solid #176c37", borderRadius: 8, background: "#176c37", color: "#fff", minHeight: 38, padding: "0 15px", font: "inherit", fontWeight: 700, cursor: "pointer" },
  rejectForm: { display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }, rejectButton: { appearance: "none", border: "1px solid #b42318", borderRadius: 8, background: "#fff", color: "#b42318", minHeight: 38, padding: "0 14px", font: "inherit", fontWeight: 700, cursor: "pointer" },
  timeline: { display: "grid", gap: 0 }, timelineRow: { display: "grid", gridTemplateColumns: "18px 1fr", gap: 10, padding: "9px 0" }, timelineDot: { width: 9, height: 9, borderRadius: 999, background: "#8c9196", marginTop: 5 }, timelineTitle: { fontSize: 12, fontWeight: 750, color: "#303030" }, timelineMeta: { fontSize: 10, color: "#8c9196", marginTop: 2 }, timelineMessage: { fontSize: 12, color: "#5c5f62", lineHeight: 1.4, marginTop: 4 },
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
