import db from "../db.server";
import { CREDIT_ROLES, isPublishingRole, isValidReleaseType, starterTitle, typeLabel } from "./releasecore";
import { FILE_KINDS, fileContentTypeForKind, isReplaceableKind, stagedResourceForKind, validateUploadDescriptor } from "./releasecore-files";
import { maybeAutoAssignIsrc } from "./isrc.server";
import { calculateReleaseReadiness, releaseCanSubmit, releaseIsEditable } from "./workflow";
import {
  createR2MasterUploadTarget,
  deleteLocalStorageKey,
  deleteR2StorageKey,
  masterStorageProvider,
  saveMasterStream,
  verifyR2MasterObject,
} from "./storage.server";
import { dispatchLatestEvent, portalReleaseAccess } from "./automations.server";
import { releaseDatePolicy, releaseDateOnly, validateReleaseDateLeadTime } from "./release-date";

export function portalIdentity(request, session) {
  const url = new URL(request.url);
  const shop = session?.shop || url.searchParams.get("shop") || "";
  const customerId = url.searchParams.get("logged_in_customer_id") || "";
  return { shop, customerId, url };
}

export function requirePortalCustomer(identity) {
  if (!identity.shop) throw new Response("Shop not found.", { status: 400 });
  if (!identity.customerId) {
    throw Response.json({ ok: false, loginRequired: true, error: "Sign in to manage your releases." }, { status: 401 });
  }
}

export async function getPortalRelease({ shop, customerId, releaseId, include = {}, previewAll = false }) {
  return db.release.findFirst({
    where: previewAll ? { id: releaseId, shop } : { id: releaseId, shop, ownerCustomerId: customerId },
    include,
  });
}

async function resolveCoverUrls(admin, releases) {
  if (!admin) return releases;
  const unresolved = [];
  for (const release of releases) {
    const cover = (release.files || []).find((file) => file.kind === FILE_KINDS.COVER_ART);
    if (cover?.url || !cover?.storageKey?.startsWith("gid://shopify/")) continue;
    unresolved.push(cover);
  }
  if (!unresolved.length) return releases;

  try {
    const response = await admin.graphql(
      `#graphql
        query ReleaseCorePortalFiles($ids: [ID!]!) {
          nodes(ids: $ids) {
            id
            ... on MediaImage { fileStatus image { url } }
            ... on GenericFile { fileStatus url }
          }
        }`,
      { variables: { ids: [...new Set(unresolved.map((file) => file.storageKey))] } },
    );
    const json = await response.json();
    const map = new Map((json?.data?.nodes || []).filter(Boolean).map((node) => [node.id, node]));
    for (const file of unresolved) {
      const node = map.get(file.storageKey);
      const url = node?.image?.url || node?.url || null;
      if (url) {
        file.url = url;
        db.releaseFile.update({ where: { id: file.id }, data: { url, status: node.fileStatus || file.status } }).catch(() => {});
      }
    }
  } catch (error) {
    console.warn("ReleaseCore portal: cover URL refresh skipped", error);
  }
  return releases;
}

function summary(release) {
  const cover = (release.files || []).find((file) => file.kind === FILE_KINDS.COVER_ART);
  return {
    id: release.id,
    type: release.type,
    title: release.title,
    status: release.status,
    distributionStatus: release.distributionStatus,
    releaseDate: release.releaseDate,
    updatedAt: release.updatedAt,
    primaryGenre: release.primaryGenre,
    trackCount: release._count?.tracks ?? release.tracks?.length ?? 0,
    coverUrl: cover?.url || null,
    artistNames: (release.artists || []).filter((item) => item.role === "PRIMARY").map((item) => item.artist?.name).filter(Boolean),
    openReviewItems: release._count?.reviewItems ?? (release.reviewItems || []).filter((item) => item.status === "OPEN").length,
  };
}

export async function listPortalReleases({ shop, customerId, admin, limit, previewAll = false }) {
  const releases = await db.release.findMany({
    where: previewAll ? { shop } : { shop, ownerCustomerId: customerId },
    orderBy: { updatedAt: "desc" },
    ...(limit ? { take: Math.max(1, Math.min(Number(limit) || 4, 12)) } : {}),
    include: {
      files: { where: { kind: FILE_KINDS.COVER_ART } },
      artists: { include: { artist: true }, orderBy: { position: "asc" } },
      _count: { select: { tracks: true, reviewItems: { where: { status: "OPEN" } } } },
    },
  });
  await resolveCoverUrls(admin, releases);
  return releases.map(summary);
}

