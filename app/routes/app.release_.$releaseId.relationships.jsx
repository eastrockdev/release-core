import {
  Link,
  useLoaderData,
  useNavigate,
  useRevalidator,
} from "react-router";
import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  loadCatalogRelationshipWorkspace,
} from "../lib/catalog-relationships.server";
import {
  CATALOG_RELATIONSHIP_TYPES,
  RECORDING_RELATIONSHIP_TYPES,
  catalogRelationshipDefinition,
  recordingLineageStatus,
} from "../lib/catalog-relationships";
import { authenticatedPost } from "../lib/authenticated-post";
import {
  EmptyState,
  PageIntro,
  StatusBadge,
} from "../components/releasecore-ui";
import {
  formatDate,
  typeLabel,
} from "../lib/releasecore";
import {
  statusLabel,
} from "../lib/workflow";

export const loader = async ({
  request,
  params,
}) => {
  const { session } =
    await authenticate.admin(request);
  const url = new URL(request.url);

  return loadCatalogRelationshipWorkspace({
    shop: session.shop,
    releaseId: params.releaseId,
    query:
      url.searchParams.get("q") || "",
    candidateLimit: 100,
  });
};

function identifierText(track) {
  return track.isrc
    ? `ISRC ${track.isrc}`
    : "No ISRC";
}

