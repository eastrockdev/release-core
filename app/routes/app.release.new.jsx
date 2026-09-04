import {
  useEffect,
  useState,
} from "react";
import {
  useLoaderData,
  useNavigate,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  typeLabel,
} from "../lib/releasecore";
import { authenticatedPost } from "../lib/authenticated-post";
import {
  getReleaseTemplate,
  listReleaseTemplates,
  releaseReusePreview,
} from "../lib/release-templates.server";
import {
  PageIntro,
  StatusBadge,
} from "../components/releasecore-ui";

export const loader = async ({ request }) => {
  const { session } =
    await authenticate.admin(request);
  const url = new URL(request.url);
  const templateId = String(
    url.searchParams.get("template") || "",
  ).trim();
  const duplicateReleaseId = String(
    url.searchParams.get("duplicate") || "",
  ).trim();

  if (
    templateId &&
    duplicateReleaseId
  ) {
    throw new Response(
      "Choose either a template or a release to duplicate.",
      { status: 400 },
    );
  }

  const [
    templates,
    selectedTemplate,
    duplicateSource,
  ] = await Promise.all([
    listReleaseTemplates({
      shop: session.shop,
    }),
    templateId
      ? getReleaseTemplate({
          shop: session.shop,
          templateId,
        })
      : Promise.resolve(null),
    duplicateReleaseId
      ? releaseReusePreview({
          shop: session.shop,
          releaseId:
            duplicateReleaseId,
        })
      : Promise.resolve(null),
  ]);

  return {
    templates,
    selectedTemplate:
      selectedTemplate
        ? {
            id: selectedTemplate.id,
            name: selectedTemplate.name,
            description:
              selectedTemplate.description,
            releaseType:
              selectedTemplate.releaseType,
            trackCount:
              selectedTemplate.trackCount,
          }
        : null,
    duplicateSource,
  };
};

const OPTIONS = [
  {
    type: "SINGLE",
    label: "Single",
    detail: "One-track release",
    note: "Best for a standalone song.",
  },
  {
    type: "EP",
    label: "EP",
    detail: "Multi-track release",
    note: "Build the tracklist after creation.",
  },
  {
    type: "ALBUM",
    label: "Album",
    detail: "Multi-track release",
    note: "Build and manage the full tracklist.",
  },
];

function ReuseSummary({
  label,
  type,
  tracks,
  detail,
}) {
  return (
    <div className="rc-release-reuse-selected">
      <div>
        <span className="rc-eyebrow">
          Reuse source
        </span>
        <strong>{label}</strong>
        {detail ? (
          <span>{detail}</span>
        ) : null}
      </div>
      <div className="rc-release-reuse-selected__badges">
        <StatusBadge tone="info">
          {typeLabel(type)}
        </StatusBadge>
        <StatusBadge tone="neutral">
          {tracks}{" "}
          {tracks === 1
            ? "track"
            : "tracks"}
        </StatusBadge>
      </div>
    </div>
  );
}

