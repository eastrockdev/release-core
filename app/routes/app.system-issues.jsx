import {
  Form,
  Link,
  useLoaderData,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  apiErrorResponse,
  publicError,
} from "../lib/http-security.server";
import {
  listRecentSystemIssues,
  markSystemIssueResolved,
} from "../lib/system-issues.server";
import {
  EmptyState,
  MetricCard,
  MetricGrid,
  PageIntro,
  StatusBadge,
} from "../components/releasecore-ui";

export const loader = async ({ request }) => {
  const { session } =
    await authenticate.admin(request);

  const issues =
    await listRecentSystemIssues({
      shop: session.shop,
      take: 100,
    });

  return {
    issues,
    openCount: issues.filter(
      (issue) => issue.status === "OPEN",
    ).length,
    criticalCount: issues.filter(
      (issue) =>
        issue.status === "OPEN" &&
        issue.severity === "CRITICAL",
    ).length,
    retryableCount: issues.filter(
      (issue) =>
        issue.status === "OPEN" &&
        issue.retryable,
    ).length,
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
    const intent = String(
      formData.get("intent") || "",
    );
    const issueId = String(
      formData.get("issueId") || "",
    ).trim();

    if (
      intent !== "resolve" ||
      !issueId
    ) {
      throw publicError(
        "Choose a system issue to resolve.",
        { status: 400 },
      );
    }

    const issue =
      await markSystemIssueResolved({
        shop,
        issueId,
      });

    if (!issue) {
      throw publicError(
        "System issue not found.",
        { status: 404 },
      );
    }

    return Response.json({
      ok: true,
      message: "System issue marked resolved.",
    });
  } catch (error) {
    return apiErrorResponse(
      request,
      error,
      {
        context:
          "system issue mutation",
        operation:
          "resolve-system-issue",
        fallback:
          "ReleaseCore could not update the system issue.",
        shop,
      },
    );
  }
};

function severityTone(severity) {
  if (severity === "CRITICAL") {
    return "critical";
  }
  if (severity === "ERROR") {
    return "warning";
  }
  return "info";
}

function issueWhen(issue) {
  return new Date(
    issue.lastSeenAt,
  ).toLocaleString();
}

function SystemIssueCard({ issue }) {
  return (
    <article className="rc-system-issue">
      <div className="rc-system-issue__header">
        <div className="rc-system-issue__badges">
          <StatusBadge
            tone={severityTone(issue.severity)}
          >
            {issue.severity}
          </StatusBadge>
          <StatusBadge
            tone={
              issue.status === "RESOLVED"
                ? "good"
                : "warning"
            }
          >
            {issue.status === "RESOLVED"
              ? "Resolved"
              : "Open"}
          </StatusBadge>
          <StatusBadge tone="neutral">
            {issue.errorClass}
          </StatusBadge>
        </div>
        <span>{issueWhen(issue)}</span>
      </div>

      <div className="rc-system-issue__body">
        <div>
          <div className="rc-eyebrow">
            {issue.source} · {issue.operation}
          </div>
          <h3>
            {issue.release?.title ||
              "ReleaseCore system"}
          </h3>
          <p>{issue.safeMessage}</p>
        </div>

        <dl className="rc-system-issue__facts">
          <div>
            <dt>Retryable</dt>
            <dd>
              {issue.retryable ? "Yes" : "No"}
            </dd>
          </div>
          <div>
            <dt>Occurrences</dt>
            <dd>{issue.occurrenceCount}</dd>
          </div>
          <div>
            <dt>Error code</dt>
            <dd>
              {issue.errorCode || "—"}
            </dd>
          </div>
          <div>
            <dt>Request reference</dt>
            <dd>
              {issue.requestId || "—"}
            </dd>
          </div>
        </dl>

        {issue.shopifyUserErrors?.length ? (
          <div className="rc-system-issue__shopify">
            <strong>Shopify reported</strong>
            <ul>
              {issue.shopifyUserErrors.map(
                (item, index) => (
                  <li
                    key={`${item.code || "shopify"}:${item.field || ""}:${index}`}
                  >
                    {item.field
                      ? `${item.field}: `
                      : ""}
                    {item.message}
                    {item.code
                      ? ` (${item.code})`
                      : ""}
                  </li>
                ),
              )}
            </ul>
          </div>
        ) : null}

        {issue.resolution ? (
          <div className="rc-system-issue__resolution">
            <strong>
              Recommended resolution
            </strong>
            <span>{issue.resolution}</span>
          </div>
        ) : null}
      </div>

      <div className="rc-system-issue__actions">
        {issue.releaseId ? (
          <Link
            to={`/app/release/${issue.releaseId}`}
            className="rc-button rc-button--compact"
          >
            Open release
          </Link>
        ) : null}
        {issue.releaseId &&
        issue.source === "BACKGROUND_JOB" ? (
          <Link
            to={`/app/distribution/${issue.releaseId}`}
            className="rc-button rc-button--tertiary rc-button--compact"
          >
            Open distribution
          </Link>
        ) : null}
        <Link
          to={`/app/feedback?from=%2Fapp%2Fsystem-issues&systemIssue=${issue.id}`}
          className="rc-button rc-button--tertiary rc-button--compact"
        >
          Report this issue
        </Link>
        {issue.status === "OPEN" ? (
          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value="resolve"
            />
            <input
              type="hidden"
              name="issueId"
              value={issue.id}
            />
            <button
              type="submit"
              className="rc-button rc-button--tertiary rc-button--compact"
            >
              Mark resolved
            </button>
          </Form>
        ) : null}
      </div>
    </article>
  );
}

export default function SystemIssues() {
  const data = useLoaderData();

  return (
    <s-page heading="System Issues">
      <s-section>
        <PageIntro
          eyebrow="Production diagnostics"
          title="Recent System Issues"
          actions={
            <Link
              to="/app/operations"
              className="rc-button"
            >
              Back to Operations
            </Link>
          }
        >
          ReleaseCore records safe operational
          diagnostics for unexpected API failures,
          terminal background-job failures, Shopify
          errors, connectivity problems, and other
          production issues. Secrets and signed URL
          query strings are redacted before storage.
        </PageIntro>
      </s-section>

      <s-section heading="Current status">
        <MetricGrid>
          <MetricCard
            label="Open issues"
            value={data.openCount}
            detail="Recent issues not marked resolved"
          />
          <MetricCard
            label="Critical"
            value={data.criticalCount}
            detail="Authorization, database, or internal failures"
          />
          <MetricCard
            label="Retryable"
            value={data.retryableCount}
            detail="Open issues safe to retry"
          />
          <MetricCard
            label="Recent history"
            value={data.issues.length}
            detail="Up to 100 latest issue fingerprints"
          />
        </MetricGrid>
      </s-section>

      <s-section heading="Issue history">
        {data.issues.length ? (
          <div className="rc-system-issue-list">
            {data.issues.map((issue) => (
              <SystemIssueCard
                key={issue.id}
                issue={issue}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No system issues recorded">
            ReleaseCore has not recorded a recent
            production error for this store.
          </EmptyState>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);