function MappingEditor({
  relationship,
  track,
  busy,
  post,
}) {
  const mapping =
    relationship.trackRelationships.find(
      (item) =>
        item.trackId === track.id,
    ) || null;

  const sourceTrack =
    mapping?.relatedTrack || null;
  const status = mapping
    ? recordingLineageStatus({
        recordingRelationship:
          mapping.recordingRelationship,
        currentIsrc: track.isrc,
        sourceIsrc:
          sourceTrack?.isrc,
      })
    : {
        tone: "neutral",
        label: "Not mapped",
        message:
          "Choose a source track to establish recording lineage.",
      };

  const formKey = `${relationship.id}:${track.id}:${mapping?.updatedAt || "new"}`;

  const save = async (event) => {
    event.preventDefault();
    const data =
      new FormData(event.currentTarget);
    data.set(
      "intent",
      "set-track-lineage",
    );
    data.set(
      "releaseRelationshipId",
      relationship.id,
    );
    data.set("trackId", track.id);
    await post(data);
  };

  const remove = async () => {
    if (!mapping) return;
    const data = new FormData();
    data.set(
      "intent",
      "remove-track-lineage",
    );
    data.set(
      "releaseRelationshipId",
      relationship.id,
    );
    data.set("trackId", track.id);
    await post(data);
  };

  return (
    <form
      className="rc-lineage-row"
      onSubmit={save}
      key={formKey}
    >
      <div className="rc-lineage-row__current">
        <span className="rc-eyebrow">
          Track {track.position}
        </span>
        <strong>
          {track.title ||
            "Untitled Track"}
        </strong>
        <span>
          {identifierText(track)}
        </span>
      </div>

      <div className="rc-lineage-row__controls">
        <label className="rc-field">
          <span className="rc-field__label">
            Source track
          </span>
          <select
            className="rc-control"
            name="relatedTrackId"
            defaultValue={
              mapping?.relatedTrackId ||
              ""
            }
            required
          >
            <option value="">
              Choose source track…
            </option>
            {relationship.source.tracks.map(
              (source) => (
                <option
                  key={source.id}
                  value={source.id}
                >
                  {source.position}.{" "}
                  {source.title} ·{" "}
                  {identifierText(source)}
                </option>
              ),
            )}
          </select>
        </label>

        <label className="rc-field">
          <span className="rc-field__label">
            Recording identity
          </span>
          <select
            className="rc-control"
            name="recordingRelationship"
            defaultValue={
              mapping?.recordingRelationship ||
              "UNKNOWN"
            }
          >
            {RECORDING_RELATIONSHIP_TYPES.map(
              (option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ),
            )}
          </select>
        </label>

        <label className="rc-field rc-lineage-row__notes">
          <span className="rc-field__label">
            Note
          </span>
          <input
            className="rc-control"
            name="notes"
            maxLength={600}
            defaultValue={
              mapping?.notes || ""
            }
            placeholder="Optional lineage note"
          />
        </label>
      </div>

      <div className="rc-lineage-row__status">
        <StatusBadge tone={status.tone}>
          {status.label}
        </StatusBadge>
        <span>{status.message}</span>
        <div className="rc-form-actions">
          <button
            className="rc-button rc-button--compact"
            disabled={busy}
          >
            Save lineage
          </button>
          {mapping ? (
            <button
              type="button"
              className="rc-button rc-button--tertiary rc-button--compact"
              disabled={busy}
              onClick={remove}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function RelationshipCard({
  relationship,
  releaseTracks,
  busy,
  post,
}) {
  const definition =
    catalogRelationshipDefinition(
      relationship.relationshipType,
    );

  const saveRelationship = async (
    event,
  ) => {
    event.preventDefault();
    const data =
      new FormData(event.currentTarget);
    data.set(
      "intent",
      "update-relationship",
    );
    data.set(
      "relationshipId",
      relationship.id,
    );
    await post(data);
  };

  const removeRelationship =
    async () => {
      if (
        !window.confirm(
          `Remove the catalog relationship to “${relationship.source.title}”? Track lineage mappings under this relationship will also be removed.`,
        )
      ) {
        return;
      }

      const data = new FormData();
      data.set(
        "intent",
        "remove-relationship",
      );
      data.set(
        "relationshipId",
        relationship.id,
      );
      await post(data);
    };

  return (
    <article className="rc-catalog-relation-card">
      <div className="rc-catalog-relation-card__header">
        <div>
          <span className="rc-eyebrow">
            Catalog source
          </span>
          <strong>
            {definition.label}{" "}
            {relationship.source.title}
          </strong>
          <span>
            {relationship.source.artistName ||
              "Artist not set"}{" "}
            ·{" "}
            {typeLabel(
              relationship.source.type,
            )}{" "}
            ·{" "}
            {statusLabel(
              relationship.source.status,
            )}
          </span>
        </div>
        <div className="rc-catalog-relation-card__actions">
          <Link
            to={`/app/release/${relationship.source.id}`}
            className="rc-button rc-button--compact"
          >
            Open source
          </Link>
          <button
            type="button"
            className="rc-button rc-button--danger rc-button--compact"
            disabled={busy}
            onClick={
              removeRelationship
            }
          >
            Remove
          </button>
        </div>
      </div>

      <div className="rc-catalog-guidance">
        <strong>{definition.summary}</strong>
        <span>
          {definition.identifierGuidance}
        </span>
      </div>

      <form
        className="rc-catalog-relation-edit"
        onSubmit={saveRelationship}
      >
        <label className="rc-field">
          <span className="rc-field__label">
            Relationship
          </span>
          <select
            className="rc-control"
            name="relationshipType"
            defaultValue={
              relationship.relationshipType
            }
          >
            {CATALOG_RELATIONSHIP_TYPES.map(
              (option) => (
                <option
                  value={option.value}
                  key={option.value}
                >
                  {option.label}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="rc-field">
          <span className="rc-field__label">
            Relationship note
          </span>
          <input
            className="rc-control"
            name="notes"
            maxLength={800}
            defaultValue={
              relationship.notes || ""
            }
            placeholder="Optional catalog note"
          />
        </label>
        <button
          className="rc-button rc-button--compact"
          disabled={busy}
        >
          Save relationship
        </button>
      </form>

      <div className="rc-catalog-lineage-heading">
        <div>
          <strong>
            Recording lineage
          </strong>
          <span>
            Map each appearance to the
            corresponding source track, then
            explicitly classify whether the audio
            is the same recording or new/changed
            audio.
          </span>
        </div>
        <StatusBadge tone="neutral">
          {
            relationship.trackRelationships
              .length
          }
          /{releaseTracks.length} mapped
        </StatusBadge>
      </div>

      <div className="rc-lineage-list">
        {releaseTracks.map((track) => (
          <MappingEditor
            key={`${relationship.id}:${track.id}`}
            relationship={relationship}
            track={track}
            busy={busy}
            post={post}
          />
        ))}
      </div>
    </article>
  );
}

export default function CatalogRelationships() {
  const data = useLoaderData();
  const navigate = useNavigate();
  const revalidator =
    useRevalidator();
  const shopify = useAppBridge();
  const [busy, setBusy] =
    useState(false);
  const [notice, setNotice] =
    useState(null);
  const [search, setSearch] =
    useState(data.query || "");

  const post = async (formData) => {
    if (busy) return null;
    setBusy(true);
    setNotice(null);

    try {
      const result =
        await authenticatedPost(
          shopify,
          `/api/release-relationships/${data.release.id}`,
          formData,
        );
      setNotice({
        tone: "good",
        message:
          result.message || "Saved.",
      });
      shopify.toast.show(
        result.message || "Saved.",
      );
      await revalidator.revalidate();
      return result;
    } catch (error) {
      setNotice({
        tone: "bad",
        message:
          error instanceof Error
            ? error.message
            : "ReleaseCore could not update catalog relationships.",
      });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const addRelationship = async (
    event,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData =
      new FormData(form);
    formData.set(
      "intent",
      "add-relationship",
    );
    const result =
      await post(formData);
    if (result) form.reset();
  };

  const searchCatalog = (
    event,
  ) => {
    event.preventDefault();
    const q = search.trim();
    navigate(
      q
        ? `/app/release/${data.release.id}/relationships?q=${encodeURIComponent(
            q,
          )}`
        : `/app/release/${data.release.id}/relationships`,
    );
  };

  return (
    <s-page heading="Catalog Relationships">
      <s-button
        slot="secondary-actions"
        onClick={() =>
          navigate(
            `/app/release/${data.release.id}`,
          )
        }
      >
        Back to release
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() =>
          navigate(
            `/app/release/new?duplicate=${encodeURIComponent(
              data.release.id,
            )}`,
          )
        }
      >
        Duplicate release
      </s-button>

      <s-section>
        <PageIntro
          eyebrow="M17.2 · Catalog relationships & editions"
          title="Connect editions without guessing what happened to the recordings."
        >
          Release relationships describe how
          releases belong together. Recording
          lineage separately describes whether a
          specific track appearance is the same
          recording or new/changed audio. ReleaseCore
          does not infer ISRC reuse from an edition
          label and does not overwrite identifiers
          automatically.
        </PageIntro>
      </s-section>

      <s-section heading="Current release">
        <div className="rc-release-reuse-selected">
          <div>
            <span className="rc-eyebrow">
              Catalog record
            </span>
            <strong>
              {data.release.title}
            </strong>
            <span>
              {data.release.artistName ||
                "Artist not set"}{" "}
              · {typeLabel(data.release.type)} ·{" "}
              {data.release.trackCount}{" "}
              {data.release.trackCount === 1
                ? "track"
                : "tracks"}
              {data.release.releaseDate
                ? ` · ${formatDate(
                    data.release.releaseDate,
                  )}`
                : ""}
            </span>
          </div>
          <div className="rc-release-reuse-selected__badges">
            <StatusBadge tone="info">
              {statusLabel(
                data.release.status,
              )}
            </StatusBadge>
            {data.release.catalogNumber ? (
              <StatusBadge tone="neutral">
                {data.release.catalogNumber}
              </StatusBadge>
            ) : null}
            {data.release.upc ? (
              <StatusBadge tone="neutral">
                UPC {data.release.upc}
              </StatusBadge>
            ) : null}
          </div>
        </div>
      </s-section>

      {notice ? (
        <s-section>
          <div
            className={`rc-notice rc-notice--${notice.tone}`}
          >
            {notice.message}
          </div>
        </s-section>
      ) : null}

      <s-section heading="Add catalog relationship">
        <form
          className="rc-catalog-source-search"
          onSubmit={searchCatalog}
        >
          <input
            className="rc-control"
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value,
              )
            }
            placeholder="Search releases by title, artist, catalog number, or UPC"
          />
          <button
            className="rc-button"
            type="submit"
          >
            Search catalog
          </button>
          {data.query ? (
            <button
              className="rc-button rc-button--tertiary"
              type="button"
              onClick={() => {
                setSearch("");
                navigate(
                  `/app/release/${data.release.id}/relationships`,
                );
              }}
            >
              Clear
            </button>
          ) : null}
        </form>

        <form
          className="rc-catalog-add-relation"
          onSubmit={addRelationship}
        >
          <label className="rc-field">
            <span className="rc-field__label">
              Source / original release
            </span>
            <select
              className="rc-control"
              name="relatedReleaseId"
              required
              defaultValue=""
            >
              <option value="">
                Choose release…
              </option>
              {data.candidates.map(
                (candidate) => (
                  <option
                    value={candidate.id}
                    key={candidate.id}
                  >
                    {candidate.title} ·{" "}
                    {candidate.artistName ||
                      "Artist not set"}{" "}
                    ·{" "}
                    {typeLabel(
                      candidate.type,
                    )}{" "}
                    ·{" "}
                    {candidate.trackCount}{" "}
                    {candidate.trackCount ===
                    1
                      ? "track"
                      : "tracks"}
                  </option>
                ),
              )}
            </select>
          </label>

          <label className="rc-field">
            <span className="rc-field__label">
              This release is…
            </span>
            <select
              className="rc-control"
              name="relationshipType"
              defaultValue="EDITION_OF"
            >
              {CATALOG_RELATIONSHIP_TYPES.map(
                (option) => (
                  <option
                    value={option.value}
                    key={option.value}
                  >
                    {option.label}
                  </option>
                ),
              )}
            </select>
          </label>

          <label className="rc-field">
            <span className="rc-field__label">
              Note
            </span>
            <input
              className="rc-control"
              name="notes"
              maxLength={800}
              placeholder="Optional edition or catalog note"
            />
          </label>

          <button
            className="rc-button rc-button--primary"
            disabled={
              busy ||
              data.candidates.length === 0
            }
          >
            {busy
              ? "Adding…"
              : "Add relationship"}
          </button>
        </form>

        {data.candidateCapped ? (
          <div className="rc-operations-note">
            Showing the first 100 matching
            releases. Search by title, artist,
            catalog number, or UPC to narrow the
            source list.
          </div>
        ) : null}
      </s-section>

      <s-section
        heading={`Edition relationships (${data.relationships.length})`}
      >
        {data.relationships.length ? (
          <div className="rc-catalog-relation-list">
            {data.relationships.map(
              (relationship) => (
                <RelationshipCard
                  key={relationship.id}
                  relationship={
                    relationship
                  }
                  releaseTracks={
                    data.release.tracks
                  }
                  busy={busy}
                  post={post}
                />
              ),
            )}
          </div>
        ) : (
          <EmptyState title="No source relationship yet">
            Add the original or source catalog
            release above. ReleaseCore will seed
            obvious title/position track matches as
            unclassified lineage for you to review.
          </EmptyState>
        )}
      </s-section>

      <s-section
        heading={`Derived releases (${data.incoming.length})`}
      >
        {data.incoming.length ? (
          <div className="rc-catalog-backlink-list">
            {data.incoming.map(
              (relationship) => {
                const definition =
                  catalogRelationshipDefinition(
                    relationship.relationshipType,
                  );
                return (
                  <Link
                    className="rc-catalog-backlink"
                    to={`/app/release/${relationship.release.id}/relationships`}
                    key={relationship.id}
                  >
                    <div>
                      <strong>
                        {
                          relationship
                            .release.title
                        }
                      </strong>
                      <span>
                        {
                          relationship
                            .release.artistName ||
                          "Artist not set"
                        }{" "}
                        ·{" "}
                        {definition.shortLabel}
                      </span>
                    </div>
                    <span aria-hidden="true">
                      →
                    </span>
                  </Link>
                );
              },
            )}
          </div>
        ) : (
          <EmptyState title="No derived releases">
            Other editions that point back to this
            release will appear here.
          </EmptyState>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (
  headersArgs,
) =>
  boundary.headers(headersArgs);
