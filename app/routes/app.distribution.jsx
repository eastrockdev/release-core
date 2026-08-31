import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { formatDate, typeLabel } from "../lib/releasecore";
import { distributionStatusLabel, distributionStatusTone } from "../lib/workflow";

const FILTERS = ["ACTIVE", "QUEUED", "PROCESSING", "SUBMITTED_TO_STORES", "RETURNED_FOR_CORRECTIONS", "DELIVERED", "ALL"];

function pill(status) {
  const tone = distributionStatusTone(status);
  const palette = tone === "good" ? { background: "#eaf7ee", color: "#176c37" }
    : tone === "warn" ? { background: "#fff4df", color: "#8a5700" }
    : tone === "info" ? { background: "#eaf2ff", color: "#174ea6" }
    : { background: "#f1f1f1", color: "#4a4a4a" };
  return { ...styles.pill, ...palette };
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const filter = FILTERS.includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "ACTIVE";
  const baseQueued = { shop: session.shop, OR: [{ distributionStatus: { not: "NOT_QUEUED" } }, { status: "APPROVED" }] };
  const where = { ...baseQueued };
  if (filter === "ACTIVE") where.OR = [
    { distributionStatus: { in: ["QUEUED", "PROCESSING", "SUBMITTED_TO_STORES", "RETURNED_FOR_CORRECTIONS"] } },
    { status: "APPROVED", distributionStatus: "NOT_QUEUED" },
  ];
  else if (filter === "QUEUED") where.OR = [
    { distributionStatus: "QUEUED" },
    { status: "APPROVED", distributionStatus: "NOT_QUEUED" },
  ];
  else if (filter !== "ALL") { delete where.OR; where.distributionStatus = filter; }
  const [releases, countRows] = await Promise.all([
    db.release.findMany({
      where,
      orderBy: [{ distributionUpdatedAt: "desc" }, { decisionAt: "desc" }, { updatedAt: "desc" }],
      include: {
        _count: { select: { tracks: true } },
        tracks: { select: { id: true, shopifyProductId: true } },
      },
    }),
    Promise.all([
      db.release.count({ where: { shop: session.shop, OR: [{ distributionStatus: { in: ["QUEUED", "PROCESSING", "SUBMITTED_TO_STORES", "RETURNED_FOR_CORRECTIONS"] } }, { status: "APPROVED", distributionStatus: "NOT_QUEUED" }] } }),
      db.release.count({ where: { shop: session.shop, OR: [{ distributionStatus: "QUEUED" }, { status: "APPROVED", distributionStatus: "NOT_QUEUED" }] } }),
      db.release.count({ where: { shop: session.shop, distributionStatus: "PROCESSING" } }),
      db.release.count({ where: { shop: session.shop, distributionStatus: "SUBMITTED_TO_STORES" } }),
      db.release.count({ where: { shop: session.shop, distributionStatus: "RETURNED_FOR_CORRECTIONS" } }),
      db.release.count({ where: { shop: session.shop, distributionStatus: "DELIVERED" } }),
    ]),
  ]);
  return { releases, filter, counts: { ACTIVE: countRows[0], QUEUED: countRows[1], PROCESSING: countRows[2], SUBMITTED_TO_STORES: countRows[3], RETURNED_FOR_CORRECTIONS: countRows[4], DELIVERED: countRows[5] } };
};

export default function DistributionQueue() {
  const { releases, filter, counts } = useLoaderData();
  return <s-page heading="Distribution">
    <s-section>
      <div style={styles.heroTitle}>Distribution queue</div>
      <div style={styles.heroCopy}>Approved releases move here for downstream delivery. Use this queue to copy metadata into your aggregator, assign or enter UPCs, create Shopify digital music products, and track delivery status.</div>
      <div style={styles.filters}>{FILTERS.map((item) => <Link key={item} to={`/app/distribution?status=${item}`} style={{ ...styles.filter, ...(filter === item ? styles.filterActive : {}) }}>{item === "ACTIVE" ? "Active" : item === "ALL" ? "All" : distributionStatusLabel(item)}{counts[item] !== undefined ? ` (${counts[item]})` : ""}</Link>)}</div>
    </s-section>
    <s-section heading={`${filter === "ACTIVE" ? "Active distribution" : filter === "ALL" ? "Distribution history" : distributionStatusLabel(filter)} (${releases.length})`}>
      {releases.length ? <div style={styles.list}>{releases.map((release) => {
        const productCount = release.tracks.filter((track) => track.shopifyProductId).length;
        const displayStatus = release.distributionStatus === "NOT_QUEUED" && release.status === "APPROVED" ? "QUEUED" : release.distributionStatus;
        return <div key={release.id} style={styles.row}>
          <div style={{ minWidth: 0 }}><div style={styles.titleLine}><strong style={styles.title}>{release.title}</strong><span style={styles.typePill}>{typeLabel(release.type)}</span><span style={pill(displayStatus)}>{distributionStatusLabel(displayStatus)}</span></div><div style={styles.muted}>{release.artistName || "Artist not set"} · {release._count.tracks} {release._count.tracks === 1 ? "track" : "tracks"} · UPC {release.upc || "pending"} · Shopify {productCount}/{release._count.tracks}</div></div>
          <div style={styles.right}><div>Release {formatDate(release.releaseDate)}</div><Link to={`/app/distribution/${release.id}`} style={styles.openButton}>Open workspace</Link></div>
        </div>;
      })}</div> : <div style={styles.empty}>No releases match this distribution queue.</div>}
    </s-section>
  </s-page>;
}

const styles={heroTitle:{fontSize:22,fontWeight:750,color:"#202223",marginBottom:7},heroCopy:{maxWidth:820,color:"#6d7175",fontSize:13,lineHeight:1.5},filters:{display:"flex",flexWrap:"wrap",gap:8,marginTop:18},filter:{textDecoration:"none",color:"#303030",border:"1px solid #d7d9db",borderRadius:999,padding:"7px 11px",fontSize:12,background:"#fff"},filterActive:{background:"#303030",color:"#fff",borderColor:"#303030"},list:{display:"grid",gap:10},row:{border:"1px solid #e3e3e3",borderRadius:12,padding:16,background:"#fff",display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:16,alignItems:"center"},titleLine:{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap",marginBottom:6},title:{fontSize:15},typePill:{display:"inline-flex",borderRadius:999,padding:"4px 8px",fontSize:11,fontWeight:700,background:"#f1f1f1",color:"#4a4a4a"},pill:{display:"inline-flex",borderRadius:999,padding:"4px 8px",fontSize:11,fontWeight:700},muted:{color:"#6d7175",fontSize:12},right:{textAlign:"right",color:"#8c9196",fontSize:12,display:"grid",gap:6,justifyItems:"end"},openButton:{display:"inline-flex",alignItems:"center",justifyContent:"center",minHeight:32,padding:"0 12px",borderRadius:8,background:"#fff",border:"1px solid #8c9196",color:"#303030",fontSize:12,fontWeight:650,textDecoration:"none",whiteSpace:"nowrap"},empty:{border:"1px dashed #c9cccf",borderRadius:12,padding:28,textAlign:"center",color:"#6d7175"}};
export const headers=(headersArgs)=>boundary.headers(headersArgs);
