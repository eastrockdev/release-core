import { authenticate } from "../shopify.server";
import db from "../db.server";
import { GENRES, LANGUAGES } from "../lib/releasecore";
import { assignMissingIsrcsForShop } from "../lib/isrc.server";
import { COUNTRY_CODE_PATTERN, REGISTRANT_CODE_PATTERN, buildIsrc, isrcReferenceYear, isrcYearDigits, normalizeCountryCode, normalizeRegistrantCode } from "../lib/isrc";
import { buildUpc, maxItemReference, normalizeGs1CompanyPrefix, UPC_MODES, validateGs1CompanyPrefix } from "../lib/upc";
import { CATALOG_MODES, buildCatalogNumber, normalizeCatalogPrefix } from "../lib/catalog";
import { minimumSafeCatalogSequence } from "../lib/catalog.server";
import { ensureReleaseCoreProductMetafields } from "../lib/shopify-products.server";

const optionalText=(value)=>{const text=String(value||"").trim();return text||null;};
const parseNextDesignation=(value)=>{const n=Number(value);if(!Number.isInteger(n)||n<1||n>99999)throw new Error("Next Designation Code must be a whole number between 1 and 99999.");return n;};
const parsePrice=(value)=>{const n=Number(value);if(!Number.isFinite(n)||n<0||n>9999)throw new Error("Default track price must be between 0 and 9999.");return Math.round(n*100)/100;};
const parseLeadTime=(value)=>{const n=Number(value);if(!Number.isInteger(n)||n<0||n>365)throw new Error("Release-date lead time must be a whole number between 0 and 365 days.");return n;};
const parsePreviewDuration=(value)=>{const n=Number(value);if(!Number.isInteger(n)||n<0||n>3600)throw new Error("Audio preview duration must be between 0 and 3600 seconds. Use 0 for the full track.");return n;};
const parsePreviewBitrate=(value)=>{const n=Number(value);if(![128,160,192,256,320].includes(n))throw new Error("Choose a supported MP3 preview bitrate.");return n;};

async function minimumSafeDesignation(shop,countryCode,registrantCode,year){const prefix=`${countryCode}${registrantCode}${isrcYearDigits(year)}`;const tracks=await db.track.findMany({where:{release:{shop},isrc:{startsWith:prefix}},select:{isrc:true}});let max=0;for(const track of tracks){const suffix=Number(String(track.isrc||"").slice(-5));if(Number.isInteger(suffix))max=Math.max(max,suffix);}return max+1;}
async function minimumSafeUpcReference(shop,companyPrefix){const releases=await db.release.findMany({where:{shop,upc:{startsWith:companyPrefix}},select:{upc:true}});const width=11-companyPrefix.length;let max=0;for(const release of releases){const body=String(release.upc||"").slice(0,11);if(!body.startsWith(companyPrefix))continue;const ref=Number(body.slice(companyPrefix.length,companyPrefix.length+width));if(Number.isInteger(ref))max=Math.max(max,ref);}return max+1;}

