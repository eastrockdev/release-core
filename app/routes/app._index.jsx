import { Link, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { typeLabel, formatDate } from "../lib/releasecore";
import { statusLabel } from "../lib/workflow";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const [releases, total, drafts, activeSubmissions, approved, distributionQueue, artists, contributors] = await Promise.all([
    db.release.findMany({
      where: { shop: session.shop },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: { _count: { select: { tracks: true } } },
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

function StatCard({ label, value, detail }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statDetail}>{detail}</div>
    </div>
  );
}

function ReleaseRow({ release }) {
  return (
    <Link to={`/app/release/${release.id}`} style={styles.releaseLink}>
      <div style={styles.releaseRow}>
        <div style={{ minWidth: 0 }}>
          <div style={styles.releaseTitleLine}>
            <strong style={styles.releaseTitle}>{release.title}</strong>
            <span style={styles.badge}>{statusLabel(release.status)}</span>
          </div>
          <div style={styles.muted}>
            {typeLabel(release.type)} · {release._count.tracks} {release._count.tracks === 1 ? "track" : "tracks"}
            {release.artistName ? ` · ${release.artistName}` : ""}
          </div>
        </div>
        <div style={styles.releaseRight}>
          <span>{formatDate(release.releaseDate)}</span>
          <span style={{ fontSize: 15 }}>→</span>
        </div>
      </div>
    </Link>
  );
}

export default function Index() {
  const { releases, stats } = useLoaderData();
  const navigate = useNavigate();

  return (
    <s-page heading="ReleaseCore">
      <s-button slot="primary-action" variant="primary" onClick={() => navigate("/app/release/new")}>Create release</s-button>

      <s-section>
        <div style={styles.hero}>
          <div style={styles.eyebrow}>Music distribution operations</div>
          <div style={styles.heroTitle}>One release workflow. Any format.</div>
          <div style={styles.heroCopy}>
            Build releases from persistent tracks, artist identities and reusable contributor credits. ReleaseCore now carries releases from draft through review, approval and downstream distribution processing.
          </div>
          <div style={styles.heroActions}>
            <s-button variant="primary" onClick={() => navigate("/app/release/new")}>Create release</s-button>
            <s-button onClick={() => navigate("/app/submissions")}>Open submissions</s-button>
            <s-button onClick={() => navigate("/app/distribution")}>Distribution queue</s-button>
            <s-button onClick={() => navigate("/app/artists")}>Manage artists</s-button>
          </div>
        </div>
      </s-section>

      <s-section heading="Overview">
        <div style={styles.statsGrid}>
          <StatCard label="All releases" value={stats.total} detail="Stored in ReleaseCore" />
          <StatCard label="Drafts" value={stats.drafts} detail="Still being prepared" />
          <StatCard label="Active submissions" value={stats.activeSubmissions} detail="Submitted, in review or changes requested" />
          <StatCard label="Approved" value={stats.approved} detail="Passed release review" />
          <StatCard label="Distribution queue" value={stats.distributionQueue} detail="Approved or in downstream processing" />
          <StatCard label="Artists" value={stats.artists} detail="Reusable artist identities" />
          <StatCard label="Contributors" value={stats.contributors} detail="Reusable credits directory" />
        </div>
      </s-section>

      <s-section heading="Recent releases">
        {releases.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyTitle}>No releases yet</div>
            <div style={{ marginBottom: 14 }}>Create a release, choose Single, EP or Album, and start building its tracklist.</div>
            <s-button variant="primary" onClick={() => navigate("/app/release/new")}>Create first release</s-button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {releases.map((release) => <ReleaseRow key={release.id} release={release} />)}
            <div style={{ paddingTop: 4 }}><Link to="/app/releases">View all releases →</Link></div>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

const styles = {
  hero: { padding: "4px 0 8px" },
  eyebrow: { fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#6d7175", marginBottom: 8 },
  heroTitle: { fontSize: 26, lineHeight: 1.15, fontWeight: 700, marginBottom: 8, color: "#202223" },
  heroCopy: { color: "#6d7175", maxWidth: 760, lineHeight: 1.5 },
  heroActions: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 },
  statCard: { border: "1px solid #e3e3e3", borderRadius: 12, padding: 18, background: "#fff", minHeight: 94 },
  statLabel: { fontSize: 12, color: "#6d7175", marginBottom: 8 },
  statValue: { fontSize: 28, fontWeight: 700, lineHeight: 1 },
  statDetail: { fontSize: 12, color: "#8c9196", marginTop: 8 },
  releaseLink: { color: "inherit", textDecoration: "none" },
  releaseRow: { border: "1px solid #e3e3e3", borderRadius: 12, padding: 16, background: "#fff", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 16, alignItems: "center" },
  releaseTitleLine: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 },
  releaseTitle: { fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  badge: { fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 8px", background: "#f1f1f1", color: "#4a4a4a" },
  muted: { color: "#6d7175", fontSize: 13 },
  releaseRight: { color: "#8c9196", fontSize: 12, display: "flex", alignItems: "center", gap: 14, textAlign: "right" },
  empty: { border: "1px dashed #c9cccf", borderRadius: 12, padding: "30px 20px", textAlign: "center", color: "#6d7175" },
  emptyTitle: { fontWeight: 700, color: "#303030", marginBottom: 6, fontSize: 15 },
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
