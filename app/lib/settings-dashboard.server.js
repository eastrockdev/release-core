import db from "../db.server";
import { getCatalogSequenceState } from "./catalog.server";
import { isIsrcConfigured, isrcReferenceYear } from "./isrc";
import { getSequenceState } from "./isrc.server";
import { getReleaseCoreMetafieldStatus } from "./shopify-products.server";

export async function loadSettingsDashboard({ admin, shop }) {
  const settings = await db.appSettings.findUnique({ where: { shop } });
  const year = isrcReferenceYear();
  const sequenceState = await getSequenceState(shop, settings, year);
  const upcSequence = settings?.gs1CompanyPrefix
    ? await db.upcSequence.findUnique({
        where: {
          shop_companyPrefix: {
            shop,
            companyPrefix: settings.gs1CompanyPrefix,
          },
        },
      })
    : null;
  const catalogState = await getCatalogSequenceState(
    shop,
    settings,
    new Date().getFullYear(),
  );
  const metafields = await getReleaseCoreMetafieldStatus(admin);
  const [
    assignedCount,
    unassignedCount,
    upcAssigned,
    upcMissing,
    catalogAssigned,
    catalogMissing,
  ] = await Promise.all([
    db.track.count({ where: { release: { shop }, isrc: { not: null } } }),
    db.track.count({ where: { release: { shop }, isrc: null } }),
    db.release.count({ where: { shop, upc: { not: null } } }),
    db.release.count({ where: { shop, upc: null, status: "APPROVED" } }),
    db.release.count({ where: { shop, catalogNumber: { not: null } } }),
    db.release.count({
      where: { shop, catalogNumber: null, status: "APPROVED" },
    }),
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
}
