import { useState } from "react";
import {
  useLoaderData,
  useNavigate,
  useRevalidator,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { hydrateReleaseCoverUrl } from "../lib/release-artwork.server";
import {
  ARTIST_ROLES,
  CREDIT_ROLES,
  LANGUAGES,
  artistRoleLabel,
  creditRoleLabel,
  contributorDisplayName,
  isPublishingRole,
} from "../lib/releasecore";
import {
  FILE_KINDS,
  formatBytes,
} from "../lib/releasecore-files";
import { authenticatedPost } from "../lib/authenticated-post";
import { promptSafetyConfirmation } from "../lib/production-safety-client";
import { uploadReleaseCoreFile } from "../lib/upload-file";
import { releaseIsEditable } from "../lib/workflow";
import { loadReleaseWorkspace } from "../lib/release-workspace.server";
import {
  ActionFeedback,
  ArtistAvatar,
  CollapsibleSection,
  ReleaseArtwork,
  StatusBadge,
} from "../components/releasecore-ui";
import { revalidateInPlace } from "../lib/revalidate-in-place";
import {
  editorSaveStateLabel,
  useEditorDirtyState,
} from "../lib/editor-dirty-state";

export const loader = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const data = await loadReleaseWorkspace({
    shop: session.shop,
    releaseId: params.releaseId,
  });

  if (!data) {
    throw new Response("Release not found", { status: 404 });
  }

  await hydrateReleaseCoverUrl(admin, data.release);

  const track = data.release.tracks.find(
    (item) => item.id === params.trackId,
  );

  if (!track) {
    throw new Response("Track not found", { status: 404 });
  }

  return {
    ...data,
    trackId: track.id,
  };
};

function Field({ label, help, children, className = "" }) {
  return (
    <label className={`rc-field ${className}`.trim()}>
      <span className="rc-field__label">{label}</span>
      {children}
      {help ? (
        <span className="rc-field__help">{help}</span>
      ) : null}
    </label>
  );
}

function RoleSelect({
  defaultValue = "PRIMARY",
  disabled = false,
  onChange,
}) {
  return (
    <select
      name="role"
      defaultValue={defaultValue}
      disabled={disabled}
      onChange={onChange}
      className="rc-control rc-control--compact"
    >
      {ARTIST_ROLES.map((role) => (
        <option key={role} value={role}>
          {artistRoleLabel(role)}
        </option>
      ))}
    </select>
  );
}

function CreditRoleSelect({
  defaultValue = "SONGWRITER",
  disabled = false,
  onChange,
}) {
  return (
    <select
      name="role"
      defaultValue={defaultValue}
      disabled={disabled}
      onChange={onChange}
      className="rc-control rc-control--compact"
    >
      {CREDIT_ROLES.map((role) => (
        <option key={role} value={role}>
          {creditRoleLabel(role)}
        </option>
      ))}
    </select>
  );
}

function primaryArtist(track, release) {
  const trackPrimary = (track.artists || []).find(
    (assignment) => assignment.role === "PRIMARY",
  );
  const releasePrimary = (release.artists || []).find(
    (assignment) => assignment.role === "PRIMARY",
  );

  return (
    trackPrimary?.artist?.name ||
    releasePrimary?.artist?.name ||
    release.artistName ||
    "Artist not assigned"
  );
}

