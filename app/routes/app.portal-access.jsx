import { useMemo, useState } from "react";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { authenticatedPost } from "../lib/authenticated-post";
import { customerNumericId } from "../lib/automations";

async function searchCustomers(admin, q) {
  if (!q) return [];
  const response = await admin.graphql(`#graphql query ReleaseCoreCustomerSearch($query:String!){customers(first:20,query:$query){nodes{id displayName email tags}}}`, { variables: { query: q } });
  const json = await response.json();
  return json?.data?.customers?.nodes || [];
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim();
  const [releases, customers, artists] = await Promise.all([
    db.release.findMany({ where: { shop: session.shop }, orderBy: { updatedAt: "desc" }, take: 100, include: { artists: { include: { artist: true }, orderBy: { position: "asc" } }, _count: { select: { tracks: true } } } }),
    searchCustomers(admin, q),
    db.artist.findMany({ where: { shop: session.shop }, orderBy: { name: "asc" }, take: 250 }),
  ]);
  const numericIds = customers.map((customer) => customerNumericId(customer.id)).filter(Boolean);
  const policies = numericIds.length ? await db.portalCustomerPolicy.findMany({ where: { shop: session.shop, customerId: { in: numericIds } }, include: { soloArtist: true } }) : [];
  return { releases, customers, artists, policies, q };
};

export default function PortalAccess() {
  const data = useLoaderData();
  const nav = useNavigate();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const [q, setQ] = useState(data.q || "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const policyMap = useMemo(() => new Map((data.policies || []).map((policy) => [policy.customerId, policy])), [data.policies]);

  const search = (event) => { event.preventDefault(); nav(`/app/portal-access${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`); };
  const post = async (form) => {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { const result = await authenticatedPost(shopify, "/api/portal-access", form); setNotice({ tone: "good", message: result.message }); shopify.toast.show(result.message || "Portal access updated"); await revalidator.revalidate(); }
    catch (error) { setNotice({ tone: "bad", message: error instanceof Error ? error.message : "Could not update portal access." }); }
    finally { setBusy(false); }
  };
  const assign = (releaseId, customerId) => { const form = new FormData(); form.set("intent", "assign-owner"); form.set("releaseId", releaseId); form.set("customerId", customerId); return post(form); };
  const savePolicy = (customerId, artistMode, soloArtistId) => { const form = new FormData(); form.set("intent", "save-customer-policy"); form.set("customerId", customerId); form.set("artistMode", artistMode); form.set("soloArtistId", soloArtistId || ""); return post(form); };

  return <s-page heading="Portal access">
    <s-section><div style={styles.hero}><div style={styles.eyebrow}>Customer ownership & artist permissions</div><div style={styles.title}>Control who can submit for whom</div><div style={styles.copy}>Assign existing releases to Shopify customers, then choose whether each customer is locked to one artist identity or can create releases for multiple artists.</div></div></s-section>
    {notice ? <s-section><div style={notice.tone === "bad" ? styles.noticeBad : styles.noticeGood}>{notice.message}</div></s-section> : null}
    <s-section heading="Find customer"><form onSubmit={search} style={styles.search}><input style={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by customer name or email"/><button style={styles.button}>Search</button></form>
      {data.customers.length ? <div style={styles.customerGrid}>{data.customers.map((customer) => {
        const numericId = customerNumericId(customer.id);
        const policy = policyMap.get(numericId);
        const mode = policy?.artistMode === "SOLO" ? "SOLO" : "MULTI";
        return <CustomerAccessCard key={customer.id} customer={customer} artists={data.artists} policy={policy} mode={mode} busy={busy} onSave={(nextMode, artistId) => savePolicy(customer.id, nextMode, artistId)} />;
      })}</div> : q ? <div style={styles.empty}>No matching customers.</div> : null}
    </s-section>
    <s-section heading="Releases"><div style={styles.list}>{data.releases.map((release) => <div key={release.id} style={styles.row}><div><strong>{release.title}</strong><div style={styles.meta}>{release.type} · {release._count.tracks} track{release._count.tracks === 1 ? "" : "s"} · {(release.artists || []).filter((item) => item.role === "PRIMARY").map((item) => item.artist?.name).filter(Boolean).join(", ") || "Artist not set"}</div><div style={styles.meta}>Portal owner: {release.ownerCustomerId || "Not assigned"}</div></div><div style={styles.assign}><select style={styles.input} defaultValue=""><option value="">Choose searched customer</option>{data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName || customer.email} — {customer.email || "no email"}</option>)}</select><button type="button" disabled={busy || !data.customers.length} style={styles.button} onClick={(event) => { const select = event.currentTarget.previousElementSibling; if (select?.value) assign(release.id, select.value); }}>Assign</button>{release.ownerCustomerId ? <button type="button" disabled={busy} style={styles.tertiary} onClick={() => assign(release.id, "")}>Clear</button> : null}</div></div>)}</div></s-section>
  </s-page>;
}

