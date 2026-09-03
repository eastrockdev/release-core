import { useState } from "react";
import { Link, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { hydrateReleaseCoverUrl } from "../lib/release-artwork.server";
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
import {
  FILE_KINDS,
  fileKindLabel,
  formatBytes,
} from "../lib/releasecore-files";
import { authenticatedPost } from "../lib/authenticated-post";
import {
  uploadReleaseCoreFile,
  validateCoverArtworkDimensions,
} from "../lib/upload-file";
import {
  calculateReleaseReadiness,
  releaseCanSubmit,
  releaseIsEditable,
  statusLabel,
  statusTone,
} from "../lib/workflow";
import { ActionFeedback, ArtistAvatar, CollapsibleSection, ReleaseHero } from "../components/releasecore-ui";
import { loadReleaseWorkspace } from "../lib/release-workspace.server";
import { revalidateInPlace } from "../lib/revalidate-in-place";

export const loader = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const data = await loadReleaseWorkspace({
    shop: session.shop,
    releaseId: params.releaseId,
  });

  await hydrateReleaseCoverUrl(
    admin,
    data?.release,
  );
  if (!data) throw new Response("Release not found", { status: 404 });
  return data;
};

function StatusPill({ children, tone = "neutral" }) {
  const palette =
    tone === "good"
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
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
      {help ? <span style={styles.help}>{help}</span> : null}
    </label>
  );
}

function Select({ name, defaultValue = "", options, placeholder = "Select" }) {
  return (
    <select className="rc-control" name={name} defaultValue={defaultValue}>
      <option value="">{placeholder}</option>
      {defaultValue && !options.includes(defaultValue) ? (
        <option value={defaultValue}>{defaultValue}</option>
      ) : null}
      {options.map((value) => (
        <option key={value} value={value}>
          {value}
        </option>
      ))}
    </select>
  );
}

function RoleSelect({ name = "role", defaultValue = "PRIMARY" }) {
  return (
    <select className="rc-control rc-control--compact" name={name} defaultValue={defaultValue}>
      {ARTIST_ROLES.map((role) => (
        <option key={role} value={role}>
          {artistRoleLabel(role)}
        </option>
      ))}
    </select>
  );
}

function CreditRoleSelect({ defaultValue = "SONGWRITER" }) {
  return (
    <select className="rc-control rc-control--compact" name="role" defaultValue={defaultValue}>
      {CREDIT_ROLES.map((role) => (
        <option key={role} value={role}>
          {creditRoleLabel(role)}
        </option>
      ))}
    </select>
  );
}

function FileCard({ file, removeFile, busy, compact = false }) {
  return (
    <div style={compact ? styles.fileCardCompact : styles.fileCard}>
      <div style={{ minWidth: 0 }}>
        <div style={styles.fileName}>{file.filename}</div>
        <div style={styles.fileMeta}>
          {fileKindLabel(file.kind)} · {formatBytes(file.sizeBytes)} ·{" "}
          {String(file.status || "Uploaded").toLowerCase()}
        </div>
      </div>
      <div style={styles.rowActions}>
        {file.url ? (
          <a
            href={file.url}
            target="_blank"
            rel="noreferrer"
            style={styles.fileLink}
          >
            View
          </a>
        ) : null}
        <button
          type="button"
          disabled={busy}
          className="rc-button rc-button--danger rc-button--compact"
          onClick={() => removeFile(file)}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function UploadControl({
  label,
  help,
  accept,
  kind,
  trackId,
  uploadFile,
  busy,
  progress,
  feedback,
}) {
  const progressPercent = Math.max(0, Math.min(100, Number(progress?.percent || 0)));
  const progressLabel = progress
    ? progress.phase === "preparing"
      ? "Preparing upload"
      : progress.phase === "finalizing"
        ? "Finalizing upload"
        : progress.phase === "done"
          ? "Upload complete"
          : progress.phase === "error"
            ? "Upload failed"
            : "Uploading"
    : "";
  return (
    <div style={styles.uploadPanel}>
      <div style={{ minWidth: 0 }}>
        <div style={styles.uploadLabel}>{label}</div>
        <div style={styles.uploadHelp}>{help}</div>
        {progress ? (
          <div className={`rc-upload-progress rc-upload-progress--${progress.phase || "uploading"}`} role="status" aria-live="polite">
            <div className="rc-upload-progress__meta">
              <span className="rc-upload-progress__label">{progressLabel}</span>
              <span className="rc-upload-progress__percent">{progressPercent}%</span>
            </div>
            <div className="rc-upload-progress__track" aria-hidden="true">
              <span className="rc-upload-progress__bar" style={{ width: `${progressPercent}%` }} />
            </div>
            {progress.message ? <div className="rc-upload-progress__detail">{progress.message}</div> : null}
          </div>
        ) : null}
        <ActionFeedback feedback={feedback} compact />
      </div>
      <label
        style={{
          ...styles.secondaryButton,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {progress && !["done", "error"].includes(progress.phase) ? `${progressLabel}…` : busy ? "Working…" : "Choose file"}
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
    </div>
  );
}

const RELEASE_AVAILABILITY_OPTIONS = [
  ["ALL_CURRENT_FUTURE", "All Current & Future Platforms"],
  ["CURRENT_ONLY", "Current Platforms Only"],
];

const RELEASE_EXCLUSIVE_PARTNERS = [
  "Apple Music",
  "Spotify",
  "Amazon Music",
  "YouTube Music",
  "TIDAL",
  "Deezer",
  "Beatport",
  "Traxsource",
  "Audiomack",
  "Other / Coordinated partner",
];

function releaseTimeParts(value) {
  const match = String(value || "").match(/^(\\d{2}):(\\d{2})$/);
  if (!match) return { hour: "12", minute: "00", meridiem: "AM" };
  const hour24 = Number(match[1]);
  return {
    hour: String(hour24 % 12 || 12),
    minute: match[2],
    meridiem: hour24 >= 12 ? "PM" : "AM",
  };
}

function ReleaseTimelineFields({ release, editable }) {
  const time = releaseTimeParts(release.releaseTime);
  const disabled = !editable;

  return (
    <>
      <Field label="Availability" help="Controls the release's intended partner availability.">
        <select className="rc-control" name="availability" defaultValue={release.availability || "ALL_CURRENT_FUTURE"} disabled={disabled}>
          {RELEASE_AVAILABILITY_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Field>

      <Field label="Enable pre-order window?">
        <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 42 }}>
          <input type="checkbox" name="preOrderEnabled" value="true" defaultChecked={Boolean(release.preOrderEnabled)} disabled={disabled} />
          <span>Allow pre-purchase before general release</span>
        </label>
      </Field>

      <Field label="Pre-order date" help="Must be before the release date when pre-order is enabled.">
        <input className="rc-control rc-admin-date-control" name="preOrderDate" type="date" defaultValue={dateInputValue(release.preOrderDate)} disabled={disabled} />
      </Field>

      <Field label="Pre-order audio previews">
        <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 42 }}>
          <input type="checkbox" name="preOrderAudioPreviews" value="true" defaultChecked={Boolean(release.preOrderAudioPreviews)} disabled={disabled} />
          <span>Enable preview audio during the pre-order window</span>
        </label>
      </Field>

      <Field label="Enable release time?">
        <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 42 }}>
          <input type="checkbox" name="releaseTimeEnabled" value="true" defaultChecked={Boolean(release.releaseTimeEnabled)} disabled={disabled} />
          <span>Choose a specific launch time</span>
        </label>
      </Field>

      <Field label="Release time">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <select className="rc-control" name="releaseTimeHour" defaultValue={time.hour} disabled={disabled}>
            {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="rc-control" name="releaseTimeMinute" defaultValue={time.minute} disabled={disabled}>
            {["00","05","10","15","20","25","30","35","40","45","50","55"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="rc-control" name="releaseTimeMeridiem" defaultValue={time.meridiem} disabled={disabled}>
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </div>
      </Field>

      <Field label="Synchronous release unlocking" help="Unlock globally at the selected release time instead of territory-local midnight.">
        <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 42 }}>
          <input type="checkbox" name="synchronousReleaseUnlocking" value="true" defaultChecked={Boolean(release.synchronousReleaseUnlocking)} disabled={disabled} />
          <span>Use one synchronized global unlock time</span>
        </label>
      </Field>

      <Field label="Enable exclusive window?">
        <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 42 }}>
          <input type="checkbox" name="exclusiveEnabled" value="true" defaultChecked={Boolean(release.exclusiveEnabled)} disabled={disabled} />
          <span>Give one partner early availability</span>
        </label>
      </Field>

      <Field label="Exclusive partner">
        <select className="rc-control" name="exclusivePartner" defaultValue={release.exclusivePartner || ""} disabled={disabled}>
          <option value="">Select exclusive partner</option>
          {RELEASE_EXCLUSIVE_PARTNERS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </Field>

      <Field label="Exclusivity period">
        <select className="rc-control" name="exclusivePeriodWeeks" defaultValue={release.exclusivePeriodWeeks || ""} disabled={disabled}>
          <option value="">Select period</option>
          {[2,4,6,8].map((weeks) => <option key={weeks} value={weeks}>{weeks} Weeks</option>)}
        </select>
      </Field>
    </>
  );
}