export async function portalReleaseDetail({ shop, customerId, releaseId, admin, previewAll = false }) {
  const release = await getPortalRelease({
    shop,
    customerId,
    releaseId,
    previewAll,
    include: {
      files: { orderBy: { createdAt: "asc" } },
      artists: { include: { artist: true }, orderBy: { position: "asc" } },
      tracks: {
        orderBy: { position: "asc" },
        include: {
          files: { orderBy: { createdAt: "asc" } },
          artists: { include: { artist: true }, orderBy: { position: "asc" } },
          credits: { include: { contributor: true }, orderBy: { createdAt: "asc" } },
        },
      },
      reviewItems: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!release) return null;
  await resolveCoverUrls(admin, [release]);
  const settings = (await db.appSettings.findUnique({ where: { shop } })) || {};
  const readiness = calculateReleaseReadiness(release, settings);
  const datePolicy = releaseDatePolicy(settings);
  const releaseDate = releaseDateOnly(release.releaseDate);
  const leadTimeCheck = validateReleaseDateLeadTime(releaseDate, settings);
  readiness.checks.releaseDateLeadTimeReady = !datePolicy.enabled || Boolean(releaseDate && leadTimeCheck.ok);
  if (releaseDate && !leadTimeCheck.ok) {
    readiness.ready = false;
    readiness.blockers = [
      { code: "RELEASE_LEAD_TIME", message: leadTimeCheck.message },
      ...readiness.blockers.filter((item) => item.code !== "RELEASE_LEAD_TIME"),
    ];
  }
  return {
    ...release,
    editable: previewAll ? false : releaseIsEditable(release.status),
    canSubmit: previewAll ? false : releaseCanSubmit(release.status),
    previewMode: previewAll,
    readiness,
    releaseDatePolicy: datePolicy,
  };
}

export async function findOrCreatePortalArtist({ shop, customerId, name }) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Enter the primary artist name.");

  const existing = await db.portalArtistAccess.findFirst({
    where: { shop, customerId, artist: { name: cleanName } },
    include: { artist: true },
  });
  if (existing?.artist) return existing.artist;

  return db.artist.create({
    data: {
      shop,
      name: cleanName,
      portalAccess: { create: { shop, customerId, role: "OWNER" } },
    },
  });
}

export async function createPortalRelease({ admin, shop, customerId, type, title, artistName }) {
  const normalizedType = String(type || "").toUpperCase();
  if (!isValidReleaseType(normalizedType)) throw new Error("Choose Single, EP or Album.");
  const access = await portalReleaseAccess({ admin, shop, customerId });
  const eligibility = access.options?.[normalizedType];
  if (!eligibility?.allowed) throw new Error(eligibility?.reason || "Your account does not have access to this release type.");
  const cleanTitle = String(title || "").trim();
  const releaseTitle = cleanTitle || starterTitle(normalizedType);
  let artist;
  if (access.artistAccess?.mode === "SOLO") {
    if (!access.artistAccess?.soloArtist?.id) throw new Error("Your account is configured for solo-artist access, but an artist profile has not been assigned yet. Contact the store administrator.");
    artist = await db.artist.findFirst({ where: { id: access.artistAccess.soloArtist.id, shop } });
    if (!artist) throw new Error("Your assigned solo artist profile could not be found.");
  } else {
    artist = await findOrCreatePortalArtist({ shop, customerId, name: artistName });
  }
  const settings = await db.appSettings.findUnique({ where: { shop } });

  const release = await db.release.create({
    data: {
      shop,
      ownerCustomerId: customerId,
      type: normalizedType,
      title: releaseTitle,
      status: "DRAFT",
      primaryGenre: settings?.defaultGenre || null,
      artistName: artist.name,
      artists: { create: { artistId: artist.id, role: "PRIMARY", position: 1 } },
      tracks: {
        create: {
          position: 1,
          title: normalizedType === "SINGLE" && cleanTitle ? cleanTitle : "Untitled Track",
          language: settings?.defaultLanguage || null,
          artists: { create: { artistId: artist.id, role: "PRIMARY", position: 1 } },
        },
      },
      events: { create: { type: "DRAFT_CREATED", actorLabel: "Artist portal", message: `${typeLabel(normalizedType)} draft created from the storefront.` } },
    },
    include: { tracks: true },
  });

  if (release.tracks[0]) {
    try { await maybeAutoAssignIsrc({ trackId: release.tracks[0].id, shop }); }
    catch (error) { console.warn("ReleaseCore portal: automatic ISRC assignment skipped", error); }
  }
  return release;
}

export async function updatePortalRelease({ shop, customerId, releaseId, formData }) {
  const release = await getPortalRelease({ shop, customerId, releaseId });
  if (!release) throw new Error("Release not found.");
  if (!releaseIsEditable(release.status)) throw new Error("This release is locked while it is under review or finalized.");
  const title = String(formData.get("title") || "").trim();
  const primaryGenre = String(formData.get("primaryGenre") || "").trim() || null;
  const releaseDateRaw = String(formData.get("releaseDate") || "").trim();
  if (!title) throw new Error("Release title is required.");
  const settings = (await db.appSettings.findUnique({ where: { shop } })) || {};
  if (releaseDateRaw && !/^\d{4}-\d{2}-\d{2}$/.test(releaseDateRaw)) throw new Error("Choose a valid release date.");
  const leadTime = validateReleaseDateLeadTime(releaseDateRaw || null, settings);
  if (!leadTime.ok) throw new Error(leadTime.message);
  return db.release.update({
    where: { id: release.id },
    data: { title, primaryGenre, releaseDate: releaseDateRaw ? new Date(`${releaseDateRaw}T12:00:00.000Z`) : null },
  });
}

export async function addPortalTrack({ shop, customerId, releaseId }) {
  const release = await getPortalRelease({
    shop,
    customerId,
    releaseId,
    include: { tracks: true, artists: { where: { role: "PRIMARY" }, orderBy: { position: "asc" } } },
  });
  if (!release) throw new Error("Release not found.");
  if (!releaseIsEditable(release.status)) throw new Error("This release is locked.");
  if (release.type === "SINGLE") throw new Error("Singles can only contain one track.");
  const settings = await db.appSettings.findUnique({ where: { shop } });
  const position = Math.max(0, ...release.tracks.map((track) => track.position)) + 1;
  const track = await db.track.create({
    data: {
      releaseId,
      position,
      title: "Untitled Track",
      language: settings?.defaultLanguage || null,
      artists: {
        create: release.artists.map((assignment, index) => ({
          artistId: assignment.artistId,
          role: "PRIMARY",
          position: index + 1,
        })),
      },
    },
  });
  try { await maybeAutoAssignIsrc({ trackId: track.id, shop }); }
  catch (error) { console.warn("ReleaseCore portal: automatic ISRC assignment skipped", error); }
  return track;
}

export async function updatePortalTrack({ shop, customerId, releaseId, trackId, formData }) {
  const release = await getPortalRelease({ shop, customerId, releaseId, include: { tracks: true } });
  if (!release) throw new Error("Release not found.");
  if (!releaseIsEditable(release.status)) throw new Error("This release is locked.");
  const track = release.tracks.find((item) => item.id === trackId);
  if (!track) throw new Error("Track not found.");
  const title = String(formData.get("title") || "").trim();
  if (!title) throw new Error("Track title is required.");
  return db.track.update({
    where: { id: track.id },
    data: {
      title,
      version: String(formData.get("version") || "").trim() || null,
      language: String(formData.get("language") || "").trim() || null,
      explicit: String(formData.get("explicit") || "") === "true",
      lyrics: String(formData.get("lyrics") || "").trim() || null,
    },
  });
}

export async function addPortalCredit({ shop, customerId, releaseId, trackId, formData }) {
  const release = await getPortalRelease({ shop, customerId, releaseId, include: { tracks: true } });
  if (!release) throw new Error("Release not found.");
  if (!releaseIsEditable(release.status)) throw new Error("This release is locked.");
  if (!release.tracks.some((track) => track.id === trackId)) throw new Error("Track not found.");
  const role = String(formData.get("role") || "").toUpperCase();
  if (!CREDIT_ROLES.includes(role)) throw new Error("Choose a valid credit role.");
  const legalName = String(formData.get("legalName") || "").trim();
  if (!legalName) throw new Error("Contributor legal name is required.");
  const ownershipRaw = String(formData.get("ownershipPercent") || "").trim();
  const ownershipPercent = ownershipRaw === "" ? null : Number(ownershipRaw);
  if (isPublishingRole(role) && (!Number.isFinite(ownershipPercent) || ownershipPercent < 0 || ownershipPercent > 100)) {
    throw new Error("Songwriter/composer ownership must be between 0 and 100%.");
  }

  let contributor = await db.contributor.findFirst({ where: { shop, ownerCustomerId: customerId, legalName } });
  const contributorData = {
    stageName: String(formData.get("stageName") || "").trim() || null,
    pro: String(formData.get("pro") || "").trim() || null,
    ipi: String(formData.get("ipi") || "").trim() || null,
  };
  if (contributor) contributor = await db.contributor.update({ where: { id: contributor.id }, data: contributorData });
  else contributor = await db.contributor.create({ data: { shop, ownerCustomerId: customerId, legalName, ...contributorData } });

  if (isPublishingRole(role)) {
    const existingCredits = await db.trackCredit.findMany({ where: { trackId, role: { in: ["SONGWRITER", "COMPOSER"] }, NOT: { contributorId: contributor.id, role } } });
    const total = existingCredits.reduce((sum, item) => sum + (item.ownershipPercent || 0), 0) + (ownershipPercent || 0);
    if (total > 100.00001) throw new Error(`Publishing ownership cannot exceed 100%. Current result would be ${total}%.`);
  }

  return db.trackCredit.upsert({
    where: { trackId_contributorId_role: { trackId, contributorId: contributor.id, role } },
    update: { ownershipPercent },
    create: { trackId, contributorId: contributor.id, role, ownershipPercent },
  });
}

export async function removePortalCredit({ shop, customerId, releaseId, trackId, creditId }) {
  const release = await getPortalRelease({ shop, customerId, releaseId, include: { tracks: true } });
  if (!release) throw new Error("Release not found.");
  if (!releaseIsEditable(release.status)) throw new Error("This release is locked.");
  if (!release.tracks.some((track) => track.id === trackId)) throw new Error("Track not found.");
  const credit = await db.trackCredit.findFirst({ where: { id: creditId, trackId } });
  if (!credit) throw new Error("Credit not found.");
  await db.trackCredit.delete({ where: { id: credit.id } });
}

export async function submitPortalRelease({ admin, shop, customerId, releaseId }) {
  const release = await portalReleaseDetail({ shop, customerId, releaseId });
  if (!release) throw new Error("Release not found.");
  if (!releaseCanSubmit(release.status)) throw new Error("This release cannot be submitted from its current status.");
  const unresolved = (release.reviewItems || []).filter((item) => item.status === "OPEN");
  if (release.status === "CHANGES_REQUESTED" && unresolved.length) {
    const error = new Error("Mark all requested corrections addressed before resubmitting.");
    error.blockers = unresolved.map((item) => ({ message: item.message, trackId: item.trackId }));
    throw error;
  }
  if (!release.readiness.ready) {
    const error = new Error("Finish the required release information before submitting.");
    error.blockers = release.readiness.blockers;
    throw error;
  }
  const now = new Date();
  const eventType = release.status === "CHANGES_REQUESTED" ? "RESUBMITTED" : "SUBMITTED";
  await db.$transaction([
    db.release.update({
      where: { id: releaseId },
      data: { status: "SUBMITTED", submittedAt: release.submittedAt || now, lastSubmittedAt: now },
    }),
    db.submissionEvent.create({
      data: { releaseId, type: eventType, actorLabel: "Artist portal", fromStatus: release.status, toStatus: "SUBMITTED", message: "Release submitted from the storefront artist portal." },
    }),
  ]);
  await dispatchLatestEvent({ admin, shop, releaseId, type: eventType });
}

export async function resolvePortalReviewItem({ shop, customerId, releaseId, reviewItemId }) {
  const release = await getPortalRelease({ shop, customerId, releaseId });
  if (!release) throw new Error("Release not found.");
  if (release.status !== "CHANGES_REQUESTED") throw new Error("This release does not currently have an active corrections workflow.");
  const item = await db.releaseReviewItem.findFirst({ where: { id: reviewItemId, releaseId, status: "OPEN" } });
  if (!item) throw new Error("Change request not found or already resolved.");
  await db.$transaction([
    db.releaseReviewItem.update({ where: { id: item.id }, data: { status: "RESOLVED", resolvedAt: new Date() } }),
    db.submissionEvent.create({ data: { releaseId, type: "CHANGE_RESOLVED", actorLabel: "Artist portal", trackId: item.trackId, message: item.message } }),
  ]);
}

export async function stagePortalUpload({ admin, shop, customerId, formData }) {
  if (!admin) throw new Error("Shopify Admin API is unavailable for this store.");
  const releaseId = String(formData.get("releaseId") || "");
  const trackId = String(formData.get("trackId") || "");
  const kind = String(formData.get("kind") || "");
  if (![FILE_KINDS.COVER_ART, FILE_KINDS.SPLIT_SHEET, FILE_KINDS.SUPPORTING_DOCUMENT].includes(kind)) throw new Error("This file type cannot be uploaded directly from the artist portal.");
  const filename = String(formData.get("filename") || "");
  const mimeType = String(formData.get("mimeType") || "");
  const sizeBytes = Number(formData.get("sizeBytes") || 0);
  const release = await getPortalRelease({ shop, customerId, releaseId, include: { tracks: true } });
  if (!release) throw new Error("Release not found.");
  if (!releaseIsEditable(release.status)) throw new Error("This release is locked.");
  if (trackId && !release.tracks.some((track) => track.id === trackId)) throw new Error("Track not found.");
  const descriptor = validateUploadDescriptor({ kind, filename, mimeType, sizeBytes, trackId });
  const response = await admin.graphql(
    `#graphql
      mutation ReleaseCorePortalStageUpload($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { field message }
        }
      }`,
    { variables: { input: [{ filename: descriptor.name, mimeType: descriptor.mime, fileSize: String(descriptor.size), httpMethod: "POST", resource: stagedResourceForKind(kind) }] } },
  );
  const json = await response.json();
  const payload = json?.data?.stagedUploadsCreate;
  if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((item) => item.message).join(" "));
  const target = payload?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) throw new Error("Shopify did not return an upload target.");
  return target;
}

