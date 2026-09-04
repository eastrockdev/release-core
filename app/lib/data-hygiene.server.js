import db from "../db.server";
import { deploymentProfileId } from "./deployment-profile.server";
import { publicError } from "./http-security.server";

const ARTIST_PROFILE_FIELDS = [
  "legalName", "email", "spotifyUrl", "appleMusicUrl", "websiteUrl",
  "imageUrl", "imageFileId", "biography", "pro", "ipi", "instagramUrl",
  "facebookUrl", "tiktokUrl", "youtubeUrl", "xUrl", "notes",
];
const CONTRIBUTOR_PROFILE_FIELDS = [
  "ownerCustomerId", "stageName", "email", "pro", "ipi", "publisherName", "notes",
];

const clean = (value) => String(value ?? "").trim() || null;
const normalizeIdentity = (value) =>
  clean(value)?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim() || "";
const normalizeUrl = (value) => {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/\/+$/, "");
  }
};
const sameValue = (a, b, normalizer = normalizeIdentity) => {
  const left = normalizer(a);
  const right = normalizer(b);
  return Boolean(left && right && left === right);
};
const confidence = (score) => (score >= 8 ? "HIGH" : "POSSIBLE");
const contributorName = (item) => item.stageName || item.legalName;

function duplicateArtists(artists) {
  const results = [];
  for (let i = 0; i < artists.length; i += 1) {
    for (let j = i + 1; j < artists.length; j += 1) {
      const a = artists[i];
      const b = artists[j];
      let score = 0;
      const signals = [];
      if (sameValue(a.spotifyUrl, b.spotifyUrl, normalizeUrl)) { score += 6; signals.push("Same Spotify profile"); }
      if (sameValue(a.appleMusicUrl, b.appleMusicUrl, normalizeUrl)) { score += 6; signals.push("Same Apple Music profile"); }
      if (sameValue(a.ipi, b.ipi)) { score += 6; signals.push("Same IPI"); }
      if (sameValue(a.email, b.email)) { score += 5; signals.push("Same email"); }
      if (sameValue(a.legalName, b.legalName)) { score += 3; signals.push("Same legal name"); }
      if (sameValue(a.name, b.name)) { score += 2; signals.push("Same artist name"); }
      if (score >= 5) {
        results.push({
          source: { id: a.id, name: a.name }, target: { id: b.id, name: b.name },
          score, confidence: confidence(score), signals,
        });
      }
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 50);
}

function duplicateContributors(contributors) {
  const results = [];
  for (let i = 0; i < contributors.length; i += 1) {
    for (let j = i + 1; j < contributors.length; j += 1) {
      const a = contributors[i];
      const b = contributors[j];
      let score = 0;
      const signals = [];
      if (sameValue(a.ipi, b.ipi)) { score += 6; signals.push("Same IPI"); }
      if (sameValue(a.email, b.email)) { score += 5; signals.push("Same email"); }
      if (sameValue(a.legalName, b.legalName)) { score += 3; signals.push("Same legal name"); }
      if (sameValue(a.stageName, b.stageName)) { score += 3; signals.push("Same stage name"); }
      if (score >= 5) {
        results.push({
          source: { id: a.id, name: contributorName(a) },
          target: { id: b.id, name: contributorName(b) },
          score, confidence: confidence(score), signals,
        });
      }
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 50);
}

function identityCandidates(artists, contributors, existingLinks) {
  const existing = new Map(existingLinks.map((row) => [`${row.artistId}:${row.contributorId}`, row.relationshipType]));
  const results = [];
  for (const artist of artists) {
    for (const contributor of contributors) {
      const existingType = existing.get(`${artist.id}:${contributor.id}`);
      if (existingType === "SAME_PERSON") continue;
      let score = 0;
      const signals = [];
      if (sameValue(artist.ipi, contributor.ipi)) { score += 7; signals.push("Same IPI"); }
      if (sameValue(artist.email, contributor.email)) { score += 6; signals.push("Same email"); }
      if (sameValue(artist.legalName, contributor.legalName)) { score += 4; signals.push("Legal names match"); }
      if (sameValue(artist.name, contributor.stageName)) { score += 4; signals.push("Stage names match"); }
      if (score >= 6) {
        results.push({
          artist: { id: artist.id, name: artist.name },
          contributor: { id: contributor.id, name: contributorName(contributor) },
          alreadyLinked: existingType === "REGULAR",
          score, confidence: confidence(score), signals,
        });
      }
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 50);
}

function expectedArtistName(release) {
  const ordered = [...(release.artists || [])].sort((a, b) => a.position - b.position);
  const first = ordered.find((item) => item.role === "PRIMARY") || ordered[0] || null;
  return first?.artist?.name || null;
}

function fillMissing(target, source, fields) {
  const data = {};
  for (const field of fields) {
    if (target[field] == null && source[field] != null) data[field] = source[field];
  }
  return data;
}

async function audit(tx, data) {
  return tx.dataMaintenanceEvent.create({
    data: { deploymentProfile: deploymentProfileId(), ...data },
  });
}

export async function scanDataHygiene({ shop }) {
  const [artists, contributors, releases, links, releaseArtists, trackArtists, trackCredits, portalAccess] =
    await Promise.all([
      db.artist.findMany({
        where: { shop }, orderBy: { name: "asc" },
        include: { _count: { select: { releases: true, tracks: true, portalAccess: true, soloPortalPolicies: true, contributors: true } } },
      }),
      db.contributor.findMany({
        where: { shop }, orderBy: { legalName: "asc" },
        include: { _count: { select: { credits: true, artists: true } } },
      }),
      db.release.findMany({
        where: { shop },
        select: { id: true, title: true, artistName: true, artists: { select: { role: true, position: true, artist: { select: { name: true } } } } },
      }),
      db.artistContributor.findMany({
        where: { artist: { shop } },
        select: { artistId: true, contributorId: true, relationshipType: true, artist: { select: { shop: true, name: true } }, contributor: { select: { shop: true, stageName: true, legalName: true } } },
      }),
      db.releaseArtist.findMany({
        where: { release: { shop } },
        select: { id: true, artist: { select: { shop: true, name: true } }, release: { select: { title: true } } },
      }),
      db.trackArtist.findMany({
        where: { track: { release: { shop } } },
        select: { id: true, artist: { select: { shop: true, name: true } }, track: { select: { title: true } } },
      }),
      db.trackCredit.findMany({
        where: { track: { release: { shop } } },
        select: { id: true, contributor: { select: { shop: true } }, track: { select: { title: true } } },
      }),
      db.portalArtistAccess.findMany({
        where: { shop }, select: { id: true, artist: { select: { shop: true, name: true } } },
      }),
    ]);

  const artistDuplicates = duplicateArtists(artists);
  const contributorDuplicates = duplicateContributors(contributors);
  const unusedArtists = artists.filter((a) =>
    a._count.releases === 0 && a._count.tracks === 0 && a._count.portalAccess === 0 &&
    a._count.soloPortalPolicies === 0 && a._count.contributors === 0 && !a.shopifyCollectionId);
  const unusedContributors = contributors.filter((c) => c._count.credits === 0 && c._count.artists === 0 && !c.ownerCustomerId);
  const cacheDrift = releases.map((release) => ({
    id: release.id, title: release.title, current: release.artistName || null, expected: expectedArtistName(release),
  })).filter((row) => row.current !== row.expected);
  const localShopifyIssues = artists.filter((artist) =>
    (artist.shopifyCollectionId && !artist.shopifyCollectionHandle) ||
    (!artist.shopifyCollectionId && artist.shopifyCollectionHandle))
    .map((artist) => ({ artistId: artist.id, artistName: artist.name }));

  const tenantIssues = [];
  for (const row of releaseArtists) if (row.artist.shop !== shop) tenantIssues.push({ type: "RELEASE_ARTIST", id: row.id, message: `${row.release.title} references artist ${row.artist.name} from another shop.` });
  for (const row of trackArtists) if (row.artist.shop !== shop) tenantIssues.push({ type: "TRACK_ARTIST", id: row.id, message: `${row.track.title} references artist ${row.artist.name} from another shop.` });
  for (const row of trackCredits) if (row.contributor.shop !== shop) tenantIssues.push({ type: "TRACK_CREDIT", id: row.id, message: `${row.track.title} references a contributor from another shop.` });
  for (const row of links) if (row.artist.shop !== shop || row.contributor.shop !== shop) tenantIssues.push({ type: "ARTIST_CONTRIBUTOR", id: `${row.artistId}:${row.contributorId}`, message: `${row.artist.name} has a cross-shop contributor relationship.` });
  for (const row of portalAccess) if (row.artist.shop !== shop) tenantIssues.push({ type: "PORTAL_ACCESS", id: row.id, message: `Portal access points to artist ${row.artist.name} from another shop.` });

  const recentEvents = await db.dataMaintenanceEvent.findMany({
    where: { shop, deploymentProfile: deploymentProfileId() },
    orderBy: { createdAt: "desc" }, take: 25,
  });

  return {
    summary: {
      artists: artists.length, contributors: contributors.length,
      duplicateArtists: artistDuplicates.length, duplicateContributors: contributorDuplicates.length,
      unusedArtists: unusedArtists.length, unusedContributors: unusedContributors.length,
      cacheDrift: cacheDrift.length, tenantIssues: tenantIssues.length,
      localShopifyIssues: localShopifyIssues.length,
    },
    artistOptions: artists.map((artist) => ({ id: artist.id, name: artist.name })),
    contributorOptions: contributors.map((c) => ({ id: c.id, name: contributorName(c) })),
    duplicateArtists: artistDuplicates,
    duplicateContributors: contributorDuplicates,
    identityCandidates: identityCandidates(artists, contributors, links),
    unusedArtists: unusedArtists.map((a) => ({ id: a.id, name: a.name, imageFileId: a.imageFileId || null })),
    unusedContributors: unusedContributors.map((c) => ({ id: c.id, name: contributorName(c) })),
    cacheDrift, tenantIssues, localShopifyIssues, recentEvents,
  };
}

async function assertArtistMergeTenantSafe({ shop, artistId }) {
  const [releaseRows, trackRows, accessRows, policyRows, contributorRows] = await Promise.all([
    db.releaseArtist.findMany({ where: { artistId }, select: { release: { select: { shop: true } } } }),
    db.trackArtist.findMany({ where: { artistId }, select: { track: { select: { release: { select: { shop: true } } } } } }),
    db.portalArtistAccess.findMany({ where: { artistId }, select: { shop: true } }),
    db.portalCustomerPolicy.findMany({ where: { soloArtistId: artistId }, select: { shop: true } }),
    db.artistContributor.findMany({ where: { artistId }, select: { contributor: { select: { shop: true } } } }),
  ]);
  const unsafe =
    releaseRows.some((row) => row.release.shop !== shop) ||
    trackRows.some((row) => row.track.release.shop !== shop) ||
    accessRows.some((row) => row.shop !== shop) ||
    policyRows.some((row) => row.shop !== shop) ||
    contributorRows.some((row) => row.contributor.shop !== shop);
  if (unsafe) throw publicError("This artist has cross-shop relationships. Resolve the tenant-integrity issue before merging.", { status: 409 });
}

async function assertContributorMergeTenantSafe({ shop, contributorId }) {
  const [credits, artistLinks] = await Promise.all([
    db.trackCredit.findMany({ where: { contributorId }, select: { track: { select: { release: { select: { shop: true } } } } } }),
    db.artistContributor.findMany({ where: { contributorId }, select: { artist: { select: { shop: true } } } }),
  ]);
  const unsafe =
    credits.some((row) => row.track.release.shop !== shop) ||
    artistLinks.some((row) => row.artist.shop !== shop);
  if (unsafe) throw publicError("This contributor has cross-shop relationships. Resolve the tenant-integrity issue before merging.", { status: 409 });
}

export async function previewArtistMerge({ shop, sourceId, targetId }) {
  if (!sourceId || !targetId || sourceId === targetId) throw publicError("Choose two different artist records.", { status: 400 });
  const include = { _count: { select: { releases: true, tracks: true, portalAccess: true, soloPortalPolicies: true, contributors: true } } };
  await Promise.all([
    assertArtistMergeTenantSafe({ shop, artistId: sourceId }),
    assertArtistMergeTenantSafe({ shop, artistId: targetId }),
  ]);
  const [source, target] = await Promise.all([
    db.artist.findFirst({ where: { id: sourceId, shop }, include }),
    db.artist.findFirst({ where: { id: targetId, shop }, include }),
  ]);
  if (!source || !target) throw publicError("Artist merge records were not found for this shop.", { status: 404 });
  const profileConflicts = ARTIST_PROFILE_FIELDS.filter((field) => source[field] != null && target[field] != null && String(source[field]) !== String(target[field]))
    .map((field) => ({ field, source: source[field], target: target[field] }));
  return {
    source, target, profileConflicts,
    collectionConflict: Boolean(source.shopifyCollectionId && target.shopifyCollectionId && source.shopifyCollectionId !== target.shopifyCollectionId),
    behavior: "The destination record wins on conflicting profile fields. Missing destination fields are filled from the source.",
  };
}


const ARTIST_ROLE_PRIORITY = new Map([
  ["PRIMARY", 0],
  ["FEATURED", 1],
]);

function preferredArtistRole(rows) {
  return [...rows]
    .sort((a, b) => {
      const aPriority = ARTIST_ROLE_PRIORITY.get(a.role) ?? 50;
      const bPriority = ARTIST_ROLE_PRIORITY.get(b.role) ?? 50;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return (a.position ?? 9999) - (b.position ?? 9999);
    })[0]?.role || "PRIMARY";
}

async function collapseReleaseArtistAssignments(
  tx,
  { releaseId, sourceId, targetId },
) {
  const rows = await tx.releaseArtist.findMany({
    where: {
      releaseId,
      artistId: { in: [sourceId, targetId] },
    },
    orderBy: { position: "asc" },
  });
  if (!rows.length) return;

  const role = preferredArtistRole(rows);
  const position = Math.min(...rows.map((row) => row.position ?? 1));
  const keeper =
    rows.find((row) => row.artistId === targetId && row.role === role) ||
    rows.find((row) => row.artistId === targetId) ||
    rows[0];

  for (const row of rows) {
    if (row.id !== keeper.id) {
      await tx.releaseArtist.delete({ where: { id: row.id } });
    }
  }

  await tx.releaseArtist.update({
    where: { id: keeper.id },
    data: { artistId: targetId, role, position },
  });
}

async function collapseTrackArtistAssignments(
  tx,
  { trackId, sourceId, targetId },
) {
  const rows = await tx.trackArtist.findMany({
    where: {
      trackId,
      artistId: { in: [sourceId, targetId] },
    },
    orderBy: { position: "asc" },
  });
  if (!rows.length) return;

  const role = preferredArtistRole(rows);
  const position = Math.min(...rows.map((row) => row.position ?? 1));
  const keeper =
    rows.find((row) => row.artistId === targetId && row.role === role) ||
    rows.find((row) => row.artistId === targetId) ||
    rows[0];

  for (const row of rows) {
    if (row.id !== keeper.id) {
      await tx.trackArtist.delete({ where: { id: row.id } });
    }
  }

  await tx.trackArtist.update({
    where: { id: keeper.id },
    data: { artistId: targetId, role, position },
  });
}

async function moveArtistRelationships(tx, { shop, sourceId, targetId }) {
  const releaseIds = new Set();
  const releaseRows = await tx.releaseArtist.findMany({
    where: { artistId: sourceId, release: { shop } },
    select: { releaseId: true },
  });
  for (const releaseId of new Set(releaseRows.map((row) => row.releaseId))) {
    releaseIds.add(releaseId);
    await collapseReleaseArtistAssignments(tx, {
      releaseId,
      sourceId,
      targetId,
    });
  }
  const trackRows = await tx.trackArtist.findMany({
    where: { artistId: sourceId, track: { release: { shop } } },
    select: {
      trackId: true,
      track: { select: { releaseId: true } },
    },
  });
  const trackReleaseIds = new Map(
    trackRows.map((row) => [row.trackId, row.track.releaseId]),
  );
  for (const [trackId, releaseId] of trackReleaseIds) {
    releaseIds.add(releaseId);
    await collapseTrackArtistAssignments(tx, {
      trackId,
      sourceId,
      targetId,
    });
  }
  const accessRows = await tx.portalArtistAccess.findMany({ where: { shop, artistId: sourceId } });
  for (const row of accessRows) {
    const duplicate = await tx.portalArtistAccess.findFirst({ where: { shop, customerId: row.customerId, artistId: targetId } });
    if (duplicate) await tx.portalArtistAccess.delete({ where: { id: row.id } });
    else await tx.portalArtistAccess.update({ where: { id: row.id }, data: { artistId: targetId } });
  }
  await tx.portalCustomerPolicy.updateMany({ where: { shop, soloArtistId: sourceId }, data: { soloArtistId: targetId } });
  const contributorRows = await tx.artistContributor.findMany({ where: { artistId: sourceId } });
  for (const row of contributorRows) {
    const duplicate = await tx.artistContributor.findFirst({ where: { artistId: targetId, contributorId: row.contributorId } });
    if (duplicate) {
      if (row.relationshipType === "SAME_PERSON" && duplicate.relationshipType !== "SAME_PERSON") {
        await tx.artistContributor.update({ where: { id: duplicate.id }, data: { relationshipType: "SAME_PERSON" } });
      }
      await tx.artistContributor.delete({ where: { id: row.id } });
    } else {
      await tx.artistContributor.update({ where: { id: row.id }, data: { artistId: targetId } });
    }
  }
  return [...releaseIds];
}

async function refreshArtistCaches(tx, releaseIds) {
  for (const releaseId of new Set(releaseIds)) {
    const assignments = await tx.releaseArtist.findMany({ where: { releaseId }, include: { artist: { select: { name: true } } }, orderBy: { position: "asc" } });
    const first = assignments.find((item) => item.role === "PRIMARY") || assignments[0] || null;
    await tx.release.update({ where: { id: releaseId }, data: { artistName: first?.artist?.name || null } });
  }
}

export async function mergeArtistIntoArtist({ shop, sourceId, targetId, collectionResolution, confirmed }) {
  if (!confirmed) throw publicError("Confirm the artist merge before continuing.", { status: 400 });
  const preview = await previewArtistMerge({ shop, sourceId, targetId });
  if (preview.collectionConflict && !["KEEP_TARGET", "KEEP_SOURCE"].includes(collectionResolution)) {
    throw publicError("Both artists have different Shopify collections. Choose which collection remains linked.", { status: 409 });
  }
  const { source, target } = preview;
  const result = await db.$transaction(async (tx) => {
    const releaseIds = await moveArtistRelationships(tx, { shop, sourceId, targetId });
    let collectionData = {};
    const transferSourceCollection = (!target.shopifyCollectionId && source.shopifyCollectionId) ||
      (preview.collectionConflict && collectionResolution === "KEEP_SOURCE");
    if (transferSourceCollection) {
      collectionData = {
        shopifyCollectionId: source.shopifyCollectionId,
        shopifyCollectionHandle: source.shopifyCollectionHandle,
        shopifyCollectionSourceId: source.shopifyCollectionSourceId,
        shopifyCollectionSyncedAt: source.shopifyCollectionSyncedAt,
      };
      await tx.artist.update({ where: { id: source.id }, data: {
        shopifyCollectionId: null, shopifyCollectionHandle: null,
        shopifyCollectionSourceId: null, shopifyCollectionSyncedAt: null,
      } });
    }
    await tx.artist.update({ where: { id: target.id }, data: {
      ...fillMissing(target, source, ARTIST_PROFILE_FIELDS), ...collectionData,
    } });
    await tx.artist.delete({ where: { id: source.id } });
    await refreshArtistCaches(tx, releaseIds);
    const event = await audit(tx, {
      shop, operation: "ARTIST_MERGE", entityType: "ARTIST", sourceId: source.id, targetId: target.id,
      summary: `Merged ${source.name} into ${target.name}.`,
      details: { affectedReleaseCount: releaseIds.length, sourceCollectionLeftInShopify: Boolean(source.shopifyCollectionId && !transferSourceCollection) },
    });
    return { eventId: event.id, targetId: target.id, targetName: target.name };
  });
  return { ...result, message: `Merged ${source.name} into ${target.name}.` };
}

export async function previewContributorMerge({ shop, sourceId, targetId }) {
  if (!sourceId || !targetId || sourceId === targetId) throw publicError("Choose two different contributor records.", { status: 400 });
  await Promise.all([
    assertContributorMergeTenantSafe({ shop, contributorId: sourceId }),
    assertContributorMergeTenantSafe({ shop, contributorId: targetId }),
  ]);
  const [source, target] = await Promise.all([
    db.contributor.findFirst({
      where: { id: sourceId, shop },
      include: { _count: { select: { credits: true, artists: true } }, credits: { include: { track: { select: { title: true, release: { select: { title: true } } } } } } },
    }),
    db.contributor.findFirst({ where: { id: targetId, shop }, include: { _count: { select: { credits: true, artists: true } }, credits: true } }),
  ]);
  if (!source || !target) throw publicError("Contributor merge records were not found for this shop.", { status: 404 });
  const targetCredits = new Map(target.credits.map((credit) => [`${credit.trackId}:${credit.role}`, credit]));
  const ownershipConflicts = source.credits.map((credit) => {
    const other = targetCredits.get(`${credit.trackId}:${credit.role}`);
    if (!other || credit.ownershipPercent == null || other.ownershipPercent == null || credit.ownershipPercent === other.ownershipPercent) return null;
    return {
      sourceCreditId: credit.id, targetCreditId: other.id, trackId: credit.trackId,
      trackTitle: credit.track.title, releaseTitle: credit.track.release.title, role: credit.role,
      sourcePercent: credit.ownershipPercent, targetPercent: other.ownershipPercent,
    };
  }).filter(Boolean);
  const ownerCustomerConflict =
    source.ownerCustomerId &&
    target.ownerCustomerId &&
    source.ownerCustomerId !== target.ownerCustomerId
      ? {
          sourceCustomerId: source.ownerCustomerId,
          targetCustomerId: target.ownerCustomerId,
        }
      : null;

  return {
    source,
    target,
    ownershipConflicts,
    ownerCustomerConflict,
    behavior:
      "The destination record wins on conflicting identity fields. Missing destination fields are filled from the source.",
  };
}

function resolveOwnership(conflict, resolutions, customValues) {
  const choice = resolutions?.[conflict.sourceCreditId];
  if (choice === "TARGET") return conflict.targetPercent;
  if (choice === "SOURCE") return conflict.sourcePercent;
  if (choice === "CUSTOM") {
    const value = Number(customValues?.[conflict.sourceCreditId]);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw publicError(`Enter a valid ownership percentage for ${conflict.trackTitle}.`, { status: 400 });
    return value;
  }
  throw publicError(`Resolve the ownership conflict for ${conflict.trackTitle} before merging.`, { status: 409 });
}

export async function mergeContributorIntoContributor({
  shop,
  sourceId,
  targetId,
  resolutions = {},
  customValues = {},
  ownerCustomerResolution,
  confirmed,
}) {
  if (!confirmed) throw publicError("Confirm the contributor merge before continuing.", { status: 400 });
  const preview = await previewContributorMerge({ shop, sourceId, targetId });
  if (
    preview.ownerCustomerConflict &&
    !["KEEP_TARGET", "KEEP_SOURCE"].includes(ownerCustomerResolution)
  ) {
    throw publicError(
      "Both contributors are linked to different customer owners. Choose which customer ownership remains.",
      { status: 409 },
    );
  }
  for (const conflict of preview.ownershipConflicts) resolveOwnership(conflict, resolutions, customValues);
  const conflictMap = new Map(preview.ownershipConflicts.map((item) => [item.sourceCreditId, item]));
  const { source, target } = preview;
  const result = await db.$transaction(async (tx) => {
    const credits = await tx.trackCredit.findMany({ where: { contributorId: source.id, track: { release: { shop } } } });
    for (const credit of credits) {
      const duplicate = await tx.trackCredit.findFirst({ where: { trackId: credit.trackId, contributorId: target.id, role: credit.role } });
      if (!duplicate) {
        await tx.trackCredit.update({ where: { id: credit.id }, data: { contributorId: target.id } });
        continue;
      }
      let ownershipPercent = duplicate.ownershipPercent;
      if (duplicate.ownershipPercent == null && credit.ownershipPercent != null) ownershipPercent = credit.ownershipPercent;
      else if (conflictMap.has(credit.id)) ownershipPercent = resolveOwnership(conflictMap.get(credit.id), resolutions, customValues);
      if (ownershipPercent !== duplicate.ownershipPercent) await tx.trackCredit.update({ where: { id: duplicate.id }, data: { ownershipPercent } });
      await tx.trackCredit.delete({ where: { id: credit.id } });
    }
    const artistLinks = await tx.artistContributor.findMany({ where: { contributorId: source.id, artist: { shop } } });
    for (const link of artistLinks) {
      const duplicate = await tx.artistContributor.findFirst({ where: { artistId: link.artistId, contributorId: target.id } });
      if (duplicate) {
        if (link.relationshipType === "SAME_PERSON" && duplicate.relationshipType !== "SAME_PERSON") await tx.artistContributor.update({ where: { id: duplicate.id }, data: { relationshipType: "SAME_PERSON" } });
        await tx.artistContributor.delete({ where: { id: link.id } });
      } else {
        await tx.artistContributor.update({ where: { id: link.id }, data: { contributorId: target.id } });
      }
    }
    const contributorUpdate = fillMissing(
      target,
      source,
      CONTRIBUTOR_PROFILE_FIELDS,
    );
    if (
      preview.ownerCustomerConflict &&
      ownerCustomerResolution === "KEEP_SOURCE"
    ) {
      contributorUpdate.ownerCustomerId = source.ownerCustomerId;
    }
    await tx.contributor.update({
      where: { id: target.id },
      data: contributorUpdate,
    });
    await tx.contributor.delete({ where: { id: source.id } });
    const event = await audit(tx, {
      shop, operation: "CONTRIBUTOR_MERGE", entityType: "CONTRIBUTOR", sourceId: source.id, targetId: target.id,
      summary: `Merged ${contributorName(source)} into ${contributorName(target)}.`,
      details: {
        resolvedOwnershipConflicts: preview.ownershipConflicts.length,
        ownerCustomerResolution:
          preview.ownerCustomerConflict
            ? ownerCustomerResolution
            : null,
      },
    });
    return { eventId: event.id, targetId: target.id, targetName: contributorName(target) };
  });
  return { ...result, message: `Merged ${contributorName(source)} into ${contributorName(target)}.` };
}

export async function linkArtistContributorIdentity({ shop, artistId, contributorId }) {
  const [artist, contributor] = await Promise.all([
    db.artist.findFirst({ where: { id: artistId, shop } }),
    db.contributor.findFirst({ where: { id: contributorId, shop } }),
  ]);
  if (!artist || !contributor) throw publicError("Artist or contributor was not found for this shop.", { status: 404 });
  await db.$transaction(async (tx) => {
    await tx.artistContributor.upsert({
      where: { artistId_contributorId: { artistId, contributorId } },
      create: { artistId, contributorId, relationshipType: "SAME_PERSON" },
      update: { relationshipType: "SAME_PERSON" },
    });
    await audit(tx, {
      shop, operation: "IDENTITY_LINK", entityType: "ARTIST_CONTRIBUTOR", sourceId: artistId, targetId: contributorId,
      summary: `Linked ${artist.name} to ${contributorName(contributor)} as the same person.`,
    });
  });
  return { message: `${artist.name} and ${contributorName(contributor)} are now marked as the same person.` };
}

export async function deleteUnusedArtist({ shop, artistId }) {
  const artist = await db.artist.findFirst({
    where: { id: artistId, shop },
    include: { _count: { select: { releases: true, tracks: true, portalAccess: true, soloPortalPolicies: true, contributors: true } } },
  });
  if (!artist) throw publicError("Artist not found.", { status: 404 });
  if (artist._count.releases || artist._count.tracks || artist._count.portalAccess || artist._count.soloPortalPolicies || artist._count.contributors || artist.shopifyCollectionId) {
    throw publicError("This artist is no longer unused. Refresh Data Maintenance before deleting it.", { status: 409 });
  }
  await db.$transaction(async (tx) => {
    await audit(tx, {
      shop, operation: "UNUSED_RECORD_DELETED", entityType: "ARTIST", sourceId: artist.id,
      summary: `Deleted unused artist ${artist.name}.`, details: { shopifyImageLeftUntouched: Boolean(artist.imageFileId) },
    });
    await tx.artist.delete({ where: { id: artist.id } });
  });
  return { message: `${artist.name} was removed from ReleaseCore. Shopify files were left untouched.` };
}

export async function deleteUnusedContributor({ shop, contributorId }) {
  const contributor = await db.contributor.findFirst({ where: { id: contributorId, shop }, include: { _count: { select: { credits: true, artists: true } } } });
  if (!contributor) throw publicError("Contributor not found.", { status: 404 });
  if (contributor._count.credits || contributor._count.artists || contributor.ownerCustomerId) throw publicError("This contributor is no longer unused. Refresh Data Maintenance before deleting it.", { status: 409 });
  await db.$transaction(async (tx) => {
    await audit(tx, { shop, operation: "UNUSED_RECORD_DELETED", entityType: "CONTRIBUTOR", sourceId: contributor.id, summary: `Deleted unused contributor ${contributorName(contributor)}.` });
    await tx.contributor.delete({ where: { id: contributor.id } });
  });
  return { message: `${contributorName(contributor)} was removed from ReleaseCore.` };
}

export async function repairArtistNameCaches({ shop }) {
  const releases = await db.release.findMany({
    where: { shop },
    select: { id: true, title: true, artistName: true, artists: { select: { role: true, position: true, artist: { select: { name: true } } } } },
  });
  const drift = releases.map((release) => ({ ...release, expected: expectedArtistName(release) }))
    .filter((release) => (release.artistName || null) !== release.expected);
  if (!drift.length) return { repaired: 0, message: "Artist-name caches are already consistent." };
  await db.$transaction(async (tx) => {
    for (const release of drift) await tx.release.update({ where: { id: release.id }, data: { artistName: release.expected } });
    await audit(tx, {
      shop, operation: "CACHE_REPAIR", entityType: "RELEASE",
      summary: `Repaired ${drift.length} release artist-name cache entr${drift.length === 1 ? "y" : "ies"}.`,
      details: { releaseIds: drift.map((release) => release.id) },
    });
  });
  return { repaired: drift.length, message: `Repaired ${drift.length} release artist-name cache entr${drift.length === 1 ? "y" : "ies"}.` };
}