function CustomerAccessCard({ customer, artists, policy, mode, busy, onSave }) {
  const [artistMode, setArtistMode] = useState(mode);
  const [soloArtistId, setSoloArtistId] = useState(policy?.soloArtistId || "");
  return <div style={styles.customer}><strong>{customer.displayName || customer.email || "Customer"}</strong><span>{customer.email || "No email"}</span><small>{(customer.tags || []).join(", ") || "No tags"}</small><div style={styles.policyBox}><label style={styles.label}>Artist submission access<select style={styles.input} value={artistMode} onChange={(e) => setArtistMode(e.target.value)}><option value="SOLO">Solo artist — locked identity</option><option value="MULTI">Multi-artist — can enter artists</option></select></label>{artistMode === "SOLO" ? <label style={styles.label}>Locked artist<select style={styles.input} value={soloArtistId} onChange={(e) => setSoloArtistId(e.target.value)}><option value="">Choose artist</option>{artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}</select></label> : null}<button type="button" disabled={busy || (artistMode === "SOLO" && !soloArtistId)} style={styles.secondaryButton} onClick={() => onSave(artistMode, soloArtistId)}>Save artist access</button></div></div>;
}

export const headers = (args) => boundary.headers(args);
const styles = { hero:{padding:"20px 2px"},eyebrow:{fontSize:12,fontWeight:750,letterSpacing:".08em",textTransform:"uppercase",color:"#6d7175"},title:{fontSize:28,fontWeight:750,marginTop:6},copy:{color:"#6d7175",maxWidth:820,marginTop:6},search:{display:"flex",gap:8},input:{boxSizing:"border-box",width:"100%",minHeight:40,padding:"8px 10px",border:"1px solid #c9cccf",borderRadius:8,background:"#fff"},button:{border:0,borderRadius:8,background:"#202223",color:"#fff",padding:"10px 14px",fontWeight:650},secondaryButton:{border:"1px solid #8c9196",borderRadius:8,background:"#fff",padding:"9px 12px",fontWeight:650},tertiary:{border:"1px solid #c9cccf",borderRadius:8,background:"#fff",padding:"9px 12px"},customerGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12,marginTop:14},customer:{display:"grid",gap:5,padding:14,border:"1px solid #dedede",borderRadius:12},policyBox:{display:"grid",gap:9,marginTop:8,paddingTop:10,borderTop:"1px solid #ededed"},label:{display:"grid",gap:5,fontSize:11,fontWeight:700,color:"#5c5f62"},list:{display:"grid",gap:10},row:{display:"grid",gridTemplateColumns:"minmax(240px,1fr) minmax(320px,.9fr)",gap:20,padding:14,border:"1px solid #dedede",borderRadius:10,alignItems:"center"},assign:{display:"flex",gap:8,alignItems:"center"},meta:{fontSize:12,color:"#6d7175",marginTop:4},noticeGood:{padding:12,border:"1px solid #b8dfc2",background:"#eaf7ee",borderRadius:9,color:"#176c37"},noticeBad:{padding:12,border:"1px solid #f3b5ad",background:"#fff1f0",borderRadius:9,color:"#8e1f0b"},empty:{padding:14,color:"#6d7175"} };
