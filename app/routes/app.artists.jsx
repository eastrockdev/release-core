import { useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { authenticatedPost } from "../lib/authenticated-post";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const artists = await db.artist.findMany({
    where: { shop: session.shop },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { releases: true, tracks: true } },
    },
  });
  return { artists };
};

function Field({ label, help, children }) {
  return <label style={styles.field}><span style={styles.label}>{label}</span>{children}{help ? <span style={styles.help}>{help}</span> : null}</label>;
}

export default function ArtistsPage() {
  const { artists } = useLoaderData();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const save = async (formData) => {
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      const result = await authenticatedPost(shopify, "/api/artists", formData);
      shopify.toast.show(result.message || "Artist saved");
      setNotice({ good: true, text: result.message || "Artist saved." });
      await revalidator.revalidate();
    } catch (error) {
      setNotice({ good: false, text: error instanceof Error ? error.message : "Could not save artist." });
    } finally { setBusy(false); }
  };

  return (
    <s-page heading="Artists">
      <s-section>
        <div style={styles.intro}>
          <div style={styles.eyebrow}>Artist directory</div>
          <div style={styles.title}>One artist identity, reused everywhere.</div>
          <div style={styles.copy}>Create and maintain the public-facing artist identities used on releases and individual tracks. Changing an artist here updates the identity ReleaseCore references everywhere.</div>
        </div>
      </s-section>

      {notice ? <div style={notice.good ? styles.good : styles.bad}>{notice.text}</div> : null}

      <s-section heading="Add artist">
        <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); data.set("intent", "create"); save(data); event.currentTarget.reset(); }}>
          <div style={styles.grid}>
            <Field label="Artist / stage name"><input name="name" required style={styles.input} placeholder="Artist name" /></Field>
            <Field label="Legal name" help="Optional. Keep private-facing identity information here."><input name="legalName" style={styles.input} /></Field>
            <Field label="Email"><input name="email" type="email" style={styles.input} /></Field>
            <Field label="Website"><input name="websiteUrl" type="url" style={styles.input} placeholder="https://" /></Field>
            <Field label="Spotify artist URL"><input name="spotifyUrl" type="url" style={styles.input} placeholder="https://open.spotify.com/artist/..." /></Field>
            <Field label="Apple Music artist URL"><input name="appleMusicUrl" type="url" style={styles.input} placeholder="https://music.apple.com/..." /></Field>
          </div>
          <div style={styles.footer}><button disabled={busy} style={styles.primary}>{busy ? "Saving…" : "Add artist"}</button></div>
        </form>
      </s-section>

      <s-section heading={`All artists (${artists.length})`}>
        {artists.length === 0 ? <div style={styles.empty}>No artists yet. Add an artist above, then assign that identity to releases and tracks.</div> : (
          <div style={{ display: "grid", gap: 10 }}>
            {artists.map((artist) => (
              <details key={artist.id} style={styles.card}>
                <summary style={styles.summary}>
                  <div><strong>{artist.name}</strong><div style={styles.muted}>{artist.legalName || "Legal name not set"}</div></div>
                  <div style={styles.usage}>{artist._count.releases} release assignments · {artist._count.tracks} track assignments</div>
                </summary>
                <div style={styles.body}>
                  <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); data.set("intent", "update"); data.set("artistId", artist.id); save(data); }}>
                    <div style={styles.grid}>
                      <Field label="Artist / stage name"><input name="name" required defaultValue={artist.name} style={styles.input} /></Field>
                      <Field label="Legal name"><input name="legalName" defaultValue={artist.legalName || ""} style={styles.input} /></Field>
                      <Field label="Email"><input name="email" type="email" defaultValue={artist.email || ""} style={styles.input} /></Field>
                      <Field label="Website"><input name="websiteUrl" type="url" defaultValue={artist.websiteUrl || ""} style={styles.input} /></Field>
                      <Field label="Spotify artist URL"><input name="spotifyUrl" type="url" defaultValue={artist.spotifyUrl || ""} style={styles.input} /></Field>
                      <Field label="Apple Music artist URL"><input name="appleMusicUrl" type="url" defaultValue={artist.appleMusicUrl || ""} style={styles.input} /></Field>
                    </div>
                    <Field label="Internal notes"><textarea name="notes" defaultValue={artist.notes || ""} rows={3} style={styles.textarea} /></Field>
                    <div style={styles.footer}><button disabled={busy} style={styles.secondary}>{busy ? "Saving…" : "Save artist"}</button></div>
                  </form>
                </div>
              </details>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

const styles = {
  intro:{padding:"4px 0 8px"}, eyebrow:{fontSize:12,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#6d7175",marginBottom:8}, title:{fontSize:24,fontWeight:700,color:"#202223",marginBottom:8}, copy:{color:"#6d7175",lineHeight:1.5,maxWidth:780},
  good:{maxWidth:1000,margin:"0 auto 12px",padding:"10px 13px",borderRadius:8,background:"#eaf7ee",color:"#176c37",fontSize:12}, bad:{maxWidth:1000,margin:"0 auto 12px",padding:"10px 13px",borderRadius:8,background:"#fff1f0",color:"#8e1f0b",fontSize:12},
  grid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14}, field:{display:"block",minWidth:0,marginTop:12}, label:{display:"block",fontSize:12,fontWeight:650,marginBottom:6,color:"#303030"}, help:{display:"block",fontSize:11,color:"#6d7175",marginTop:6,lineHeight:1.35}, input:{display:"block",width:"100%",boxSizing:"border-box",height:40,border:"1px solid #8c9196",borderRadius:8,padding:"0 11px",font:"inherit",background:"#fff"}, textarea:{display:"block",width:"100%",boxSizing:"border-box",border:"1px solid #8c9196",borderRadius:8,padding:11,font:"inherit",background:"#fff",resize:"vertical"},
  footer:{display:"flex",justifyContent:"flex-end",marginTop:16}, primary:{appearance:"none",border:"1px solid #303030",borderRadius:8,background:"#303030",color:"#fff",minHeight:38,padding:"0 15px",font:"inherit",fontWeight:650,cursor:"pointer"}, secondary:{appearance:"none",border:"1px solid #8c9196",borderRadius:8,background:"#fff",color:"#303030",minHeight:38,padding:"0 15px",font:"inherit",fontWeight:650,cursor:"pointer"},
  card:{border:"1px solid #e3e3e3",borderRadius:12,background:"#fff",overflow:"hidden"}, summary:{cursor:"pointer",listStyle:"none",padding:15,display:"flex",justifyContent:"space-between",gap:16,alignItems:"center"}, muted:{fontSize:12,color:"#6d7175",marginTop:4}, usage:{fontSize:12,color:"#8c9196",textAlign:"right"}, body:{borderTop:"1px solid #ededed",padding:16,background:"#fafafa"}, empty:{border:"1px dashed #c9cccf",borderRadius:12,padding:24,textAlign:"center",color:"#6d7175"}
};
export const headers = (headersArgs) => boundary.headers(headersArgs);
