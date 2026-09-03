import { useState, useEffect } from "react";
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
  const { admin, session } = await authenticate.admin(request);
  const data = await loadDistributionWorkspace({
    admin,
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
  if (intent === "retry-sync-health") return "sync-health";
  if (intent === "orchestrate-publication") return "publication";
  if (["create-shopify-products", "publish-shopify-product", "schedule-shopify-product", "unpublish-shopify-product"].includes(intent)) return "products";
  if (["sync-shopify-release-product", "publish-shopify-release-product", "schedule-shopify-release-product", "unpublish-shopify-release-product"].includes(intent)) return "release-product";
  if (["update-distribution", "return-for-corrections"].includes(intent)) return "status";
  return "distribution";
}

const BACKGROUND_DISTRIBUTION_INTENTS = new Set([
  "generate-audio-previews",
  "retry-sync-health",
  "orchestrate-publication",
  "create-shopify-products",
  "sync-shopify-release-product",
  "publish-shopify-product",
  "schedule-shopify-product",
  "unpublish-shopify-product",
  "publish-shopify-release-product",
  "schedule-shopify-release-product",
  "unpublish-shopify-release-product",
]);

function operationJobStatusLabel(status) {
  return (
    {
      QUEUED: "Queued",
      RUNNING: "Running",
      SUCCEEDED: "Completed",
      FAILED: "Failed",
    }[status] || status
  );
}

function operationJobTone(status) {
  if (status === "SUCCEEDED") return "good";
  if (status === "FAILED") return "warning";
  return "pending";
}

function BackgroundOperationsPanel({
  jobs,
  busy,
  busyAction,
  onRetry,
}) {
  return (
    <CollapsibleSection
      icon="history"
      title="Background operations"
      description="Long-running preview, Shopify sync, bundle, recovery, and publication work continues independently of this browser page."
      summary={
        jobs.some((job) =>
          ["QUEUED", "RUNNING"].includes(job.status),
        )
          ? "Work in progress"
          : jobs.length
            ? "Recent activity"
            : "No jobs yet"
      }
      defaultOpen={jobs.some((job) =>
        ["QUEUED", "RUNNING", "FAILED"].includes(
          job.status,
        ),
      )}
    >
      {jobs.length ? (
        <div className="rc-operation-jobs">
          {jobs.map((job) => (
            <div
              className="rc-operation-job"
              key={job.id}
            >
              <div className="rc-operation-job__main">
                <div className="rc-operation-job__title">
                  <strong>{job.label}</strong>
                  <SyncHealthPill
                    status={operationJobTone(job.status)}
                  >
                    {operationJobStatusLabel(job.status)}
                  </SyncHealthPill>
                </div>
                <div className="rc-operation-job__meta">
                  Attempt {job.attempts}/{job.maxAttempts}
                  {" · "}
                  {new Date(
                    job.updatedAt || job.createdAt,
                  ).toLocaleString()}
                </div>
                {job.lastError ? (
                  <div className="rc-operation-job__error">
                    {job.lastError}
                  </div>
                ) : null}
                {job.attemptLog?.length ? (
                  <div className="rc-operation-job__attempts">
                    {job.attemptLog
                      .slice(0, 3)
                      .map((attempt) => (
                        <span key={attempt.id}>
                          #{attempt.attempt}{" "}
                          {operationJobStatusLabel(
                            attempt.status,
                          )}
                        </span>
                      ))}
                  </div>
                ) : null}
              </div>
              {job.status === "FAILED" ? (
                <button
                  type="button"
                  className="rc-button rc-button--compact"
                  disabled={busy}
                  onClick={() => onRetry(job.id)}
                >
                  {busyAction ===
                  `operation-job:${job.id}`
                    ? "Queueing retry…"
                    : "Retry"}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div style={styles.emptyInline}>
          Long-running distribution work will appear here
          after it is queued.
        </div>
      )}
    </CollapsibleSection>
  );
}

function releaseProductPublicationLabel(release) {
  if (!release.shopifyReleaseProductId) {
    return release.shopifyReleaseBundleOperationId ? "Bundle operation processing" : "Not created";
  }
  const state = release.shopifyReleaseState;
  if (!state) return "Shopify link needs repair";
  if (state.status === "DRAFT") return "Draft";
  if (state.onlineStore?.scheduled) {
    const date = state.onlineStore.publishDate ? new Date(state.onlineStore.publishDate).toLocaleDateString() : "release date";
    return `Scheduled ${date}`;
  }
  if (state.onlineStore?.isPublished) return "Published";
  return state.status === "ACTIVE" ? "Active / unpublished" : state.status;
}

function shopifyPublicationLabel(track) {
  const state = track.shopifyState;
  if (!track.shopifyProductId) return "Not created";
  if (!state) return "Shopify link needs repair";
  if (state.status === "DRAFT") return "Draft";
  if (state.onlineStore?.scheduled) {
    const date = state.onlineStore.publishDate ? new Date(state.onlineStore.publishDate).toLocaleDateString() : "release date";
    return `Scheduled ${date}`;
  }
  if (state.onlineStore?.isPublished) return "Published";
  return state.status === "ACTIVE" ? "Active / unpublished" : state.status;
}

function SyncHealthPill({ status, children }) {
  const tone =
    status === "healthy" || status === "good"
      ? "good"
      : status === "warning" || status === "bad"
        ? "warning"
        : "pending";
  return (
    <span className={`rc-sync-health-pill rc-sync-health-pill--${tone}`}>
      {children}
    </span>
  );
}

function syncEventText(event) {
  if (!event) return "None recorded";
  const stamp = event.createdAt
    ? new Date(event.createdAt).toLocaleString()
    : "Unknown time";
  return event.message
    ? `${stamp} · ${event.message}`
    : stamp;
}

function SyncHealthPanel({
  health,
  busy,
  busyAction,
  feedback,
  onRetry,
  onRefresh,
}) {
  if (!health) return null;

  const preflight = health.preflight || {
    ready: true,
    blockers: [],
    warnings: [],
  };
  const retryCount =
    (health.retry?.trackIds || []).length +
    (health.retry?.releaseProduct ? 1 : 0);

  return (
    <CollapsibleSection
      icon="product"
      title="Sync health"
      description="Preflight, Shopify metadata state, previews, publication, and targeted recovery."
      summary={`${health.summary?.healthyTracks || 0}/${health.tracks?.length || 0} tracks healthy`}
      defaultOpen
    >
      <ActionFeedback feedback={feedback} />

      <div className="rc-sync-health-grid">
        <div className="rc-sync-health-metric">
          <span>Preflight</span>
          <strong>
            {preflight.ready ? "Ready" : `${preflight.blockers.length} blocker${preflight.blockers.length === 1 ? "" : "s"}`}
          </strong>
        </div>
        <div className="rc-sync-health-metric">
          <span>Track products</span>
          <strong>
            {health.summary?.linkedTracks || 0}/{health.tracks?.length || 0}
          </strong>
        </div>
        <div className="rc-sync-health-metric">
          <span>Preview files</span>
          <strong>
            {health.summary?.previewReady || 0}/{health.tracks?.length || 0}
          </strong>
        </div>
        <div className="rc-sync-health-metric">
          <span>Preview sync</span>
          <strong>
            {health.summary?.previewSynced || 0}/{health.summary?.previewReady || 0}
          </strong>
        </div>
      </div>

      <div
        className={`rc-sync-preflight ${preflight.ready ? "rc-sync-preflight--ready" : "rc-sync-preflight--blocked"}`}
      >
        <div className="rc-sync-preflight__heading">
          <strong>
            {preflight.ready
              ? "Shopify sync preflight passed"
              : "Resolve preflight blockers before the next full sync"}
          </strong>
          <span>
            {preflight.checkedAt
              ? `Checked ${new Date(preflight.checkedAt).toLocaleTimeString()}`
              : "Preflight not yet checked"}
          </span>
        </div>

        {preflight.blockers?.length ? (
          <ul className="rc-sync-health-issues">
            {preflight.blockers.map((item, index) => (
              <li key={`${item.code}:${item.trackId || "release"}:${index}`}>
                {item.message}
              </li>
            ))}
          </ul>
        ) : null}

        {preflight.warnings?.length ? (
          <div className="rc-sync-health-warnings">
            {preflight.warnings.slice(0, 6).map((item, index) => (
              <div key={`${item.code}:${item.trackId || "release"}:${index}`}>
                {item.message}
              </div>
            ))}
            {preflight.warnings.length > 6 ? (
              <div>
                +{preflight.warnings.length - 6} additional preflight warning
                {preflight.warnings.length - 6 === 1 ? "" : "s"}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rc-sync-health-history">
        <div>
          <span>Last successful sync</span>
          <strong>{syncEventText(health.history?.lastSuccessfulSync)}</strong>
        </div>
        <div>
          <span>Last warning</span>
          <strong>{syncEventText(health.history?.lastWarning)}</strong>
        </div>
        <div>
          <span>Last sync error</span>
          <strong>{syncEventText(health.history?.lastError)}</strong>
        </div>
      </div>

      <div className="rc-sync-health-list">
        {health.tracks.map((track) => (
          <div className="rc-sync-health-row" key={track.id}>
            <div className="rc-sync-health-row__track">
              <span>{String(track.position).padStart(2, "0")}</span>
              <div>
                <strong>{track.title}</strong>
                <small>{track.isrc || "ISRC pending"}</small>
              </div>
            </div>
            <div className="rc-sync-health-row__checks">
              <SyncHealthPill status={track.product.exists ? "good" : track.status}>
                Product · {track.product.label}
              </SyncHealthPill>
              <SyncHealthPill status={track.metadata.synced ? "good" : track.status}>
                Metadata · {track.metadata.label}
              </SyncHealthPill>
              <SyncHealthPill
                status={
                  !track.preview.generated
                    ? "pending"
                    : track.preview.synced
                      ? "good"
                      : "warning"
                }
              >
                Preview · {track.preview.label}
              </SyncHealthPill>
              <span className="rc-sync-health-publication">
                Store · {track.publication}
              </span>
            </div>
            {track.reasons?.length ? (
              <div className="rc-sync-health-row__reason">
                {track.reasons.join(" ")}
              </div>
            ) : null}
          </div>
        ))}

        {health.releaseProduct ? (
          <div className="rc-sync-health-row rc-sync-health-row--release">
            <div className="rc-sync-health-row__track">
              <span>LP</span>
              <div>
                <strong>Album / EP parent product</strong>
                <small>{health.releaseProduct.publication}</small>
              </div>
            </div>
            <div className="rc-sync-health-row__checks">
              <SyncHealthPill
                status={
                  health.releaseProduct.product.exists
                    ? "good"
                    : health.releaseProduct.status
                }
              >
                Product · {health.releaseProduct.product.label}
              </SyncHealthPill>
              <SyncHealthPill
                status={
                  health.releaseProduct.metadata.synced
                    ? "good"
                    : health.releaseProduct.status
                }
              >
                Metadata · {health.releaseProduct.metadata.label}
              </SyncHealthPill>
              <SyncHealthPill
                status={
                  health.releaseProduct.bundle.synced
                    ? "good"
                    : health.releaseProduct.status
                }
              >
                Bundle · {health.releaseProduct.bundle.label}
              </SyncHealthPill>
            </div>
            {health.releaseProduct.reasons?.length ? (
              <div className="rc-sync-health-row__reason">
                {health.releaseProduct.reasons.join(" ")}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rc-sync-health-actions">
        <button
          type="button"
          disabled={busy || retryCount === 0}
          onClick={onRetry}
          className="rc-button rc-button--primary"
        >
          {busyAction === "retry-sync-health"
            ? "Retrying failed items…"
            : retryCount
              ? `Retry failed items (${retryCount})`
              : "No failed items"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onRefresh}
          className="rc-button"
        >
          Run preflight again
        </button>
      </div>
    </CollapsibleSection>
  );
}

function PublicationOrchestrationPanel({
  plan,
  selectedMode,
  onModeChange,
  onApply,
  busy,
  busyAction,
  feedback,
}) {
  if (!plan) return null;

  const selected =
    plan.modes?.find((mode) => mode.id === selectedMode) ||
    plan.modes?.[0] ||
    null;

  const desiredLabel =
    selected?.desiredLabel || "Select a publication mode";

  return (
    <CollapsibleSection
      icon="product"
      title="Storefront publication"
      description="Coordinate Online Store availability for the entire release instead of publishing products one at a time."
      summary={`${plan.summary?.linked || 0}/${plan.summary?.expected || 0} products linked`}
      defaultOpen
    >
      <ActionFeedback feedback={feedback} />

      <div className="rc-publication-summary">
        <div>
          <span>Published</span>
          <strong>{plan.summary?.published || 0}</strong>
        </div>
        <div>
          <span>Scheduled</span>
          <strong>{plan.summary?.scheduled || 0}</strong>
        </div>
        <div>
          <span>Active / hidden</span>
          <strong>{plan.summary?.activeUnpublished || 0}</strong>
        </div>
        <div>
          <span>Draft</span>
          <strong>{plan.summary?.draft || 0}</strong>
        </div>
      </div>

      <div className="rc-publication-mode-grid">
        {plan.modes?.map((mode) => {
          const active = mode.id === selectedMode;
          const label =
            mode.id === "SCHEDULE_RELEASE"
              ? "Schedule for release timeline"
              : mode.label;
          return (
            <button
              key={mode.id}
              type="button"
              className={`rc-publication-mode${active ? " rc-publication-mode--active" : ""}`}
              aria-pressed={active}
              onClick={() => onModeChange(mode.id)}
            >
              <span className="rc-publication-mode__title">
                {label}
              </span>
              <span className="rc-publication-mode__copy">
                {mode.description}
              </span>
              {!mode.allowed && mode.blockers?.length ? (
                <span className="rc-publication-mode__blocked">
                  {mode.blockers[0]}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="rc-publication-timeline">
        <div>
          <span>Schedule basis</span>
          <strong>
            {plan.schedule?.basis === "PRE_ORDER"
              ? "Pre-order window"
              : "Release date"}
          </strong>
        </div>
        <div>
          <span>Effective storefront time</span>
          <strong>
            {plan.schedule?.available
              ? plan.schedule.label
              : "Schedule unavailable"}
          </strong>
        </div>
        <div>
          <span>Shop timezone</span>
          <strong>{plan.schedule?.timeZone || "UTC"}</strong>
        </div>
      </div>

      {plan.schedule?.warnings?.length ? (
        <div className="rc-publication-notes">
          {plan.schedule.warnings.map((warning, index) => (
            <div key={`publication-note:${index}`}>
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      <div className="rc-publication-preview">
        <div className="rc-publication-preview__header">
          <div>
            <strong>Publication preview</strong>
            <span>
              Nothing changes until you confirm the action below.
            </span>
          </div>
          <span className="rc-publication-preview__desired">
            Target · {desiredLabel}
          </span>
        </div>

        <div className="rc-publication-preview__list">
          {plan.targets?.map((target) => (
            <div
              className="rc-publication-preview__row"
              key={`${target.kind}:${target.trackId || "release"}`}
            >
              <div>
                <strong>{target.title}</strong>
                <span>
                  {target.kind === "RELEASE"
                    ? "Album / EP parent"
                    : "Track product"}
                </span>
              </div>
              <div className="rc-publication-preview__state">
                <span>{target.currentLabel}</span>
                <span aria-hidden="true">→</span>
                <strong>{desiredLabel}</strong>
              </div>
            </div>
          ))}
        </div>
      </div>

      {plan.missing?.length ? (
        <div className="rc-notice rc-notice--info">
          {plan.missing.length} expected Shopify product
          {plan.missing.length === 1 ? " is" : "s are"} not linked yet.
          Publish and Schedule remain blocked until the complete release
          product set exists. Offline actions can still operate on linked
          products.
        </div>
      ) : null}

      <div className="rc-publication-footer">
        <div>
          <strong>{selected?.label || "Publication mode"}</strong>
          <span>
            {selected?.allowed
              ? `${plan.summary?.linked || 0} linked product${plan.summary?.linked === 1 ? "" : "s"} will be evaluated.`
              : selected?.blockers?.join(" ") || "This publication mode is not available yet."}
          </span>
        </div>
        <button
          type="button"
          disabled={busy || !selected?.allowed}
          className={
            selectedMode === "UNPUBLISH_ALL"
              ? "rc-button rc-button--danger"
              : "rc-button rc-button--primary"
          }
          onClick={onApply}
        >
          {busyAction === "orchestrate-publication"
            ? "Applying publication plan…"
            : selectedMode === "UNPUBLISH_ALL"
              ? "Unpublish complete release"
              : "Apply publication plan"}
        </button>
      </div>
    </CollapsibleSection>
  );
}

export default function DistributionWorkspace() {
  const {
    release,
    settings,
    syncHealth,
    operationJobs = [],
    publicationOrchestration,
  } = useLoaderData();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [notice, setNotice] = useState(null);
  const [jobs, setJobs] = useState(operationJobs);
  const [bundleReadiness, setBundleReadiness] = useState(null);
  const [price, setPrice] = useState(
    String(settings?.defaultTrackPrice ?? 1.29),
  );
  const [releasePrice, setReleasePrice] = useState(
    String(settings?.defaultAlbumPrice ?? 9.99),
  );
  const [publicationMode, setPublicationMode] = useState(
    publicationOrchestration?.defaultMode || "KEEP_UNPUBLISHED",
  );
  useEffect(() => {
    setJobs(operationJobs);
  }, [operationJobs]);

  const hasActiveJobs = jobs.some((job) =>
    ["QUEUED", "RUNNING"].includes(job.status),
  );

  useEffect(() => {
    if (!hasActiveJobs) return undefined;

    let cancelled = false;
    let timer = null;

    const poll = async () => {
      try {
        const formData = new FormData();
        formData.set("intent", "list");
        const result = await authenticatedPost(
          shopify,
          `/api/operation-jobs/${release.id}`,
          formData,
        );
        if (cancelled) return;
        const nextJobs = result.jobs || [];
        setJobs(nextJobs);
        const stillActive = nextJobs.some((job) =>
          ["QUEUED", "RUNNING"].includes(job.status),
        );
        if (stillActive) {
          timer = window.setTimeout(poll, 2500);
        } else {
          await revalidateInPlace(revalidator);
        }
      } catch {
        if (!cancelled) {
          timer = window.setTimeout(poll, 5000);
        }
      }
    };

    timer = window.setTimeout(poll, 1500);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [
    hasActiveJobs,
    release.id,
    revalidator,
    shopify,
  ]);

  const createdCount = release.tracks.filter((t) => t.shopifyProductId).length;
  const isAlbumOrEp = ["ALBUM", "EP"].includes(String(release.type || "").toUpperCase());
  useEffect(() => {
    let active = true;

    if (!isAlbumOrEp || release.tracks.length > 30) {
      setBundleReadiness(null);
      return () => {
        active = false;
      };
    }

    const formData = new FormData();
    authenticatedPost(shopify, "/api/bundle-readiness", formData)
      .then((result) => {
        if (active) {
          setBundleReadiness(
            result?.readiness || {
              eligibleForBundles: false,
              sellsBundles: false,
              ineligibilityReason: "Shopify did not return bundle readiness.",
            },
          );
        }
      })
      .catch((error) => {
        if (active) {
          setBundleReadiness({
            eligibleForBundles: false,
            sellsBundles: false,
            ineligibilityReason:
              error instanceof Error
                ? error.message
                : "ReleaseCore could not check Shopify bundle readiness.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [isAlbumOrEp, release.tracks.length, shopify]);

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
      "retry-sync-health":
        "Retrying only the Shopify items that need recovery…",
      "orchestrate-publication":
        "Applying the release-level storefront publication plan…",
      "assign-upc": "Assigning UPC…",
      "assign-catalog": "Assigning catalog number…",
      "create-shopify-products": "Syncing Shopify products…",
      "sync-shopify-release-product": "Syncing Album/EP storefront product and bundle components…",
      "publish-shopify-release-product": "Publishing Album/EP product to the Online Store…",
      "schedule-shopify-release-product": "Scheduling Album/EP product publication…",
      "unpublish-shopify-release-product": "Removing Album/EP product from the Online Store…",
      "publish-shopify-product": "Publishing track to the Online Store…",
      "schedule-shopify-product": "Scheduling Online Store publication…",
      "unpublish-shopify-product": "Removing track from the Online Store…",
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
    if (
      BACKGROUND_DISTRIBUTION_INTENTS.has(intent) &&
      !formData.get("idempotencyKey")
    ) {
      formData.set(
        "idempotencyKey",
        window.crypto?.randomUUID?.() ||
          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
    }
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
      setNotice({
        scope,
        tone: r.warning ? "bad" : "good",
        message: r.warning
          ? `${message} ${r.warning}`
          : message,
      });
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
  const retryBackgroundOperation = async (jobId) => {
    if (busy) return;
    setBusy(true);
    setBusyAction(`operation-job:${jobId}`);
    try {
      const formData = new FormData();
      formData.set("intent", "retry");
      formData.set("jobId", jobId);
      const result = await authenticatedPost(
        shopify,
        `/api/operation-jobs/${release.id}`,
        formData,
      );
      setJobs(result.jobs || []);
      shopify.toast.show(
        result.message ||
          "Background operation queued for retry.",
      );
    } catch (error) {
      setNotice({
        scope: "distribution",
        tone: "bad",
        message:
          error instanceof Error
            ? error.message
            : "ReleaseCore could not retry the background operation.",
      });
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const retryFailedItems = () => {
    const f = new FormData();
    f.set("intent", "retry-sync-health");
    f.set(
      "trackIds",
      JSON.stringify(syncHealth?.retry?.trackIds || []),
    );
    f.set(
      "retryReleaseProduct",
      syncHealth?.retry?.releaseProduct ? "true" : "false",
    );
    return mutate(f);
  };
  const applyPublicationPlan = () => {
    const selected = publicationOrchestration?.modes?.find(
      (mode) => mode.id === publicationMode,
    );
    if (!selected?.allowed) return;

    const actionLabel =
      publicationMode === "UNPUBLISH_ALL"
        ? "take the complete release offline and return linked products to Draft"
        : publicationMode === "KEEP_UNPUBLISHED"
          ? "keep the complete release active in Shopify but unpublished"
          : publicationMode === "SCHEDULE_RELEASE"
            ? `schedule the complete release for ${publicationOrchestration?.schedule?.label || "the release timeline"}`
            : "publish the complete release now";

    if (
      !window.confirm(
        `ReleaseCore will ${actionLabel}. This applies to ${publicationOrchestration?.summary?.linked || 0} linked Shopify product${publicationOrchestration?.summary?.linked === 1 ? "" : "s"}. Continue?`,
      )
    ) {
      return;
    }

    const f = new FormData();
    f.set("intent", "orchestrate-publication");
    f.set("mode", publicationMode);
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

      <BackgroundOperationsPanel
        jobs={jobs}
        busy={busy}
        busyAction={busyAction}
        onRetry={retryBackgroundOperation}
      />

      <SyncHealthPanel
        health={syncHealth}
        busy={busy}
        busyAction={busyAction}
        feedback={feedbackFor("sync-health")}
        onRetry={retryFailedItems}
        onRefresh={() => revalidateInPlace(revalidator)}
      />

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
            ? "Your aggregator or admin provides ISRCs. Assign or correct each code from that track's Edit Track Info page."
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
                  <div className="rc-isrc-editor-redirect">
                    <div>
                      <strong>ISRC pending</strong>
                      <div style={styles.muted}>
                        ISRC assignment and corrections are managed in Edit Track Info so identifiers have one authoritative Admin editing surface.
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      className="rc-button rc-button--tertiary"
                      onClick={() =>
                        navigate(`/app/release/${release.id}/track/${track.id}`)
                      }
                    >
                      Edit track info
                    </button>
                  </div>
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
        description="Create or synchronize individual track products and the release-level Album/EP storefront product."
        summary={!isAlbumOrEp ? `${createdCount}/${release.tracks.length} linked` : `${createdCount}/${release.tracks.length} tracks · ${release.shopifyReleaseProductId ? "release product linked" : "release product pending"}`}
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
          ReleaseCore applies the artwork, artist, price, identifiers, category-scoped music metadata, and Shopify Music genre. Existing products update in place without overwriting merchant-added tags or publication state.
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {release.tracks.map((track) => (
            <div key={track.id} className="rc-directory-row" style={{ alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <strong>{track.position}. {track.title}</strong>
                <div className="rc-directory-row__meta">
                  {track.shopifyProductId ? shopifyPublicationLabel(track) : "No Shopify product linked"}
                  {track.shopifyState?.templateSuffix ? ` · template ${track.shopifyState.templateSuffix}` : ""}
                </div>
              </div>
              <div className="rc-directory-row__aside">
                <span style={styles.muted}>
                  {track.shopifyProductId
                    ? "Publication managed below"
                    : "Create product first"}
                </span>
              </div>
            </div>
          ))}
        </div>
        {isAlbumOrEp ? (
          <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid rgba(0,0,0,.08)" }}>
            <ActionFeedback feedback={feedbackFor("release-product")} />
            <div className="rc-distribution-shopify-box" style={styles.shopifyBox}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={styles.inputLabel}>{release.type === "EP" ? "EP" : "Album"} storefront product</div>
                <div style={{ fontWeight: 760, marginTop: 3 }}>{releaseProductPublicationLabel(release)}</div>
                <div style={styles.muted}>
                  {release.shopifyReleaseState?.isBundle
                    ? `Shopify fixed bundle · ${release.shopifyReleaseState.componentCount}/${release.tracks.length} components linked`
                    : release.tracks.length > 30
                      ? `Standard product fallback · Shopify fixed bundles support up to 30 components`
                      : release.shopifyReleaseProductId
                        ? "Standard product · component relationships are not managed as a fixed bundle"
                        : `Creates a Shopify fixed bundle from all ${release.tracks.length} track products`}
                  {release.shopifyReleaseState?.templateSuffix ? ` · template ${release.shopifyReleaseState.templateSuffix}` : ""}
                </div>
              </div>
              {release.tracks.length <= 30 ? (
                <div style={{ ...styles.muted, marginBottom: 10 }}>
                  {bundleReadiness === null
                    ? "Checking native Shopify bundle readiness…"
                    : bundleReadiness.eligibleForBundles
                      ? "Native Shopify bundles ready · managed by ReleaseCore"
                      : `Native Shopify bundles unavailable · ${bundleReadiness.ineligibilityReason || "Shopify has not enabled fixed bundles for this store."} ReleaseCore includes bundling; no additional Shopify Bundles app is required.`}
                </div>
              ) : null}
              <label>
                <span style={styles.inputLabel}>Album / EP price</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={releasePrice}
                  onChange={(event) => setReleasePrice(event.target.value)}
                  className="rc-control"
                  style={{ width: 130 }}
                />
              </label>
              <button
                type="button"
                disabled={
                  busy ||
                  createdCount !== release.tracks.length ||
                  (release.tracks.length <= 30 && bundleReadiness?.eligibleForBundles !== true)
                }
                onClick={() => {
                  const f = new FormData();
                  f.set("intent", "sync-shopify-release-product");
                  f.set("price", releasePrice);
                  mutate(f);
                }}
                className="rc-button rc-button--primary"
              >
                {busyAction === "sync-shopify-release-product"
                  ? "Syncing Album/EP…"
                  : release.shopifyReleaseProductId
                    ? "Sync Album/EP product"
                    : release.shopifyReleaseBundleOperationId
                      ? "Finish bundle sync"
                      : "Create Album/EP product"}
              </button>
            </div>
            {createdCount !== release.tracks.length ? (
              <div style={{ ...styles.muted, marginTop: 8 }}>
                Sync every track product first. Shopify bundle components reference the individual track products.
              </div>
            ) : null}
            {release.shopifyReleaseProductId ? (
              <div style={{ ...styles.muted, marginTop: 10 }}>
                Publication is coordinated with every track product in the Storefront publication section below.
              </div>
            ) : null}
          </div>
        ) : null}
      </CollapsibleSection>

      <PublicationOrchestrationPanel
        plan={publicationOrchestration}
        selectedMode={publicationMode}
        onModeChange={setPublicationMode}
        onApply={applyPublicationPlan}
        busy={busy}
        busyAction={busyAction}
        feedback={feedbackFor("publication")}
      />

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