async function bestEffortDeleteShopifyFile(admin, fileId) {
  if (!admin || !fileId) return;
  try {
    await admin.graphql(`mutation ReleaseCorePortalDeleteFile($fileIds:[ID!]!){fileDelete(fileIds:$fileIds){deletedFileIds userErrors{message}}}`, { variables: { fileIds: [fileId] } });
  } catch {}
}

export async function completePortalUpload({ admin, shop, customerId, formData }) {
  if (!admin) throw new Error("Shopify Admin API is unavailable for this store.");
  const releaseId = String(formData.get("releaseId") || "");
  const trackId = String(formData.get("trackId") || "") || null;
  const kind = String(formData.get("kind") || "");
  if (![FILE_KINDS.COVER_ART, FILE_KINDS.SPLIT_SHEET, FILE_KINDS.SUPPORTING_DOCUMENT].includes(kind)) throw new Error("This file type cannot be uploaded directly from the artist portal.");
  const filename = String(formData.get("filename") || "");
  const mimeType = String(formData.get("mimeType") || "");
  const sizeBytes = Number(formData.get("sizeBytes") || 0);
  const resourceUrl = String(formData.get("resourceUrl") || "");
  const release = await getPortalRelease({ shop, customerId, releaseId, include: { tracks: true } });
  if (!release) throw new Error("Release not found.");
  if (!releaseIsEditable(release.status)) throw new Error("This release is locked.");
  if (trackId && !release.tracks.some((track) => track.id === trackId)) throw new Error("Track not found.");
  const descriptor = validateUploadDescriptor({ kind, filename, mimeType, sizeBytes, trackId });
  if (!resourceUrl) throw new Error("Upload resource URL is missing.");
  const response = await admin.graphql(
    `#graphql
      mutation ReleaseCorePortalCreateFile($files:[FileCreateInput!]!){
        fileCreate(files:$files){files{id fileStatus ... on GenericFile{url} ... on MediaImage{image{url width height}}} userErrors{field message code}}
      }`,
    { variables: { files: [{ contentType: fileContentTypeForKind(kind), originalSource: resourceUrl, ...(kind === FILE_KINDS.COVER_ART ? { alt: `${release.title} cover artwork` } : {}) }] } },
  );
  const json = await response.json();
  const payload = json?.data?.fileCreate;
  if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((item) => item.message).join(" "));
  const shopifyFile = payload?.files?.[0];
  if (!shopifyFile?.id) throw new Error("Shopify did not create the file.");

  if (isReplaceableKind(kind)) {
    const existing = await db.releaseFile.findMany({ where: { releaseId, trackId, kind } });
    for (const item of existing) if (item.storageProvider === "SHOPIFY_FILES") await bestEffortDeleteShopifyFile(admin, item.storageKey);
    if (existing.length) await db.releaseFile.deleteMany({ where: { id: { in: existing.map((item) => item.id) } } });
  }
  const file = await db.releaseFile.create({
    data: { releaseId, trackId, kind, filename: descriptor.name, storageProvider: "SHOPIFY_FILES", storageKey: shopifyFile.id, url: shopifyFile.url || shopifyFile.image?.url || null, mimeType: descriptor.mime, sizeBytes: descriptor.size, status: shopifyFile.fileStatus || "UPLOADED" },
  });
  await db.release.update({ where: { id: releaseId }, data: { updatedAt: new Date() } });
  return file;
}