function ReleaseArtists({ release, artists, mutate, busy, feedback }) {
  return (
    <CollapsibleSection
      icon="artist"
      title="Release artists"
      description="Primary and featured artist identities credited across the release."
      summary={`${release.artists.length} assigned`}
    >
      <div style={styles.sectionIntro}>
        Assign the artist identities credited at the release level. Track-level
        featured artists are managed inside each song.
      </div>
      <ActionFeedback feedback={feedback} />
      {release.artists.length ? (
        <div style={styles.assignmentList}>
          {release.artists.map((assignment) => (
            <form
              key={assignment.id}
              className="rc-assignment-row"
              style={styles.assignmentRow}
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                data.set("intent", "update-release-artist");
                data.set("assignmentId", assignment.id);
                mutate(data);
              }}
            >
              <div className="rc-artist-assignment-identity">
                <ArtistAvatar artist={assignment.artist} size="small" />
                <div style={{ minWidth: 0 }}>
                  <strong>{assignment.artist.name}</strong>
                  <div style={styles.micro}>
                    {assignment.artist.legalName || "Artist identity"}
                  </div>
                </div>
              </div>
              <RoleSelect defaultValue={assignment.role} />
              <div style={styles.rowActions}>
                <button disabled={busy} className="rc-button rc-button--compact">
                  Save
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="rc-button rc-button--danger rc-button--compact"
                  onClick={() => {
                    const data = new FormData();
                    data.set("intent", "remove-release-artist");
                    data.set("assignmentId", assignment.id);
                    mutate(data);
                  }}
                >
                  Remove
                </button>
              </div>
            </form>
          ))}
        </div>
      ) : (
        <div style={styles.emptyInline}>No release artists assigned yet.</div>
      )}
      {artists.length ? (
        <form
          style={styles.addRow}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            data.set("intent", "add-release-artist");
            mutate(data);
          }}
        >
          <select name="artistId" required className="rc-control">
            <option value="">Choose artist…</option>
            {artists.map((artist) => (
              <option key={artist.id} value={artist.id}>
                {artist.name}
              </option>
            ))}
          </select>
          <RoleSelect />
          <button disabled={busy} className="rc-button">
            Add artist
          </button>
        </form>
      ) : (
        <div style={styles.directoryPrompt}>
          Create an artist in <Link to="/app/artists">Artists</Link> before
          assigning release credits.
        </div>
      )}
    </CollapsibleSection>
  );
}

function ReleaseAssets({
  release,
  uploadFile,
  removeFile,
  busy,
  uploadState,
  feedbackFor,
  requireSplitSheet = false,
}) {
  const cover = release.files.find(
    (file) => file.kind === FILE_KINDS.COVER_ART,
  );
  const splitSheet = release.files.find(
    (file) => file.kind === FILE_KINDS.SPLIT_SHEET,
  );
  const supporting = release.files.filter(
    (file) => file.kind === FILE_KINDS.SUPPORTING_DOCUMENT,
  );
  return (
    <CollapsibleSection
      icon="files"
      title="Release files"
      description="Cover artwork, split sheets, and supporting documentation."
      summary={cover ? "Artwork ready" : "Artwork required"}
      defaultOpen={!cover}
    >
      <div style={styles.sectionIntro}>
        Store the release-level artwork and documentation that travels with the
        distribution project.
      </div>
      <div style={styles.assetGrid}>
        <div style={styles.assetCard}>
          <div style={styles.assetHeading}>
            <div>
              <div style={styles.subheading}>Cover artwork</div>
              <div style={styles.subcopy}>
                JPG or PNG, square, at least 3000×3000px.
              </div>
            </div>
            <StatusPill tone={cover ? "good" : "warn"}>
              {cover ? "Uploaded" : "Required"}
            </StatusPill>
          </div>
          {cover?.url ? (
            <img
              src={cover.url}
              alt="Release cover"
              style={styles.coverPreview}
            />
          ) : null}
          {cover ? (
            <FileCard
              file={cover}
              removeFile={removeFile}
              busy={busy}
              compact
            />
          ) : null}
          <UploadControl
            label={cover ? "Replace artwork" : "Upload artwork"}
            help="ReleaseCore validates dimensions in the browser before upload."
            accept="image/jpeg,image/png,.jpg,.jpeg,.png"
            kind={FILE_KINDS.COVER_ART}
            uploadFile={uploadFile}
            busy={busy}
            progress={
              uploadState?.kind === FILE_KINDS.COVER_ART ? uploadState : null
            }
            feedback={feedbackFor(`upload:${FILE_KINDS.COVER_ART}:release`)}
          />
        </div>
        <div style={styles.assetCard}>
          <div style={styles.assetHeading}>
            <div>
              <div style={styles.subheading}>Split sheet</div>
              <div style={styles.subcopy}>
                {requireSplitSheet
                  ? "Required release-level songwriter ownership documentation."
                  : "Optional release-level songwriter ownership documentation."}
              </div>
            </div>
            <StatusPill
              tone={
                splitSheet ? "good" : requireSplitSheet ? "warn" : "neutral"
              }
            >
              {splitSheet
                ? "Uploaded"
                : requireSplitSheet
                  ? "Required"
                  : "Optional"}
            </StatusPill>
          </div>
          {splitSheet ? (
            <FileCard
              file={splitSheet}
              removeFile={removeFile}
              busy={busy}
              compact
            />
          ) : null}
          <UploadControl
            label={splitSheet ? "Replace split sheet" : "Upload split sheet"}
            help="PDF only. This supports the structured publishing credits entered on each track."
            accept="application/pdf,.pdf"
            kind={FILE_KINDS.SPLIT_SHEET}
            uploadFile={uploadFile}
            busy={busy}
            progress={
              uploadState?.kind === FILE_KINDS.SPLIT_SHEET ? uploadState : null
            }
            feedback={feedbackFor(`upload:${FILE_KINDS.SPLIT_SHEET}:release`)}
          />
        </div>
      </div>
      <div style={styles.subsection}>
        <div style={styles.subheading}>Supporting documents</div>
        <div style={styles.subcopy}>
          Optional PDFs or images such as licensing documentation, sample
          clearances, or other release notes.
        </div>
        {supporting.length ? (
          <div style={styles.assignmentList}>
            {supporting.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                removeFile={removeFile}
                busy={busy}
              />
            ))}
          </div>
        ) : (
          <div style={styles.emptyInline}>
            No supporting documents uploaded.
          </div>
        )}
        <UploadControl
          label="Add supporting document"
          help="PDF, JPG, or PNG. Multiple supporting files are allowed."
          accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
          kind={FILE_KINDS.SUPPORTING_DOCUMENT}
          uploadFile={uploadFile}
          busy={busy}
          progress={
            uploadState?.kind === FILE_KINDS.SUPPORTING_DOCUMENT
              ? uploadState
              : null
          }
          feedback={feedbackFor(`upload:${FILE_KINDS.SUPPORTING_DOCUMENT}:release`)}
        />
      </div>
    </CollapsibleSection>
  );
}

