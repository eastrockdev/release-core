import {
  useLoaderData,
  useNavigate,
  useRevalidator,
} from "react-router";
import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  CATALOG_OPERATION_CATEGORIES,
  CATALOG_OPERATION_TYPES,
  catalogOperationCategoryLabel,
  catalogOperationNextStatuses,
  catalogOperationStatusDefinition,
  catalogOperationTypeDefinition,
} from "../lib/catalog-operations";
import {
  loadCatalogOperationsWorkspace,
} from "../lib/catalog-operations.server";
import {
  authenticatedPost,
} from "../lib/authenticated-post";
import {
  promptSafetyConfirmation,
} from "../lib/production-safety-client";
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

  return loadCatalogOperationsWorkspace({
    shop: session.shop,
    releaseId: params.releaseId,
  });
};

function localDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function dateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function operationActionLabel(status) {
  return (
    {
      APPROVED: "Approve",
      IN_PROGRESS: "Start work",
      COMPLETED: "Mark completed",
      REJECTED: "Reject",
      CANCELLED: "Cancel",
    }[status] || status
  );
}

function CatalogOperationCard({
  request,
  busy,
  post,
}) {
  const type =
    catalogOperationTypeDefinition(
      request.type,
    );
  const status =
    catalogOperationStatusDefinition(
      request.status,
    );
  const nextStatuses =
    catalogOperationNextStatuses(
      request.status,
    );

  const submitTransition = async (
    event,
  ) => {
    event.preventDefault();
    const form =
      event.currentTarget;
    const data = new FormData(form);
    const submitter =
      event.nativeEvent?.submitter;
    const nextStatus = String(
      submitter?.value ||
        data.get("nextStatus") ||
        "",
    ).toUpperCase();

    if (!nextStatus) return;
    data.set("nextStatus", nextStatus);

    if (
      request.type === "TAKEDOWN" &&
      nextStatus === "COMPLETED"
    ) {
      const safetyConfirmation =
        promptSafetyConfirmation({
          phrase: "COMPLETE TAKEDOWN",
          message:
            "Mark this full release takedown completed? Only do this after downstream removal has actually been confirmed.",
        });
      if (!safetyConfirmation) return;
      data.set(
        "safetyConfirmation",
        safetyConfirmation,
      );
    }

    data.set(
      "intent",
      "transition-operation",
    );
    data.set(
      "requestId",
      request.id,
    );
    await post(data);
  };

  return (
    <article className="rc-catalog-operation-card">
      <div className="rc-catalog-operation-card__header">
        <div>
          <span className="rc-eyebrow">
            {type.label}
          </span>
          <strong>
            {request.summary}
          </strong>
          <span>
            {catalogOperationCategoryLabel(
              request.category,
            )}
            {request.track
              ? ` · Track ${request.track.position}: ${request.track.title}`
              : " · Release level"}
          </span>
        </div>
        <StatusBadge tone={status.tone}>
          {status.label}
        </StatusBadge>
      </div>

      <div className="rc-catalog-operation-card__details">
        <div>
          <span className="rc-eyebrow">
            Request details
          </span>
          <p>{request.reason}</p>
        </div>
        <dl className="rc-catalog-operation-meta">
          <div>
            <dt>Created</dt>
            <dd>{localDate(request.createdAt)}</dd>
          </div>
          <div>
            <dt>Effective</dt>
            <dd>
              {request.effectiveAt
                ? dateInputValue(
                    request.effectiveAt,
                  )
                : "Not scheduled"}
            </dd>
          </div>
          <div>
            <dt>Requested by</dt>
            <dd>
              {request.requestedBy ||
                "Shopify admin"}
            </dd>
          </div>
          {request.completedAt ? (
            <div>
              <dt>Completed</dt>
              <dd>
                {localDate(
                  request.completedAt,
                )}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      {request.resolutionNote ? (
        <div className="rc-catalog-operation-resolution">
          <strong>Resolution note</strong>
          <span>
            {request.resolutionNote}
          </span>
        </div>
      ) : null}

      {nextStatuses.length ? (
        <form
          className="rc-catalog-operation-transition"
          onSubmit={submitTransition}
        >
          <label className="rc-field">
            <span className="rc-field__label">
              Resolution / processing note
            </span>
            <input
              className="rc-control"
              name="resolutionNote"
              maxLength={2000}
              placeholder="Optional note for the audit trail"
            />
          </label>
          <div className="rc-form-actions">
            {nextStatuses.map(
              (nextStatus) => (
                <button
                  key={nextStatus}
                  className={
                    nextStatus ===
                      "REJECTED" ||
                    nextStatus ===
                      "CANCELLED"
                      ? "rc-button rc-button--tertiary rc-button--compact"
                      : "rc-button rc-button--compact"
                  }
                  name="nextStatus"
                  value={nextStatus}
                  disabled={busy}
                >
                  {operationActionLabel(
                    nextStatus,
                  )}
                </button>
              ),
            )}
          </div>
        </form>
      ) : null}
    </article>
  );
}

export default function CatalogOperations() {
  const data = useLoaderData();
  const navigate = useNavigate();
  const revalidator =
    useRevalidator();
  const shopify = useAppBridge();
  const [busy, setBusy] =
    useState(false);
  const [notice, setNotice] =
    useState(null);
  const [operationType, setOperationType] =
    useState("CORRECTION");

  const post = async (formData) => {
    if (busy) return null;
    setBusy(true);
    setNotice({
      tone: "info",
      message: "Saving catalog operation…",
    });

    try {
      const result =
        await authenticatedPost(
          shopify,
          `/api/catalog-operations/${data.release.id}`,
          formData,
        );
      const message =
        result.message || "Saved.";
      setNotice({
        tone: "good",
        message,
      });
      shopify.toast.show(message);
      await revalidator.revalidate();
      return result;
    } catch (error) {
      setNotice({
        tone: "bad",
        message:
          error instanceof Error
            ? error.message
            : "ReleaseCore could not update catalog operations.",
      });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveCatalogNumber = async (
    event,
  ) => {
    event.preventDefault();
    const formData =
      new FormData(event.currentTarget);
    const next = String(
      formData.get("catalogNumber") || "",
    )
      .trim()
      .toUpperCase();
    const current =
      currentCatalogNumber;

    if (
      current &&
      next !== current
    ) {
      const safetyConfirmation =
        promptSafetyConfirmation({
          phrase:
            "CHANGE CATALOG NUMBER",
          message: `Change catalog number ${current} to ${next}? The old value remains in ReleaseCore's audit history.`,
        });
      if (!safetyConfirmation) return;
      formData.set(
        "safetyConfirmation",
        safetyConfirmation,
      );
    }

    formData.set(
      "intent",
      "set-catalog-number",
    );
    await post(formData);
  };

  const createOperation = async (
    event,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData =
      new FormData(form);
    formData.set(
      "intent",
      "create-operation",
    );

    if (operationType === "TAKEDOWN") {
      const safetyConfirmation =
        promptSafetyConfirmation({
          phrase: "REQUEST TAKEDOWN",
          message:
            "Record a full release takedown request? This does not contact DSPs automatically, but it creates a high-impact operational request.",
        });
      if (!safetyConfirmation) return;
      formData.set(
        "safetyConfirmation",
        safetyConfirmation,
      );
    }

    const result =
      await post(formData);
    if (result) {
      form.reset();
      setOperationType("CORRECTION");
    }
  };

  const currentCatalogNumber =
    data.release.catalogNumber || "";

  return (
    <s-page heading="Catalog Operations">
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
            `/app/release/${data.release.id}/relationships`,
          )
        }
      >
        Catalog relationships
      </s-button>
      {data.release.status === "APPROVED" ||
      (data.release.distributionStatus &&
        data.release.distributionStatus !==
          "NOT_QUEUED") ? (
        <s-button
          slot="secondary-actions"
          onClick={() =>
            navigate(
              `/app/distribution/${data.release.id}`,
            )
          }
        >
          Distribution
        </s-button>
      ) : null}

      <s-section>
        <PageIntro
          eyebrow="M17.4 · Corrections, updates & takedowns"
          title="Manage changes to a catalog record without erasing its history."
        >
          Record post-submission corrections,
          deliberate updates, and full-release
          takedown requests here. These operations
          create an auditable ReleaseCore workflow;
          they do not directly contact DSPs or remove
          Shopify products.
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
              {data.release.tracks.length}{" "}
              {data.release.tracks.length === 1
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

      <s-section heading="Catalog identifier">
        <div className="rc-catalog-identifier-panel">
          <div>
            <span className="rc-eyebrow">
              Admin override
            </span>
            <strong>
              Catalog number
            </strong>
            <p>
              Assign a legacy catalog number to a
              back-catalog release or correct an
              existing ReleaseCore catalog number.
              This works even when automatic catalog
              numbering remains enabled for new
              releases.
            </p>
          </div>
          <form
            className="rc-catalog-identifier-form"
            onSubmit={saveCatalogNumber}
          >
            <input
              className="rc-control"
              name="catalogNumber"
              defaultValue={
                currentCatalogNumber
              }
              maxLength={64}
              required
              placeholder="ERE190001"
            />
            <button
              className="rc-button rc-button--primary"
              disabled={busy}
            >
              {currentCatalogNumber
                ? "Save catalog number"
                : "Assign catalog number"}
            </button>
          </form>
          <div className="rc-catalog-identifier-note">
            <span>
              Assignment mode:{" "}
              <strong>
                {data.catalogSettings.mode}
              </strong>
            </span>
            <span>
              Changing this field does not change
              your global numbering settings and
              does not directly write to Shopify or
              a distributor. The previous value is
              retained in the audit history.
            </span>
          </div>
        </div>
      </s-section>

      <s-section heading="New catalog operation">
        <form
          className="rc-catalog-operation-form"
          onSubmit={createOperation}
        >
          <label className="rc-field">
            <span className="rc-field__label">
              Operation
            </span>
            <select
              className="rc-control"
              name="type"
              value={operationType}
              onChange={(event) =>
                setOperationType(
                  event.target.value,
                )
              }
            >
              {CATALOG_OPERATION_TYPES.map(
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
            <span className="rc-field__help">
              {
                catalogOperationTypeDefinition(
                  operationType,
                ).description
              }
            </span>
          </label>

          {operationType !== "TAKEDOWN" ? (
            <>
              <label className="rc-field">
                <span className="rc-field__label">
                  Category
                </span>
                <select
                  className="rc-control"
                  name="category"
                  defaultValue="METADATA"
                >
                  {CATALOG_OPERATION_CATEGORIES.map(
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

              <label className="rc-field">
                <span className="rc-field__label">
                  Track
                </span>
                <select
                  className="rc-control"
                  name="trackId"
                  defaultValue=""
                >
                  <option value="">
                    Release-level change
                  </option>
                  {data.release.tracks.map(
                    (track) => (
                      <option
                        key={track.id}
                        value={track.id}
                      >
                        Track {track.position} —{" "}
                        {track.title}
                        {track.isrc
                          ? ` · ${track.isrc}`
                          : ""}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </>
          ) : (
            <div className="rc-notice rc-notice--warn rc-catalog-takedown-warning">
              <strong>
                Full release takedown
              </strong>
              <span>
                ReleaseCore preserves the catalog
                record, identifiers, relationships,
                files, and audit history. This
                request is operational intent only;
                it does not automatically remove
                anything from DSPs.
              </span>
            </div>
          )}

          <label className="rc-field">
            <span className="rc-field__label">
              Requested effective date
            </span>
            <input
              className="rc-control rc-admin-date-control"
              type="date"
              name="effectiveDate"
            />
            <span className="rc-field__help">
              Optional. Leave blank when the change
              should be processed as soon as
              practical.
            </span>
          </label>

          <label className="rc-field rc-catalog-operation-form__wide">
            <span className="rc-field__label">
              Summary
            </span>
            <input
              className="rc-control"
              name="summary"
              required
              maxLength={160}
              placeholder={
                operationType === "TAKEDOWN"
                  ? "Remove release from distribution"
                  : "Correct original release year"
              }
            />
          </label>

          <label className="rc-field rc-catalog-operation-form__wide">
            <span className="rc-field__label">
              Request details
            </span>
            <textarea
              className="rc-control"
              name="reason"
              required
              maxLength={3000}
              rows={5}
              placeholder="Describe exactly what needs to change, why, and any downstream context the operator needs."
            />
          </label>

          <div className="rc-form-actions rc-catalog-operation-form__wide">
            <button
              className={
                operationType === "TAKEDOWN"
                  ? "rc-button rc-button--danger"
                  : "rc-button rc-button--primary"
              }
              disabled={busy}
            >
              {operationType === "TAKEDOWN"
                ? "Request takedown"
                : operationType === "UPDATE"
                  ? "Create update request"
                  : "Create correction request"}
            </button>
          </div>
        </form>
      </s-section>

      <s-section
        heading={`Catalog operation history (${data.release.lifecycleRequests.length})`}
      >
        {data.release.lifecycleRequests.length ? (
          <div className="rc-catalog-operation-list">
            {data.release.lifecycleRequests.map(
              (request) => (
                <CatalogOperationCard
                  key={request.id}
                  request={request}
                  busy={busy}
                  post={post}
                />
              ),
            )}
          </div>
        ) : (
          <EmptyState title="No catalog operations yet">
            Corrections, updates, and takedown
            requests will remain attached to this
            release as a permanent operational
            history.
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
