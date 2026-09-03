import {
  Link,
  useLoaderData,
  useNavigate,
} from "react-router";
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
import {
  formatDate,
  typeLabel,
} from "../lib/releasecore";
import {
  distributionStatusLabel,
  statusLabel,
} from "../lib/workflow";
import { loadOperationsCenter } from "../lib/operations-center.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return loadOperationsCenter({
    shop: session.shop,
    releaseLimit: 250,
    issueLimit: 60,
  });
};

function issueTone(severity) {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "warning";
  return "info";
}

function OperationsIssue({ issue }) {
  return (
    <article className="rc-operations-issue">
      <div className="rc-operations-issue__main">
        <div className="rc-operations-issue__meta">
          <StatusBadge tone={issueTone(issue.severity)}>
            {issue.category}
          </StatusBadge>
          <span>{issue.release.title}</span>
          <span>·</span>
          <span>{statusLabel(issue.release.status)}</span>
        </div>
        <strong className="rc-operations-issue__title">
          {issue.title}
        </strong>
        <div className="rc-operations-issue__copy">
          {issue.message}
        </div>
      </div>
      <Link
        to={issue.href}
        className="rc-button rc-button--compact"
      >
        {issue.actionLabel}
      </Link>
    </article>
  );
}

export default function Operations() {
  const data = useLoaderData();
  const navigate = useNavigate();

  return (
    <s-page heading="Operations">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/release/new")}
      >
        Create release
      </s-button>

      <s-section>
        <PageIntro
          eyebrow="Production workflow"
          title="See what needs attention before the next release goes out."
          actions={
            <>
              <s-button
                variant="primary"
                onClick={() =>
                  navigate("/app/submissions")
                }
              >
                Review submissions
              </s-button>
              <s-button
                onClick={() =>
                  navigate("/app/distribution")
                }
              >
                Distribution queue
              </s-button>
            </>
          }
        >
          ReleaseCore evaluates active releases from local catalog
          data, review state, delivery state, recent Shopify sync
          outcomes, and notification failures. Nothing on this page
          performs an external Shopify write.
        </PageIntro>
      </s-section>

      <s-section heading="Current queue">
        <MetricGrid>
          <MetricCard
            label="Needs attention"
            value={data.stats.needsAttention}
            detail="Active releases with an actionable issue"
          />
          <MetricCard
            label="Waiting for review"
            value={data.stats.waitingReview}
            detail="Submitted or currently in review"
            href="/app/submissions"
          />
          <MetricCard
            label="Ready to distribute"
            value={data.stats.readyToDistribute}
            detail="Approved and locally preflight-complete"
            href="/app/distribution"
          />
          <MetricCard
            label="Next 7 days"
            value={data.stats.scheduledNextSevenDays}
            detail="Upcoming undelivered releases"
          />
        </MetricGrid>
        {data.capped ? (
          <div className="rc-operations-note">
            The active-release scan reached its 250-release safety
            cap. Counts based on exact database totals remain
            complete; readiness issue lists cover the first 250
            active releases.
          </div>
        ) : null}
      </s-section>

      <s-section heading="Needs attention">
        {data.issues.length ? (
          <div className="rc-operations-list">
            {data.issues.map((issue) => (
              <OperationsIssue
                key={issue.key}
                issue={issue}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No active release issues">
            ReleaseCore did not find an actionable problem in the
            current production queue.
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
                  {
                    label: typeLabel(release.type),
                    tone: "info",
                  },
                  {
                    label: "Preflight ready",
                    tone: "good",
                  },
                ]}
                meta={`${release.artistName || "Artist not set"} · ${release.trackCount} ${release.trackCount === 1 ? "track" : "tracks"}`}
                aside={
                  release.releaseDate
                    ? `Release ${formatDate(release.releaseDate)}`
                    : "No release date"
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState title="Nothing is waiting for distribution">
            Approved releases will appear here once their local
            preflight is complete.
          </EmptyState>
        )}
      </s-section>

      <s-section heading="Scheduled next 7 days">
        {data.scheduled.length ? (
          <div className="rc-release-list">
            {data.scheduled.map((release) => (
              <ReleaseListItem
                key={release.id}
                release={release}
                href={`/app/release/${release.id}`}
                badges={[
                  {
                    label: typeLabel(release.type),
                    tone: "info",
                  },
                  {
                    label: release.ready
                      ? "Ready"
                      : `${release.blockerCount} issue${release.blockerCount === 1 ? "" : "s"}`,
                    tone: release.ready ? "good" : "warn",
                  },
                ]}
                meta={`${statusLabel(release.status)} · ${distributionStatusLabel(release.distributionStatus)}`}
                aside={
                  release.daysUntilRelease === 0
                    ? "Today"
                    : `${release.daysUntilRelease} day${release.daysUntilRelease === 1 ? "" : "s"} · ${formatDate(release.releaseDate)}`
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No releases in the next 7 days">
            Upcoming release dates will appear here
            automatically.
          </EmptyState>
        )}
      </s-section>

      {data.advisories.length ? (
        <s-section heading="Workflow advisories">
          <div className="rc-operations-list">
            {data.advisories.map((issue) => (
              <OperationsIssue
                key={issue.key}
                issue={issue}
              />
            ))}
          </div>
        </s-section>
      ) : null}

      <s-section>
        <div className="rc-operations-footer">
          <span>
            Last evaluated{" "}
            {new Date(data.checkedAt).toLocaleString()}.
          </span>
          <Link to="/app/releases">
            Browse complete catalog →
          </Link>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);