async function deleteStoredPortalMaster(file) {
  if (!file?.storageKey) return;
  if (file.storageProvider === "R2") {
    await deleteR2StorageKey(file.storageKey);
  } else if (file.storageProvider === "LOCAL_DEV") {
    await deleteLocalStorageKey(file.storageKey);
  }
}

export async function stagePortalMasterUpload({ request, shop, customerId }) {
  const formData = await request.formData();
  const releaseId = String(formData.get("releaseId") || "");
  const trackId = String(formData.get("trackId") || "");
  const filename = String(formData.get("filename") || "master.wav");
  const mimeType = String(formData.get("mimeType") || "audio/wav");
  const sizeBytes = Number(formData.get("sizeBytes") || 0);

  const release = await getPortalRelease({
    shop,
    customerId,
    releaseId,
    include: { tracks: true },
  });
  if (!release) throw new Error("Release not found.");
  if (!releaseIsEditable(release.status)) throw new Error("This release is locked.");
  if (!release.tracks.some((item) => item.id === trackId)) {
    throw new Error("Track not found.");
  }

  const descriptor = validateUploadDescriptor({
    kind: FILE_KINDS.MASTER_WAV,
    filename,
    mimeType,
    sizeBytes,
    trackId,
  });

  if (masterStorageProvider() !== "R2") {
    return { provider: "LOCAL_DEV" };
  }

  return createR2MasterUploadTarget({
    shop,
    releaseId,
    trackId,
    filename: descriptor.name,
    mimeType: descriptor.mime,
  });
}

