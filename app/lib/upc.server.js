import db from "../db.server";
import { buildUpc, maxItemReference, validateGs1CompanyPrefix } from "./upc";

export async function assignUpcToRelease({ releaseId, shop }) {
  return db.$transaction(async (tx) => {
    const release = await tx.release.findFirst({ where: { id: releaseId, shop } });
    if (!release) throw new Error("Release not found.");
    if (release.upc) return release.upc;

    const settings = await tx.appSettings.findUnique({ where: { shop } });
    if (settings?.upcMode !== "GS1") throw new Error("ReleaseCore UPC generation is not enabled in Settings.");
    const companyPrefix = validateGs1CompanyPrefix(settings.gs1CompanyPrefix);

    const sequence = await tx.upcSequence.upsert({
      where: { shop_companyPrefix: { shop, companyPrefix } },
      create: { shop, companyPrefix, nextItemReference: 1 },
      update: {},
    });
    const max = maxItemReference(companyPrefix);
    if (sequence.nextItemReference > max) throw new Error("This GS1 Company Prefix has exhausted its available Item References in ReleaseCore.");

    const upc = buildUpc({ companyPrefix, itemReference: sequence.nextItemReference });
    await tx.release.update({ where: { id: release.id }, data: { upc, upcAssignedAt: new Date() } });
    await tx.upcSequence.update({ where: { id: sequence.id }, data: { nextItemReference: sequence.nextItemReference + 1 } });
    await tx.submissionEvent.create({ data: { releaseId: release.id, type: "UPC_ASSIGNED", message: `UPC ${upc} assigned by ReleaseCore.`, actorLabel: "Shopify admin" } });
    return upc;
  });
}
