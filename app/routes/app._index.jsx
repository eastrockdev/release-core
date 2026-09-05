import { Link, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { typeLabel, formatDate } from "../lib/releasecore";
import { statusLabel, statusTone } from "../lib/workflow";
import { loadOperationsCenter } from "../lib/operations-center.server";
import { EmptyState, MetricCard, MetricGrid, PageIntro, ReleaseListItem } from "../components/releasecore-ui";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const releases = await db.release.findMany({
    where: { shop: session.shop },
    orderBy: { updatedAt: "desc" },
    take: 6,
    include: {
      _count: { select: { tracks: true } },
      files: {
        where: { kind: "COVER_ART", trackId: null },
        select: { kind: true, url: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const operations = await loadOperationsCenter({
    shop: session.shop,
    releaseLimit: 80,
    issueLimit: 4,
  });

  return { releases, operations };
};

export default function Index() {
  const { releases, operations } = useLoaderData();
  const navigate = useNavigate();

  return (
    <s-page heading="ReleaseCore">
      <s-button slot="primary-action" variant="primary" onClick={() => navigate("/app/release/new")}>Create release</s-button>

      <s-section>
        <PageIntro
          title="Manage your catalog, artists, and distribution."
          actions={
            <>
              <s-button variant="primary" onClick={() => navigate("/app/release/new")}>Create release</s-button>
              <s-button onClick={() => navigate("/app/releases")}>View releases</s-button>
            </>
          }
        >
          Start new releases, see what needs attention, and continue the work already in progress.
        </PageIntro>
      </s-section>

      <s-section heading="Needs your attention">
        <MetricGrid>
          <MetricCard label="Needs attention" value={operations.stats.needsAttention} detail="Releases with something to resolve" href="/app/operations" />
          <MetricCard label="Waiting for review" value={operations.stats.waitingReview} detail="Submitted releases awaiting a decision" href="/app/submissions" />
          <MetricCard label="Ready to distribute" value={operations.stats.readyToDistribute} detail="Approved releases ready for delivery" href="/app/distribution" />
          <MetricCard label="Next 7 days" value={operations.stats.scheduledNextSevenDays} detail="Upcoming releases not yet delivered" href="/app/operations" />
        </MetricGrid>

        {operations.issues.length ? (
          <div className="rc-operations-home-list">
            {operations.issues.map((issue) => (
              <Link key={issue.key} to={issue.href} className="rc-operations-home-row">
                <span>
                  <strong>{issue.release.title}</strong>
                  <span>{issue.title}</span>
                </span>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rc-operations-home-clear">Nothing needs attention right now.</div>
        )}

        <div className="rc-card__actions">
          <s-button onClick={() => navigate("/app/operations")}>Open operations</s-button>
        </div>
      </s-section>

      <s-section heading="Recent releases">
        {releases.length === 0 ? (
          <EmptyState
            title="No releases yet"
            action={<s-button variant="primary" onClick={() => navigate("/app/release/new")}>Create first release</s-button>}
          >
            Create a Single, EP, or Album to begin building your catalog.
          </EmptyState>
        ) : (
          <div className="rc-release-list">
            {releases.map((release) => (
              <ReleaseListItem
                key={release.id}
                release={release}
                href={`/app/release/${release.id}`}
                badges={[
                  { label: typeLabel(release.type), tone: "info" },
                  { label: statusLabel(release.status), tone: statusTone(release.status) },
                ]}
                meta={`${release.artistName || "Artist not set"} · ${release._count.tracks} ${release._count.tracks === 1 ? "track" : "tracks"}`}
                aside={`Release ${formatDate(release.releaseDate)}`}
              />
            ))}
            <div style={{ paddingTop: 4 }}><Link to="/app/releases">View all releases →</Link></div>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
