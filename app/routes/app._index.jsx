import { Link, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { typeLabel, formatDate } from "../lib/releasecore";
import { statusLabel, statusTone } from "../lib/workflow";
import { EmptyState, MetricCard, MetricGrid, PageIntro, ReleaseListItem } from "../components/releasecore-ui";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const [releases, total, drafts, activeSubmissions, approved, distributionQueue, artists, contributors] = await Promise.all([
    db.release.findMany({
      where: { shop: session.shop },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: {
        _count: { select: { tracks: true } },
        files: { where: { kind: "COVER_ART", trackId: null }, select: { kind: true, url: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    db.release.count({ where: { shop: session.shop } }),
    db.release.count({ where: { shop: session.shop, status: "DRAFT" } }),
    db.release.count({ where: { shop: session.shop, status: { in: ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"] } } }),
    db.release.count({ where: { shop: session.shop, status: "APPROVED" } }),
    db.release.count({
      where: {
        shop: session.shop,
        OR: [
          { distributionStatus: { not: "NOT_QUEUED" } },
          { status: "APPROVED", distributionStatus: "NOT_QUEUED" },
        ],
      },
    }),
    db.artist.count({ where: { shop: session.shop } }),
    db.contributor.count({ where: { shop: session.shop } }),
  ]);

  return { releases, stats: { total, drafts, activeSubmissions, approved, distributionQueue, artists, contributors } };
};

export default function Index() {
  const { releases, stats } = useLoaderData();
  const navigate = useNavigate();

  return (
    <s-page heading="ReleaseCore">
      <s-button slot="primary-action" variant="primary" onClick={() => navigate("/app/release/new")}>Create release</s-button>

      <s-section>
        <PageIntro
          eyebrow="Music distribution operations"
          title="Your catalog, review queue, and delivery work in one place."
          actions={
            <>
            <s-button variant="primary" onClick={() => navigate("/app/release/new")}>Create release</s-button>
            <s-button onClick={() => navigate("/app/submissions")}>Open submissions</s-button>
            <s-button onClick={() => navigate("/app/distribution")}>Distribution queue</s-button>
            </>
          }
        >
          Track every release from draft through approval and delivery without losing the artists, credits, files, or identifiers attached to it.
        </PageIntro>
      </s-section>

      <s-section heading="Getting started">
        <div className="rc-card-grid rc-card-grid--3">
          <article className="rc-card"><div className="rc-card__body">
            <div className="rc-eyebrow">Step 1</div>
            <h3 className="rc-card__title">Configure operations</h3>
            <p className="rc-card__copy">Set your identifier modes, catalog behavior, preview settings, and Shopify publishing configuration.</p>
            <div className="rc-card__actions"><s-button onClick={() => navigate("/app/settings")}>Open settings</s-button></div>
          </div></article>
          <article className="rc-card"><div className="rc-card__body">
            <div className="rc-eyebrow">Step 2</div>
            <h3 className="rc-card__title">Connect artist access</h3>
            <p className="rc-card__copy">Link Shopify customer accounts to the artists who should use ReleaseCore on the storefront.</p>
            <div className="rc-card__actions"><s-button onClick={() => navigate("/app/portal-access")}>Portal access</s-button></div>
          </div></article>
          <article className="rc-card"><div className="rc-card__body">
            <div className="rc-eyebrow">Step 3</div>
            <h3 className="rc-card__title">Add storefront blocks</h3>
            <p className="rc-card__copy">Use ReleaseCore&apos;s Theme Editor deep links and test the Artist Portal while signed in as a linked customer.</p>
            <div className="rc-card__actions"><s-button onClick={() => navigate("/app/storefront-setup")}>Storefront setup</s-button></div>
          </div></article>
        </div>
      </s-section>

      <s-section heading="Overview">
        <MetricGrid>
          <MetricCard label="All releases" value={stats.total} detail="Complete catalog" href="/app/releases" />
          <MetricCard label="Drafts" value={stats.drafts} detail="Still being prepared" href="/app/releases" />
          <MetricCard label="Active submissions" value={stats.activeSubmissions} detail="Waiting on review or changes" href="/app/submissions" />
          <MetricCard label="Approved" value={stats.approved} detail="Ready for delivery" href="/app/submissions?status=APPROVED" />
          <MetricCard label="Distribution" value={stats.distributionQueue} detail="In the delivery workflow" href="/app/distribution" />
          <MetricCard label="Artists" value={stats.artists} detail="Saved identities" href="/app/artists" />
          <MetricCard label="Contributors" value={stats.contributors} detail="Saved credit profiles" href="/app/contributors" />
        </MetricGrid>
      </s-section>

      <s-section heading="Recent releases">
        {releases.length === 0 ? (
          <EmptyState title="No releases yet" action={<s-button variant="primary" onClick={() => navigate("/app/release/new")}>Create first release</s-button>}>
            Create a single, EP, or album and start building its tracklist.
          </EmptyState>
        ) : (
          <div className="rc-release-list">
            {releases.map((release) => <ReleaseListItem
              key={release.id}
              release={release}
              href={`/app/release/${release.id}`}
              badges={[{ label: typeLabel(release.type), tone: "info" }, { label: statusLabel(release.status), tone: statusTone(release.status) }]}
              meta={`${release.artistName || "Artist not set"} · ${release._count.tracks} ${release._count.tracks === 1 ? "track" : "tracks"}`}
              aside={`Release ${formatDate(release.releaseDate)}`}
            />)}
            <div style={{ paddingTop: 4 }}><Link to="/app/releases">View all releases →</Link></div>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
