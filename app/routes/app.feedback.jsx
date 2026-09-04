import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  ActionFeedback,
  EmptyState,
  PageIntro,
  StatusBadge,
} from "../components/releasecore-ui";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_IMPACTS,
  createFeedbackReport,
  listFeedbackReports,
  normalizeFeedbackPagePath,
  resolveFeedbackContext,
} from "../lib/feedback-reports.server";
import {
  listRecentSystemIssues,
} from "../lib/system-issues.server";
import {
  apiErrorResponse,
} from "../lib/http-security.server";

const CATEGORY_LABELS = {
  PROBLEM: "Problem / bug",
  IMPROVEMENT: "Workflow improvement",
  FEATURE_REQUEST: "Feature request",
  GENERAL: "General feedback",
};

const IMPACT_LABELS = {
  BLOCKING: "Blocking my work",
  SIGNIFICANT: "Significant",
  MINOR: "Minor",
  SUGGESTION: "Suggestion only",
};

function feedbackStatusTone(status) {
  if (status === "RESOLVED") return "good";
  if (status === "REVIEWING") return "info";
  return "neutral";
}

export const loader = async ({ request }) => {
  const { session } =
    await authenticate.admin(request);
  const url = new URL(request.url);

  const pagePath =
    normalizeFeedbackPagePath(
      url.searchParams.get("from"),
    ) || "/app";

  const requestedSystemIssue =
    String(
      url.searchParams.get(
        "systemIssue",
      ) || "",
    ).trim();

  const [
    context,
    recentReports,
    openSystemIssues,
  ] = await Promise.all([
    resolveFeedbackContext({
      shop: session.shop,
      pagePath,
      systemIssueId:
        requestedSystemIssue,
    }),
    listFeedbackReports({
      shop: session.shop,
      take: 10,
    }),
    listRecentSystemIssues({
      shop: session.shop,
      take: 8,
      status: "OPEN",
    }),
  ]);

  return {
    context,
    recentReports,
    openSystemIssues,
    categories: FEEDBACK_CATEGORIES,
    impacts: FEEDBACK_IMPACTS,
  };
};

export const action = async ({ request }) => {
  let shop = null;

  try {
    const { session } =
      await authenticate.admin(request);
    shop = session.shop;

    const formData =
      await request.formData();

    const report =
      await createFeedbackReport({
        shop,
        category:
          formData.get("category"),
        impact:
          formData.get("impact"),
        summary:
          formData.get("summary"),
        message:
          formData.get("message"),
        pagePath:
          formData.get("pagePath"),
        systemIssueId:
          formData.get("systemIssueId"),
      });

    return Response.json({
      ok: true,
      reference: report.reference,
      message:
        `Feedback ${report.reference} received.`,
    });
  } catch (error) {
    return apiErrorResponse(
      request,
      error,
      {
        context:
          "feedback submission",
        operation:
          "submit-feedback",
        fallback:
          "ReleaseCore could not submit this feedback.",
        shop,
      },
    );
  }
};

