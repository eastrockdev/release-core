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
  listReleaseTemplates,
  releaseReusePreview,
} from "../lib/release-templates.server";
import { authenticatedPost } from "../lib/authenticated-post";
import {
  EmptyState,
  PageIntro,
  StatusBadge,
} from "../components/releasecore-ui";
import { typeLabel } from "../lib/releasecore";

export const loader = async ({ request }) => {
  const { session } =
    await authenticate.admin(request);
  const url = new URL(request.url);
  const sourceReleaseId = String(
    url.searchParams.get("source") || "",
  ).trim();

  const [templates, source] =
    await Promise.all([
      listReleaseTemplates({
        shop: session.shop,
      }),
      sourceReleaseId
        ? releaseReusePreview({
            shop: session.shop,
            releaseId:
              sourceReleaseId,
          })
        : Promise.resolve(null),
    ]);

  return {
    templates,
    source,
  };
};

export default function ReleaseTemplates() {
  const { templates, source } =
    useLoaderData();
  const navigate = useNavigate();
  const revalidator =
    useRevalidator();
  const shopify = useAppBridge();
  const [busy, setBusy] =
    useState(false);
  const [notice, setNotice] =
    useState(null);

  const post = async (formData) => {
    if (busy) return null;
    setBusy(true);
    setNotice(null);

    try {
      const result =
        await authenticatedPost(
          shopify,
          "/api/release-templates",
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
            : "ReleaseCore could not update release templates.",
      });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const createTemplate = async (
    event,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("intent", "create");

    const result = await post(data);
    if (result) {
      form.reset();
      navigate(
        "/app/release-templates",
        { replace: true },
      );
    }
  };

  const deleteTemplate = async (
    template,
  ) => {
    if (
      !window.confirm(
        `Delete release template “${template.name}”? Existing releases created from it are not affected.`,
      )
    ) {
      return;
    }

    const data = new FormData();
    data.set("intent", "delete");
    data.set(
      "templateId",
      template.id,
    );
    await post(data);
  };

  return (
    <s-page heading="Release Templates">
      <s-button
        slot="secondary-actions"
        onClick={() =>
          navigate("/app/settings")
        }
      >
        Settings
      </s-button>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() =>
          navigate("/app/release/new")
        }
      >
        Create release
      </s-button>

      <s-section>
        <PageIntro
          eyebrow="M17.1 · Reusable release workflow"
          title="Save recurring release structure without carrying dangerous identifiers forward."
        >
          Templates store a sanitized local
          blueprint of release metadata, track
          structure, artist assignments, credits,
          and availability rules. Masters,
          artwork/support files, Shopify product
          links, UPC/catalog numbers, ISRCs,
          release dates, submission state, and
          artist-portal ownership are never stored
          as reusable release output.
        </PageIntro>
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

      {source ? (
        <s-section heading="Save current release as a template">
          <div className="rc-release-template-source">
            <div>
              <span className="rc-eyebrow">
                Source release
              </span>
              <strong>{source.title}</strong>
              <span>
                {source.trackCount}{" "}
                {source.trackCount === 1
                  ? "track"
                  : "tracks"}{" "}
                · {source.artistCount} release
                artist assignment
                {source.artistCount === 1
                  ? ""
                  : "s"}{" "}
                · {source.creditCount} credit
                {source.creditCount === 1
                  ? ""
                  : "s"}
              </span>
            </div>
            <StatusBadge tone="info">
              {typeLabel(source.type)}
            </StatusBadge>
          </div>

          <form
            onSubmit={createTemplate}
            className="rc-release-template-create"
          >
            <input
              type="hidden"
              name="sourceReleaseId"
              value={source.id}
            />
            <label className="rc-field">
              <span className="rc-field__label">
                Template name
              </span>
              <input
                className="rc-control"
                name="name"
                required
                maxLength={80}
                defaultValue={`${source.title} template`}
              />
            </label>
            <label className="rc-field">
              <span className="rc-field__label">
                Description
              </span>
              <textarea
                className="rc-control"
                name="description"
                maxLength={240}
                placeholder="Optional note about when to use this template."
              />
            </label>
            <div className="rc-form-actions">
              <button
                className="rc-button rc-button--primary"
                disabled={busy}
              >
                {busy
                  ? "Saving…"
                  : "Save template"}
              </button>
              <Link
                className="rc-button"
                to={`/app/release/${source.id}`}
              >
                Back to release
              </Link>
            </div>
          </form>
        </s-section>
      ) : (
        <s-section>
          <div className="rc-operations-note">
            To save a new template, open any
            ReleaseCore release and choose{" "}
            <strong>Save as template</strong>.
          </div>
        </s-section>
      )}

      <s-section heading={`Saved templates (${templates.length})`}>
        {templates.length ? (
          <div className="rc-release-template-list">
            {templates.map(
              (template) => (
                <article
                  className="rc-release-template-row"
                  key={template.id}
                >
                  <div className="rc-release-template-row__main">
                    <div className="rc-release-template-row__title">
                      <strong>
                        {template.name}
                      </strong>
                      <StatusBadge tone="info">
                        {typeLabel(
                          template.releaseType,
                        )}
                      </StatusBadge>
                      <StatusBadge tone="neutral">
                        {template.trackCount}{" "}
                        {template.trackCount ===
                        1
                          ? "track"
                          : "tracks"}
                      </StatusBadge>
                    </div>
                    {template.description ? (
                      <span>
                        {template.description}
                      </span>
                    ) : null}
                    <span className="rc-field__help">
                      Updated{" "}
                      {new Date(
                        template.updatedAt,
                      ).toLocaleString()}
                    </span>
                  </div>
                  <div className="rc-release-template-row__actions">
                    <Link
                      className="rc-button rc-button--primary rc-button--compact"
                      to={`/app/release/new?template=${encodeURIComponent(
                        template.id,
                      )}`}
                    >
                      Use template
                    </Link>
                    <button
                      type="button"
                      disabled={busy}
                      className="rc-button rc-button--danger rc-button--compact"
                      onClick={() =>
                        deleteTemplate(
                          template,
                        )
                      }
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ),
            )}
          </div>
        ) : (
          <EmptyState title="No release templates yet">
            Save a release as a template to
            reuse its metadata structure, artists,
            credits, and availability rules.
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
