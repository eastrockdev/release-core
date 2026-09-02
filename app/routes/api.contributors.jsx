import { authenticate } from "../shopify.server";
import db from "../db.server";
import { contributorIdentityProtection } from "../lib/identity-protection.server";
import { apiErrorResponse } from "../lib/http-security.server";
import { findShopContributor } from "../lib/tenant-db.server";

const clean = (value) => String(value || "").trim() || null;

export const action = async ({ request }) => {
  if (request.method !== "POST") return Response.json({ ok:false, error:"Method not allowed." }, { status:405 });
  try {
    const { session } = await authenticate.admin(request);
    const data = await request.formData();
    const intent = String(data.get("intent") || "");
    const payload = {
      legalName: String(data.get("legalName") || "").trim(),
      stageName: clean(data.get("stageName")),
      email: clean(data.get("email")),
      pro: clean(data.get("pro")),
      ipi: clean(data.get("ipi")),
      publisherName: clean(data.get("publisherName")),
      notes: clean(data.get("notes")),
    };
    if (!payload.legalName) return Response.json({ ok:false, error:"Contributor legal name is required." }, { status:400 });

    if (intent === "create") {
      const contributor = await db.contributor.create({ data:{ shop:session.shop, ...payload } });
      return Response.json({ ok:true, contributorId:contributor.id, message:`${contributor.stageName || contributor.legalName} added to contributors.` });
    }
    if (intent === "update") {
      const contributorId = String(data.get("contributorId") || "");
      const owned = await findShopContributor(session.shop, contributorId);
      if (!owned) return Response.json({ ok:false, error:"Contributor not found." }, { status:404 });
      const protection = await contributorIdentityProtection({ shop: session.shop, contributorId: owned.id });
      const protectedFields = ["legalName", "stageName", "pro", "ipi", "publisherName"];
      if (protection.identityLocked && protectedFields.some((field) => (payload[field] || null) !== (owned[field] || null))) {
        return Response.json({ ok:false, error:"This contributor identity is locked because it appears on a submitted release. Disable contributor identity protection in Settings before making a verified correction." }, { status:409 });
      }
      const contributor = await db.contributor.update({
        where:{id:owned.id},
        data: protection.identityLocked
          ? { email: payload.email, notes: payload.notes }
          : payload,
      });
      return Response.json({ ok:true, message:`${contributor.stageName || contributor.legalName} updated.` });
    }
    return Response.json({ ok:false, error:"Unknown contributor action." }, { status:400 });
  } catch (error) {
    return apiErrorResponse(request, error, { context: "contributor mutation", fallback: "ReleaseCore could not save this contributor." });
  }
};
