import { useState } from "react";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  contributorDisplayName,
  creditRoleLabel,
  formatDate,
  typeLabel,
} from "../lib/releasecore";
import { authenticatedPost } from "../lib/authenticated-post";
import {
  distributionStatusLabel,
  distributionStatusTone,
  publishingTotal,
} from "../lib/workflow";
import { upcModeLabel } from "../lib/upc";
import { catalogModeLabel } from "../lib/catalog";
import { isrcAssignmentMode } from "../lib/isrc";
import { ActionFeedback, CollapsibleSection, ReleaseHero, SectionIcon } from "../components/releasecore-ui";
import { loadDistributionWorkspace } from "../lib/distribution-workspace.server";
import { revalidateInPlace } from "../lib/revalidate-in-place";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const data = await loadDistributionWorkspace({
    shop: session.shop,
    releaseId: params.releaseId,
  });
  if (!data) throw new Response("Release not found", { status: 404 });
  return data;
};

function Readout({ label, value, mono = false }) {
  return (
    <div style={styles.readout}>
      <div style={styles.readoutLabel}>{label}</div>
      <div style={{ ...styles.readoutValue, ...(mono ? styles.mono : {}) }}>
        {value || "—"}
      </div>
    </div>
  );
}
function linkedArtistNames(contributor) {
  return (contributor?.artists || [])
    .map((item) => item.artist?.name)
    .filter(Boolean)
    .join(", ");
}
function names(assignments, role) {
  return (assignments || [])
    .filter((a) => a.role === role)
    .map((a) => a.artist?.name)
    .filter(Boolean);
}

function distributionActionScope(formData) {
  const intent = String(formData.get("intent") || "");
  if (["assign-upc", "save-manual-upc"].includes(intent)) return "upc";
  if (["assign-catalog", "save-manual-catalog"].includes(intent)) return "catalog";
  if (intent === "save-manual-isrc") return `track:${String(formData.get("trackId") || "")}`;
  if (intent === "generate-audio-previews") return "previews";
  if (intent === "create-shopify-products") return "products";
  if (["update-distribution", "return-for-corrections"].includes(intent)) return "status";
  return "distribution";
}