export default function NewRelease() {
  const {
    templates,
    selectedTemplate,
    duplicateSource,
  } = useLoaderData();
  const [type, setType] =
    useState("SINGLE");
  const [title, setTitle] =
    useState("");
  const [saving, setSaving] =
    useState(false);
  const [error, setError] =
    useState("");
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const mode = duplicateSource
    ? "duplicate"
    : selectedTemplate
      ? "template"
      : "blank";
  const inheritedType =
    duplicateSource?.type ||
    selectedTemplate?.releaseType ||
    null;
  const selectionKey =
    duplicateSource?.id ||
    selectedTemplate?.id ||
    "blank";

  useEffect(() => {
    if (duplicateSource) {
      setType(duplicateSource.type);
      setTitle(
        `${duplicateSource.title} Copy`,
      );
      return;
    }

    if (selectedTemplate) {
      setType(
        selectedTemplate.releaseType,
      );
      setTitle("");
      return;
    }

    setType("SINGLE");
    setTitle("");
  }, [
    selectionKey,
    duplicateSource,
    selectedTemplate,
  ]);

  const createRelease = async () => {
    if (saving) return;
    setSaving(true);
    setError("");

    try {
      const formData =
        new FormData();
      formData.set("type", type);
      formData.set("title", title);

      if (selectedTemplate) {
        formData.set(
          "templateId",
          selectedTemplate.id,
        );
      }
      if (duplicateSource) {
        formData.set(
          "duplicateReleaseId",
          duplicateSource.id,
        );
      }

      const data =
        await authenticatedPost(
          shopify,
          "/api/releases/create",
          formData,
        );

      shopify.toast.show(
        `${typeLabel(
          data.type || type,
        )} draft created`,
      );
      navigate(
        `/app/release/${data.releaseId}`,
      );
    } catch (err) {
      console.error(
        "ReleaseCore: create release request failed",
        err,
      );
      setError(
        err instanceof Error
          ? err.message
          : "ReleaseCore could not create this release.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <s-page heading="Create release">
      <s-button
        slot="secondary-actions"
        onClick={() =>
          navigate("/app/releases")
        }
      >
        Cancel
      </s-button>

      <div style={styles.pageStack}>
        <s-section>
          <PageIntro
            eyebrow="M17.1 · Reusable release workflow"
            title="Start blank, reuse a template, or duplicate an existing release."
          >
            Reused drafts carry forward
            structured metadata, track
            structure, artists, credits, and
            availability rules. Release dates,
            UPC/catalog identifiers, ISRCs,
            masters, Shopify product links,
            distribution state, submission
            history, and artist-portal ownership
            are intentionally reset.
          </PageIntro>
        </s-section>

        <s-section heading="1. Start from">
          <div className="rc-release-reuse-grid">
            <button
              type="button"
              className={`rc-choice-button ${
                mode === "blank"
                  ? "rc-choice-button--selected"
                  : ""
              }`}
              aria-pressed={
                mode === "blank"
              }
              onClick={() =>
                navigate(
                  "/app/release/new",
                )
              }
            >
              <strong>Blank release</strong>
              <span>
                Use current ReleaseCore
                defaults and build the release
                from scratch.
              </span>
            </button>

            <div
              className={`rc-release-reuse-template ${
                mode === "template"
                  ? "rc-release-reuse-template--selected"
                  : ""
              }`}
            >
              <strong>Release template</strong>
              <span>
                Reuse a saved release structure
                and recurring metadata.
              </span>
              <select
                className="rc-control"
                value={
                  selectedTemplate?.id || ""
                }
                onChange={(event) => {
                  const value =
                    event.target.value;
                  navigate(
                    value
                      ? `/app/release/new?template=${encodeURIComponent(
                          value,
                        )}`
                      : "/app/release/new",
                  );
                }}
              >
                <option value="">
                  Choose template…
                </option>
                {templates.map(
                  (template) => (
                    <option
                      key={template.id}
                      value={template.id}
                    >
                      {template.name} ·{" "}
                      {typeLabel(
                        template.releaseType,
                      )} ·{" "}
                      {template.trackCount}{" "}
                      {template.trackCount ===
                      1
                        ? "track"
                        : "tracks"}
                    </option>
                  ),
                )}
              </select>
              <button
                type="button"
                className="rc-button rc-button--tertiary rc-button--compact"
                onClick={() =>
                  navigate(
                    "/app/release-templates",
                  )
                }
              >
                Manage templates
              </button>
            </div>

            {duplicateSource ? (
              <div className="rc-release-reuse-template rc-release-reuse-template--selected">
                <strong>
                  Duplicate existing release
                </strong>
                <span>
                  {duplicateSource.title}
                </span>
                <StatusBadge tone="info">
                  {typeLabel(
                    duplicateSource.type,
                  )}
                </StatusBadge>
                <button
                  type="button"
                  className="rc-button rc-button--tertiary rc-button--compact"
                  onClick={() =>
                    navigate(
                      "/app/release/new",
                    )
                  }
                >
                  Clear duplicate
                </button>
              </div>
            ) : (
              <div className="rc-release-reuse-template rc-release-reuse-template--muted">
                <strong>
                  Duplicate existing release
                </strong>
                <span>
                  Open any release and choose
                  Duplicate release to use it as
                  the source.
                </span>
              </div>
            )}
          </div>
        </s-section>

        {duplicateSource ? (
          <s-section heading="Selected duplicate">
            <ReuseSummary
              label={duplicateSource.title}
              type={duplicateSource.type}
              tracks={
                duplicateSource.trackCount
              }
              detail={`${duplicateSource.artistCount} release artist assignment${duplicateSource.artistCount === 1 ? "" : "s"} · ${duplicateSource.creditCount} credit${duplicateSource.creditCount === 1 ? "" : "s"} carried forward`}
            />
          </s-section>
        ) : null}

        {selectedTemplate ? (
          <s-section heading="Selected template">
            <ReuseSummary
              label={selectedTemplate.name}
              type={
                selectedTemplate.releaseType
              }
              tracks={
                selectedTemplate.trackCount
              }
              detail={
                selectedTemplate.description ||
                "Saved reusable release metadata"
              }
            />
          </s-section>
        ) : null}

        <s-section heading="2. Release format">
          {inheritedType ? (
            <div className="rc-notice rc-notice--info">
              Format is inherited from the{" "}
              {mode === "template"
                ? "template"
                : "source release"}
              :{" "}
              <strong>
                {typeLabel(inheritedType)}
              </strong>
              .
            </div>
          ) : (
            <div style={styles.optionGrid}>
              {OPTIONS.map((option) => {
                const selected =
                  type === option.type;
                return (
                  <button
                    type="button"
                    key={option.type}
                    onClick={() =>
                      setType(option.type)
                    }
                    className={`rc-choice-button ${
                      selected
                        ? "rc-choice-button--selected"
                        : ""
                    }`}
                    aria-pressed={selected}
                  >
                    <div
                      style={
                        styles.optionTop
                      }
                    >
                      <span
                        style={
                          styles.optionLabel
                        }
                      >
                        {option.label}
                      </span>
                    </div>
                    <div
                      style={
                        styles.optionDetail
                      }
                    >
                      {option.detail}
                    </div>
                    <div
                      style={
                        styles.optionNote
                      }
                    >
                      {option.note}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </s-section>

        <s-section heading="3. Name the release">
          <label
            style={styles.label}
            htmlFor="release-title"
          >
            Release title
          </label>
          <input
            id="release-title"
            name="title"
            type="text"
            value={title}
            onChange={(event) =>
              setTitle(
                event.target.value,
              )
            }
            onKeyDown={(event) => {
              if (
                event.key === "Enter"
              ) {
                event.preventDefault();
                createRelease();
              }
            }}
            placeholder={`e.g. ${
              type === "SINGLE"
                ? "Running Away"
                : type === "EP"
                  ? "After Hours"
                  : "Midnight in New Haven"
            }`}
            className="rc-control"
          />
          <div style={styles.help}>
            {duplicateSource
              ? "The source release remains unchanged. This title belongs only to the new draft."
              : selectedTemplate
                ? "The template remains unchanged. Enter the title for this new release."
                : "Optional for now. You can change the title from the release workspace at any time."}
          </div>

          {error ? (
            <div
              className="rc-notice rc-notice--bad"
              style={{ marginTop: 12 }}
            >
              {error}
            </div>
          ) : null}

          <div
            className="rc-form-actions rc-release-new-actions"
            style={
              styles.footerActions
            }
          >
            <s-button
              onClick={() =>
                navigate("/app/releases")
              }
            >
              Cancel
            </s-button>
            <button
              type="button"
              disabled={saving}
              onClick={createRelease}
              className="rc-button rc-button--primary"
            >
              {saving
                ? "Creating…"
                : mode === "duplicate"
                  ? "Create duplicate draft"
                  : mode === "template"
                    ? "Create from template"
                    : `Create ${typeLabel(
                        type,
                      )}`}
            </button>
          </div>
        </s-section>
      </div>
    </s-page>
  );
}

const styles = {
  pageStack: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
  },
  optionGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(190px,1fr))",
    gap: 12,
  },
  optionTop: {
    display: "flex",
    justifyContent:
      "space-between",
    gap: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  optionLabel: {
    fontSize: 17,
    fontWeight: 750,
    color: "#202223",
  },
  optionDetail: {
    fontSize: 12,
    fontWeight: 650,
    color: "#303030",
    marginBottom: 5,
  },
  optionNote: {
    fontSize: 12,
    lineHeight: 1.4,
    color: "#6d7175",
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 650,
    color: "#303030",
    marginBottom: 6,
  },
  help: {
    color: "#6d7175",
    fontSize: 11,
    lineHeight: 1.4,
    marginTop: 7,
  },
  footerActions: {
    display: "flex",
    justifyContent:
      "flex-end",
    alignItems: "center",
    gap: 10,
    marginTop: 20,
  },
};

export const headers = (
  headersArgs,
) =>
  boundary.headers(headersArgs);