export async function completePortalMasterUpload({
  request,
  admin,
  shop,
  customerId,
}) {
  const formData = await request.formData();
  const releaseId = String(formData.get("releaseId") || "");
  const trackId = String(formData.get("trackId") || "");
  const filename = String(formData.get("filename") || "master.wav");
  const mimeType = String(formData.get("mimeType") || "audio/wav");
  const sizeBytes = Number(formData.get("sizeBytes") || 0);
  const storageKey = String(formData.get("storageKey") || "");

  const release = await getPortalRelease({
    shop,
    customerId,
    releaseId,
    include: { tracks: true },
  });
  if (!release) throw new Error("Release not found.");
  if (!releaseIsEditable(release.status)) throw new Error("This release is locked.");
  if (!release.tracks.some((item) => item.id === trackId)) {
    throw new Error("Track not found.");
  }

  const descriptor = validateUploadDescriptor({
    kind: FILE_KINDS.MASTER_WAV,
    filename,
    mimeType,
    sizeBytes,
    trackId,
  });

  if (!storageKey) throw new Error("R2 storage key is missing.");

  const verified = await verifyR2MasterObject({
    shop,
    releaseId,
    trackId,
    storageKey,
    expectedSize: descriptor.size,
    expectedMimeType: descriptor.mime,
  });

  const existing = await db.releaseFile.findMany({
    where: { releaseId, trackId, kind: FILE_KINDS.MASTER_WAV },
  });
  const stalePreviews = await db.releaseFile.findMany({
    where: { releaseId, trackId, kind: FILE_KINDS.PREVIEW_MP3 },
  });

  let created;
  try {
    created = await db.$transaction(async (tx) => {
      if (existing.length) {
        await tx.releaseFile.deleteMany({
          where: { id: { in: existing.map((item) => item.id) } },
        });
      }
      if (stalePreviews.length) {
        await tx.releaseFile.deleteMany({
          where: { id: { in: stalePreviews.map((item) => item.id) } },
        });
      }

      const file = await tx.releaseFile.create({
        data: {
          releaseId,
          trackId,
          kind: FILE_KINDS.MASTER_WAV,
          filename: descriptor.name,
          storageProvider: "R2",
          storageKey,
          mimeType: verified.mimeType || descriptor.mime,
          sizeBytes: verified.sizeBytes,
          status: "READY",
        },
      });

      await tx.release.update({
        where: { id: releaseId },
        data: { updatedAt: new Date() },
      });

      return file;
    });
  } catch (error) {
    try { await deleteR2StorageKey(storageKey); } catch {}
    throw error;
  }

  for (const item of existing) {
    try { await deleteStoredPortalMaster(item); } catch {}
  }

  for (const item of stalePreviews) {
    if (item.storageProvider === "SHOPIFY_FILES" && item.storageKey) {
      await bestEffortDeleteShopifyFile(admin, item.storageKey);
    }
  }

  return created;
}

