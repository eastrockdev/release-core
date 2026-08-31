import { authenticate } from "../shopify.server";
import db from "../db.server";
import { customerNumericId, getShopifyCustomer } from "../lib/automations.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") return Response.json({ ok:false, error:"Method not allowed." }, { status:405 });
  try {
    const { admin, session } = await authenticate.admin(request);
    const form = await request.formData();
    const intent = String(form.get("intent") || "");

    if (intent === "save-customer-policy") {
      const customerId = customerNumericId(form.get("customerId"));
      if (!customerId) return Response.json({ ok:false, error:"Choose a valid Shopify customer." }, { status:400 });
      const customer = await getShopifyCustomer(admin, customerId);
      if (!customer) return Response.json({ ok:false, error:"Shopify customer not found." }, { status:404 });
      const artistMode = String(form.get("artistMode") || "MULTI").toUpperCase() === "SOLO" ? "SOLO" : "MULTI";
      const soloArtistId = artistMode === "SOLO" ? String(form.get("soloArtistId") || "").trim() : null;
      if (artistMode === "SOLO") {
        const artist = soloArtistId ? await db.artist.findFirst({ where: { id: soloArtistId, shop: session.shop } }) : null;
        if (!artist) return Response.json({ ok:false, error:"Choose the artist identity this customer is allowed to submit for." }, { status:400 });
        await db.portalArtistAccess.upsert({ where:{ shop_customerId_artistId:{ shop:session.shop, customerId, artistId:artist.id } }, create:{ shop:session.shop, customerId, artistId:artist.id, role:"OWNER" }, update:{} });
      }
      await db.portalCustomerPolicy.upsert({
        where: { shop_customerId: { shop:session.shop, customerId } },
        create: { shop:session.shop, customerId, artistMode, soloArtistId },
        update: { artistMode, soloArtistId },
      });
      return Response.json({ ok:true, message:artistMode === "SOLO" ? "Customer locked to the selected solo artist." : "Customer can now submit for multiple artists." });
    }

    if (intent !== "assign-owner") return Response.json({ ok:false, error:"Unknown portal access action." }, { status:400 });
    const releaseId = String(form.get("releaseId") || "");
    const release = await db.release.findFirst({ where:{ id:releaseId, shop:session.shop }, include:{ artists:true } });
    if (!release) return Response.json({ ok:false, error:"Release not found." }, { status:404 });
    const raw = String(form.get("customerId") || "").trim();
    let ownerCustomerId = null;
    if (raw) { ownerCustomerId = customerNumericId(raw); const customer = await getShopifyCustomer(admin, ownerCustomerId); if (!customer) return Response.json({ ok:false, error:"Shopify customer not found." }, { status:404 }); }
    await db.$transaction(async (tx) => {
      await tx.release.update({ where:{ id:release.id }, data:{ ownerCustomerId } });
      if (ownerCustomerId) for (const assignment of release.artists.filter((item) => item.role === "PRIMARY")) await tx.portalArtistAccess.upsert({ where:{ shop_customerId_artistId:{ shop:session.shop, customerId:ownerCustomerId, artistId:assignment.artistId } }, create:{ shop:session.shop, customerId:ownerCustomerId, artistId:assignment.artistId, role:"OWNER" }, update:{} });
      await tx.submissionEvent.create({ data:{ releaseId:release.id, type:ownerCustomerId ? "PORTAL_OWNER_ASSIGNED" : "PORTAL_OWNER_CLEARED", message:ownerCustomerId ? `Portal ownership assigned to Shopify customer ${ownerCustomerId}.` : "Portal ownership cleared.", actorLabel:"Shopify admin" } });
    });
    return Response.json({ ok:true, message:ownerCustomerId ? "Release assigned to the customer portal." : "Portal owner cleared." });
  } catch (error) {
    console.error("ReleaseCore portal access failed", error);
    return Response.json({ ok:false, error:error instanceof Error ? error.message : "Could not update portal access." }, { status:500 });
  }
};