export const action=async({request})=>{
  if(request.method!=="POST")return Response.json({ok:false,error:"Method not allowed."},{status:405});
  try{
    const {admin,session}=await authenticate.admin(request);
    const formData=await request.formData();
    const intent=String(formData.get("intent")||"");

    if(intent==="install-shopify-metafields"){
      const result=await ensureReleaseCoreProductMetafields(admin);
      if(result.mismatched.length)return Response.json({ok:false,error:`${result.mismatched.length} existing ReleaseCore metafield definition${result.mismatched.length===1?" has":"s have"} an incompatible type: ${result.mismatched.map((x)=>`${x.key} (${x.actual} → ${x.expected})`).join(", ")}. Shopify doesn't allow changing a definition's type in place.`},{status:409});
      return Response.json({ok:true,message:`Shopify integration ready. ${result.created.length} metafield definitions created and ${result.repaired.length} repaired.`});
    }

    if(intent==="save-settings"){
      const countryCode=normalizeCountryCode(formData.get("countryCode"));
      const registrantCode=normalizeRegistrantCode(formData.get("registrantCode"));
      const autoAssignIsrc=formData.get("autoAssignIsrc")==="on";
      const defaultLabelName=optionalText(formData.get("defaultLabelName"));
      const defaultCopyrightHolder=optionalText(formData.get("defaultCopyrightHolder"));
      const defaultGenre=optionalText(formData.get("defaultGenre"));
      const defaultLanguage=optionalText(formData.get("defaultLanguage"));
      const requireLyrics=formData.get("requireLyrics")==="on";
      const requirePublishing=formData.get("requirePublishing")==="on";
      const requireSplitSheet=formData.get("requireSplitSheet")==="on";
      const requireCredits=formData.get("requireCredits")==="on";
      const requireIsrc=formData.get("requireIsrc")==="on";
      const requireTrackLanguage=formData.get("requireTrackLanguage")==="on";
      const releaseLeadTimeEnabled=formData.get("releaseLeadTimeEnabled")==="on";
      const releaseLeadTimeDays=parseLeadTime(formData.get("releaseLeadTimeDays")||"14");
      const upcMode=String(formData.get("upcMode")||"AGGREGATOR").toUpperCase();
      const gs1CompanyPrefix=normalizeGs1CompanyPrefix(formData.get("gs1CompanyPrefix"));
      const catalogMode=String(formData.get("catalogMode")||"AUTO").toUpperCase();
      const catalogPrefix=normalizeCatalogPrefix(formData.get("catalogPrefix"));
      const catalogIncludeYear=formData.get("catalogIncludeYear")==="on";
      const catalogSequenceWidth=Number(formData.get("catalogSequenceWidth")||4);
      const autoAssignCatalogNumber=formData.get("autoAssignCatalogNumber")==="on";
      const defaultTrackPrice=parsePrice(formData.get("defaultTrackPrice")||"1.29");
      const generateShopifyAudioPreview=formData.get("generateShopifyAudioPreview")==="on";
      const audioPreviewDurationSeconds=parsePreviewDuration(formData.get("audioPreviewDurationSeconds")||"60");
      const audioPreviewBitrateKbps=parsePreviewBitrate(formData.get("audioPreviewBitrateKbps")||"192");

      const hasCountry=Boolean(countryCode),hasRegistrant=Boolean(registrantCode);
      if(hasCountry!==hasRegistrant)return Response.json({ok:false,error:"Enter both the ISRC Country Code and Registrant Code, or leave both blank."},{status:400});
      if(hasCountry&&!COUNTRY_CODE_PATTERN.test(countryCode))return Response.json({ok:false,error:"Country Code must contain exactly 2 letters, such as US or GB."},{status:400});
      if(hasRegistrant&&!REGISTRANT_CODE_PATTERN.test(registrantCode))return Response.json({ok:false,error:"Registrant Code must contain exactly 3 letters or numbers."},{status:400});
      if(defaultGenre&&!GENRES.includes(defaultGenre))return Response.json({ok:false,error:"Choose a valid default genre."},{status:400});
      if(defaultLanguage&&!LANGUAGES.includes(defaultLanguage))return Response.json({ok:false,error:"Choose a valid default language."},{status:400});
      if(!UPC_MODES.includes(upcMode))return Response.json({ok:false,error:"Choose a valid UPC handling mode."},{status:400});
      if(!CATALOG_MODES.includes(catalogMode))return Response.json({ok:false,error:"Choose a valid catalog number mode."},{status:400});
      if(!Number.isInteger(catalogSequenceWidth)||catalogSequenceWidth<2||catalogSequenceWidth>8)return Response.json({ok:false,error:"Catalog sequence width must be between 2 and 8 digits."},{status:400});
      if(catalogMode==="AUTO"&&!catalogPrefix)return Response.json({ok:false,error:"Enter a catalog prefix when automatic catalog numbers are enabled."},{status:400});

      let isrcSequencePayload=null;
      if(countryCode&&registrantCode){const year=isrcReferenceYear();const requestedNext=parseNextDesignation(formData.get("nextDesignation")||"1");const safeMinimum=await minimumSafeDesignation(session.shop,countryCode,registrantCode,year);if(requestedNext<safeMinimum)return Response.json({ok:false,error:`The next designation for ${countryCode}${registrantCode}${isrcYearDigits(year)} must be ${String(safeMinimum).padStart(5,"0")} or higher because lower numbers are already assigned in ReleaseCore.`},{status:400});isrcSequencePayload={year,requestedNext};}

      let upcSequencePayload=null;let normalizedPrefix=gs1CompanyPrefix?validateGs1CompanyPrefix(gs1CompanyPrefix):null;
      if(upcMode==="GS1"){if(!normalizedPrefix)return Response.json({ok:false,error:"Enter your licensed GS1 U.P.C. Company Prefix to enable ReleaseCore UPC generation."},{status:400});const max=maxItemReference(normalizedPrefix);const requestedNext=Number(formData.get("nextUpcItemReference")||"1");if(!Number.isInteger(requestedNext)||requestedNext<0||requestedNext>max)return Response.json({ok:false,error:`Next UPC Item Reference must be between 0 and ${max} for this prefix.`},{status:400});const safeMinimum=await minimumSafeUpcReference(session.shop,normalizedPrefix);if(requestedNext<safeMinimum)return Response.json({ok:false,error:`The next UPC Item Reference must be ${safeMinimum} or higher because lower values are already used in ReleaseCore.`},{status:400});upcSequencePayload={requestedNext};}

      let catalogSequencePayload=null;
      if(catalogMode==="AUTO"&&catalogPrefix){const year=new Date().getFullYear();const requestedNext=Number(formData.get("nextCatalogSequence")||"1");const max=(10**catalogSequenceWidth)-1;if(!Number.isInteger(requestedNext)||requestedNext<1||requestedNext>max)return Response.json({ok:false,error:`Next catalog sequence must be between 1 and ${max}.`},{status:400});const temp={catalogPrefix,catalogIncludeYear,catalogSequenceWidth};const safeMinimum=await minimumSafeCatalogSequence(session.shop,temp,year);if(requestedNext<safeMinimum)return Response.json({ok:false,error:`The next catalog sequence must be ${safeMinimum} or higher because lower numbers are already assigned.`},{status:400});catalogSequencePayload={yearKey:catalogIncludeYear?year:0,requestedNext};}

      await db.$transaction(async(tx)=>{
        await tx.appSettings.upsert({where:{shop:session.shop},create:{shop:session.shop,countryCode:countryCode||null,registrantCode:registrantCode||null,autoAssignIsrc,defaultLabelName,defaultCopyrightHolder,defaultGenre,defaultLanguage,requireLyrics,requirePublishing,requireSplitSheet,requireCredits,requireIsrc,requireTrackLanguage,releaseLeadTimeEnabled,releaseLeadTimeDays,upcMode,gs1CompanyPrefix:normalizedPrefix,catalogMode,catalogPrefix:catalogPrefix||null,catalogIncludeYear,catalogSequenceWidth,autoAssignCatalogNumber,defaultTrackPrice,generateShopifyAudioPreview,audioPreviewDurationSeconds,audioPreviewBitrateKbps},update:{countryCode:countryCode||null,registrantCode:registrantCode||null,autoAssignIsrc,defaultLabelName,defaultCopyrightHolder,defaultGenre,defaultLanguage,requireLyrics,requirePublishing,requireSplitSheet,requireCredits,requireIsrc,requireTrackLanguage,releaseLeadTimeEnabled,releaseLeadTimeDays,upcMode,gs1CompanyPrefix:normalizedPrefix,catalogMode,catalogPrefix:catalogPrefix||null,catalogIncludeYear,catalogSequenceWidth,autoAssignCatalogNumber,defaultTrackPrice,generateShopifyAudioPreview,audioPreviewDurationSeconds,audioPreviewBitrateKbps}});
        if(isrcSequencePayload)await tx.isrcSequence.upsert({where:{shop_countryCode_registrantCode_year:{shop:session.shop,countryCode,registrantCode,year:isrcSequencePayload.year}},create:{shop:session.shop,countryCode,registrantCode,year:isrcSequencePayload.year,nextDesignation:isrcSequencePayload.requestedNext},update:{nextDesignation:isrcSequencePayload.requestedNext}});
        if(upcSequencePayload&&normalizedPrefix)await tx.upcSequence.upsert({where:{shop_companyPrefix:{shop:session.shop,companyPrefix:normalizedPrefix}},create:{shop:session.shop,companyPrefix:normalizedPrefix,nextItemReference:upcSequencePayload.requestedNext},update:{nextItemReference:upcSequencePayload.requestedNext}});
        if(catalogSequencePayload&&catalogPrefix)await tx.catalogSequence.upsert({where:{shop_prefix_yearKey:{shop:session.shop,prefix:catalogPrefix,yearKey:catalogSequencePayload.yearKey}},create:{shop:session.shop,prefix:catalogPrefix,yearKey:catalogSequencePayload.yearKey,nextSequence:catalogSequencePayload.requestedNext},update:{nextSequence:catalogSequencePayload.requestedNext}});
      });
      return Response.json({ok:true,message:"ReleaseCore settings saved."});
    }

    if(intent==="assign-missing-isrcs"){const assigned=await assignMissingIsrcsForShop({shop:session.shop});return Response.json({ok:true,message:assigned?`${assigned} missing ISRC${assigned===1?" was":"s were"} assigned.`:"Every track already has an ISRC."});}
    if(intent==="preview-isrc"){const settings=await db.appSettings.findUnique({where:{shop:session.shop}});if(!settings?.countryCode||!settings?.registrantCode)return Response.json({ok:false,error:"Configure ISRC settings first."},{status:400});const year=isrcReferenceYear();const sequence=await db.isrcSequence.findUnique({where:{shop_countryCode_registrantCode_year:{shop:session.shop,countryCode:settings.countryCode,registrantCode:settings.registrantCode,year}}});return Response.json({ok:true,code:buildIsrc({countryCode:settings.countryCode,registrantCode:settings.registrantCode,year,designation:sequence?.nextDesignation||1})});}
    if(intent==="preview-upc"){const settings=await db.appSettings.findUnique({where:{shop:session.shop}});if(settings?.upcMode!=="GS1"||!settings?.gs1CompanyPrefix)return Response.json({ok:false,error:"Configure GS1 UPC generation first."},{status:400});const sequence=await db.upcSequence.findUnique({where:{shop_companyPrefix:{shop:session.shop,companyPrefix:settings.gs1CompanyPrefix}}});return Response.json({ok:true,code:buildUpc({companyPrefix:settings.gs1CompanyPrefix,itemReference:sequence?.nextItemReference||1})});}
    if(intent==="preview-catalog"){const settings=await db.appSettings.findUnique({where:{shop:session.shop}});if((settings?.catalogMode||"AUTO")!=="AUTO"||!settings?.catalogPrefix)return Response.json({ok:false,error:"Configure automatic catalog numbers first."},{status:400});const year=new Date().getFullYear();const key=settings.catalogIncludeYear===false?0:year;const seq=await db.catalogSequence.findUnique({where:{shop_prefix_yearKey:{shop:session.shop,prefix:settings.catalogPrefix,yearKey:key}}});return Response.json({ok:true,code:buildCatalogNumber({prefix:settings.catalogPrefix,includeYear:settings.catalogIncludeYear!==false,year,sequence:seq?.nextSequence||1,width:settings.catalogSequenceWidth||4})});}
    return Response.json({ok:false,error:"Unknown settings action."},{status:400});
  }catch(error){console.error("ReleaseCore: settings mutation failed",error);return Response.json({ok:false,error:error instanceof Error?error.message:"ReleaseCore could not save these settings."},{status:500});}
};
