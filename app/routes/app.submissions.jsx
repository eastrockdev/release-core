import { Link, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { typeLabel, formatDate } from "../lib/releasecore";
import { statusLabel, statusTone } from "../lib/workflow";

const FILTERS = ["ACTIVE", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "REJECTED", "ALL"];

function pill(status) {
  const tone = statusTone(status);
  const palette = tone === "good" ? { background: "#eaf7ee", color: "#176c37" }
    : tone === "bad" ? { background: "#fff1f0", color: "#8e1f0b" }
    : tone === "warn" ? { background: "#fff4df", color: "#8a5700" }
    : tone === "info" ? { background: "#eaf2ff", color: "#174ea6" }
    : { background: "#f1f1f1", color: "#4a4a4a" };
  return { ...styles.pill, ...palette };
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const filter = FILTERS.includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "ACTIVE";
  const where = { shop: session.shop };
  if (filter === "ACTIVE") where.status = { in: ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"] };
  else if (filter !== "ALL") where.status = filter;
  else where.status = { not: "DRAFT" };

  const [releases, counts] = await Promise.all([
    db.release.findMany({
      where,
      orderBy: [{ lastSubmittedAt: "desc" }, { updatedAt: "desc" }],
      include: {
        _count: { select: { tracks: true } },
        reviewItems: { where: { status: "OPEN" }, select: { id: true } },
      },
    }),
    Promise.all([
      db.release.count({ where: { shop: session.shop, status: { in: ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"] } } }),
      db.release.count({ where: { shop: session.shop, status: "SUBMITTED" } }),
      db.release.count({ where: { shop: session.shop, status: "IN_REVIEW" } }),
      db.release.count({ where: { shop: session.shop, status: "CHANGES_REQUESTED" } }),
      db.release.count({ where: { shop: session.shop, status: "APPROVED" } }),
      db.release.count({ where: { shop: session.shop, status: "REJECTED" } }),
    ]),
  ]);

  return { releases, filter, counts: { ACTIVE: counts[0], SUBMITTED: counts[1], IN_REVIEW: counts[2], CHANGES_REQUESTED: counts[3], APPROVED: counts[4], REJECTED: counts[5] } };
};

export default function Submissions() {
  const { releases, filter, counts } = useLoaderData();
  const navigate = useNavigate();
  return <s-page heading="Submissions">
    <s-button slot="primary-action" onClick={() => navigate("/app/releases")}>All releases</s-button>
    <s-section>
      <div style={styles.heroTitle}>Review queue</div>
      <div style={styles.heroCopy}>Submitted releases move through review, requested changes, approval or rejection here. Drafts remain in Releases until they are submitted.</div>
      <div style={styles.filters}>
        {FILTERS.map((item) => <Link key={item} to={`/app/submissions?status=${item}`} style={{ ...styles.filter, ...(filter === item ? styles.filterActive : {}) }}>
          {item === "ACTIVE" ? "Active" : item === "ALL" ? "All submissions" : statusLabel(item)}{counts[item] !== undefined ? ` (${counts[item]})` : ""}
        </Link>)}
      </div>
    </s-section>

    <s-section heading={`${filter === "ACTIVE" ? "Active queue" : filter === "ALL" ? "Submission history" : statusLabel(filter)} (${releases.length})`}>
      {releases.length ? <div style={styles.list}>{releases.map((release) => <Link key={release.id} to={`/app/release/${release.id}`} style={styles.link}>
        <div style={styles.row}>
          <div style={{ minWidth: 0 }}>
            <div style={styles.titleLine}><strong style={styles.title}>{release.title}</strong><span style={styles.typePill}>{typeLabel(release.type)}</span><span style={pill(release.status)}>{statusLabel(release.status)}</span></div>
            <div style={styles.muted}>{release.artistName || "Artist not set"} · {release._count.tracks} {release._count.tracks === 1 ? "track" : "tracks"}{release.reviewItems.length ? ` · ${release.reviewItems.length} open change request${release.reviewItems.length === 1 ? "" : "s"}` : ""}</div>
          </div>
          <div style={styles.right}><div>{release.lastSubmittedAt ? `Submitted ${new Date(release.lastSubmittedAt).toLocaleDateString()}` : `Release ${formatDate(release.releaseDate)}`}</div><div>Open →</div></div>
        </div>
      </Link>)}</div> : <div style={styles.empty}>No releases match this queue.</div>}
    </s-section>
  </s-page>;
}

const styles = {
  heroTitle: { fontSize: 21, fontWeight: 750, color: "#202223", marginBottom: 7 },
  heroCopy: { maxWidth: 780, color: "#6d7175", fontSize: 13, lineHeight: 1.5 },
  filters: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 },
  filter: { textDecoration: "none", color: "#303030", border: "1px solid #d7d9db", borderRadius: 999, padding: "7px 11px", fontSize: 12, background: "#fff" },
  filterActive: { background: "#303030", color: "#fff", borderColor: "#303030" },
  list: { display: "grid", gap: 10 }, link: { color: "inherit", textDecoration: "none" },
  row: { border: "1px solid #e3e3e3", borderRadius: 12, padding: 16, background: "#fff", display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 16, alignItems: "center" },
  titleLine: { display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }, title: { fontSize: 15 },
  typePill: { display: "inline-flex", borderRadius: 999, padding: "4px 8px", fontSize: 11, fontWeight: 700, background: "#f1f1f1", color: "#4a4a4a" },
  pill: { display: "inline-flex", borderRadius: 999, padding: "4px 8px", fontSize: 11, fontWeight: 700 },
  muted: { color: "#6d7175", fontSize: 12 }, right: { textAlign: "right", color: "#8c9196", fontSize: 12, display: "grid", gap: 6 },
  empty: { border: "1px dashed #c9cccf", borderRadius: 12, padding: 28, textAlign: "center", color: "#6d7175" },
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