function ContextCard({ context }) {
  const hasContext =
    context.pagePath ||
    context.release ||
    context.track ||
    context.systemIssue;

  return (
    <div className="rc-feedback-context">
      <div>
        <strong>
          Context included automatically
        </strong>
        <span>
          ReleaseCore attaches only operational
          context needed to reproduce the issue.
        </span>
      </div>

      {hasContext ? (
        <dl>
          <div>
            <dt>Page</dt>
            <dd>
              {context.pagePath || "—"}
            </dd>
          </div>
          <div>
            <dt>Release</dt>
            <dd>
              {context.release?.title ||
                "Not associated"}
            </dd>
          </div>
          <div>
            <dt>Track</dt>
            <dd>
              {context.track
                ? `Track ${context.track.position} · ${context.track.title}`
                : "Not associated"}
            </dd>
          </div>
          <div>
            <dt>System issue</dt>
            <dd>
              {context.systemIssue
                ? context.systemIssue.requestId ||
                  context.systemIssue.errorClass
                : "Not associated"}
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

function FeedbackReportCard({ report }) {
  return (
    <article className="rc-feedback-report">
      <div className="rc-feedback-report__header">
        <div className="rc-feedback-report__badges">
          <StatusBadge tone="neutral">
            {CATEGORY_LABELS[
              report.category
            ] || report.category}
          </StatusBadge>
          <StatusBadge
            tone={
              report.impact ===
              "BLOCKING"
                ? "critical"
                : report.impact ===
                    "SIGNIFICANT"
                  ? "warning"
                  : "info"
            }
          >
            {IMPACT_LABELS[
              report.impact
            ] || report.impact}
          </StatusBadge>
          <StatusBadge
            tone={feedbackStatusTone(
              report.status,
            )}
          >
            {report.status}
          </StatusBadge>
        </div>
        <span>{report.reference}</span>
      </div>

      <strong>{report.summary}</strong>

      <div className="rc-feedback-report__meta">
        <span>
          {new Date(
            report.createdAt,
          ).toLocaleString()}
        </span>
        {report.release ? (
          <>
            <span>·</span>
            <Link
              to={`/app/release/${report.release.id}`}
            >
              {report.release.title}
            </Link>
          </>
        ) : null}
        {report.systemIssueId ? (
          <>
            <span>·</span>
            <Link to="/app/system-issues">
              System issue attached
            </Link>
          </>
        ) : null}
      </div>
    </article>
  );
}

export default function Feedback() {
  const data = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();

  const submitting =
    navigation.state === "submitting";

  const actionFeedback = actionData
    ? {
        tone: actionData.ok
          ? "good"
          : "bad",
        message:
          actionData.message ||
          actionData.error,
      }
    : null;

  return (
    <s-page heading="Feedback">
      <s-section>
        <PageIntro
          eyebrow="Help improve ReleaseCore"
          title="Report a problem or tell us what would make the workflow better."
          actions={
            <Link
              to={data.context.pagePath || "/app"}
              className="rc-button"
            >
              Back to previous page
            </Link>
          }
        >
          Feedback is stored with this store and
          deployment only. ReleaseCore does not
          attach your staff name, email address,
          IP address, browser fingerprint, request
          headers, or URL query string.
        </PageIntro>
      </s-section>

      <ActionFeedback
        feedback={actionFeedback}
      />

      <s-section heading="Send feedback">
        <ContextCard
          context={data.context}
        />

        <Form
          key={
            actionData?.ok
              ? actionData.reference
              : "feedback-form"
          }
          method="post"
          className="rc-feedback-form"
        >
          <input
            type="hidden"
            name="pagePath"
            value={
              data.context.pagePath ||
              "/app"
            }
          />

          <div className="rc-feedback-form__grid">
            <label className="rc-field">
              <span className="rc-field__label">
                Feedback type
              </span>
              <select
                name="category"
                defaultValue="PROBLEM"
                className="rc-control"
                required
              >
                {data.categories.map(
                  (category) => (
                    <option
                      key={category}
                      value={category}
                    >
                      {CATEGORY_LABELS[
                        category
                      ] || category}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label className="rc-field">
              <span className="rc-field__label">
                Impact
              </span>
              <select
                name="impact"
                defaultValue="MINOR"
                className="rc-control"
                required
              >
                {data.impacts.map(
                  (impact) => (
                    <option
                      key={impact}
                      value={impact}
                    >
                      {IMPACT_LABELS[
                        impact
                      ] || impact}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>

          <label className="rc-field">
            <span className="rc-field__label">
              Summary
            </span>
            <input
              name="summary"
              className="rc-control"
              minLength={5}
              maxLength={160}
              placeholder="What happened or what should change?"
              required
            />
          </label>

          <label className="rc-field">
            <span className="rc-field__label">
              Details
            </span>
            <textarea
              name="message"
              className="rc-control rc-feedback-form__details"
              minLength={10}
              maxLength={4000}
              placeholder="What were you trying to do, what happened, and what did you expect instead?"
              required
            />
            <span className="rc-field__help">
              Do not include passwords, access
              tokens, private master-audio links,
              customer payment information, or
              other secrets.
            </span>
          </label>

          <label className="rc-field">
            <span className="rc-field__label">
              Related System Issue
            </span>
            <select
              name="systemIssueId"
              className="rc-control"
              defaultValue={
                data.context.systemIssue?.id ||
                ""
              }
            >
              <option value="">
                None
              </option>
              {data.openSystemIssues.map(
                (issue) => (
                  <option
                    key={issue.id}
                    value={issue.id}
                  >
                    {issue.requestId ||
                      issue.errorClass}
                    {" · "}
                    {issue.release?.title ||
                      "ReleaseCore system"}
                  </option>
                ),
              )}
            </select>
            <span className="rc-field__help">
              Attach an existing diagnostic when
              it describes the same problem. No
              technical stack trace is added to
              your report.
            </span>
          </label>

          <div className="rc-feedback-form__actions">
            <div>
              <strong>
                Ready to send
              </strong>
              <span>
                You will receive a feedback
                reference after submission.
              </span>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="rc-button rc-button--primary"
            >
              {submitting
                ? "Sending feedback…"
                : "Send feedback"}
            </button>
          </div>
        </Form>
      </s-section>

      <s-section heading="Recent feedback from this store">
        {data.recentReports.length ? (
          <div className="rc-feedback-report-list">
            {data.recentReports.map(
              (report) => (
                <FeedbackReportCard
                  key={report.id}
                  report={report}
                />
              ),
            )}
          </div>
        ) : (
          <EmptyState title="No feedback submitted yet">
            Reports sent from this store will
            appear here with their feedback
            reference.
          </EmptyState>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);
