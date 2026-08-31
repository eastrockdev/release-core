import { useEffect, useMemo, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { GENRES, LANGUAGES } from "../lib/releasecore";
import { getSequenceState } from "../lib/isrc.server";
import { isIsrcConfigured, isrcReferenceYear, isrcYearDigits, normalizeCountryCode, normalizeRegistrantCode } from "../lib/isrc";
import { buildUpc, maxItemReference, normalizeGs1CompanyPrefix } from "../lib/upc";
import { buildCatalogNumber, normalizeCatalogPrefix } from "../lib/catalog";
import { getCatalogSequenceState } from "../lib/catalog.server";
import { getReleaseCoreMetafieldStatus } from "../lib/shopify-products.server";
import { authenticatedPost } from "../lib/authenticated-post";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await db.appSettings.findUnique({ where: { shop: session.shop } });
  const year = isrcReferenceYear();
  const sequenceState = await getSequenceState(session.shop, settings, year);
  const upcSequence = settings?.gs1CompanyPrefix ? await db.upcSequence.findUnique({ where: { shop_companyPrefix: { shop: session.shop, companyPrefix: settings.gs1CompanyPrefix } } }) : null;
  const catalogState = await getCatalogSequenceState(session.shop, settings, new Date().getFullYear());
  const metafields = await getReleaseCoreMetafieldStatus(admin);
  const [assignedCount, unassignedCount, upcAssigned, upcMissing, catalogAssigned, catalogMissing] = await Promise.all([
    db.track.count({ where: { release: { shop: session.shop }, isrc: { not: null } } }),
    db.track.count({ where: { release: { shop: session.shop }, isrc: null } }),
    db.release.count({ where: { shop: session.shop, upc: { not: null } } }),
    db.release.count({ where: { shop: session.shop, upc: null, status: "APPROVED" } }),
    db.release.count({ where: { shop: session.shop, catalogNumber: { not: null } } }),
    db.release.count({ where: { shop: session.shop, catalogNumber: null, status: "APPROVED" } }),
  ]);
  return {
    settings,
    year,
    nextDesignation: sequenceState.nextDesignation,
    isrcConfigured: isIsrcConfigured(settings),
    assignedCount,
    unassignedCount,
    nextUpcItemReference: upcSequence?.nextItemReference || 1,
    upcAssigned,
    upcMissing,
    nextCatalogSequence: catalogState.nextSequence || 1,
    catalogAssigned,
    catalogMissing,
    metafields,
  };
};

function Field({ label, help, children }) { return <label style={styles.field}><span style={styles.label}>{label}</span>{children}{help ? <span style={styles.help}>{help}</span> : null}</label>; }
function Select({ value, onChange, options, placeholder }) { return <select value={value} onChange={onChange} style={styles.input}><option value="">{placeholder}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>; }
function Toggle({ checked, onChange, title, help }) { return <label style={styles.toggle}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span><strong>{title}</strong><span style={styles.toggleHelp}>{help}</span></span></label>; }

function isrcPreview(countryCode, registrantCode, year, nextDesignation) {
  const country = normalizeCountryCode(countryCode);
  const registrant = normalizeRegistrantCode(registrantCode);
  const designation = Number(nextDesignation);
  if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z0-9]{3}$/.test(registrant) || !Number.isInteger(designation) || designation < 1 || designation > 99999) return "Complete the ISRC settings";
  return `${country}${registrant}${isrcYearDigits(year)}${String(designation).padStart(5, "0")}`;
}

