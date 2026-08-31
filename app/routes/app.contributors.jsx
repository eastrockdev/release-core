import { useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { authenticatedPost } from "../lib/authenticated-post";
import { PRO_OPTIONS, contributorDisplayName } from "../lib/releasecore";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const contributors = await db.contributor.findMany({
    where: { shop: session.shop },
    orderBy: [{ legalName: "asc" }],
    include: { _count: { select: { credits: true } } },
  });
  return { contributors };
};

function Field({ label, help, children }) { return <label style={styles.field}><span style={styles.label}>{label}</span>{children}{help ? <span style={styles.help}>{help}</span> : null}</label>; }
function ProSelect({ value = "" }) { return <select name="pro" defaultValue={value} style={styles.input}><option value="">Not set</option>{PRO_OPTIONS.map((pro)=><option key={pro} value={pro}>{pro}</option>)}</select>; }

export default function ContributorsPage() {
  const { contributors } = useLoaderData();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const save = async (formData) => {
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      const result = await authenticatedPost(shopify, "/api/contributors", formData);
      shopify.toast.show(result.message || "Contributor saved");
      setNotice({ good:true, text:result.message || "Contributor saved." });
      await revalidator.revalidate();
    } catch (error) { setNotice({ good:false, text:error instanceof Error ? error.message : "Could not save contributor." }); }
    finally { setBusy(false); }
  };

  return (
    <s-page heading="Contributors">
      <s-section>
        <div style={styles.intro}>
          <div style={styles.eyebrow}>Credits directory</div>
          <div style={styles.title}>Enter a contributor once. Credit them everywhere.</div>
          <div style={styles.copy}>Writers, composers, producers and engineers live in one reusable directory. PRO, IPI and publisher information follows that contributor into every track credit.</div>
        </div>
      </s-section>
      {notice ? <div style={notice.good ? styles.good : styles.bad}>{notice.text}</div> : null}
      <s-section heading="Add contributor">
        <form onSubmit={(event)=>{event.preventDefault();const data=new FormData(event.currentTarget);data.set("intent","create");save(data);event.currentTarget.reset();}}>
          <div style={styles.grid}>
            <Field label="Legal name" help="Use the contributor's legal writer/credit name."><input name="legalName" required style={styles.input} /></Field>
            <Field label="Stage / display name"><input name="stageName" style={styles.input} /></Field>
            <Field label="Email"><input name="email" type="email" style={styles.input} /></Field>
            <Field label="Performing rights organization"><ProSelect /></Field>
            <Field label="IPI / CAE number"><input name="ipi" inputMode="numeric" style={styles.input} /></Field>
            <Field label="Publisher"><input name="publisherName" style={styles.input} /></Field>
          </div>
          <div style={styles.footer}><button disabled={busy} style={styles.primary}>{busy?"Saving…":"Add contributor"}</button></div>
        </form>
      </s-section>
      <s-section heading={`All contributors (${contributors.length})`}>
        {contributors.length===0 ? <div style={styles.empty}>No contributors yet. Add your first writer, producer or engineer above.</div> : (
          <div style={{display:"grid",gap:10}}>{contributors.map((contributor)=>(
            <details key={contributor.id} style={styles.card}>
              <summary style={styles.summary}>
                <div><strong>{contributorDisplayName(contributor)}</strong><div style={styles.muted}>{contributor.legalName}{contributor.pro ? ` · ${contributor.pro}` : ""}{contributor.ipi ? ` · IPI ${contributor.ipi}` : ""}</div></div>
                <div style={styles.usage}>{contributor._count.credits} track credits</div>
              </summary>
              <div style={styles.body}>
                <form onSubmit={(event)=>{event.preventDefault();const data=new FormData(event.currentTarget);data.set("intent","update");data.set("contributorId",contributor.id);save(data);}}>
                  <div style={styles.grid}>
                    <Field label="Legal name"><input name="legalName" required defaultValue={contributor.legalName} style={styles.input}/></Field>
                    <Field label="Stage / display name"><input name="stageName" defaultValue={contributor.stageName||""} style={styles.input}/></Field>
                    <Field label="Email"><input name="email" type="email" defaultValue={contributor.email||""} style={styles.input}/></Field>
                    <Field label="Performing rights organization"><ProSelect value={contributor.pro||""}/></Field>
                    <Field label="IPI / CAE number"><input name="ipi" defaultValue={contributor.ipi||""} style={styles.input}/></Field>
                    <Field label="Publisher"><input name="publisherName" defaultValue={contributor.publisherName||""} style={styles.input}/></Field>
                  </div>
                  <Field label="Internal notes"><textarea name="notes" defaultValue={contributor.notes||""} rows={3} style={styles.textarea}/></Field>
                  <div style={styles.footer}><button disabled={busy} style={styles.secondary}>{busy?"Saving…":"Save contributor"}</button></div>
                </form>
              </div>
            </details>
          ))}</div>
        )}
      </s-section>
    </s-page>
  );
}

const styles={intro:{padding:"4px 0 8px"},eyebrow:{fontSize:12,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#6d7175",marginBottom:8},title:{fontSize:24,fontWeight:700,color:"#202223",marginBottom:8},copy:{color:"#6d7175",lineHeight:1.5,maxWidth:780},good:{maxWidth:1000,margin:"0 auto 12px",padding:"10px 13px",borderRadius:8,background:"#eaf7ee",color:"#176c37",fontSize:12},bad:{maxWidth:1000,margin:"0 auto 12px",padding:"10px 13px",borderRadius:8,background:"#fff1f0",color:"#8e1f0b",fontSize:12},grid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14},field:{display:"block",minWidth:0,marginTop:12},label:{display:"block",fontSize:12,fontWeight:650,marginBottom:6,color:"#303030"},help:{display:"block",fontSize:11,color:"#6d7175",marginTop:6,lineHeight:1.35},input:{display:"block",width:"100%",boxSizing:"border-box",height:40,border:"1px solid #8c9196",borderRadius:8,padding:"0 11px",font:"inherit",background:"#fff"},textarea:{display:"block",width:"100%",boxSizing:"border-box",border:"1px solid #8c9196",borderRadius:8,padding:11,font:"inherit",background:"#fff",resize:"vertical"},footer:{display:"flex",justifyContent:"flex-end",marginTop:16},primary:{appearance:"none",border:"1px solid #303030",borderRadius:8,background:"#303030",color:"#fff",minHeight:38,padding:"0 15px",font:"inherit",fontWeight:650,cursor:"pointer"},secondary:{appearance:"none",border:"1px solid #8c9196",borderRadius:8,background:"#fff",color:"#303030",minHeight:38,padding:"0 15px",font:"inherit",fontWeight:650,cursor:"pointer"},card:{border:"1px solid #e3e3e3",borderRadius:12,background:"#fff",overflow:"hidden"},summary:{cursor:"pointer",listStyle:"none",padding:15,display:"flex",justifyContent:"space-between",gap:16,alignItems:"center"},muted:{fontSize:12,color:"#6d7175",marginTop:4},usage:{fontSize:12,color:"#8c9196",textAlign:"right"},body:{borderTop:"1px solid #ededed",padding:16,background:"#fafafa"},empty:{border:"1px dashed #c9cccf",borderRadius:12,padding:24,textAlign:"center",color:"#6d7175"}};
export const headers=(headersArgs)=>boundary.headers(headersArgs);