function normalizeIsrc(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function TrackFileCard({ file, busy, onRemove }) {
  return (
    <div className="rc-track-info-file">
      <div className="rc-track-info-file__copy">
        <strong>{file.filename}</strong>
        <span>
          {formatBytes(file.sizeBytes)} ·{" "}
          {String(file.status || "Uploaded").toLowerCase()}
        </span>
      </div>
      <div className="rc-track-info-file__actions">
        {file.url ? (
          <a
            href={file.url}
            target="_blank"
            rel="noreferrer"
            className="rc-button rc-button--tertiary rc-button--compact"
          >
            View
          </a>
        ) : null}
        <button
          type="button"
          disabled={busy}
          className="rc-button rc-button--danger rc-button--compact"
          onClick={() => onRemove(file)}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export default function EditTrackInfo() {
  const {
    release,
    trackId,
    artists,
    contributors,
    workflowSettings,
  } = useLoaderData();

  const track = release.tracks.find(
    (item) => item.id === trackId,
  );

  const shopify = useAppBridge();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [uploadState, setUploadState] = useState(null);
  const [artistAddMode, setArtistAddMode] = useState(
    () => (artists.length ? "existing" : "new"),
  );
  const [contributorAddMode, setContributorAddMode] = useState(
    () => (contributors.length ? "existing" : "new"),
  );

  const editor = useEditorDirtyState({
    message:
      "You have unsaved track information. Leave this track and discard those changes?",
  });

  const editable = releaseIsEditable(release.status);
  const creditSplitsEnabled =
    workflowSettings?.requirePublishing ?? true;

  const master = (track.files || []).find(
    (file) => file.kind === FILE_KINDS.MASTER_WAV,
  );

  const writerCredits = (track.credits || []).filter(
    (credit) => isPublishingRole(credit.role),
  );
  const publishingTotal = writerCredits.reduce(
    (sum, credit) =>
      sum + Number(credit.ownershipPercent || 0),
    0,
  );

  const relationshipArtists = track.artists.length
    ? track.artists
    : release.artists;
  const trackArtistIds = new Set(
    relationshipArtists.map((item) => item.artistId),
  );
  const linkedContributorIds = new Set(
    artists
      .filter((artist) => trackArtistIds.has(artist.id))
      .flatMap((artist) =>
        artist.contributors.map(
          (item) => item.contributorId,
        ),
      ),
  );
  const suggestedContributors = contributors.filter(
    (item) => linkedContributorIds.has(item.id),
  );
  const otherContributors = contributors.filter(
    (item) => !linkedContributorIds.has(item.id),
  );

  const setResult = (tone, message) => {
    setFeedback({ tone, message });
    if (tone === "good") {
      shopify.toast.show(message);
    }
  };

  const mutate = async (
    formData,
    pendingMessage = "Saving track…",
  ) => {
    if (busy) return null;

    setBusy(true);
    setResult("info", pendingMessage);

    try {
      const result = await authenticatedPost(
        shopify,
        `/api/releases/${release.id}`,
        formData,
      );
      const message = result.message || "Saved.";
      setResult("good", message);
      await revalidateInPlace(revalidator);
      return result;
    } catch (error) {
      setResult(
        "bad",
        error instanceof Error
          ? error.message
          : "ReleaseCore could not save this track.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveTrackInfo = async (event) => {
    event.preventDefault();
    if (busy) return;

    const raw = new FormData(event.currentTarget);
    const explicitValue = raw.get("explicit");

    const row = {
      trackId: track.id,
      position: track.position,
      title: String(
        raw.get("title") ?? track.title ?? "",
      ),
      version: String(
        raw.get("version") ?? track.version ?? "",
      ),
      language: String(
        raw.get("language") ?? track.language ?? "",
      ),
      explicit:
        explicitValue === null
          ? Boolean(track.explicit)
          : String(explicitValue) === "true",
      isrc: String(
        raw.get("isrc") ?? track.isrc ?? "",
      ),
      lyrics: String(
        raw.get("lyrics") ?? track.lyrics ?? "",
      ),
    };

    const isrcChanged =
      normalizeIsrc(row.isrc) !==
      normalizeIsrc(track.isrc);

    if (
      isrcChanged &&
      !window.confirm(
        track.isrc
          ? `Correct ISRC ${track.isrc} to ${row.isrc}? This creates a permanent audit event.`
          : `Assign ISRC ${row.isrc}? This creates a permanent audit event.`,
      )
    ) {
      return;
    }

    const data = new FormData();
    data.set("intent", "bulk-update-tracks");
    data.set("tracks", JSON.stringify([row]));
    data.set(
      "expectedTrackMetadataVersion",
      String(track.metadataVersion ?? 0),
    );

    editor.markSaving();
    const result = await mutate(
      data,
      "Saving track information…",
    );
    if (result) {
      editor.markSaved();
    } else {
      editor.markError();
    }
  };

  const uploadMaster = async (file) => {
    if (!file || busy || !editable) return;

    setBusy(true);
    setUploadState({
      phase: "preparing",
      percent: 0,
      message: `Preparing ${file.name}…`,
    });
    setResult("info", `Preparing ${file.name}…`);

    try {
      const result = await uploadReleaseCoreFile({
        shopify,
        releaseId: release.id,
        trackId: track.id,
        kind: FILE_KINDS.MASTER_WAV,
        file,
        onStage: (state) => {
          setUploadState(state);
          if (state.message) {
            setFeedback({
              tone: "info",
              message: state.message,
            });
          }
        },
      });

      const message =
        result.message || `${file.name} uploaded.`;
      setUploadState({
        phase: "done",
        percent: 100,
        message,
      });
      setResult("good", message);
      await revalidateInPlace(revalidator);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "ReleaseCore could not upload this master.";
      setUploadState({
        phase: "error",
        percent: 0,
        message,
      });
      setResult("bad", message);
    } finally {
      setBusy(false);
    }
  };

  const removeMaster = async (file) => {
    if (busy || !editable) return;
    if (
      !window.confirm(
        `Remove ${file.filename}? This can permanently delete the stored master.`,
      )
    ) {
      return;
    }

    setBusy(true);
    setResult("info", `Removing ${file.filename}…`);

    try {
      const data = new FormData();
      const result = await authenticatedPost(
        shopify,
        `/api/files/${file.id}`,
        data,
      );
      const message =
        result.message || "Master removed.";
      setResult("good", message);
      await revalidateInPlace(revalidator);
    } catch (error) {
      setResult(
        "bad",
        error instanceof Error
          ? error.message
          : "ReleaseCore could not remove this master.",
      );
    } finally {
      setBusy(false);
    }
  };

  const deleteTrack = async () => {
    const safetyConfirmation =
      promptSafetyConfirmation({
        phrase: "DELETE TRACK",
        message: `Delete Track ${track.position} permanently from this draft? This cannot be undone.`,
      });
    if (!safetyConfirmation) return;

    const data = new FormData();
    data.set("intent", "delete-track");
    data.set("trackId", track.id);
    data.set(
      "safetyConfirmation",
      safetyConfirmation,
    );

    if (busy) return;
    setBusy(true);
    setResult("info", "Deleting draft track…");

    try {
      const result = await authenticatedPost(
        shopify,
        `/api/releases/${release.id}`,
        data,
      );
      shopify.toast.show(
        result.message || "Track deleted.",
      );
      editor.discardChanges();
      navigate(`/app/release/${release.id}`, {
        replace: true,
      });
    } catch (error) {
      setResult(
        "bad",
        error instanceof Error
          ? error.message
          : "ReleaseCore could not delete this track.",
      );
      setBusy(false);
    }
  };

  const canDeleteTrack =
    release.status === "DRAFT" &&
    release.type !== "SINGLE" &&
    !track.shopifyProductId;

  return (
    <s-page heading="Edit Track Info">
      <s-button
        slot="secondary-actions"
        onClick={() =>
          navigate(`/app/release/${release.id}`)
        }
      >
        Back to release
      </s-button>

      {release.tracks.length > 1 ? (
        <s-button
          slot="secondary-actions"
          onClick={() =>
            navigate(
              `/app/release/${release.id}/tracks/bulk`,
            )
          }
        >
          Bulk edit tracks
        </s-button>
      ) : null}

      <s-section>
        <div className="rc-track-detail-hero">
          <ReleaseArtwork release={release} size="large" />
          <div className="rc-track-detail-hero__content">
            <div className="rc-eyebrow">
              Track {track.position} · {release.title}
            </div>
            <div className="rc-track-detail-hero__title-line">
              <h2>{track.title || "Untitled Track"}</h2>
              <StatusBadge tone="neutral">
                {release.type}
              </StatusBadge>
              {track.shopifyProductId ? (
                <StatusBadge tone="good">
                  Shopify linked
                </StatusBadge>
              ) : null}
            </div>
            <div className="rc-track-detail-hero__meta">
              {primaryArtist(track, release)}
              {track.isrc
                ? ` · ${track.isrc}`
                : " · ISRC pending"}
            </div>
          </div>
        </div>
      </s-section>

      <ActionFeedback feedback={feedback} />

      {!editable ? (
        <div className="rc-notice rc-notice--info">
          Release metadata is locked by workflow status.
          Administrators can still correct the ISRC and
          existing credit roles/splits here. Reopen the release
          before changing other track information.
        </div>
      ) : null}

      <CollapsibleSection
        icon="tracks"
        title="Track information"
        description="The complete metadata record for this recording."
        summary={track.isrc || "ISRC pending"}
        defaultOpen
      >
        <form
          key={`${track.id}:${track.metadataVersion}`}
          onSubmit={saveTrackInfo}
          onChange={editor.markDirty}
        >
          <div className="rc-track-info-grid">
            <Field label="Track title">
              <input
                name="title"
                defaultValue={
                  track.title === "Untitled Track"
                    ? ""
                    : track.title
                }
                className="rc-control"
                placeholder="Song title"
                disabled={!editable}
              />
            </Field>

            <Field
              label="Version / subtitle"
              help="Examples: Remix, Acoustic, Radio Edit. Leave blank for the original version."
            >
              <input
                name="version"
                defaultValue={track.version || ""}
                className="rc-control"
                placeholder="Original version"
                disabled={!editable}
              />
            </Field>

            <Field label="Language">
              <select
                name="language"
                defaultValue={track.language || ""}
                className="rc-control"
                disabled={!editable}
              >
                <option value="">Choose language</option>
                {track.language &&
                !LANGUAGES.includes(track.language) ? (
                  <option value={track.language}>
                    {track.language}
                  </option>
                ) : null}
                {LANGUAGES.map((language) => (
                  <option
                    key={language}
                    value={language}
                  >
                    {language}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Explicit status">
              <select
                name="explicit"
                defaultValue={
                  track.explicit ? "true" : "false"
                }
                className="rc-control"
                disabled={!editable}
              >
                <option value="false">
                  Non-explicit
                </option>
                <option value="true">Explicit</option>
              </select>
            </Field>

            <Field
              label="ISRC"
              help="This is the only Admin field for assigning or correcting this recording's ISRC."
              className="rc-track-info-field--isrc"
            >
              <input
                name="isrc"
                defaultValue={track.isrc || ""}
                className="rc-control"
                placeholder="USABC2600001"
                autoCapitalize="characters"
                autoComplete="off"
              />
            </Field>

            <Field
              label="Lyrics"
              help="Enter the lyrics exactly as performed. Instrumental tracks can leave this blank when language is marked accordingly."
              className="rc-track-info-field--lyrics"
            >
              <textarea
                name="lyrics"
                defaultValue={track.lyrics || ""}
                className="rc-control"
                placeholder="Enter complete lyrics…"
                disabled={!editable}
              />
            </Field>
          </div>

          <div className="rc-track-info-save">
            <div>
              <strong>Save track information</strong>
              <span>
                Metadata and ISRC validation are applied
                together. ISRC corrections create a permanent
                audit event.
              </span>
              <div
                className={`rc-editor-save-state rc-editor-save-state--${editor.saveState}`}
                aria-live="polite"
              >
                <span
                  className="rc-editor-save-state__dot"
                  aria-hidden="true"
                />
                {editorSaveStateLabel(editor.saveState)}
              </div>
            </div>
            <button
              type="submit"
              disabled={busy || !editor.dirty}
              className="rc-button rc-button--primary"
            >
              {editor.saveState === "saving"
                ? "Saving track…"
                : editor.dirty
                  ? "Save track info"
                  : "No changes to save"}
            </button>
          </div>
        </form>
      </CollapsibleSection>

      <CollapsibleSection
        icon="audio"
        title="Audio master"
        description="Private final WAV used for delivery and preview generation."
        summary={master ? "Master ready" : "Master required"}
        defaultOpen={!master}
      >
        {master ? (
          <TrackFileCard
            file={master}
            busy={busy || !editable}
            onRemove={removeMaster}
          />
        ) : (
          <div className="rc-track-info-empty">
            No master WAV uploaded.
          </div>
        )}

        <label className="rc-track-info-upload">
          <div>
            <strong>
              {master
                ? "Replace master WAV"
                : "Upload master WAV"}
            </strong>
            <span>
              WAV only · maximum 500 MB · stored privately
            </span>
            {uploadState?.message ? (
              <span>{uploadState.message}</span>
            ) : null}
          </div>
          <span className="rc-button">
            Choose WAV
          </span>
          <input
            type="file"
            accept="audio/wav,audio/x-wav,.wav"
            disabled={busy || !editable}
            onChange={(event) => {
              const file =
                event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) uploadMaster(file);
            }}
          />
        </label>
      </CollapsibleSection>

      <CollapsibleSection
        icon="artist"
        title="Track artists"
        description="Primary and featured artist identities credited on this recording. Role changes save automatically."
        summary={`${track.artists.length} assigned`}
      >
        {track.artists.length ? (
          <div className="rc-track-info-assignment-list">
            {track.artists.map((assignment) => (
              <form
                key={assignment.id}
                className="rc-track-info-assignment"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(
                    event.currentTarget,
                  );
                  data.set(
                    "intent",
                    "update-track-artist",
                  );
                  data.set("trackId", track.id);
                  data.set(
                    "assignmentId",
                    assignment.id,
                  );
                  mutate(
                    data,
                    "Saving artist role…",
                  );
                }}
              >
                <div className="rc-track-info-person">
                  <ArtistAvatar
                    artist={assignment.artist}
                    size="small"
                  />
                  <div>
                    <strong>
                      {assignment.artist.name}
                    </strong>
                    <span>
                      {assignment.artist.legalName ||
                        "Artist identity"}
                    </span>
                  </div>
                </div>

                <RoleSelect
                  defaultValue={assignment.role}
                  disabled={busy || !editable}
                  onChange={(event) =>
                    event.currentTarget.form?.requestSubmit()
                  }
                />

                <button
                  type="button"
                  disabled={busy || !editable}
                  className="rc-button rc-button--danger rc-button--compact"
                  onClick={() => {
                    const data = new FormData();
                    data.set(
                      "intent",
                      "remove-track-artist",
                    );
                    data.set("trackId", track.id);
                    data.set(
                      "assignmentId",
                      assignment.id,
                    );
                    mutate(
                      data,
                      "Removing track artist…",
                    );
                  }}
                >
                  Remove
                </button>
              </form>
            ))}
          </div>
        ) : (
          <div className="rc-track-info-empty">
            No track-specific artists assigned. Release-level
            artist assignments remain visible to distribution.
          </div>
        )}

        <div
          className="rc-inline-identity-switch"
          role="group"
          aria-label="Artist source"
        >
          <button
            type="button"
            className={`rc-button rc-button--compact ${
              artistAddMode === "existing"
                ? "rc-button--primary"
                : "rc-button--tertiary"
            }`}
            aria-pressed={artistAddMode === "existing"}
            disabled={busy || !editable || !artists.length}
            onClick={() => setArtistAddMode("existing")}
          >
            Existing artist
          </button>
          <button
            type="button"
            className={`rc-button rc-button--compact ${
              artistAddMode === "new"
                ? "rc-button--primary"
                : "rc-button--tertiary"
            }`}
            aria-pressed={artistAddMode === "new"}
            disabled={busy || !editable}
            onClick={() => setArtistAddMode("new")}
          >
            New artist
          </button>
        </div>

        <form
          className="rc-track-info-add-row rc-inline-identity-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            data.set(
              "intent",
              artistAddMode === "new"
                ? "create-track-artist-inline"
                : "add-track-artist",
            );
            data.set("trackId", track.id);
            const result = await mutate(
              data,
              artistAddMode === "new"
                ? "Creating and adding artist…"
                : "Adding track artist…",
            );
            if (result) form.reset();
          }}
        >
          {artistAddMode === "new" ? (
            <input
              name="artistName"
              required
              maxLength={200}
              className="rc-control"
              placeholder="Artist name"
              autoComplete="off"
              disabled={busy || !editable}
            />
          ) : (
            <select
              name="artistId"
              required
              className="rc-control"
              disabled={busy || !editable || !artists.length}
            >
              <option value="">
                {artists.length
                  ? "Choose artist…"
                  : "No existing artists"}
              </option>
              {artists.map((artist) => (
                <option
                  key={artist.id}
                  value={artist.id}
                >
                  {artist.name}
                </option>
              ))}
            </select>
          )}

          <RoleSelect
            disabled={busy || !editable}
          />

          <button
            disabled={
              busy ||
              !editable ||
              (artistAddMode === "existing" &&
                !artists.length)
            }
            className="rc-button"
          >
            {artistAddMode === "new"
              ? "Create + add artist"
              : "Add artist"}
          </button>
        </form>

        <div className="rc-field__help">
          New artists are saved to the Artist directory immediately
          and can be reused elsewhere in ReleaseCore.
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="contributor"
        title={
          creditSplitsEnabled
            ? "Credits & splits"
            : "Credits"
        }
        description={
          creditSplitsEnabled
            ? "Contributor roles and publishing ownership for this recording. Role and split changes save automatically."
            : "Contributor roles credited on this recording. Role changes save automatically."
        }
        summary={
          creditSplitsEnabled
            ? `${publishingTotal}% publishing`
            : `${track.credits.length} credits`
        }
      >
        {track.credits.length ? (
          <div className="rc-track-info-assignment-list">
            {track.credits.map((credit) => (
              <form
                key={credit.id}
                className={`rc-track-info-credit${
                  creditSplitsEnabled
                    ? ""
                    : " rc-track-info-credit--roles-only"
                }`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(
                    event.currentTarget,
                  );
                  data.set("intent", "update-credit");
                  data.set("trackId", track.id);
                  data.set("creditId", credit.id);
                  mutate(data, "Saving credit…");
                }}
              >
                <div className="rc-track-info-person">
                  <div>
                    <strong>
                      {contributorDisplayName(
                        credit.contributor,
                      )}
                    </strong>
                    <span>
                      {credit.contributor.legalName}
                      {credit.contributor.pro
                        ? ` · ${credit.contributor.pro}`
                        : ""}
                      {credit.contributor.ipi
                        ? ` · IPI ${credit.contributor.ipi}`
                        : ""}
                    </span>
                  </div>
                </div>

                <CreditRoleSelect
                  defaultValue={credit.role}
                  disabled={busy}
                  onChange={(event) =>
                    event.currentTarget.form?.requestSubmit()
                  }
                />

                {creditSplitsEnabled ? (
                  <input
                    name="ownershipPercent"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={
                      credit.ownershipPercent ?? ""
                    }
                    placeholder="Split %"
                    className="rc-control rc-control--compact"
                    disabled={busy}
                    onBlur={(event) =>
                      event.currentTarget.form?.requestSubmit()
                    }
                  />
                ) : null}

                <button
                  type="button"
                  disabled={busy || !editable}
                  className="rc-button rc-button--danger rc-button--compact"
                  onClick={() => {
                    const data = new FormData();
                    data.set(
                      "intent",
                      "remove-credit",
                    );
                    data.set("trackId", track.id);
                    data.set(
                      "creditId",
                      credit.id,
                    );
                    mutate(
                      data,
                      "Removing credit…",
                    );
                  }}
                >
                  Remove
                </button>
              </form>
            ))}
          </div>
        ) : (
          <div className="rc-track-info-empty">
            No contributors credited yet.
          </div>
        )}

        {suggestedContributors.length ? (
          <div className="rc-linked-suggestion">
            Suggested for{" "}
            {relationshipArtists
              .map((item) => item.artist.name)
              .join(", ")}
            :{" "}
            {suggestedContributors
              .map(contributorDisplayName)
              .join(", ")}
          </div>
        ) : null}

        <div
          className="rc-inline-identity-switch"
          role="group"
          aria-label="Contributor source"
        >
          <button
            type="button"
            className={`rc-button rc-button--compact ${
              contributorAddMode === "existing"
                ? "rc-button--primary"
                : "rc-button--tertiary"
            }`}
            aria-pressed={contributorAddMode === "existing"}
            disabled={busy || !editable || !contributors.length}
            onClick={() => setContributorAddMode("existing")}
          >
            Existing contributor
          </button>
          <button
            type="button"
            className={`rc-button rc-button--compact ${
              contributorAddMode === "new"
                ? "rc-button--primary"
                : "rc-button--tertiary"
            }`}
            aria-pressed={contributorAddMode === "new"}
            disabled={busy || !editable}
            onClick={() => setContributorAddMode("new")}
          >
            New contributor
          </button>
        </div>

        <form
          className={`rc-track-info-add-credit${
            creditSplitsEnabled
              ? ""
              : " rc-track-info-add-credit--roles-only"
          } rc-inline-identity-form`}
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            data.set(
              "intent",
              contributorAddMode === "new"
                ? "create-track-contributor-inline"
                : "add-credit",
            );
            data.set("trackId", track.id);
            const result = await mutate(
              data,
              contributorAddMode === "new"
                ? "Creating and adding contributor…"
                : "Adding credit…",
            );
            if (result) form.reset();
          }}
        >
          {contributorAddMode === "new" ? (
            <input
              name="contributorName"
              required
              maxLength={200}
              className="rc-control"
              placeholder="Contributor legal name"
              autoComplete="off"
              disabled={busy || !editable}
            />
          ) : (
            <select
              name="contributorId"
              required
              className="rc-control"
              disabled={
                busy || !editable || !contributors.length
              }
            >
              <option value="">
                {contributors.length
                  ? "Choose contributor…"
                  : "No existing contributors"}
              </option>

              {suggestedContributors.length ? (
                <optgroup label="Linked to this artist">
                  {suggestedContributors.map(
                    (contributor) => (
                      <option
                        key={contributor.id}
                        value={contributor.id}
                      >
                        {contributorDisplayName(
                          contributor,
                        )}{" "}
                        — {contributor.legalName}
                      </option>
                    ),
                  )}
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
                  {otherContributors.map(
                    (contributor) => (
                      <option
                        key={contributor.id}
                        value={contributor.id}
                      >
                        {contributorDisplayName(
                          contributor,
                        )}{" "}
                        — {contributor.legalName}
                      </option>
                    ),
                  )}
                </optgroup>
              ) : null}
            </select>
          )}

          <CreditRoleSelect
            disabled={busy || !editable}
          />

          {creditSplitsEnabled ? (
            <input
              name="ownershipPercent"
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="Split %"
              className="rc-control rc-control--compact"
              disabled={busy || !editable}
            />
          ) : null}

          <button
            disabled={
              busy ||
              !editable ||
              (contributorAddMode === "existing" &&
                !contributors.length)
            }
            className="rc-button"
          >
            {contributorAddMode === "new"
              ? "Create + add credit"
              : "Add credit"}
          </button>
        </form>

        <div className="rc-field__help">
          New contributors are saved to the Contributor directory
          immediately. PRO, IPI, publisher, email, and other
          identity details can be completed later.
        </div>

        {creditSplitsEnabled ? (
          <div className="rc-track-info-credit-total">
            Publishing ownership total:{" "}
            <strong>{publishingTotal}%</strong>
          </div>
        ) : null}
      </CollapsibleSection>

      {canDeleteTrack ? (
        <s-section heading="Track actions">
          <div className="rc-track-info-danger">
            <div>
              <strong>Delete this draft track</strong>
              <span>
                Available only for unlinked tracks on draft
                multi-track releases.
              </span>
            </div>
            <button
              type="button"
              disabled={busy}
              className="rc-button rc-button--danger"
              onClick={deleteTrack}
            >
              Delete track
            </button>
          </div>
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);