export default function SettingsPage() {
  const data = useLoaderData();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const s = data.settings || {};

  const [countryCode,setCountryCode]=useState(s.countryCode||"");
  const [registrantCode,setRegistrantCode]=useState(s.registrantCode||"");
  const [nextDesignation,setNextDesignation]=useState(String(data.nextDesignation||1));
  const [autoAssignIsrc,setAutoAssignIsrc]=useState(s.autoAssignIsrc??true);
  const [defaultLabelName,setDefaultLabelName]=useState(s.defaultLabelName||"");
  const [defaultCopyrightHolder,setDefaultCopyrightHolder]=useState(s.defaultCopyrightHolder||"");
  const [defaultGenre,setDefaultGenre]=useState(s.defaultGenre||"");
  const [defaultLanguage,setDefaultLanguage]=useState(s.defaultLanguage||"");
  const [requireLyrics,setRequireLyrics]=useState(s.requireLyrics??true);
  const [requirePublishing,setRequirePublishing]=useState(s.requirePublishing??true);
  const [requireSplitSheet,setRequireSplitSheet]=useState(s.requireSplitSheet??false);
  const [requireCredits,setRequireCredits]=useState(s.requireCredits??false);
  const [requireIsrc,setRequireIsrc]=useState(s.requireIsrc??true);
  const [requireTrackLanguage,setRequireTrackLanguage]=useState(s.requireTrackLanguage??true);
  const [releaseLeadTimeEnabled,setReleaseLeadTimeEnabled]=useState(s.releaseLeadTimeEnabled??false);
  const [releaseLeadTimeDays,setReleaseLeadTimeDays]=useState(String(s.releaseLeadTimeDays??14));
  const [upcMode,setUpcMode]=useState(s.upcMode||"AGGREGATOR");
  const [gs1CompanyPrefix,setGs1CompanyPrefix]=useState(s.gs1CompanyPrefix||"");
  const [nextUpcItemReference,setNextUpcItemReference]=useState(String(data.nextUpcItemReference||1));
  const [catalogMode,setCatalogMode]=useState(s.catalogMode||"AUTO");
  const [catalogPrefix,setCatalogPrefix]=useState(s.catalogPrefix||"");
  const [catalogIncludeYear,setCatalogIncludeYear]=useState(s.catalogIncludeYear??true);
  const [catalogSequenceWidth,setCatalogSequenceWidth]=useState(String(s.catalogSequenceWidth||4));
  const [nextCatalogSequence,setNextCatalogSequence]=useState(String(data.nextCatalogSequence||1));
  const [autoAssignCatalogNumber,setAutoAssignCatalogNumber]=useState(s.autoAssignCatalogNumber??true);
  const [defaultTrackPrice,setDefaultTrackPrice]=useState(String(s.defaultTrackPrice??1.29));
  const [generateShopifyAudioPreview,setGenerateShopifyAudioPreview]=useState(s.generateShopifyAudioPreview??false);
  const [audioPreviewDurationSeconds,setAudioPreviewDurationSeconds]=useState(String(s.audioPreviewDurationSeconds??60));
  const [audioPreviewBitrateKbps,setAudioPreviewBitrateKbps]=useState(String(s.audioPreviewBitrateKbps??192));
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState(null);

  useEffect(()=>setNextDesignation(String(data.nextDesignation||1)),[data.nextDesignation]);
  useEffect(()=>setNextUpcItemReference(String(data.nextUpcItemReference||1)),[data.nextUpcItemReference]);
  useEffect(()=>setNextCatalogSequence(String(data.nextCatalogSequence||1)),[data.nextCatalogSequence]);

  const previewIsrc=useMemo(()=>isrcPreview(countryCode,registrantCode,data.year,nextDesignation),[countryCode,registrantCode,data.year,nextDesignation]);
  const previewUpc=useMemo(()=>{try{const p=normalizeGs1CompanyPrefix(gs1CompanyPrefix);return p?buildUpc({companyPrefix:p,itemReference:Number(nextUpcItemReference||0)}):"Enter a GS1 U.P.C. Company Prefix";}catch{return "Enter a valid GS1 U.P.C. Company Prefix";}},[gs1CompanyPrefix,nextUpcItemReference]);
  const previewCatalog=useMemo(()=>{try{const prefix=normalizeCatalogPrefix(catalogPrefix);return prefix?buildCatalogNumber({prefix,includeYear:catalogIncludeYear,year:new Date().getFullYear(),sequence:Number(nextCatalogSequence||1),width:Number(catalogSequenceWidth||4)}):"Enter a catalog prefix";}catch{return "Complete the catalog settings";}},[catalogPrefix,catalogIncludeYear,nextCatalogSequence,catalogSequenceWidth]);

  const post=async(formData, fallback)=>{if(busy)return null;setBusy(true);setNotice(null);try{const r=await authenticatedPost(shopify,"/api/settings",formData);setNotice({tone:"good",message:r.message||fallback});await revalidator.revalidate();return r;}catch(e){setNotice({tone:"bad",message:e instanceof Error?e.message:"ReleaseCore could not save settings."});return null;}finally{setBusy(false);}};
  const save=async()=>{const f=new FormData();f.set("intent","save-settings");f.set("countryCode",countryCode);f.set("registrantCode",registrantCode);f.set("nextDesignation",nextDesignation);if(autoAssignIsrc)f.set("autoAssignIsrc","on");f.set("defaultLabelName",defaultLabelName);f.set("defaultCopyrightHolder",defaultCopyrightHolder);f.set("defaultGenre",defaultGenre);f.set("defaultLanguage",defaultLanguage);if(requireLyrics)f.set("requireLyrics","on");if(requirePublishing)f.set("requirePublishing","on");if(requireSplitSheet)f.set("requireSplitSheet","on");if(requireCredits)f.set("requireCredits","on");if(requireIsrc)f.set("requireIsrc","on");if(requireTrackLanguage)f.set("requireTrackLanguage","on");if(releaseLeadTimeEnabled)f.set("releaseLeadTimeEnabled","on");f.set("releaseLeadTimeDays",releaseLeadTimeDays);f.set("upcMode",upcMode);f.set("gs1CompanyPrefix",gs1CompanyPrefix);f.set("nextUpcItemReference",nextUpcItemReference);f.set("catalogMode",catalogMode);f.set("catalogPrefix",catalogPrefix);if(catalogIncludeYear)f.set("catalogIncludeYear","on");f.set("catalogSequenceWidth",catalogSequenceWidth);f.set("nextCatalogSequence",nextCatalogSequence);if(autoAssignCatalogNumber)f.set("autoAssignCatalogNumber","on");f.set("defaultTrackPrice",defaultTrackPrice);if(generateShopifyAudioPreview)f.set("generateShopifyAudioPreview","on");f.set("audioPreviewDurationSeconds",audioPreviewDurationSeconds);f.set("audioPreviewBitrateKbps",audioPreviewBitrateKbps);const r=await post(f,"Settings saved.");if(r)shopify.toast.show("Settings saved");};
  const backfill=async()=>{const f=new FormData();f.set("intent","assign-missing-isrcs");await post(f,"ISRCs updated.");};
  const installMetafields=async()=>{const f=new FormData();f.set("intent","install-shopify-metafields");await post(f,"Shopify integration ready.");};

  let upcCapacity="";try{const p=normalizeGs1CompanyPrefix(gs1CompanyPrefix);if(p)upcCapacity=`Item Reference range 0–${maxItemReference(p)}`;}catch{}
  const metaReady=data.metafields.missing.length===0&&data.metafields.mismatched.length===0&&data.metafields.hidden.length===0;

  return <s-page heading="Settings">
    <s-section><div style={styles.hero}><div style={styles.eyebrow}>ReleaseCore configuration</div><div style={styles.heroTitle}>Distribution rules, identifiers & defaults</div><div style={styles.heroCopy}>Control what artists must provide, how identifiers are assigned, and the defaults used during downstream distribution and Shopify product creation.</div></div></s-section>
    {notice?.tone==="good"?<div style={styles.noticeGood}>{notice.message}</div>:null}{notice?.tone==="bad"?<div style={styles.noticeBad}>{notice.message}</div>:null}

    <s-section heading="Submission requirements"><div style={styles.sectionIntro}>Core metadata, cover artwork, master audio and primary artists remain required. These switches control requirements that vary between distributors and label workflows.</div><div style={styles.toggleGrid}>
      <Toggle checked={requireLyrics} onChange={setRequireLyrics} title="Require lyrics or instrumental designation" help="Blocks submission when a lyrical track has no lyrics." />
      <Toggle checked={requirePublishing} onChange={setRequirePublishing} title="Require publishing splits to total 100%" help="Useful when writer ownership must be captured before delivery." />
      <Toggle checked={requireSplitSheet} onChange={setRequireSplitSheet} title="Require a split sheet" help="Makes the release-level PDF split sheet mandatory." />
      <Toggle checked={requireCredits} onChange={setRequireCredits} title="Require at least one contributor credit" help="Requires a writer, producer, engineer or other contributor on each track." />
      <Toggle checked={requireIsrc} onChange={setRequireIsrc} title="Require ISRC before submission" help="Turn off when your downstream distributor will assign track identifiers." />
      <Toggle checked={requireTrackLanguage} onChange={setRequireTrackLanguage} title="Require track language" help="Turn off only if your aggregator does not require a language value." />
      <Toggle checked={releaseLeadTimeEnabled} onChange={setReleaseLeadTimeEnabled} title="Enforce release-date lead time" help="Prevents artists from choosing or submitting a release date that is too close to today." />
    </div>{releaseLeadTimeEnabled?<div style={styles.leadTimeCard}><div><strong style={styles.setupTitle}>Artist release-date lead time</strong><div style={styles.muted}>The earliest selectable date in the storefront portal will always be this many calendar days from the current date. ReleaseCore validates it again when the artist submits.</div></div><Field label="Minimum lead time (days)" help="Example: 14 means an artist submitting today must choose a release date at least 14 days away."><input type="number" min="0" max="365" step="1" value={releaseLeadTimeDays} onChange={(e)=>setReleaseLeadTimeDays(e.target.value)} style={{...styles.input,maxWidth:180}} /></Field></div>:null}<div style={styles.actionRow}><button type="button" disabled={busy} onClick={save} style={styles.primaryButton}>Save requirements</button></div></s-section>

    <s-section heading="ISRC assignment"><div style={styles.sectionIntro}>Configure the issuer prefix used when ReleaseCore assigns track-level ISRCs.</div><div style={styles.grid}>
      <Field label="Country Code (2 characters)"><input value={countryCode} onChange={(e)=>setCountryCode(e.target.value.toUpperCase().replace(/[^A-Z]/g,"").slice(0,2))} style={styles.input}/></Field>
      <Field label="Registrant Code (3 characters)"><input value={registrantCode} onChange={(e)=>setRegistrantCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,3))} style={styles.input}/></Field>
      <Field label="Reference year"><div style={styles.readonly}>{data.year} · {isrcYearDigits(data.year)}</div></Field>
      <Field label="Next Designation Code"><input type="number" min="1" max="99999" value={nextDesignation} onChange={(e)=>setNextDesignation(e.target.value)} style={styles.input}/></Field>
    </div><div style={styles.previewCard}><div><div style={styles.previewLabel}>Next ISRC</div><div style={styles.previewCode}>{previewIsrc}</div></div><div style={styles.previewMeta}>{data.assignedCount} assigned · {data.unassignedCount} waiting</div></div><Toggle checked={autoAssignIsrc} onChange={setAutoAssignIsrc} title="Automatically assign ISRCs to new tracks" help="When the issuer prefix is configured."/><div style={styles.actionRow}><button type="button" disabled={busy||!data.isrcConfigured||!data.unassignedCount} onClick={backfill} style={styles.secondaryButton}>Assign missing ISRCs</button><button type="button" disabled={busy} onClick={save} style={styles.primaryButton}>Save ISRC settings</button></div></s-section>

    <s-section heading="UPC / GTIN-12 handling"><div style={styles.sectionIntro}>Choose whether your aggregator supplies release UPCs or ReleaseCore assigns them from your licensed GS1 U.P.C. Company Prefix. ReleaseCore generates the GTIN-12 value; it does not license GS1 numbers.</div><div style={styles.choiceGrid}>
      <label style={{...styles.choice,...(upcMode==="AGGREGATOR"?styles.choiceActive:{})}}><input type="radio" checked={upcMode==="AGGREGATOR"} onChange={()=>setUpcMode("AGGREGATOR")}/><span><strong>Aggregator / admin provides UPC</strong><span style={styles.toggleHelp}>Enter the UPC in Distribution after your distributor assigns it.</span></span></label>
      <label style={{...styles.choice,...(upcMode==="GS1"?styles.choiceActive:{})}}><input type="radio" checked={upcMode==="GS1"} onChange={()=>setUpcMode("GS1")}/><span><strong>Generate from GS1 Company Prefix</strong><span style={styles.toggleHelp}>ReleaseCore allocates the Item Reference and calculates the GTIN-12 check digit.</span></span></label>
    </div>{upcMode==="GS1"?<><div style={{...styles.grid,marginTop:16}}><Field label="GS1 U.P.C. Company Prefix" help="Enter the numeric prefix exactly as licensed to your organization."><input value={gs1CompanyPrefix} onChange={(e)=>setGs1CompanyPrefix(e.target.value.replace(/\D/g,"").slice(0,10))} style={styles.input} placeholder="123456"/></Field><Field label="Next Item Reference" help={upcCapacity}><input type="number" min="0" value={nextUpcItemReference} onChange={(e)=>setNextUpcItemReference(e.target.value)} style={styles.input}/></Field></div><div style={styles.previewCard}><div><div style={styles.previewLabel}>Next UPC / GTIN-12</div><div style={styles.previewCode}>{previewUpc}</div></div><div style={styles.previewMeta}>{data.upcAssigned} assigned · {data.upcMissing} approved releases waiting</div></div></>:null}<div style={styles.actionRow}><button type="button" disabled={busy} onClick={save} style={styles.primaryButton}>Save UPC settings</button></div></s-section>

    <s-section heading="Catalog number assignment"><div style={styles.sectionIntro}>Catalog numbers are release-level identifiers controlled by the label. Automatic mode can follow patterns such as ERE260046: prefix + two-digit year + padded sequence.</div><div style={styles.choiceGrid}>
      <label style={{...styles.choice,...(catalogMode==="AUTO"?styles.choiceActive:{})}}><input type="radio" checked={catalogMode==="AUTO"} onChange={()=>setCatalogMode("AUTO")}/><span><strong>ReleaseCore generates catalog numbers</strong><span style={styles.toggleHelp}>Use a configurable prefix, optional year, and sequential number.</span></span></label>
      <label style={{...styles.choice,...(catalogMode==="MANUAL"?styles.choiceActive:{})}}><input type="radio" checked={catalogMode==="MANUAL"} onChange={()=>setCatalogMode("MANUAL")}/><span><strong>Admin provides catalog number</strong><span style={styles.toggleHelp}>Enter the catalog number in the Distribution workspace.</span></span></label>
    </div>{catalogMode==="AUTO"?<><div style={{...styles.grid,marginTop:16}}><Field label="Catalog prefix" help="Letters, numbers and hyphens. Example: ERE"><input value={catalogPrefix} onChange={(e)=>setCatalogPrefix(normalizeCatalogPrefix(e.target.value))} style={styles.input} placeholder="ERE"/></Field><Field label="Sequence digits"><select value={catalogSequenceWidth} onChange={(e)=>setCatalogSequenceWidth(e.target.value)} style={styles.input}>{[2,3,4,5,6,7,8].map((n)=><option key={n} value={n}>{n} digits</option>)}</select></Field><Field label="Next sequence"><input type="number" min="1" value={nextCatalogSequence} onChange={(e)=>setNextCatalogSequence(e.target.value)} style={styles.input}/></Field></div><Toggle checked={catalogIncludeYear} onChange={setCatalogIncludeYear} title="Include two-digit year" help="Example: ERE + 26 + 0046 → ERE260046."/><Toggle checked={autoAssignCatalogNumber} onChange={setAutoAssignCatalogNumber} title="Automatically assign before Shopify product creation" help="ReleaseCore will reserve the next catalog number if the release reaches Distribution without one."/><div style={styles.previewCard}><div><div style={styles.previewLabel}>Next catalog number</div><div style={styles.previewCode}>{previewCatalog}</div></div><div style={styles.previewMeta}>{data.catalogAssigned} assigned · {data.catalogMissing} approved releases waiting</div></div></>:null}<div style={styles.actionRow}><button type="button" disabled={busy} onClick={save} style={styles.primaryButton}>Save catalog settings</button></div></s-section>

    <s-section heading="Shopify integration"><div style={styles.sectionIntro}>ReleaseCore can create its own product metafield definitions automatically. These definitions are merchant-visible and Storefront API readable so themes can display music metadata without manual Shopify setup.</div><div style={styles.shopifySetup}><div><div style={styles.setupTitle}>{metaReady?"Shopify metafields ready":"Shopify metafields need setup"}</div><div style={styles.muted}>{data.metafields.installed}/{data.metafields.total} definitions found{data.metafields.hidden.length?` · ${data.metafields.hidden.length} need Storefront access`:""}{data.metafields.mismatched.length?` · ${data.metafields.mismatched.length} type mismatch`:""}</div>{data.metafields.missing.length?<div style={styles.smallList}>Missing: {data.metafields.missing.join(", ")}</div>:null}{data.metafields.mismatched.length?<div style={styles.smallList}>Type mismatch: {data.metafields.mismatched.map((x)=>x.key).join(", ")}</div>:null}</div><button type="button" disabled={busy} onClick={installMetafields} style={metaReady?styles.secondaryButton:styles.primaryButton}>{metaReady?"Check / repair definitions":"Install metafields"}</button></div></s-section>

    <s-section heading="Shopify audio previews"><div style={styles.sectionIntro}>Optionally convert uploaded WAV masters to browser-friendly MP3 previews, store them in Shopify Files, and attach the preview file to each track product as <code>releasecore.audio_preview</code>. The artist portal always plays the original uploaded WAV for confirmation.</div><Toggle checked={generateShopifyAudioPreview} onChange={setGenerateShopifyAudioPreview} title="Enable MP3 preview generation" help="Adds preview controls to the Distribution workspace. Product sync will expose the generated Shopify file through the ReleaseCore metafield."/>{generateShopifyAudioPreview?<div style={{...styles.grid,marginTop:14}}><Field label="Preview duration (seconds)" help="Use 0 for the full track. Short previews are recommended because Shopify Files limits generic files to 20 MB."><input type="number" min="0" max="3600" step="1" value={audioPreviewDurationSeconds} onChange={(e)=>setAudioPreviewDurationSeconds(e.target.value)} style={styles.input}/></Field><Field label="MP3 bitrate"><select value={audioPreviewBitrateKbps} onChange={(e)=>setAudioPreviewBitrateKbps(e.target.value)} style={styles.input}>{[128,160,192,256,320].map((n)=><option key={n} value={n}>{n} kbps</option>)}</select></Field></div>:null}<div style={styles.actionRow}><button type="button" disabled={busy} onClick={save} style={styles.primaryButton}>Save audio preview settings</button></div></s-section>

    <s-section heading="Distribution & Shopify defaults"><div style={styles.grid}><Field label="Default label name"><input value={defaultLabelName} onChange={(e)=>setDefaultLabelName(e.target.value)} style={styles.input}/></Field><Field label="Default copyright holder"><input value={defaultCopyrightHolder} onChange={(e)=>setDefaultCopyrightHolder(e.target.value)} style={styles.input}/></Field><Field label="Default genre"><Select value={defaultGenre} onChange={(e)=>setDefaultGenre(e.target.value)} options={GENRES} placeholder="No default genre"/></Field><Field label="Default track language"><Select value={defaultLanguage} onChange={(e)=>setDefaultLanguage(e.target.value)} options={LANGUAGES} placeholder="No default language"/></Field><Field label="Default Shopify track price" help="Used when creating or syncing digital music products from Distribution."><input type="number" min="0" step="0.01" value={defaultTrackPrice} onChange={(e)=>setDefaultTrackPrice(e.target.value)} style={styles.input}/></Field></div><div style={styles.actionRow}><button type="button" disabled={busy} onClick={save} style={styles.primaryButton}>Save defaults</button></div></s-section>
  </s-page>;
}