export default function DistributionWorkspace() {
  const { release, settings } = useLoaderData();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [notice, setNotice] = useState(null);
  const [price, setPrice] = useState(
    String(settings?.defaultTrackPrice ?? 1.29),
  );
  const createdCount = release.tracks.filter((t) => t.shopifyProductId).length;
  const previewCount = release.tracks.filter((t) =>
    (t.files || []).some((f) => f.kind === "PREVIEW_MP3"),
  ).length;
  const creditedContributors = [
    ...new Map(
      release.tracks
        .flatMap((track) => track.credits.map((credit) => credit.contributor))
        .map((contributor) => [contributor.id, contributor]),
    ).values(),
  ];
  const displayDistributionStatus =
    release.distributionStatus === "NOT_QUEUED" && release.status === "APPROVED"
      ? "QUEUED"
      : release.distributionStatus;
  const pendingMessage = (intent) =>
    ({
      "generate-audio-previews":
        "Generating MP3 previews… This may take a moment.",
      "assign-upc": "Assigning UPC…",
      "assign-catalog": "Assigning catalog number…",
      "create-shopify-products": "Syncing Shopify products…",
      "save-manual-upc": "Saving UPC…",
      "save-manual-catalog": "Saving catalog number…",
      "save-manual-isrc": "Validating and assigning ISRC…",
      "update-distribution": "Updating distribution status…",
      "return-for-corrections": "Returning release for corrections…",
    })[intent] || "Processing…";
  const feedbackFor = (scope) => (notice?.scope === scope ? notice : null);
  const mutate = async (formData) => {
    if (busy) return;
    const intent = String(formData.get("intent") || "");
    const scope = distributionActionScope(formData);
    setBusy(true);
    setBusyAction(intent);
    setNotice({ scope, tone: "info", message: pendingMessage(intent) });
    try {
      const r = await authenticatedPost(
        shopify,
        `/api/distribution/${release.id}`,
        formData,
      );
      const message = r.message || "Saved.";
      setNotice({ scope, tone: "good", message });
      shopify.toast.show(message);
      await revalidateInPlace(revalidator);
    } catch (e) {
      setNotice({
        scope,
        tone: "bad",
        message:
          e instanceof Error
            ? e.message
            : "ReleaseCore could not update distribution.",
      });
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };
  const simple = (intent) => {
    const f = new FormData();
    f.set("intent", intent);
    return mutate(f);
  };
  return (
    <s-page heading={release.title}>
      <s-button
        slot="secondary-actions"
        onClick={() => navigate("/app/distribution")}
      >
        Distribution queue
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() => navigate(`/app/release/${release.id}`)}
      >
        Release workspace
      </s-button>
      <s-section>
        <ReleaseHero
          release={release}
          eyebrow="Distribution workspace"
          badges={[
            { label: typeLabel(release.type), tone: "neutral" },
            {
              label: distributionStatusLabel(displayDistributionStatus),
              tone: distributionStatusTone(displayDistributionStatus),
            },
          ]}
          meta={`${release.artistName || "Artist not set"} · ${release.tracks.length} ${release.tracks.length === 1 ? "track" : "tracks"} · Release ${formatDate(release.releaseDate)}`}
        />
      </s-section>
      <ActionFeedback feedback={feedbackFor("distribution")} />

      <CollapsibleSection
        icon="files"
        title="Delivery sheet"
        description="Release-level metadata formatted for your distribution partner."
        summary={`${release.tracks.length} ${release.tracks.length === 1 ? "track" : "tracks"}`}
      >
        <div style={styles.readoutGrid}>
          <Readout label="Release title" value={release.title} />
          <Readout label="Format" value={typeLabel(release.type)} />
          <Readout
            label="Primary artist"
            value={
              names(release.artists, "PRIMARY").join(" & ") ||
              release.artistName
            }
          />
          <Readout
            label="Featured artists"
            value={names(release.artists, "FEATURED").join(", ")}
          />
          <Readout label="Primary genre" value={release.primaryGenre} />
          <Readout
            label="Release date"
            value={formatDate(release.releaseDate)}
          />
          <Readout
            label="UPC / GTIN-12"
            value={release.upc || "Pending"}
            mono
          />
          <Readout
            label="Catalog number"
            value={release.catalogNumber || "Pending"}
            mono
          />
          <Readout label="Label" value={settings?.defaultLabelName} />
          <Readout
            label="Copyright holder"
            value={settings?.defaultCopyrightHolder}
          />
          <Readout
            label="Aggregator reference"
            value={release.aggregatorReference}
          />
        </div>
      </CollapsibleSection>

      <s-section heading="UPC">
        <ActionFeedback feedback={feedbackFor("upc")} />
        <div style={styles.intro}>
          {upcModeLabel(settings?.upcMode || "AGGREGATOR")}. UPCs identify the
          release; ISRCs continue to identify individual recordings.
        </div>
        {release.upc ? (
          <div style={styles.upcCard}>
            <div>
              <div style={styles.readoutLabel}>Assigned UPC</div>
              <div style={styles.upc}>{release.upc}</div>
            </div>
            <span style={styles.goodPill}>Assigned</span>
          </div>
        ) : settings?.upcMode === "GS1" ? (
          <div className="rc-distribution-action-box" style={styles.actionBox}>
            <div>
              <strong>UPC not assigned yet</strong>
              <div style={styles.muted}>
                ReleaseCore will allocate the next Item Reference from your
                configured GS1 prefix and calculate the GTIN-12 check digit.
              </div>
            </div>
            <button
              disabled={busy}
              onClick={() => simple("assign-upc")}
              className="rc-button rc-button--primary"
            >
              {busyAction === "assign-upc" ? "Assigning UPC…" : "Assign UPC"}
            </button>
          </div>
        ) : (
          <form
            className="rc-admin-inline-form" style={styles.inlineForm}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              f.set("intent", "save-manual-upc");
              mutate(f);
            }}
          >
            <label style={{ flex: 1 }}>
              <span style={styles.inputLabel}>UPC provided by aggregator</span>
              <input
                name="upc"
                inputMode="numeric"
                maxLength={12}
                placeholder="12-digit UPC / GTIN-12"
                className="rc-control"
              />
            </label>
            <button disabled={busy} className="rc-button rc-button--primary">
              {busyAction === "save-manual-upc" ? "Saving UPC…" : "Save UPC"}
            </button>
          </form>
        )}
      </s-section>

      <s-section heading="Catalog number">
        <ActionFeedback feedback={feedbackFor("catalog")} />
        <div style={styles.intro}>
          {catalogModeLabel(settings?.catalogMode || "AUTO")}. The catalog
          number is stored on every Shopify music product as a ReleaseCore
          metafield and is used to build the Shopify SKU.
        </div>
        {release.catalogNumber ? (
          <div style={styles.upcCard}>
            <div>
              <div style={styles.readoutLabel}>Assigned catalog number</div>
              <div style={styles.upc}>{release.catalogNumber}</div>
            </div>
            <span style={styles.goodPill}>Assigned</span>
          </div>
        ) : (settings?.catalogMode || "AUTO") === "AUTO" ? (
          <div className="rc-distribution-action-box" style={styles.actionBox}>
            <div>
              <strong>Catalog number not assigned yet</strong>
              <div style={styles.muted}>
                ReleaseCore will reserve the next number from your configured
                catalog sequence.
              </div>
            </div>
            <button
              disabled={busy}
              onClick={() => simple("assign-catalog")}
              className="rc-button rc-button--primary"
            >
              {busyAction === "assign-catalog"
                ? "Assigning catalog…"
                : "Assign catalog number"}
            </button>
          </div>
        ) : (
          <form
            className="rc-admin-inline-form" style={styles.inlineForm}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              f.set("intent", "save-manual-catalog");
              mutate(f);
            }}
          >
            <label style={{ flex: 1 }}>
              <span style={styles.inputLabel}>Catalog number</span>
              <input
                name="catalogNumber"
                maxLength={32}
                placeholder="Example: ERE260046"
                className="rc-control"
              />
            </label>
            <button disabled={busy} className="rc-button rc-button--primary">
              {busyAction === "save-manual-catalog"
                ? "Saving catalog…"
                : "Save catalog number"}
            </button>
          </form>
        )}
      </s-section>

      <CollapsibleSection
        icon="tracks"
        title="Tracks and delivery metadata"
        description="Track identifiers, credits, publishing totals, previews, and product status."
        summary={`${release.tracks.length} ${release.tracks.length === 1 ? "track" : "tracks"}`}
        defaultOpen
      >
        <div style={styles.intro}>
          {isrcAssignmentMode(settings) === "ADMIN"
            ? "Your aggregator or admin provides ISRCs. Enter each permanent code below; saved codes cannot be replaced."
            : "ReleaseCore assigns ISRCs from the configured issuer sequence. Missing automatic codes can be assigned from the release workspace."}
        </div>
        <div style={styles.trackList}>
          {release.tracks.map((track) => {
            const primary = names(track.artists, "PRIMARY").join(" & ");
            const featured = names(track.artists, "FEATURED").join(", ");
            const previewReady = (track.files || []).some(
              (file) => file.kind === "PREVIEW_MP3",
            );
            return (
              <div key={track.id} style={styles.trackCard}>
                <div className="rc-distribution-track-head" style={styles.trackHead}>
                  <div style={styles.trackNum}>
                    {String(track.position).padStart(2, "0")}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={styles.trackTitle}>
                      {track.title}
                      {track.version ? ` (${track.version})` : ""}
                    </div>
                    <div style={styles.muted}>
                      {primary || "Artist missing"}
                      {featured ? ` feat. ${featured}` : ""}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                      justifyContent: "flex-end",
                    }}
                  >
                    <span
                      style={
                        previewReady ? styles.goodPill : styles.neutralPill
                      }
                    >
                      {previewReady ? "Preview ready" : "No MP3 preview"}
                    </span>
                    <span
                      style={
                        track.shopifyProductId
                          ? styles.goodPill
                          : styles.neutralPill
                      }
                    >
                      {track.shopifyProductId
                        ? "Shopify created"
                        : "Shopify pending"}
                    </span>
                  </div>
                </div>
                <ActionFeedback feedback={feedbackFor(`track:${track.id}`)} compact />
                <div style={styles.trackMeta}>
                  <Readout label="ISRC" value={track.isrc} mono />
                  <Readout label="Language" value={track.language} />
                  <Readout
                    label="Explicit"
                    value={track.explicit ? "Yes" : "No"}
                  />
                  <Readout
                    label="Publishing"
                    value={`${publishingTotal(track)}%`}
                  />
                </div>
                {isrcAssignmentMode(settings) === "ADMIN" && !track.isrc ? (
                  <form
                    className="rc-admin-inline-form" style={styles.inlineForm}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const formData = new FormData(event.currentTarget);
                      formData.set("intent", "save-manual-isrc");
                      formData.set("trackId", track.id);
                      mutate(formData);
                    }}
                  >
                    <label style={{ flex: 1 }}>
                      <span style={styles.inputLabel}>
                        Permanent ISRC for track {track.position}
                      </span>
                      <input
                        name="isrc"
                        maxLength={17}
                        autoCapitalize="characters"
                        autoComplete="off"
                        placeholder="USABC2600001 or US-ABC-26-00001"
                        className="rc-control"
                      />
                    </label>
                    <button disabled={busy} className="rc-button rc-button--primary">
                      {busyAction === "save-manual-isrc"
                        ? "Assigning ISRC…"
                        : "Assign ISRC"}
                    </button>
                  </form>
                ) : null}
                <div style={styles.creditBlock}>
                  <div style={styles.creditLabel}>Credits</div>
                  {track.credits.length ? (
                    <div style={styles.creditRows}>
                      {track.credits.map((credit) => (
                        <div key={credit.id} style={styles.creditRow}>
                          <span>
                            <strong>
                              {contributorDisplayName(credit.contributor)}
                            </strong>{" "}
                            · {creditRoleLabel(credit.role)}
                            {linkedArtistNames(credit.contributor)
                              ? ` · Linked to ${linkedArtistNames(credit.contributor)}`
                              : ""}
                          </span>
                          <span>
                            {credit.ownershipPercent != null
                              ? `${credit.ownershipPercent}%`
                              : credit.contributor?.pro ||
                                  credit.contributor?.ipi
                                ? [
                                    credit.contributor.pro,
                                    credit.contributor.ipi,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")
                                : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={styles.muted}>No contributor credits.</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="artist"
        title="Artist and contributor relationships"
        description="Confirm which recurring contributors are associated with each artist before delivery."
        summary={`${creditedContributors.length} credited`}
      >
        {creditedContributors.length ? (
          <div className="rc-directory-list">
            {creditedContributors.map((contributor) => (
              <div className="rc-directory-row" key={contributor.id}>
                <SectionIcon name="contributor" />
                <div>
                  <strong>{contributorDisplayName(contributor)}</strong>
                  <div className="rc-directory-row__meta">{contributor.legalName}</div>
                </div>
                <div className="rc-directory-row__aside">
                  {linkedArtistNames(contributor)
                    ? `Linked artist: ${linkedArtistNames(contributor)}`
                    : "No artist relationship saved"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={styles.muted}>No contributors are credited on this release.</div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        icon="audio"
        title="Audio previews"
        description="Create storefront listening previews without exposing original masters."
        summary={`${previewCount}/${release.tracks.length} ready`}
      >
        <ActionFeedback feedback={feedbackFor("previews")} />
        <div className="rc-distribution-shopify-box" style={styles.shopifyBox}>
          <div>
            <div style={styles.bigStat}>
              {previewCount}/{release.tracks.length}
            </div>
            <div style={styles.muted}>MP3 previews ready</div>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <strong>
              {settings?.generateShopifyAudioPreview
                ? "Preview generation enabled"
                : "Preview generation disabled"}
            </strong>
            <div style={styles.muted}>
              {settings?.generateShopifyAudioPreview
                ? `${settings.audioPreviewDurationSeconds === 0 ? "Full-track" : `${settings.audioPreviewDurationSeconds || 60}-second`} · ${settings.audioPreviewBitrateKbps || 192} kbps MP3`
                : "Enable audio previews in Settings."}
            </div>
          </div>
          <button
            type="button"
            disabled={busy || !settings?.generateShopifyAudioPreview}
            onClick={() => simple("generate-audio-previews")}
            className="rc-button rc-button--primary"
          >
            {busyAction === "generate-audio-previews"
              ? "Generating MP3 previews…"
              : previewCount
                ? "Regenerate MP3 previews"
                : "Generate MP3 previews"}
          </button>
        </div>
        <div style={styles.muted}>
          Generated previews are attached to the corresponding Shopify products
          without exposing the original masters.
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="product"
        title="Shopify products"
        description="Create or synchronize the storefront product connected to each track."
        summary={`${createdCount}/${release.tracks.length} linked`}
      >
        <ActionFeedback feedback={feedbackFor("products")} />
        <div className="rc-distribution-shopify-box" style={styles.shopifyBox}>
          <div>
            <div style={styles.bigStat}>
              {createdCount}/{release.tracks.length}
            </div>
            <div style={styles.muted}>track products linked</div>
          </div>
          <label>
            <span style={styles.inputLabel}>Track price</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="rc-control" style={{ width: 120 }}
            />
          </label>
          <button
            disabled={busy}
            onClick={() => {
              const f = new FormData();
              f.set("intent", "create-shopify-products");
              f.set("price", price);
              mutate(f);
            }}
            className="rc-button rc-button--primary"
          >
            {busyAction === "create-shopify-products"
              ? "Syncing Shopify products…"
              : createdCount
                ? "Sync Shopify products"
                : "Create Shopify products"}
          </button>
        </div>
        <div style={styles.muted}>
          ReleaseCore applies the artwork, artist, price, identifiers, and
          public music metadata. Existing products update in place.
        </div>
      </CollapsibleSection>

      <s-section heading="Distribution status">
        <ActionFeedback feedback={feedbackFor("status")} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            f.set("intent", "update-distribution");
            mutate(f);
          }}
        >
          <div style={styles.formGrid}>
            <label>
              <span style={styles.inputLabel}>Status</span>
              <select
                name="distributionStatus"
                defaultValue={displayDistributionStatus}
                className="rc-control"
              >
                <option value="QUEUED">Ready for distribution</option>
                <option value="PROCESSING">Processing</option>
                <option value="SUBMITTED_TO_STORES">Submitted to stores</option>
                <option value="DELIVERED">Distribution complete</option>
              </select>
            </label>
            <label>
              <span style={styles.inputLabel}>
                Aggregator reference / submission ID
              </span>
              <input
                name="aggregatorReference"
                defaultValue={release.aggregatorReference || ""}
                className="rc-control"
              />
            </label>
          </div>
          <label style={{ display: "block", marginTop: 12 }}>
            <span style={styles.inputLabel}>Admin notes</span>
            <textarea
              name="distributionNotes"
              defaultValue={release.distributionNotes || ""}
              className="rc-control"
            />
          </label>
          <div style={styles.footer}>
            <button disabled={busy} className="rc-button rc-button--primary">
              {busyAction === "update-distribution"
                ? "Updating status…"
                : "Save distribution status"}
            </button>
          </div>
        </form>
        <div style={styles.correctionBox}>
          <div>
            <strong>Return for corrections</strong>
            <div style={styles.muted}>
              Creates a change request, unlocks the release for correction, and
              keeps it visible in the Distribution Queue.
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              f.set("intent", "return-for-corrections");
              mutate(f);
            }}
            className="rc-distribution-correction-form" style={styles.correctionForm}
          >
            <select name="trackId" className="rc-control">
              <option value="">Release-level correction</option>
              {release.tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  Track {t.position} — {t.title}
                </option>
              ))}
            </select>
            <input
              name="message"
              required
              placeholder="What needs to be corrected?"
              className="rc-control"
            />
            <button disabled={busy} className="rc-button rc-button--danger">
              {busyAction === "return-for-corrections"
                ? "Returning…"
                : "Return"}
            </button>
          </form>
        </div>
      </s-section>

      <s-section slot="aside" heading="Queue status">
        <div style={styles.asideRow}>
          <span>Distribution</span>
          <strong>{distributionStatusLabel(displayDistributionStatus)}</strong>
        </div>
        <div style={styles.asideRow}>
          <span>UPC</span>
          <strong>{release.upc || "Pending"}</strong>
        </div>
        <div style={styles.asideRow}>
          <span>Catalog</span>
          <strong>{release.catalogNumber || "Pending"}</strong>
        </div>
        <div style={styles.asideRow}>
          <span>Shopify</span>
          <strong>
            {createdCount}/{release.tracks.length}
          </strong>
        </div>
        <div style={styles.asideRow}>
          <span>Review</span>
          <strong>{release.status}</strong>
        </div>
        <div style={styles.asideHelp}>
          Approval and distribution are separate state machines: review status
          records the approval decision, while distribution status tracks
          downstream delivery.
        </div>
      </s-section>
    </s-page>
  );
}

const styles = {
  hero: { display: "flex", gap: 18, alignItems: "center" },
  cover: {
    width: 96,
    height: 96,
    objectFit: "cover",
    borderRadius: 12,
    border: "1px solid #ddd",
  },
  coverEmpty: {
    width: 96,
    height: 96,
    borderRadius: 12,
    background: "#f3f3f3",
    display: "grid",
    placeItems: "center",
    color: "#8c9196",
    fontSize: 12,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color: "#6d7175",
    marginBottom: 7,
  },
  titleLine: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  title: { fontSize: 25, fontWeight: 760, color: "#202223" },
  typePill: {
    display: "inline-flex",
    borderRadius: 999,
    padding: "4px 8px",
    fontSize: 11,
    fontWeight: 700,
    background: "#f1f1f1",
  },
  pill: {
    display: "inline-flex",
    borderRadius: 999,
    padding: "5px 9px",
    fontSize: 11,
    fontWeight: 700,
  },
  heroMeta: { fontSize: 12, color: "#6d7175", marginTop: 7 },
  intro: { fontSize: 13, color: "#6d7175", lineHeight: 1.5, marginBottom: 14 },
  readoutGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
    gap: 10,
  },
  readout: {
    border: "1px solid #e5e5e5",
    borderRadius: 9,
    padding: 10,
    background: "#fafafa",
    minWidth: 0,
  },
  readoutLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: ".06em",
    fontWeight: 700,
    color: "#8c9196",
    marginBottom: 4,
  },
  readoutValue: { fontSize: 13, color: "#303030", overflowWrap: "anywhere" },
  mono: {
    fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace",
    letterSpacing: ".04em",
  },
  upcCard: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
    border: "1px solid #b8dfc2",
    background: "#f2fbf4",
    borderRadius: 11,
    padding: 14,
  },
  upc: {
    fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace",
    fontSize: 22,
    fontWeight: 750,
    letterSpacing: ".08em",
  },
  goodPill: {
    display: "inline-flex",
    borderRadius: 999,
    padding: "4px 8px",
    fontSize: 11,
    fontWeight: 700,
    background: "#eaf7ee",
    color: "#176c37",
  },
  neutralPill: {
    display: "inline-flex",
    borderRadius: 999,
    padding: "4px 8px",
    fontSize: 11,
    fontWeight: 700,
    background: "#f1f1f1",
    color: "#5c5f62",
  },
  actionBox: {
    display: "flex",
    justifyContent: "space-between",
    gap: 18,
    alignItems: "center",
    border: "1px solid #e1e3e5",
    borderRadius: 11,
    padding: 14,
    background: "#fafafa",
  },
  inlineForm: { display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" },
  inputLabel: {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    color: "#5c5f62",
    marginBottom: 5,
  },
  input: {
    height: 40,
    border: "1px solid #8c9196",
    borderRadius: 8,
    padding: "0 10px",
    font: "inherit",
    boxSizing: "border-box",
    width: "100%",
    background: "#fff",
  },
  textarea: {
    width: "100%",
    minHeight: 90,
    border: "1px solid #8c9196",
    borderRadius: 8,
    padding: 10,
    font: "inherit",
    boxSizing: "border-box",
    resize: "vertical",
  },
  primaryButton: {
    appearance: "none",
    border: "1px solid #303030",
    borderRadius: 8,
    background: "#303030",
    color: "#fff",
    minHeight: 38,
    padding: "0 14px",
    font: "inherit",
    fontWeight: 650,
    cursor: "pointer",
  },
  dangerButton: {
    appearance: "none",
    border: "1px solid #b42318",
    borderRadius: 8,
    background: "#fff",
    color: "#b42318",
    minHeight: 38,
    padding: "0 14px",
    font: "inherit",
    fontWeight: 650,
    cursor: "pointer",
  },
  muted: { fontSize: 12, color: "#6d7175", lineHeight: 1.45 },
  trackList: { display: "grid", gap: 10 },
  trackCard: {
    border: "1px solid #e1e3e5",
    borderRadius: 12,
    padding: 14,
    background: "#fff",
  },
  trackHead: { display: "flex", gap: 12, alignItems: "center" },
  trackNum: {
    width: 36,
    height: 36,
    borderRadius: 9,
    background: "#f4f4f4",
    display: "grid",
    placeItems: "center",
    fontWeight: 750,
    fontSize: 12,
    color: "#6d7175",
  },
  trackTitle: { fontSize: 16, fontWeight: 760, lineHeight: 1.25, color: "#202223" },
  trackMeta: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
    gap: 8,
    marginTop: 12,
  },
  creditBlock: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid #ededed",
  },
  creditLabel: {
    fontSize: 11,
    fontWeight: 750,
    color: "#5c5f62",
    marginBottom: 7,
  },
  creditRows: { display: "grid", gap: 5 },
  creditRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    fontSize: 12,
    color: "#45484b",
  },
  shopifyBox: {
    display: "flex",
    alignItems: "end",
    gap: 18,
    flexWrap: "wrap",
    padding: 14,
    border: "1px solid #e1e3e5",
    borderRadius: 11,
    background: "#fafafa",
    marginBottom: 10,
  },
  bigStat: { fontSize: 25, fontWeight: 760 },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
    gap: 12,
  },
  footer: { display: "flex", justifyContent: "flex-end", marginTop: 14 },
  correctionBox: {
    borderTop: "1px solid #ededed",
    marginTop: 18,
    paddingTop: 18,
    display: "grid",
    gap: 12,
  },
  correctionForm: {
    display: "grid",
    gridTemplateColumns: "minmax(180px,240px) minmax(240px,1fr) auto",
    gap: 8,
    alignItems: "end",
  },
  asideRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "8px 0",
    borderBottom: "1px solid #ededed",
    fontSize: 12,
  },
  asideHelp: {
    fontSize: 11,
    color: "#6d7175",
    lineHeight: 1.45,
    marginTop: 12,
  },
  noticeInfo: {
    padding: 12,
    border: "1px solid #b8c7df",
    background: "#eef4ff",
    borderRadius: 9,
    color: "#174ea6",
    display: "flex",
    alignItems: "center",
    gap: 9,
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
};
export const headers = (headersArgs) => boundary.headers(headersArgs);
