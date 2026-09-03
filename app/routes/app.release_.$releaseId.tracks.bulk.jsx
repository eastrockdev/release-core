import { useState } from "react";
import {
  Link,
  useLoaderData,
  useNavigate,
  useRevalidator,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { hydrateReleaseCoverUrl } from "../lib/release-artwork.server";
import { LANGUAGES, typeLabel } from "../lib/releasecore";
import { authenticatedPost } from "../lib/authenticated-post";
import { releaseIsEditable } from "../lib/workflow";
import { loadReleaseWorkspace } from "../lib/release-workspace.server";
import {
  ActionFeedback,
  ReleaseHero,
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
  return data;
};

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

export default function BulkEditTracks() {
  const { release } = useLoaderData();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const editor = useEditorDirtyState({
    message:
      "You have unsaved bulk track changes. Leave this editor and discard them?",
  });

  const editable = releaseIsEditable(release.status);
  const trackCount = release.tracks.length;

  const saveTracks = async (event) => {
    event.preventDefault();
    if (busy || !editable || trackCount < 2) return;

    const raw = new FormData(event.currentTarget);

    const rows = release.tracks.map((track) => ({
      trackId: track.id,
      position: Number(
        raw.get(`position:${track.id}`) ??
          track.position,
      ),
      title: String(
        raw.get(`title:${track.id}`) ??
          track.title ??
          "",
      ),
      version: String(
        raw.get(`version:${track.id}`) ??
          track.version ??
          "",
      ),
      language: String(
        raw.get(`language:${track.id}`) ??
          track.language ??
          "",
      ),
      explicit:
        String(
          raw.get(`explicit:${track.id}`) ??
            (track.explicit ? "true" : "false"),
        ) === "true",
      // Bulk editing intentionally does not expose identifiers,
      // lyrics, audio, artists, or credits. Preserve those values.
      isrc: track.isrc || "",
      lyrics: track.lyrics || "",
    }));

    const data = new FormData();
    data.set("intent", "bulk-update-tracks");
    data.set("tracks", JSON.stringify(rows));
    data.set(
      "expectedReleaseUpdatedAt",
      String(release.updatedAt || ""),
    );

    editor.markSaving();
    setBusy(true);
    setFeedback({
      tone: "info",
      message: `Saving ${trackCount} tracks…`,
    });

    try {
      const result = await authenticatedPost(
        shopify,
        `/api/releases/${release.id}`,
        data,
      );
      const message =
        result.message || "Track changes saved.";
      setFeedback({ tone: "good", message });
      editor.markSaved();
      shopify.toast.show(message);
      await revalidateInPlace(revalidator);
    } catch (error) {
      editor.markError();
      setFeedback({
        tone: "bad",
        message:
          error instanceof Error
            ? error.message
            : "ReleaseCore could not save bulk track changes.",
      });
    } finally {
      setBusy(false);
    }
  };

  if (trackCount < 2) {
    const firstTrack = release.tracks[0] || null;
    return (
      <s-page heading="Bulk Edit Tracks">
        <s-button
          slot="secondary-actions"
          onClick={() =>
            navigate(`/app/release/${release.id}`)
          }
        >
          Back to release
        </s-button>
        <s-section>
          <div className="rc-notice rc-notice--info">
            Bulk editing is available for releases with two or
            more tracks.
            {firstTrack ? (
              <>
                {" "}
                <Link
                  to={`/app/release/${release.id}/track/${firstTrack.id}`}
                >
                  Edit this track instead
                </Link>
                .
              </>
            ) : null}
          </div>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Bulk Edit Tracks">
      <s-button
        slot="secondary-actions"
        onClick={() =>
          navigate(`/app/release/${release.id}`)
        }
      >
        Back to release
      </s-button>

      <s-section>
        <ReleaseHero
          release={release}
          eyebrow="Bulk track workspace"
          badges={[
            {
              label: typeLabel(release.type),
              tone: "neutral",
            },
            {
              label: `${trackCount} tracks`,
              tone: "info",
            },
          ]}
          meta="Edit the repeated core metadata for the full tracklist in one place."
        />
      </s-section>

      {!editable ? (
        <div className="rc-notice rc-notice--info">
          This release is locked. Reopen it before bulk
          editing track metadata. Individual Edit Track Info
          pages remain available for permitted ISRC corrections.
        </div>
      ) : null}

      <s-section>
        <div className="rc-bulk-track-intro">
          <div>
            <strong>Core tracklist fields only</strong>
            <p>
              Bulk-edit order, title, version, language and
              explicit status. ISRC, lyrics, audio, artists and
              credits stay on each track&apos;s Edit Track Info page
              so those workflows have one authoritative editing
              surface.
            </p>
          </div>
          <span>{trackCount} tracks</span>
        </div>

        <ActionFeedback feedback={feedback} />

        <form
          key={`${release.id}:${release.tracks
            .map((track) => `${track.id}:${track.updatedAt}`)
            .join("|")}`}
          onSubmit={saveTracks}
          onChange={editor.markDirty}
          className="rc-bulk-track-form"
        >
          <div className="rc-bulk-track-list">
            {release.tracks.map((track) => (
              <article
                key={track.id}
                className="rc-bulk-track-card"
              >
                <div className="rc-bulk-track-card__header">
                  <div className="rc-bulk-track-card__number">
                    {String(track.position).padStart(2, "0")}
                  </div>
                  <div className="rc-bulk-track-card__identity">
                    <strong>
                      {track.title || "Untitled Track"}
                    </strong>
                    <span>
                      {primaryArtist(track, release)}
                      {track.isrc
                        ? ` · ${track.isrc}`
                        : " · ISRC pending"}
                    </span>
                  </div>
                  <Link
                    to={`/app/release/${release.id}/track/${track.id}`}
                    className="rc-button rc-button--tertiary rc-button--compact"
                  >
                    Edit full track info
                  </Link>
                </div>

                <div className="rc-bulk-track-fields">
                  <label className="rc-field">
                    <span className="rc-field__label">
                      Order
                    </span>
                    <input
                      type="number"
                      min="1"
                      max={trackCount}
                      step="1"
                      name={`position:${track.id}`}
                      defaultValue={track.position}
                      className="rc-control"
                      disabled={!editable}
                    />
                  </label>

                  <label className="rc-field rc-bulk-track-field--title">
                    <span className="rc-field__label">
                      Track title
                    </span>
                    <input
                      name={`title:${track.id}`}
                      defaultValue={track.title || ""}
                      className="rc-control"
                      disabled={!editable}
                    />
                  </label>

                  <label className="rc-field">
                    <span className="rc-field__label">
                      Version
                    </span>
                    <input
                      name={`version:${track.id}`}
                      defaultValue={track.version || ""}
                      placeholder="Original, Remix…"
                      className="rc-control"
                      disabled={!editable}
                    />
                  </label>

                  <label className="rc-field">
                    <span className="rc-field__label">
                      Language
                    </span>
                    <select
                      name={`language:${track.id}`}
                      defaultValue={track.language || ""}
                      className="rc-control"
                      disabled={!editable}
                    >
                      <option value="">
                        Choose language
                      </option>
                      {track.language &&
                      !LANGUAGES.includes(
                        track.language,
                      ) ? (
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
                  </label>

                  <label className="rc-field">
                    <span className="rc-field__label">
                      Explicit
                    </span>
                    <select
                      name={`explicit:${track.id}`}
                      defaultValue={
                        track.explicit
                          ? "true"
                          : "false"
                      }
                      className="rc-control"
                      disabled={!editable}
                    >
                      <option value="false">
                        Non-explicit
                      </option>
                      <option value="true">
                        Explicit
                      </option>
                    </select>
                  </label>
                </div>
              </article>
            ))}
          </div>

          <div className="rc-bulk-track-footer">
            <div>
              <strong>Save bulk track changes</strong>
              <span>
                Reordering is committed atomically so position
                swaps cannot collide.
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
              disabled={
                busy || !editable || !editor.dirty
              }
              className="rc-button rc-button--primary"
            >
              {editor.saveState === "saving"
                ? "Saving tracks…"
                : editor.dirty
                  ? "Save all track changes"
                  : "No changes to save"}
            </button>
          </div>
        </form>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);