const styles={hero:{padding:"3px 0 7px"},eyebrow:{fontSize:11,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#6d7175",marginBottom:7},heroTitle:{fontSize:24,fontWeight:750,color:"#202223",marginBottom:7},heroCopy:{maxWidth:800,color:"#6d7175",lineHeight:1.5},sectionIntro:{fontSize:13,color:"#6d7175",lineHeight:1.5,marginBottom:16},grid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14},field:{display:"block",minWidth:0},label:{display:"block",fontSize:12,fontWeight:650,color:"#303030",marginBottom:6},help:{display:"block",fontSize:11,color:"#6d7175",lineHeight:1.4,marginTop:6},input:{display:"block",width:"100%",boxSizing:"border-box",height:40,border:"1px solid #8c9196",borderRadius:8,padding:"0 11px",font:"inherit",background:"#fff",color:"#202223"},readonly:{height:40,boxSizing:"border-box",display:"flex",alignItems:"center",padding:"0 11px",border:"1px solid #e1e3e5",borderRadius:8,background:"#f6f6f7",color:"#5c5f62",fontSize:12},toggleGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:10},toggle:{display:"flex",gap:9,alignItems:"flex-start",border:"1px solid #e3e3e3",borderRadius:10,padding:12,background:"#fff",fontSize:12,marginTop:10},toggleHelp:{display:"block",color:"#6d7175",fontWeight:400,lineHeight:1.4,marginTop:3},choiceGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:10},choice:{display:"flex",gap:10,border:"1px solid #d8dadd",borderRadius:11,padding:14,background:"#fff",fontSize:12},choiceActive:{borderColor:"#303030",boxShadow:"0 0 0 1px #303030"},previewCard:{display:"flex",justifyContent:"space-between",gap:18,alignItems:"center",flexWrap:"wrap",marginTop:17,padding:16,borderRadius:12,border:"1px solid #e1e3e5",background:"#fafafa"},previewLabel:{fontSize:11,color:"#6d7175",fontWeight:650,marginBottom:5},previewCode:{fontSize:21,fontWeight:750,letterSpacing:".06em",color:"#202223"},previewMeta:{fontSize:12,color:"#6d7175"},actionRow:{display:"flex",justifyContent:"flex-end",gap:9,flexWrap:"wrap",marginTop:18},primaryButton:{appearance:"none",border:"1px solid #303030",borderRadius:8,background:"#303030",color:"#fff",minHeight:36,padding:"0 14px",font:"inherit",fontWeight:650,cursor:"pointer"},secondaryButton:{appearance:"none",border:"1px solid #8c9196",borderRadius:8,background:"#fff",color:"#303030",minHeight:36,padding:"0 14px",font:"inherit",fontWeight:650,cursor:"pointer"},noticeGood:{maxWidth:1000,margin:"0 auto 12px",borderRadius:8,background:"#eaf7ee",color:"#176c37",padding:"10px 13px",fontSize:13},noticeBad:{maxWidth:1000,margin:"0 auto 12px",borderRadius:8,background:"#fff1f0",color:"#8e1f0b",padding:"10px 13px",fontSize:13},shopifySetup:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:18,flexWrap:"wrap",border:"1px solid #e1e3e5",borderRadius:12,padding:16,background:"#fafafa"},setupTitle:{fontSize:15,fontWeight:700,color:"#202223",marginBottom:4},muted:{fontSize:12,color:"#6d7175",lineHeight:1.45},smallList:{fontSize:11,color:"#8a5700",marginTop:6,maxWidth:760,lineHeight:1.4},leadTimeCard:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:18,alignItems:"end",marginTop:14,padding:16,border:"1px solid #e1e3e5",borderRadius:12,background:"#fafafa"}};
export const headers=(headersArgs)=>boundary.headers(headersArgs);
