import { Link, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  EmptyState,
  MetricCard,
  MetricGrid,
  PageIntro,
  ReleaseListItem,
  StatusBadge,
} from "../components/releasecore-ui";
import { formatDate, typeLabel } from "../lib/releasecore";
import { distributionStatusLabel, statusLabel } from "../lib/workflow";
import { loadOperationsCenter } from "../lib/operations-center.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return loadOperationsCenter({ shop: session.shop, releaseLimit: 250, issueLimit: 60 });
};

function issueTone(severity) {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "warning";
  return "info";
}

function SystemIssueSummary({ issue }) {
  return (
    <article className="rc-system-issue rc-system-issue--summary">
      <div className="rc-system-issue__body">
        <div className="rc-system-issue__badges">
          <StatusBadge
            tone={issue.severity === "CRITICAL" ? "critical" : issue.severity === "ERROR" ? "warning" : "info"}
          >
            {issue.errorClass}
          </StatusBadge>
        </div>
        <strong>{issue.release?.title || "ReleaseCore"}</strong>
        <div className="rc-operations-issue__copy">{issue.safeMessage}</div>
        {issue.resolution ? (
          <div className="rc-system-issue__resolution">
            <strong>What to do next</strong>
            <span>{issue.resolution}</span>
          </div>
        ) : null}
        <div className="rc-system-issue__reference">
          {issue.requestId ? `Reference: ${issue.requestId}` : "No request reference"} · {new Date(issue.lastSeenAt).toLocaleString()}
        </div>
      </div>
      <Link to="/app/system-issues" className="rc-button rc-button--compact">View details</Link>
    </article>
  );
}

function OperationsIssue({ issue }) {
  return (
    <article className="rc-operations-issue">
      <div className="rc-operations-issue__main">
        <div className="rc-operations-issue__meta">
          <StatusBadge tone={issueTone(issue.severity)}>{issue.category}</StatusBadge>
          <span>{issue.release.title}</span>
          <span>·</span>
          <span>{statusLabel(issue.release.status)}</span>
        </div>
        <strong className="rc-operations-issue__title">{issue.title}</strong>
        <div className="rc-operations-issue__copy">{issue.message}</div>
      </div>
      <Link to={issue.href} className="rc-button rc-button--compact">{issue.actionLabel}</Link>
    </article>
  );
}

export default function Operations() {
  const data = useLoaderData();
  const navigate = useNavigate();

  return (
    <s-page heading="Operations">
      <s-section>
        <PageIntro
          title="Resolve work that needs intervention."
          actions={
            <>
              <s-button variant="primary" onClick={() => navigate("/app/submissions")}>Review submissions</s-button>
              <s-button onClick={() => navigate("/app/distribution")}>Distribution</s-button>
            </>
          }
        >
          Review release blockers, pending review work, distribution readiness, and system problems from one place.
        </PageIntro>
      </s-section>

      <s-section heading="At a glance">
        <MetricGrid>
          <MetricCard label="Needs attention" value={data.stats.needsAttention} detail="Releases with something to resolve" />
          <MetricCard label="Waiting for review" value={data.stats.waitingReview} detail="Submitted or currently in review" href="/app/submissions" />
          <MetricCard label="Ready to distribute" value={data.stats.readyToDistribute} detail="Approved and ready for delivery" href="/app/distribution" />
          <MetricCard label="System issues" value={data.stats.openSystemIssues} detail="Open problems recorded by ReleaseCore" href="/app/system-issues" />
        </MetricGrid>
      </s-section>

      <s-section heading="Needs attention">
        {data.issues.length ? (
          <div className="rc-operations-list">
            {data.issues.map((issue) => <OperationsIssue key={issue.key} issue={issue} />)}
          </div>
        ) : (
          <EmptyState title="Nothing needs attention">
            There are no active release problems that require action right now.
          </EmptyState>
        )}
      </s-section>

      <s-section heading="Ready to distribute">
        {data.readyToDistribute.length ? (
          <div className="rc-release-list">
            {data.readyToDistribute.map((release) => (
              <ReleaseListItem
                key={release.id}
                release={release}
                href={`/app/distribution/${release.id}`}
                actionLabel="Open distribution"
                badges={[
                  { label: typeLabel(release.type), tone: "info" },
                  { label: "Ready", tone: "good" },
                ]}
                meta={`${release.artistName || "Artist not set"} · ${release.trackCount} ${release.trackCount === 1 ? "track" : "tracks"}`}
                aside={release.releaseDate ? `Release ${formatDate(release.releaseDate)}` : "No release date"}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="Nothing is waiting for distribution">
            Approved releases will appear here when they are ready to deliver.
          </EmptyState>
        )}
      </s-section>

      {data.scheduled.length ? (
        <s-section heading="Upcoming releases">
          <div className="rc-release-list">
            {data.scheduled.map((release) => (
              <ReleaseListItem
                key={release.id}
                release={release}
                href={`/app/release/${release.id}`}
                badges={[
                  { label: typeLabel(release.type), tone: "info" },
                  {
                    label: release.ready ? "Ready" : `${release.blockerCount} issue${release.blockerCount === 1 ? "" : "s"}`,
                    tone: release.ready ? "good" : "warn",
                  },
                ]}
                meta={`${statusLabel(release.status)} · ${distributionStatusLabel(release.distributionStatus)}`}
                aside={release.daysUntilRelease === 0 ? "Today" : `${release.daysUntilRelease} day${release.daysUntilRelease === 1 ? "" : "s"} · ${formatDate(release.releaseDate)}`}
              />
            ))}
          </div>
        </s-section>
      ) : null}

      {data.recentSystemIssues.length ? (
        <s-section heading="System issues">
          <div className="rc-system-issue-list">
            {data.recentSystemIssues.map((issue) => <SystemIssueSummary key={issue.id} issue={issue} />)}
          </div>
          <div className="rc-operations-footer">
            <Link to="/app/system-issues">View all system issues →</Link>
          </div>
        </s-section>
      ) : null}

      {data.advisories.length ? (
        <s-section heading="Advisories">
          <div className="rc-operations-list">
            {data.advisories.map((issue) => <OperationsIssue key={issue.key} issue={issue} />)}
          </div>
        </s-section>
      ) : null}

      <s-section>
        <div className="rc-operations-footer">
          <Link to="/app/releases">View all releases →</Link>
          <Link to="/app/operations/metrics">Advanced metrics</Link>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
