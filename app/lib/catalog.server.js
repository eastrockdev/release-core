import db from "../db.server";
import { buildCatalogNumber, normalizeCatalogPrefix } from "./catalog";

function yearKey(settings, year = new Date().getFullYear()) {
  return settings?.catalogIncludeYear === false ? 0 : year;
}

export async function getCatalogSequenceState(shop, settings, year = new Date().getFullYear()) {
  const prefix = normalizeCatalogPrefix(settings?.catalogPrefix);
  if (!prefix) return { prefix: "", yearKey: yearKey(settings, year), nextSequence: 1 };
  const key = yearKey(settings, year);
  const sequence = await db.catalogSequence.findUnique({ where: { shop_prefix_yearKey: { shop, prefix, yearKey: key } } });
  return { prefix, yearKey: key, nextSequence: sequence?.nextSequence || 1 };
}

export async function minimumSafeCatalogSequence(shop, settings, year = new Date().getFullYear()) {
  const prefix = normalizeCatalogPrefix(settings?.catalogPrefix);
  if (!prefix) return 1;
  const includeYear = settings?.catalogIncludeYear !== false;
  const width = Number(settings?.catalogSequenceWidth || 4);
  const stem = `${prefix}${includeYear ? String(year).slice(-2) : ""}`;
  const releases = await db.release.findMany({ where: { shop, catalogNumber: { startsWith: stem } }, select: { catalogNumber: true } });
  let max = 0;
  for (const release of releases) {
    const value = String(release.catalogNumber || "");
    const suffix = value.slice(stem.length);
    if (!/^\d+$/.test(suffix)) continue;
    max = Math.max(max, Number(suffix));
  }
  return Math.min(max + 1, (10 ** width) - 1);
}

export async function assignCatalogNumberToRelease({ releaseId, shop }) {
  return db.$transaction(async (tx) => {
    const release = await tx.release.findFirst({ where: { id: releaseId, shop } });
    if (!release) throw new Error("Release not found.");
    if (release.catalogNumber) return release.catalogNumber;
    const settings = await tx.appSettings.findUnique({ where: { shop } });
    if ((settings?.catalogMode || "AUTO") !== "AUTO") throw new Error("Catalog numbers are configured for manual entry.");
    const prefix = normalizeCatalogPrefix(settings?.catalogPrefix);
    if (!prefix) throw new Error("Configure a catalog number prefix in Settings first.");
    const includeYear = settings?.catalogIncludeYear !== false;
    const width = Number(settings?.catalogSequenceWidth || 4);
    const year = new Date().getFullYear();
    const key = includeYear ? year : 0;
    let sequence = await tx.catalogSequence.findUnique({ where: { shop_prefix_yearKey: { shop, prefix, yearKey: key } } });
    if (!sequence) sequence = await tx.catalogSequence.create({ data: { shop, prefix, yearKey: key, nextSequence: 1 } });
    const code = buildCatalogNumber({ prefix, includeYear, year, sequence: sequence.nextSequence, width });
    const duplicate = await tx.release.findFirst({ where: { shop, catalogNumber: code } });
    if (duplicate) throw new Error(`Catalog number ${code} is already in use.`);
    await tx.release.update({ where: { id: release.id }, data: { catalogNumber: code, catalogNumberAssignedAt: new Date() } });
    await tx.catalogSequence.update({ where: { id: sequence.id }, data: { nextSequence: sequence.nextSequence + 1 } });
    await tx.submissionEvent.create({ data: { releaseId: release.id, type: "CATALOG_NUMBER_ASSIGNED", message: `Catalog number ${code} assigned.`, actorLabel: "ReleaseCore" } });
    return code;
  });
}