export async function uploadPortalMaster({ request, admin, shop, customerId, url }) {
  const releaseId = url.searchParams.get("releaseId") || "";
  const trackId = url.searchParams.get("trackId") || "";
  const filename = decodeURIComponent(url.searchParams.get("filename") || "master.wav");
  const mimeType = decodeURIComponent(url.searchParams.get("mimeType") || "audio/wav");
  const sizeBytes = Number(url.searchParams.get("sizeBytes") || request.headers.get("content-length") || 0);
  const release = await getPortalRelease({ shop, customerId, releaseId, include: { tracks: true } });
  if (!release) throw new Error("Release not found.");
  if (!releaseIsEditable(release.status)) throw new Error("This release is locked.");
  const track = release.tracks.find((item) => item.id === trackId);
  if (!track) throw new Error("Track not found.");
  const descriptor = validateUploadDescriptor({ kind: FILE_KINDS.MASTER_WAV, filename, mimeType, sizeBytes, trackId });
  let savedKey = null;
  try {
    savedKey = await saveMasterStream({ stream: request.body, shop, releaseId, trackId, filename: descriptor.name });
    const existing = await db.releaseFile.findMany({ where: { releaseId, trackId, kind: FILE_KINDS.MASTER_WAV } });
    for (const item of existing) {
      if (item.storageProvider === "R2" && item.storageKey) await deleteR2StorageKey(item.storageKey);
      else if (item.storageProvider === "LOCAL_DEV" && item.storageKey) await deleteLocalStorageKey(item.storageKey);
    }
    if (existing.length) await db.releaseFile.deleteMany({ where: { id: { in: existing.map((item) => item.id) } } });
    const stalePreviews = await db.releaseFile.findMany({ where: { releaseId, trackId, kind: FILE_KINDS.PREVIEW_MP3 } });
    for (const item of stalePreviews) if (item.storageProvider === "SHOPIFY_FILES" && item.storageKey) await bestEffortDeleteShopifyFile(admin, item.storageKey);
    if (stalePreviews.length) await db.releaseFile.deleteMany({ where: { id: { in: stalePreviews.map((item) => item.id) } } });
    const file = await db.releaseFile.create({ data: { releaseId, trackId, kind: FILE_KINDS.MASTER_WAV, filename: descriptor.name, storageProvider: "LOCAL_DEV", storageKey: savedKey, mimeType: descriptor.mime, sizeBytes: descriptor.size, status: "READY" } });
    await db.release.update({ where: { id: releaseId }, data: { updatedAt: new Date() } });
    return file;
  } catch (error) {
    if (savedKey) try { await deleteLocalStorageKey(savedKey); } catch {}
    throw error;
  }
}
