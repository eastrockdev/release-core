import { Link, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { typeLabel, formatDate } from "../lib/releasecore";
import { statusLabel } from "../lib/workflow";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const releases = await db.release.findMany({
    where: { shop: session.shop },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { tracks: true } } },
  });

  return { releases };
};

export default function ReleasesIndex() {
  const { releases } = useLoaderData();
  const navigate = useNavigate();

  return (
    <s-page heading="Releases">
      <s-button slot="primary-action" variant="primary" onClick={() => navigate("/app/release/new")}>Create release</s-button>

      <s-section>
        <div style={{ color: "#6d7175", maxWidth: 760 }}>
          Every distribution project lives here, regardless of whether it is a single, EP or album.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <s-button onClick={() => navigate("/app/import")}>Import Shopify product</s-button>
        </div>
      </s-section>

      <s-section heading={`All releases (${releases.length})`}>
        {releases.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyTitle}>Nothing in the catalog workspace yet</div>
            <div style={{ marginBottom: 14 }}>Start one release and choose its format on the next screen.</div>
            <s-button variant="primary" onClick={() => navigate("/app/release/new")}>Create release</s-button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {releases.map((release) => (
              <Link key={release.id} to={`/app/release/${release.id}`} style={styles.link}>
                <div style={styles.row}>
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.titleLine}>
                      <strong style={styles.title}>{release.title}</strong>
                      <span style={styles.typeBadge}>{typeLabel(release.type)}</span>
                      <span style={styles.statusBadge}>{statusLabel(release.status)}</span>
                    </div>
                    <div style={styles.muted}>
                      {release.artistName || "Artist not set"} · {release._count.tracks} {release._count.tracks === 1 ? "track" : "tracks"}
                    </div>
                  </div>
                  <div style={styles.right}>
                    <div>{formatDate(release.releaseDate)}</div>
                    <div>Updated {new Date(release.updatedAt).toLocaleDateString()}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

const styles = {
  link: { color: "inherit", textDecoration: "none" },
  row: { border: "1px solid #e3e3e3", borderRadius: 12, padding: 16, background: "#fff", display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 18, alignItems: "center" },
  titleLine: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 },
  title: { fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  typeBadge: { fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 8px", background: "#eef4ff", color: "#214c8f" },
  statusBadge: { fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 8px", background: "#f1f1f1", color: "#4a4a4a" },
  muted: { color: "#6d7175", fontSize: 13 },
  right: { color: "#8c9196", fontSize: 12, textAlign: "right", display: "grid", gap: 4 },
  empty: { border: "1px dashed #c9cccf", borderRadius: 12, padding: "30px 20px", textAlign: "center", color: "#6d7175" },
  emptyTitle: { fontWeight: 700, color: "#303030", marginBottom: 6, fontSize: 15 },
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
