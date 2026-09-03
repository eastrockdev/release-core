import { useState } from "react";
import {
  useLoaderData,
  useNavigate,
  useRevalidator,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { LANGUAGES, typeLabel } from "../lib/releasecore";
import { authenticatedPost } from "../lib/authenticated-post";
import { releaseIsEditable } from "../lib/workflow";
import { loadReleaseWorkspace } from "../lib/release-workspace.server";
import {
  ActionFeedback,
  ReleaseHero,
} from "../components/releasecore-ui";
import { revalidateInPlace } from "../lib/revalidate-in-place";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const data = await loadReleaseWorkspace({
    shop: session.shop,
    releaseId: params.releaseId,
  });

  if (!data) {
    throw new Response("Release not found", { status: 404 });
  }

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

function normalizeIsrc(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export default function ReleaseTrackEditor() {
  const { release } = useLoaderData();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const editable = releaseIsEditable(release.status);
  const trackCount = release.tracks.length;
  const pageLabel =
    trackCount === 1 ? "Track editor" : "Bulk track editor";

  const saveTracks = async (event) => {
    event.preventDefault();
    if (busy) return;

    const raw = new FormData(event.currentTarget);
    const rows = release.tracks.map((track) => {
      const explicitValue = raw.get(`explicit:${track.id}`);
      return {
        trackId: track.id,
        position: Number(
          raw.get(`position:${track.id}`) ?? track.position,
        ),
        title: String(
          raw.get(`title:${track.id}`) ?? track.title ?? "",
        ),
        version: String(
          raw.get(`version:${track.id}`) ?? track.version ?? "",
        ),
        language: String(
          raw.get(`language:${track.id}`) ?? track.language ?? "",
        ),
        explicit:
          explicitValue === null
            ? Boolean(track.explicit)
            : String(explicitValue) === "true",
        isrc: String(
          raw.get(`isrc:${track.id}`) ?? track.isrc ?? "",
        ),
        lyrics: String(
          raw.get(`lyrics:${track.id}`) ?? track.lyrics ?? "",
        ),
      };
    });

    const isrcChanges = rows.filter((row) => {
      const current = release.tracks.find(
        (track) => track.id === row.trackId,
      );
      return (
        normalizeIsrc(row.isrc) !==
        normalizeIsrc(current?.isrc)
      );
    });

    if (
      isrcChanges.length &&
      !window.confirm(
        `${isrcChanges.length} ISRC ${isrcChanges.length === 1 ? "value is" : "values are"} changing. ISRC corrections are permanent audit events. Continue?`,
      )
    ) {
      return;
    }

    const data = new FormData();
    data.set("intent", "bulk-update-tracks");
    data.set("tracks", JSON.stringify(rows));

    setBusy(true);
    setFeedback({
      tone: "info",
      message: `Saving ${trackCount} track${trackCount === 1 ? "" : "s"}…`,
    });

    try {
      const result = await authenticatedPost(
        shopify,
        `/api/releases/${release.id}`,
        data,
      );
      const message = result.message || "Track changes saved.";
      setFeedback({ tone: "good", message });
      shopify.toast.show(message);
      await revalidateInPlace(revalidator);
    } catch (error) {
      setFeedback({
        tone: "bad",
        message:
          error instanceof Error
            ? error.message
            : "ReleaseCore could not save track changes.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <s-page heading={pageLabel}>
      <s-button
        slot="secondary-actions"
        onClick={() => navigate(`/app/release/${release.id}`)}
      >
        Back to release
      </s-button>

      <s-section>
        <ReleaseHero
          release={release}
          eyebrow="Dedicated track workspace"
          badges={[
            {
              label: typeLabel(release.type),
              tone: "neutral",
            },
            {
              label:
                trackCount === 1
                  ? "Single-track editing"
                  : `${trackCount} tracks`,
              tone: "info",
            },
          ]}
          meta={
            editable
              ? "Track metadata and identifiers can be edited here. One Save applies the release-wide batch atomically."
              : "Release metadata is locked. Administrators can still correct ISRCs here without reopening the release."
          }
        />
      </s-section>

      <s-section>
        <div className="rc-track-editor-intro">
          <div>
            <strong>
              One authoritative editing surface
            </strong>
            <p>
              Title, order, version, language, explicit status,
              lyrics and ISRC are managed here instead of being
              duplicated across the release workspace. ISRC
              assignment/correction uses the same atomic batch
              validation for Singles, EPs and Albums.
            </p>
          </div>
          <span className="rc-track-editor-count">
            {trackCount} {trackCount === 1 ? "track" : "tracks"}
          </span>
        </div>

        {!editable ? (
          <div className="rc-notice rc-notice--info">
            Metadata is locked by workflow status. ISRC remains
            editable for administrator corrections; other fields
            are read-only until the release is reopened or returned
            for changes.
          </div>
        ) : null}

        <ActionFeedback feedback={feedback} />

        {trackCount ? (
          <form
            key={`${release.id}:${release.updatedAt}`}
            className="rc-track-editor-form"
            onSubmit={saveTracks}
          >
            <div className="rc-track-editor-grid">
              {release.tracks.map((track) => (
                <article
                  className="rc-track-editor-card"
                  key={track.id}
                >
                  <div className="rc-track-editor-card__header">
                    <div className="rc-track-editor-card__number">
                      {String(track.position).padStart(2, "0")}
                    </div>
                    <div>
                      <strong>
                        {track.title || "Untitled Track"}
                      </strong>
                      <span>
                        {primaryArtist(track, release)}
                        {track.shopifyProductId
                          ? " · Shopify product linked"
                          : " · Shopify product pending"}
                      </span>
                    </div>
                  </div>

                  <div className="rc-track-editor-fields">
                    <label className="rc-field">
                      <span className="rc-field__label">
                        Track order
                      </span>
                      <input
                        className="rc-control"
                        type="number"
                        min="1"
                        max={trackCount}
                        step="1"
                        name={`position:${track.id}`}
                        defaultValue={track.position}
                        disabled={!editable}
                      />
                    </label>

                    <label className="rc-field rc-track-editor-field--title">
                      <span className="rc-field__label">
                        Track title
                      </span>
                      <input
                        className="rc-control"
                        name={`title:${track.id}`}
                        defaultValue={track.title || ""}
                        disabled={!editable}
                      />
                    </label>

                    <label className="rc-field">
                      <span className="rc-field__label">
                        Version
                      </span>
                      <input
                        className="rc-control"
                        name={`version:${track.id}`}
                        defaultValue={track.version || ""}
                        placeholder="Original, Remix, Radio Edit…"
                        disabled={!editable}
                      />
                    </label>

                    <label className="rc-field">
                      <span className="rc-field__label">
                        Language
                      </span>
                      <select
                        className="rc-control"
                        name={`language:${track.id}`}
                        defaultValue={track.language || ""}
                        disabled={!editable}
                      >
                        <option value="">
                          Select language
                        </option>
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
                    </label>

                    <label className="rc-field">
                      <span className="rc-field__label">
                        Explicit
                      </span>
                      <select
                        className="rc-control"
                        name={`explicit:${track.id}`}
                        defaultValue={
                          track.explicit ? "true" : "false"
                        }
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

                    <label className="rc-field rc-track-editor-field--isrc">
                      <span className="rc-field__label">
                        ISRC
                      </span>
                      <input
                        className="rc-control"
                        name={`isrc:${track.id}`}
                        defaultValue={track.isrc || ""}
                        placeholder="USABC2600001"
                        autoCapitalize="characters"
                        autoComplete="off"
                      />
                      <span className="rc-field__help">
                        This is the only Admin UI where an
                        existing ISRC can be assigned or corrected.
                      </span>
                    </label>

                    <label className="rc-field rc-track-editor-field--lyrics">
                      <span className="rc-field__label">
                        Lyrics
                      </span>
                      <textarea
                        className="rc-control"
                        name={`lyrics:${track.id}`}
                        defaultValue={track.lyrics || ""}
                        placeholder="Enter lyrics or leave blank when not applicable."
                        disabled={!editable}
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>

            <div className="rc-track-editor-footer">
              <div>
                <strong>
                  {editable
                    ? "Save the complete track batch"
                    : "Save ISRC corrections"}
                </strong>
                <span>
                  Changes are validated together. ISRC swaps and
                  track-order swaps are committed atomically.
                </span>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="rc-button rc-button--primary"
              >
                {busy
                  ? "Saving track changes…"
                  : "Save all track changes"}
              </button>
            </div>
          </form>
        ) : (
          <div className="rc-notice rc-notice--info">
            Add a track to the release before opening the Track
            editor.
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);