function TrackCard({
  track,
  index,
  count,
  mutate,
  busy,
  artists,
  contributors,
  releaseArtists,
  uploadFile,
  removeFile,
  uploadState,
  feedbackFor,
  isrcConfigured,
  isrcMode,
}) {
  const complete = !trackNeedsTitle(track);
  const writerCredits = track.credits.filter((credit) =>
    isPublishingRole(credit.role),
  );
  const publishingTotal = writerCredits.reduce(
    (sum, credit) => sum + (credit.ownershipPercent || 0),
    0,
  );
  const publishingTone =
    publishingTotal === 100 ? "good" : publishingTotal > 0 ? "warn" : "neutral";
  const master = track.files.find(
    (file) => file.kind === FILE_KINDS.MASTER_WAV,
  );
  const lyricsReady =
    track.language === "Instrumental / No linguistic content" ||
    Boolean(track.lyrics?.trim());
  const move = (intent) => {
    const data = new FormData();
    data.set("intent", intent);
    data.set("trackId", track.id);
    mutate(data);
  };
  const relationshipArtists = track.artists.length ? track.artists : releaseArtists;
  const trackArtistIds = new Set(relationshipArtists.map((item) => item.artistId));
  const linkedContributorIds = new Set(
    artists
      .filter((artist) => trackArtistIds.has(artist.id))
      .flatMap((artist) =>
        artist.contributors.map((item) => item.contributorId),
      ),
  );
  const suggestedContributors = contributors.filter((item) =>
    linkedContributorIds.has(item.id),
  );
  const otherContributors = contributors.filter(
    (item) => !linkedContributorIds.has(item.id),
  );

  return (
    <details style={styles.trackCard}>
      <summary className="rc-track-summary" style={styles.trackSummary}>
        <div style={styles.trackNumber}>
          {String(index + 1).padStart(2, "0")}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={styles.trackTitle}>{track.title || "Untitled Track"}</div>
          <div style={styles.trackMeta}>
            {track.version || "Original version"}
            {track.language ? ` · ${track.language}` : ""}
            {track.explicit ? " · Explicit" : " · Clean / not marked explicit"}
          </div>
        </div>
        <div className="rc-track-summary__status" style={styles.trackSummaryRight}>
          <StatusPill tone={complete ? "good" : "warn"}>
            {complete ? "Basics saved" : "Needs title"}
          </StatusPill>
          <StatusPill
            tone={
              track.isrc
                ? "good"
                : isrcMode === "ADMIN"
                  ? "neutral"
                  : isrcConfigured
                    ? "warn"
                    : "neutral"
            }
          >
            {track.isrc
              ? track.isrc
              : isrcMode === "ADMIN"
                ? "Provided in Distribution"
              : isrcConfigured
                ? "Needs ISRC"
                : "ISRC not configured"}
          </StatusPill>
          <StatusPill tone={master ? "good" : "warn"}>
            {master ? "Master uploaded" : "Needs master"}
          </StatusPill>
          <StatusPill tone={track.artists.length ? "good" : "warn"}>
            {track.artists.length} artist{track.artists.length === 1 ? "" : "s"}
          </StatusPill>
          <StatusPill tone={publishingTone}>
            {publishingTotal}% publishing
          </StatusPill>
          <span style={styles.expandHint}>Edit</span>
        </div>
      </summary>
      <div style={styles.trackBody}>
        <div style={styles.trackToolbar}>
          <div>
            <div style={styles.smallEyebrow}>Track {index + 1}</div>
            <div style={{ fontWeight: 700 }}>Song workspace</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => move("move-up")}
              disabled={busy || index === 0}
              className="rc-button rc-button--icon"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move("move-down")}
              disabled={busy || index === count - 1}
              className="rc-button rc-button--icon"
            >
              ↓
            </button>
          </div>
        </div>
        <ActionFeedback feedback={feedbackFor(`track:${track.id}`)} />

        <div style={styles.subsection}>
          <div style={styles.subheading}>Basic details</div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              data.set("intent", "update-track");
              data.set("trackId", track.id);
              mutate(data);
            }}
          >
            <div style={styles.formGrid}>
              <Field
                label="Track title"
                help="Use the song title only. Version information has its own field."
              >
                <input
                  name="title"
                  defaultValue={
                    track.title === "Untitled Track" ? "" : track.title
                  }
                  placeholder="Song title"
                  className="rc-control"
                />
              </Field>
              <Field
                label="Version / subtitle"
                help="Examples: Remix, Acoustic, Radio Edit. Leave blank for the original version."
              >
                <input
                  name="version"
                  defaultValue={track.version || ""}
                  placeholder="Original version"
                  className="rc-control"
                />
              </Field>
              <Field label="Language">
                <Select
                  name="language"
                  defaultValue={track.language || ""}
                  options={LANGUAGES}
                  placeholder="Choose language"
                />
              </Field>
              <Field
                label="ISRC"
                help={
                  track.isrc
                    ? "This permanent recording identifier is locked and is not rewritten when settings change."
                    : isrcMode === "ADMIN"
                      ? "Your aggregator or Shopify admin will enter this code in the Distribution workspace. It does not block artist submission."
                    : isrcConfigured
                      ? "ReleaseCore will assign the next available ISRC automatically. You can also assign all missing codes from the tracklist header."
                      : "Configure your Country Code and Registrant Code in Settings before ReleaseCore can assign an ISRC."
                }
              >
                <div style={styles.readonlyField}>
                  {track.isrc
                    ? track.isrc
                    : isrcMode === "ADMIN"
                      ? "Provided during distribution"
                    : isrcConfigured
                      ? "Automatic · Waiting for assignment"
                      : "Automatic · Configure Settings"}
                </div>
              </Field>
            </div>
            <div style={styles.checkRow}>
              <input
                id={`track-${track.id}-explicit`}
                type="checkbox"
                name="explicit"
                defaultChecked={track.explicit}
              />
              <span>
                <label
                  htmlFor={`track-${track.id}-explicit`}
                  style={{ fontWeight: 700, cursor: "pointer" }}
                >
                  Explicit content
                </label>
                <span style={styles.checkHelp}>
                  {" "}
                  Mark this track explicit if its lyrical or audio content
                  requires an explicit designation.
                </span>
              </span>
            </div>
            <div style={styles.trackFooter}>
              <button disabled={busy} className="rc-button">
                {busy ? "Saving…" : "Save basic details"}
              </button>
            </div>
          </form>
        </div>

        <div style={styles.subsection}>
          <div style={styles.assetHeading}>
            <div>
              <div style={styles.subheading}>Audio master</div>
              <div style={styles.subcopy}>
                Upload the final uncompressed WAV that should be delivered for
                this recording.
              </div>
            </div>
            <StatusPill tone={master ? "good" : "warn"}>
              {master ? "Ready" : "Required"}
            </StatusPill>
          </div>
          {master ? (
            <FileCard file={master} removeFile={removeFile} busy={busy} />
          ) : (
            <div style={styles.emptyInline}>No master WAV uploaded.</div>
          )}
          <UploadControl
            label={master ? "Replace master WAV" : "Upload master WAV"}
            help="WAV only. Maximum 500 MB. Masters are stored privately and are never exposed as permanent public files."
            accept="audio/wav,audio/x-wav,.wav"
            kind={FILE_KINDS.MASTER_WAV}
            trackId={track.id}
            uploadFile={uploadFile}
            busy={busy}
            progress={
              uploadState?.trackId === track.id &&
              uploadState?.kind === FILE_KINDS.MASTER_WAV
                ? uploadState
                : null
            }
            feedback={feedbackFor(`upload:${FILE_KINDS.MASTER_WAV}:${track.id}`)}
          />
        </div>

        <div style={styles.subsection}>
          <div style={styles.assetHeading}>
            <div>
              <div style={styles.subheading}>Lyrics</div>
              <div style={styles.subcopy}>
                Enter the complete lyrics exactly as performed. Instrumental
                tracks can leave this blank when the language is marked
                accordingly.
              </div>
            </div>
            <StatusPill tone={lyricsReady ? "good" : "warn"}>
              {lyricsReady ? "Ready" : "Missing"}
            </StatusPill>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              data.set("intent", "update-lyrics");
              data.set("trackId", track.id);
              mutate(data);
            }}
          >
            <textarea
              name="lyrics"
              defaultValue={track.lyrics || ""}
              placeholder="Paste complete lyrics here…"
              className="rc-control"
            />
            <div style={styles.trackFooter}>
              <button disabled={busy} className="rc-button">
                {busy ? "Saving…" : "Save lyrics"}
              </button>
            </div>
          </form>
        </div>

        <div style={styles.subsection}>
          <div style={styles.subheading}>Artists</div>
          <div style={styles.subcopy}>
            Primary and featured artist identities for this recording.
          </div>
          {track.artists.length ? (
            <div style={styles.assignmentList}>
              {track.artists.map((assignment) => (
                <form
                  key={assignment.id}
                  className="rc-assignment-row"
                  style={styles.assignmentRow}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    data.set("intent", "update-track-artist");
                    data.set("trackId", track.id);
                    data.set("assignmentId", assignment.id);
                    mutate(data);
                  }}
                >
                  <div className="rc-artist-assignment-identity">
                    <ArtistAvatar artist={assignment.artist} size="small" />
                    <div style={{ minWidth: 0 }}>
                      <strong>{assignment.artist.name}</strong>
                      <div style={styles.micro}>
                        {assignment.artist.legalName || "Artist identity"}
                      </div>
                    </div>
                  </div>
                  <RoleSelect defaultValue={assignment.role} />
                  <div style={styles.rowActions}>
                    <button disabled={busy} className="rc-button rc-button--compact">
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rc-button rc-button--danger rc-button--compact"
                      onClick={() => {
                        const data = new FormData();
                        data.set("intent", "remove-track-artist");
                        data.set("trackId", track.id);
                        data.set("assignmentId", assignment.id);
                        mutate(data);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </form>
              ))}
            </div>
          ) : (
            <div style={styles.emptyInline}>
              No artists assigned to this track.
            </div>
          )}
          {artists.length ? (
            <form
              style={styles.addRow}
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                data.set("intent", "add-track-artist");
                data.set("trackId", track.id);
                mutate(data);
              }}
            >
              <select name="artistId" required className="rc-control">
                <option value="">Choose artist…</option>
                {artists.map((artist) => (
                  <option key={artist.id} value={artist.id}>
                    {artist.name}
                  </option>
                ))}
              </select>
              <RoleSelect />
              <button disabled={busy} className="rc-button">
                Add artist
              </button>
            </form>
          ) : (
            <div style={styles.directoryPrompt}>
              No artist identities yet.{" "}
              <Link to="/app/artists">Add artists</Link>.
            </div>
          )}
        </div>

        <div style={styles.subsection}>
          <div style={styles.creditHeading}>
            <div>
              <div style={styles.subheading}>Credits & publishing</div>
              <div style={styles.subcopy}>
                Credit reusable contributors, then assign publishing ownership
                to songwriter/composer rows.
              </div>
            </div>
            <StatusPill tone={publishingTone}>
              {publishingTotal}% songwriter ownership
            </StatusPill>
          </div>
          {track.credits.length ? (
            <div style={styles.assignmentList}>
              {track.credits.map((credit) => (
                <form
                  key={credit.id}
                  className="rc-credit-row"
                  style={styles.creditRow}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    data.set("intent", "update-credit");
                    data.set("trackId", track.id);
                    data.set("creditId", credit.id);
                    mutate(data);
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <strong>
                      {contributorDisplayName(credit.contributor)}
                    </strong>
                    <div style={styles.micro}>
                      {credit.contributor.legalName}
                      {credit.contributor.pro
                        ? ` · ${credit.contributor.pro}`
                        : ""}
                      {credit.contributor.ipi
                        ? ` · IPI ${credit.contributor.ipi}`
                        : ""}
                    </div>
                  </div>
                  <CreditRoleSelect defaultValue={credit.role} />
                  <input
                    name="ownershipPercent"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={credit.ownershipPercent ?? ""}
                    placeholder="Split %"
                    className="rc-control rc-control--compact"
                  />
                  <div style={styles.rowActions}>
                    <button disabled={busy} className="rc-button rc-button--compact">
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rc-button rc-button--danger rc-button--compact"
                      onClick={() => {
                        const data = new FormData();
                        data.set("intent", "remove-credit");
                        data.set("trackId", track.id);
                        data.set("creditId", credit.id);
                        mutate(data);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </form>
              ))}
            </div>
          ) : (
            <div style={styles.emptyInline}>No contributors credited yet.</div>
          )}
          {suggestedContributors.length ? (
            <div className="rc-linked-suggestion">
              Suggested for{" "}
              {relationshipArtists.map((item) => item.artist.name).join(", ")}:{" "}
              {suggestedContributors.map(contributorDisplayName).join(", ")}
            </div>
          ) : null}
          {contributors.length ? (
            <form
              style={styles.creditAddRow}
              className="rc-credit-row"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                data.set("intent", "add-credit");
                data.set("trackId", track.id);
                mutate(data);
              }}
            >
              <select name="contributorId" required className="rc-control">
                <option value="">Choose contributor…</option>
                {suggestedContributors.length ? (
                  <optgroup label="Linked to this artist">
                    {suggestedContributors.map((contributor) => (
                      <option key={contributor.id} value={contributor.id}>
                        {contributorDisplayName(contributor)} —{" "}
                        {contributor.legalName}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {otherContributors.length ? (
                  <optgroup
                    label={
                      suggestedContributors.length
                        ? "All other contributors"
                        : "All contributors"
                    }
                  >
                    {otherContributors.map((contributor) => (
                      <option key={contributor.id} value={contributor.id}>
                        {contributorDisplayName(contributor)} —{" "}
                        {contributor.legalName}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <CreditRoleSelect />
              <input
                name="ownershipPercent"
                type="number"
                min="0"
                max="100"
                step="0.01"
                placeholder="Split %"
                className="rc-control rc-control--compact"
              />
              <button disabled={busy} className="rc-button">
                Add credit
              </button>
            </form>
          ) : (
            <div style={styles.directoryPrompt}>
              No contributor records yet.{" "}
              <Link to="/app/contributors">Add contributors</Link>.
            </div>
          )}
          <div style={styles.splitHelp}>
            Ownership is only stored for Songwriter and Composer credits.
            ReleaseCore prevents the publishing total from exceeding 100%.
          </div>
        </div>
      </div>
    </details>
  );
}

function WorkflowPanel({ release, readiness, mutate, busy, feedback }) {
  const editable = releaseIsEditable(release.status);
  const canSubmit = releaseCanSubmit(release.status);
  const openItems = release.reviewItems.filter(
    (item) => item.status === "OPEN",
  );
  const send = (intent, extras = {}) => {
    const data = new FormData();
    data.set("intent", intent);
    Object.entries(extras).forEach(([key, value]) => data.set(key, value));
    mutate(data);
  };

  return (
    <s-section heading="Submission workflow">
<ActionFeedback feedback={feedback} />
            <div style={styles.workflowHeader}>
        <div>
          <div style={styles.smallEyebrow}>Current status</div>
          <div style={styles.workflowStatus}>
            <StatusPill tone={statusTone(release.status)}>
              {statusLabel(release.status)}
            </StatusPill>
            {release.lastSubmittedAt ? (
              <span style={styles.muted}>
                Last submitted{" "}
                {new Date(release.lastSubmittedAt).toLocaleString()}
              </span>
            ) : null}
          </div>
        </div>
        <div className="rc-workflow-actions" style={styles.workflowActions}>
          {canSubmit ? (
            <button
              type="button"
              disabled={busy || !readiness.ready || openItems.length > 0}
              onClick={() => send("submit-release")}
              className="rc-button rc-button--primary"
            >
              {release.submittedAt
                ? "Resubmit for review"
                : "Submit for review"}
            </button>
          ) : null}
          {release.status === "SUBMITTED" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => send("start-review")}
              className="rc-button rc-button--primary"
            >
              Start review
            </button>
          ) : null}
          {["SUBMITTED", "IN_REVIEW", "APPROVED", "REJECTED"].includes(
            release.status,
          ) ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => send("reopen-draft")}
              className="rc-button"
            >
              Reopen draft
            </button>
          ) : null}
        </div>
      </div>

      {canSubmit && !readiness.ready ? (
        <div style={styles.workflowWarning}>
          <strong>Not ready to submit.</strong>
          <div style={styles.blockerList}>
            {readiness.blockers.slice(0, 8).map((item, index) => (
              <div key={`${item.code}-${item.trackId || index}`}>
                • {item.message}
              </div>
            ))}
          </div>
          {readiness.blockers.length > 8 ? (
            <div style={styles.micro}>
              + {readiness.blockers.length - 8} more readiness items
            </div>
          ) : null}
        </div>
      ) : null}
      {canSubmit && openItems.length ? (
        <div style={styles.workflowWarning}>
          <strong>
            {openItems.length} change request{openItems.length === 1 ? "" : "s"}{" "}
            still open.
          </strong>{" "}
          Resolve them before resubmitting.
        </div>
      ) : null}
      {!editable && ["SUBMITTED", "IN_REVIEW"].includes(release.status) ? (
        <div style={styles.workflowInfo}>
          Release metadata is locked while this submission is under review.
          Request changes or reopen the draft before editing.
        </div>
      ) : null}
      {release.status === "APPROVED" ? (
        <div style={styles.workflowGood}>
          Approved. This release is ready to move into Distribution.
        </div>
      ) : null}
      {release.status === "REJECTED" ? (
        <div style={styles.workflowBad}>
          Rejected. Reopen the release as a draft if it should be revised and
          submitted again.
        </div>
      ) : null}

      {release.reviewItems.length ? (
        <div style={styles.reviewItems}>
          <div style={styles.subheading}>Change requests</div>
          {release.reviewItems.map((item) => (
            <div
              key={item.id}
              style={{
                ...styles.reviewItem,
                ...(item.status === "RESOLVED" ? styles.reviewResolved : {}),
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={styles.reviewItemTitle}>
                  {item.track
                    ? `Track ${item.track.position}: ${item.track.title}`
                    : "Release-level change"}
                </div>
                <div style={styles.reviewMessage}>{item.message}</div>
                <div style={styles.micro}>
                  {item.status === "RESOLVED"
                    ? `Resolved${item.resolvedAt ? ` ${new Date(item.resolvedAt).toLocaleString()}` : ""}`
                    : `Requested ${new Date(item.createdAt).toLocaleString()}`}
                </div>
              </div>
              {item.status === "OPEN" && editable ? (
                <button
                  type="button"
                  disabled={busy}
                  className="rc-button rc-button--compact"
                  onClick={() =>
                    send("resolve-review-item", { reviewItemId: item.id })
                  }
                >
                  Mark resolved
                </button>
              ) : (
                <StatusPill tone={item.status === "RESOLVED" ? "good" : "warn"}>
                  {item.status === "RESOLVED" ? "Resolved" : "Open"}
                </StatusPill>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(
        release.status,
      ) ? (
        <div style={styles.reviewFormWrap}>
          <div style={styles.subheading}>Staff review action</div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              data.set("intent", "request-changes");
              mutate(data).then?.(() => form.reset());
            }}
          >
            <div style={styles.reviewFormGrid}>
              <select name="reviewTrackId" className="rc-control">
                <option value="">Release-level change</option>
                {release.tracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    Track {track.position} — {track.title}
                  </option>
                ))}
              </select>
              <textarea
                name="message"
                required
                placeholder="Describe exactly what needs to be corrected…"
                className="rc-control"
              />
            </div>
            <div className="rc-form-actions" style={styles.sectionFooter}>
              <button disabled={busy} className="rc-button">
                Request changes
              </button>
            </div>
          </form>
          {["SUBMITTED", "IN_REVIEW"].includes(release.status) ? (
            <div className="rc-release-decision-grid" style={styles.decisionGrid}>
              <button
                type="button"
                disabled={busy || !readiness.ready || openItems.length > 0}
                onClick={() => send("approve-release")}
                className="rc-button rc-button--success"
              >
                Approve release
              </button>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  data.set("intent", "reject-release");
                  mutate(data);
                }}
                className="rc-release-reject-form" style={styles.rejectForm}
              >
                <input
                  name="message"
                  required
                  placeholder="Reason for rejection"
                  className="rc-control"
                />
                <button disabled={busy} className="rc-button rc-button--danger">
                  Reject
                </button>
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
    </s-section>
  );
}

function EventHistory({ events }) {
  return (
    <CollapsibleSection
      icon="history"
      title="Status history"
      description="Submission decisions, requested changes, and other release activity."
      summary={`${events.length} event${events.length === 1 ? "" : "s"}`}
    >
      {events.length ? (
        <div style={styles.timeline}>
          {events.map((event) => (
            <div key={event.id} style={styles.timelineRow}>
              <div style={styles.timelineDot} />
              <div>
                <div style={styles.timelineTitle}>
                  {String(event.type || "EVENT")
                    .replaceAll("_", " ")
                    .toLowerCase()
                    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())}
                </div>
                <div style={styles.timelineMeta}>
                  {new Date(event.createdAt).toLocaleString()}
                  {event.fromStatus && event.toStatus
                    ? ` · ${statusLabel(event.fromStatus)} → ${statusLabel(event.toStatus)}`
                    : ""}
                </div>
                {event.message ? (
                  <div style={styles.timelineMessage}>{event.message}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={styles.emptyInline}>No workflow activity yet.</div>
      )}
    </CollapsibleSection>
  );
}

const WORKFLOW_INTENTS = new Set([
  "submit-release",
  "start-review",
  "request-changes",
  "resolve-review-item",
  "approve-release",
  "reject-release",
  "reopen-release",
]);

function releaseActionScope(formData) {
  const intent = String(formData.get("intent") || "");
  const trackId = String(formData.get("trackId") || "");
  if (trackId) return `track:${trackId}`;
  if (WORKFLOW_INTENTS.has(intent)) return "workflow";
  if (["add-release-artist", "update-release-artist", "remove-release-artist"].includes(intent)) return "release-artists";
  if (intent === "update-release") return "release-details";
  if (["add-track", "assign-missing-isrcs"].includes(intent)) return "tracklist";
  return "release";
}

function releasePendingMessage(formData) {
  const intent = String(formData.get("intent") || "");
  return ({
    "update-release": "Saving release details…",
    "add-release-artist": "Adding release artist…",
    "update-release-artist": "Saving artist role…",
    "remove-release-artist": "Removing release artist…",
    "add-track": "Adding track…",
    "assign-missing-isrcs": "Assigning missing ISRCs…",
    "update-track": "Saving track details…",
    "update-lyrics": "Saving lyrics…",
    "add-track-artist": "Adding track artist…",
    "update-track-artist": "Saving track artist…",
    "remove-track-artist": "Removing track artist…",
    "add-credit": "Adding contributor credit…",
    "update-credit": "Saving contributor credit…",
    "remove-credit": "Removing contributor credit…",
    "move-up": "Moving track…",
    "move-down": "Moving track…",
    "submit-release": "Submitting release for review…",
    "start-review": "Starting review…",
    "request-changes": "Creating change request…",
    "resolve-review-item": "Resolving change request…",
    "approve-release": "Approving release…",
    "reject-release": "Rejecting release…",
    "reopen-release": "Reopening release…",
  })[intent] || "Saving change…";
}

export default function ReleaseWorkspace() {
  const { release, artists, contributors, isrcSettings, workflowSettings } =
    useLoaderData();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [uploadState, setUploadState] = useState(null);

  const readiness = calculateReleaseReadiness(release, workflowSettings);
  const {
    titledTracks,
    artistReady,
    publishingReady,
    masterReady,
    lyricsReady,
    artworkReady,
    isrcReady,
  } = readiness.checks;
  const editable = releaseIsEditable(release.status);
  const canAddTrack = release.type !== "SINGLE" && editable;
  const feedbackFor = (scope) => (notice?.scope === scope ? notice : null);

  const mutate = async (formData) => {
    if (busy) return;
    const scope = releaseActionScope(formData);
    setBusy(true);
    setNotice({ scope, tone: "info", message: releasePendingMessage(formData) });
    try {
      const result = await authenticatedPost(
        shopify,
        `/api/releases/${release.id}`,
        formData,
      );
      setNotice({ scope, tone: "good", message: result.message || "Saved." });
      await revalidateInPlace(revalidator);
    } catch (error) {
      console.error("ReleaseCore: release save request failed", error);
      setNotice({
        scope,
        tone: "bad",
        message:
          error instanceof Error
            ? error.message
            : "ReleaseCore could not save this change.",
      });
    } finally {
      setBusy(false);
    }
  };

  const addTrack = () => {
    const data = new FormData();
    data.set("intent", "add-track");
    mutate(data);
  };
  const assignMissingIsrcs = () => {
    const data = new FormData();
    data.set("intent", "assign-missing-isrcs");
    mutate(data);
  };

  const uploadFile = async ({ file, kind, trackId = "" }) => {
    if (busy) return;
    const scope = `upload:${kind}:${trackId || "release"}`;
    setBusy(true);
    setNotice({ scope, tone: "info", message: `Preparing ${file.name}…` });
    setUploadState({ kind, trackId, phase: "preparing", percent: 0, message: `Preparing ${file.name}…` });
    try {
      if (kind === FILE_KINDS.COVER_ART)
        await validateCoverArtworkDimensions(file);
      const result = await uploadReleaseCoreFile({
        shopify,
        releaseId: release.id,
        trackId,
        kind,
        file,
        onStage: (state) => {
          setUploadState({ kind, trackId, ...state });
          const phaseMessage = state.message || (state.phase === "finalizing" ? `Finalizing ${file.name}…` : state.phase === "uploading" ? `Uploading ${file.name}…` : `Preparing ${file.name}…`);
          setNotice({ scope, tone: "info", message: phaseMessage });
        },
      });
      const successMessage = result.message || `${file.name} uploaded.`;
      setUploadState({ kind, trackId, phase: "done", percent: 100, message: successMessage });
      setNotice({ scope, tone: "good", message: successMessage });
      await revalidateInPlace(revalidator);
    } catch (error) {
      console.error("ReleaseCore: file upload failed", error);
      const message = error instanceof Error ? error.message : "ReleaseCore could not upload this file.";
      setUploadState({ kind, trackId, phase: "error", percent: 0, message });
      setNotice({ scope, tone: "bad", message });
    } finally {
      setBusy(false);
      setTimeout(() => {
        setUploadState((current) =>
          current?.kind === kind && current?.trackId === trackId && current?.phase === "done" ? null : current,
        );
      }, 3000);
    }
  };

  const removeFile = async (file) => {
    if (busy) return;
    const scope = `upload:${file.kind}:${file.trackId || "release"}`;
    setBusy(true);
    setNotice({ scope, tone: "info", message: `Removing ${file.filename || "file"}…` });
    try {
      const data = new FormData();
      const result = await authenticatedPost(
        shopify,
        `/api/files/${file.id}`,
        data,
      );
      setNotice({ scope, tone: "good", message: result.message || "File removed." });
      await revalidateInPlace(revalidator);
    } catch (error) {
      setNotice({
        scope,
        tone: "bad",
        message:
          error instanceof Error
            ? error.message
            : "ReleaseCore could not remove this file.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <s-page heading={release.title}>
      <s-button
        slot="secondary-actions"
        onClick={() => navigate("/app/releases")}
      >
        All releases
      </s-button>
      {release.status === "APPROVED" ||
      (release.distributionStatus &&
        release.distributionStatus !== "NOT_QUEUED") ? (
        <s-button
          slot="secondary-actions"
          onClick={() => navigate(`/app/distribution/${release.id}`)}
        >
          Distribution
        </s-button>
      ) : null}
      <s-section>
        <ReleaseHero
          release={release}
          badges={[
            { label: typeLabel(release.type), tone: "neutral" },
            {
              label: statusLabel(release.status),
              tone: statusTone(release.status),
            },
          ]}
          meta={`${release.artistName || "Artist not set"} · ${release.tracks.length} ${release.tracks.length === 1 ? "track" : "tracks"} · Release ${formatDate(release.releaseDate)}`}
          trailing={
            busy
              ? "Working…"
              : editable
                ? "All changes saved"
                : "Editing locked during review"
          }
        />
      </s-section>
      <ActionFeedback feedback={feedbackFor("release")} />

      <WorkflowPanel
        release={release}
        readiness={readiness}
        mutate={mutate}
        busy={busy}
        feedback={feedbackFor("workflow")}
      />

      <CollapsibleSection
        icon="catalog"
        title="Release details"
        description="Core title, genre, and scheduling information."
        summary={
          release.releaseDate
            ? `Release ${formatDate(release.releaseDate)}`
            : "Date required"
        }
        defaultOpen
      >
        <ActionFeedback feedback={feedbackFor("release-details")} />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            data.set("intent", "update-release");
            mutate(data);
          }}
        >
          <div style={styles.formGrid}>
            <Field label="Release title">
              <input
                name="title"
                defaultValue={release.title}
                className="rc-control"
              />
            </Field>
            <Field label="Primary genre">
              <Select
                name="primaryGenre"
                defaultValue={release.primaryGenre || ""}
                options={GENRES}
                placeholder="Choose genre"
              />
            </Field>
            <Field label="Release date">
              <input
                className="rc-control rc-admin-date-control"
                name="releaseDate"
                type="date"
                defaultValue={dateInputValue(release.releaseDate)}
              />
            </Field>
            <ReleaseTimelineFields
              release={release}
              editable={editable}
            />
            <Field label="Pre-save URL">
              <input
                className="rc-control"
                name="preSaveUrl"
                type="url"
                placeholder="https://…"
                defaultValue={release.preSaveUrl || ""}
              />
            </Field>
            <Field label="Streaming URL">
              <input
                className="rc-control"
                name="streamingUrl"
                type="url"
                placeholder="https://…"
                defaultValue={release.streamingUrl || ""}
              />
            </Field>
          </div>
          <div className="rc-form-actions" style={styles.sectionFooter}>
            <button disabled={busy || !editable} className="rc-button">
              {busy
                ? "Saving…"
                : editable
                  ? "Save release details"
                  : "Locked during review"}
            </button>
          </div>
        </form>
      </CollapsibleSection>

      <ReleaseArtists
        release={release}
        artists={artists}
        mutate={mutate}
        busy={busy || !editable}
        feedback={feedbackFor("release-artists")}
      />
      <ReleaseAssets
        release={release}
        uploadFile={uploadFile}
        removeFile={removeFile}
        busy={busy || !editable}
        uploadState={uploadState}
        feedbackFor={feedbackFor}
        requireSplitSheet={workflowSettings?.requireSplitSheet ?? false}
      />

      <s-section heading="Tracklist">
        <ActionFeedback feedback={feedbackFor("tracklist")} />
        <div style={styles.tracklistIntro}>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              {titledTracks} of {release.tracks.length} tracks named
            </div>
            <div style={styles.muted}>
              Expand a song to manage metadata, master audio, lyrics, artists,
              contributors and publishing splits.
            </div>
          </div>
          <div className="rc-tracklist-actions" style={styles.tracklistActions}>
            {isrcSettings.mode === "AUTO" && isrcSettings.configured && isrcReady < release.tracks.length ? (
              <button
                type="button"
                disabled={busy || !editable}
                onClick={assignMissingIsrcs}
                className="rc-button"
              >
                Assign missing ISRCs
              </button>
            ) : isrcSettings.mode === "AUTO" && !isrcSettings.configured ? (
              <s-button onClick={() => navigate("/app/settings")}>
                Configure ISRC
              </s-button>
            ) : null}
            {release.type === "SINGLE" ? (
              <StatusPill>Single · 1 track</StatusPill>
            ) : editable ? (
              <button
                type="button"
                disabled={busy}
                onClick={addTrack}
                className="rc-button rc-button--primary"
              >
                + Add track
              </button>
            ) : (
              <StatusPill tone="info">Tracklist locked</StatusPill>
            )}
          </div>
        </div>
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          {release.tracks.map((track, index) => (
            <TrackCard
              key={track.id}
              track={track}
              index={index}
              count={release.tracks.length}
              mutate={mutate}
              busy={busy || !editable}
              artists={artists}
              contributors={contributors}
              releaseArtists={release.artists}
              uploadFile={uploadFile}
              removeFile={removeFile}
              uploadState={uploadState}
              feedbackFor={feedbackFor}
              isrcConfigured={isrcSettings.configured}
              isrcMode={isrcSettings.mode}
            />
          ))}
        </div>
        {canAddTrack ? (
          <div style={styles.addBottom}>
            <button
              type="button"
              disabled={busy}
              onClick={addTrack}
              className="rc-button rc-button--dashed"
            >
              + Add another track
            </button>
          </div>
        ) : null}
      </s-section>

      <EventHistory events={release.events} />

      <s-section slot="aside" heading="Release readiness">
        <div style={styles.readinessRow}>
          <span>Format</span>
          <strong>{typeLabel(release.type)}</strong>
        </div>
        <div style={styles.readinessRow}>
          <span>Cover artwork</span>
          <strong>{artworkReady ? "Ready" : "Missing"}</strong>
        </div>
        <div style={styles.readinessRow}>
          <span>Tracks named</span>
          <strong>
            {titledTracks}/{release.tracks.length}
          </strong>
        </div>
        <div style={styles.readinessRow}>
          <span>ISRC assigned</span>
          <strong>
            {isrcReady}/{release.tracks.length}
            {isrcSettings.mode === "ADMIN" ? " · during distribution" : ""}
          </strong>
        </div>
        <div style={styles.readinessRow}>
          <span>Master WAVs</span>
          <strong>
            {masterReady}/{release.tracks.length}
          </strong>
        </div>
        <div style={styles.readinessRow}>
          <span>Lyrics / instrumental</span>
          <strong>
            {lyricsReady}/{release.tracks.length}
            {workflowSettings?.requireLyrics === false ? " · optional" : ""}
          </strong>
        </div>
        <div style={styles.readinessRow}>
          <span>Tracks with artists</span>
          <strong>
            {artistReady}/{release.tracks.length}
          </strong>
        </div>
        <div style={styles.readinessRow}>
          <span>Publishing at 100%</span>
          <strong>
            {publishingReady}/{release.tracks.length}
            {workflowSettings?.requirePublishing === false ? " · optional" : ""}
          </strong>
        </div>
        <div style={styles.readinessRow}>
          <span>Directory</span>
          <strong>
            {artists.length} artists · {contributors.length} contributors
          </strong>
        </div>
        <div style={styles.asideHelp}>
          {readiness.ready
            ? "All required release data is ready for submission."
            : `${readiness.blockers.length} readiness item${readiness.blockers.length === 1 ? "" : "s"} remain before this release can be submitted.`}
        </div>
      </s-section>
    </s-page>
  );
}

const styles = {
  workspaceHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 20,
    alignItems: "flex-end",
    flexWrap: "wrap",
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color: "#6d7175",
    marginBottom: 7,
  },
  workspaceTitleLine: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 7,
  },
  workspaceTitle: { fontSize: 23, fontWeight: 700, color: "#202223" },
  workspaceMeta: { fontSize: 13, color: "#6d7175" },
  saveState: { fontSize: 12, color: "#8c9196" },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "4px 9px",
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 700,
  },
  noticeGood: {
    maxWidth: 1000,
    margin: "0 auto 12px",
    borderRadius: 8,
    background: "#eaf7ee",
    color: "#176c37",
    padding: "10px 13px",
    fontSize: 13,
  },
  noticeBad: {
    maxWidth: 1000,
    margin: "0 auto 12px",
    borderRadius: 8,
    background: "#fff1f0",
    color: "#8e1f0b",
    padding: "10px 13px",
    fontSize: 13,
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
    gap: 14,
  },
  field: { display: "block", minWidth: 0 },
  fieldLabel: {
    display: "block",
    fontSize: 12,
    fontWeight: 650,
    marginBottom: 6,
    color: "#303030",
  },
  input: {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    height: 40,
    border: "1px solid #8c9196",
    borderRadius: 8,
    padding: "0 11px",
    font: "inherit",
    color: "#202223",
    background: "#fff",
  },
  compactInput: {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    height: 36,
    border: "1px solid #8c9196",
    borderRadius: 8,
    padding: "0 9px",
    font: "inherit",
    background: "#fff",
  },
  percentInput: {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    height: 36,
    border: "1px solid #8c9196",
    borderRadius: 8,
    padding: "0 9px",
    font: "inherit",
    background: "#fff",
  },
  readonlyField: {
    height: 40,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    padding: "0 11px",
    borderRadius: 8,
    border: "1px solid #e1e3e5",
    background: "#f6f6f7",
    color: "#6d7175",
    fontSize: 12,
  },
  textarea: {
    display: "block",
    width: "100%",
    minHeight: 180,
    boxSizing: "border-box",
    border: "1px solid #8c9196",
    borderRadius: 8,
    padding: 11,
    resize: "vertical",
    font: "inherit",
    lineHeight: 1.45,
    background: "#fff",
  },
  help: {
    display: "block",
    color: "#6d7175",
    fontSize: 11,
    lineHeight: 1.35,
    marginTop: 6,
  },
  sectionFooter: { display: "flex", justifyContent: "flex-end", marginTop: 16 },
  primaryButton: {
    appearance: "none",
    border: "1px solid #303030",
    borderRadius: 8,
    background: "#303030",
    color: "#fff",
    minHeight: 36,
    padding: "0 14px",
    font: "inherit",
    fontWeight: 650,
    cursor: "pointer",
  },
  secondaryButton: {
    appearance: "none",
    border: "1px solid #8c9196",
    borderRadius: 8,
    background: "#fff",
    color: "#303030",
    minHeight: 36,
    padding: "0 14px",
    font: "inherit",
    fontWeight: 650,
    cursor: "pointer",
  },
  tinyButton: {
    appearance: "none",
    border: "1px solid #8c9196",
    borderRadius: 7,
    background: "#fff",
    minHeight: 32,
    padding: "0 10px",
    font: "inherit",
    fontSize: 12,
    fontWeight: 650,
    cursor: "pointer",
  },
  dangerButton: {
    appearance: "none",
    border: "none",
    background: "transparent",
    color: "#b42318",
    minHeight: 32,
    padding: "0 6px",
    font: "inherit",
    fontSize: 12,
    cursor: "pointer",
  },
  sectionIntro: {
    fontSize: 13,
    color: "#6d7175",
    marginBottom: 14,
    lineHeight: 1.45,
  },
  tracklistIntro: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "center",
    flexWrap: "wrap",
  },
  tracklistActions: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  muted: { color: "#6d7175", fontSize: 13 },
  trackCard: {
    border: "1px solid #dedede",
    borderRadius: 12,
    background: "#fff",
    overflow: "hidden",
  },
  trackSummary: {
    listStyle: "none",
    cursor: "pointer",
    padding: 15,
    display: "grid",
    gridTemplateColumns: "42px minmax(0,1fr)",
    gap: 12,
    alignItems: "center",
  },
  trackNumber: {
    width: 36,
    height: 36,
    borderRadius: 9,
    display: "grid",
    placeItems: "center",
    background: "#f4f4f4",
    color: "#5c5f62",
    fontSize: 12,
    fontWeight: 750,
  },
  trackTitle: {
    color: "#202223",
    fontWeight: 760,
    fontSize: 16,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    marginBottom: 3,
  },
  trackMeta: {
    fontSize: 12,
    color: "#6d7175",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  trackSummaryRight: {
    gridColumn: "2",
    display: "flex",
    gap: 7,
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  expandHint: { fontSize: 12, color: "#6d7175" },
  trackBody: {
    borderTop: "1px solid #ededed",
    padding: 16,
    background: "#fafafa",
  },
  trackToolbar: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "center",
    marginBottom: 14,
  },
  smallEyebrow: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: ".08em",
    fontWeight: 750,
    color: "#8c9196",
    marginBottom: 3,
  },
  iconButton: {
    width: 34,
    height: 34,
    border: "1px solid #c9cccf",
    borderRadius: 8,
    background: "#fff",
    color: "#303030",
    fontSize: 16,
    cursor: "pointer",
  },
  checkRow: {
    display: "flex",
    gap: 9,
    alignItems: "flex-start",
    marginTop: 14,
    fontSize: 12,
    color: "#303030",
  },
  checkHelp: { color: "#6d7175", fontWeight: 400 },
  trackFooter: { display: "flex", justifyContent: "flex-end", marginTop: 16 },
  subsection: { borderTop: "1px solid #e5e5e5", paddingTop: 17, marginTop: 17 },
  subheading: {
    fontSize: 14,
    fontWeight: 750,
    color: "#303030",
    marginBottom: 4,
  },
  subcopy: {
    fontSize: 11,
    color: "#6d7175",
    lineHeight: 1.4,
    marginBottom: 12,
  },
  assignmentList: { display: "grid", gap: 8 },
  assignmentRow: {
    display: "grid",
    gridTemplateColumns: "minmax(160px,1fr) minmax(120px,170px) auto",
    gap: 10,
    alignItems: "center",
    border: "1px solid #e3e3e3",
    borderRadius: 9,
    padding: 10,
    background: "#fff",
  },
  creditRow: {
    display: "grid",
    gridTemplateColumns: "minmax(180px,1fr) minmax(150px,190px) 100px auto",
    gap: 10,
    alignItems: "center",
    border: "1px solid #e3e3e3",
    borderRadius: 9,
    padding: 10,
    background: "#fff",
  },
  addRow: {
    display: "grid",
    gridTemplateColumns: "minmax(200px,1fr) minmax(120px,170px) auto",
    gap: 10,
    alignItems: "end",
    marginTop: 10,
  },
  creditAddRow: {
    display: "grid",
    gridTemplateColumns: "minmax(200px,1fr) minmax(150px,190px) 100px auto",
    gap: 10,
    alignItems: "end",
    marginTop: 10,
  },
  rowActions: {
    display: "flex",
    gap: 5,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  micro: {
    fontSize: 10,
    color: "#8c9196",
    marginTop: 3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  emptyInline: {
    fontSize: 12,
    color: "#8c9196",
    border: "1px dashed #d5d7d9",
    borderRadius: 9,
    padding: 12,
    background: "#fff",
  },
  directoryPrompt: { fontSize: 12, color: "#6d7175", padding: "8px 0" },
  creditHeading: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },
  splitHelp: { fontSize: 10, color: "#8c9196", marginTop: 8, lineHeight: 1.4 },
  futureSections: { display: "flex", flexWrap: "wrap", gap: 7, marginTop: 18 },
  futureHelp: { color: "#8c9196", fontSize: 11, lineHeight: 1.4, marginTop: 7 },
  addBottom: { display: "flex", justifyContent: "center", paddingTop: 14 },
  addTrackGhost: {
    appearance: "none",
    border: "1px dashed #aeb4b9",
    borderRadius: 9,
    background: "transparent",
    color: "#303030",
    minHeight: 38,
    padding: "0 18px",
    font: "inherit",
    fontWeight: 650,
    cursor: "pointer",
  },
  readinessRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "8px 0",
    borderBottom: "1px solid #ededed",
    fontSize: 13,
  },
  asideHelp: {
    fontSize: 12,
    color: "#6d7175",
    lineHeight: 1.45,
    marginTop: 14,
  },
  assetGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
    gap: 14,
  },
  assetCard: {
    border: "1px solid #e1e3e5",
    borderRadius: 11,
    padding: 14,
    background: "#fafafa",
  },
  assetHeading: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  coverPreview: {
    width: 124,
    height: 124,
    objectFit: "cover",
    borderRadius: 10,
    margin: "10px 0",
    border: "1px solid #ddd",
  },
  uploadPanel: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    border: "1px dashed #c9cccf",
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    background: "#fff",
  },
  uploadLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "#303030",
    marginBottom: 3,
  },
  uploadHelp: {
    fontSize: 11,
    color: "#6d7175",
    lineHeight: 1.4,
    maxWidth: 580,
  },
  fileCard: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    border: "1px solid #e3e3e3",
    borderRadius: 9,
    padding: 10,
    background: "#fff",
  },
  fileCardCompact: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    border: "1px solid #e3e3e3",
    borderRadius: 9,
    padding: 9,
    background: "#fff",
    marginTop: 8,
  },
  fileName: {
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 420,
  },
  fileMeta: { fontSize: 10, color: "#8c9196", marginTop: 3 },
  fileLink: { fontSize: 12, color: "#005bd3", textDecoration: "none" },

  workflowHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "center",
    flexWrap: "wrap",
  },
  workflowStatus: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  workflowActions: { display: "flex", gap: 8, flexWrap: "wrap" },
  workflowWarning: {
    marginTop: 14,
    border: "1px solid #f0c36a",
    background: "#fff8e8",
    color: "#6d4c00",
    borderRadius: 10,
    padding: 12,
    fontSize: 12,
    lineHeight: 1.45,
  },
  workflowInfo: {
    marginTop: 14,
    border: "1px solid #b7cff5",
    background: "#f1f6ff",
    color: "#174ea6",
    borderRadius: 10,
    padding: 12,
    fontSize: 12,
  },
  workflowGood: {
    marginTop: 14,
    border: "1px solid #b8dfc2",
    background: "#eef9f1",
    color: "#176c37",
    borderRadius: 10,
    padding: 12,
    fontSize: 12,
  },
  workflowBad: {
    marginTop: 14,
    border: "1px solid #efb8b3",
    background: "#fff3f1",
    color: "#8e1f0b",
    borderRadius: 10,
    padding: 12,
    fontSize: 12,
  },
  blockerList: { display: "grid", gap: 3, marginTop: 6 },
  reviewItems: { display: "grid", gap: 8, marginTop: 18 },
  reviewItem: {
    border: "1px solid #e3e3e3",
    borderRadius: 10,
    padding: 12,
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    alignItems: "center",
    background: "#fff",
  },
  reviewResolved: { opacity: 0.66, background: "#fafafa" },
  reviewItemTitle: {
    fontSize: 12,
    fontWeight: 750,
    color: "#303030",
    marginBottom: 4,
  },
  reviewMessage: { fontSize: 12, color: "#45484b", lineHeight: 1.45 },
  reviewFormWrap: {
    borderTop: "1px solid #e5e5e5",
    paddingTop: 18,
    marginTop: 18,
  },
  reviewFormGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(180px,240px) minmax(260px,1fr)",
    gap: 10,
    alignItems: "start",
  },
  reviewTextarea: {
    display: "block",
    width: "100%",
    minHeight: 82,
    boxSizing: "border-box",
    border: "1px solid #8c9196",
    borderRadius: 8,
    padding: 10,
    font: "inherit",
    resize: "vertical",
  },
  decisionGrid: {
    display: "grid",
    gridTemplateColumns: "auto minmax(300px,1fr)",
    gap: 12,
    alignItems: "center",
    marginTop: 18,
    paddingTop: 16,
    borderTop: "1px solid #ededed",
  },
  approveButton: {
    appearance: "none",
    border: "1px solid #176c37",
    borderRadius: 8,
    background: "#176c37",
    color: "#fff",
    minHeight: 38,
    padding: "0 15px",
    font: "inherit",
    fontWeight: 700,
    cursor: "pointer",
  },
  rejectForm: { display: "grid", gridTemplateColumns: "1fr auto", gap: 8 },
  rejectButton: {
    appearance: "none",
    border: "1px solid #b42318",
    borderRadius: 8,
    background: "#fff",
    color: "#b42318",
    minHeight: 38,
    padding: "0 14px",
    font: "inherit",
    fontWeight: 700,
    cursor: "pointer",
  },
  timeline: { display: "grid", gap: 0 },
  timelineRow: {
    display: "grid",
    gridTemplateColumns: "18px 1fr",
    gap: 10,
    padding: "9px 0",
  },
  timelineDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    background: "#8c9196",
    marginTop: 5,
  },
  timelineTitle: { fontSize: 12, fontWeight: 750, color: "#303030" },
  timelineMeta: { fontSize: 10, color: "#8c9196", marginTop: 2 },
  timelineMessage: {
    fontSize: 12,
    color: "#5c5f62",
    lineHeight: 1.4,
    marginTop: 4,
  },
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
