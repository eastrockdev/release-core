import {
  portalDashboardState,
  portalMembership,
  savePortalOnboarding,
} from "../lib/portal-dashboard.server";
import { Readable } from "node:stream";
import { authenticate } from "../shopify.server";
import { GENRES, LANGUAGES, PRO_OPTIONS } from "../lib/releasecore";
import { configuredCreditRoles } from "../lib/credit-types";
import {
  savePortalLabelName,
} from "../lib/portal-labels.server";
import {
  addPortalCredit,
  addPortalTrack,
  completePortalUpload,
  createPortalArtistProfile,
  createPortalRelease,
  getPortalRelease,
  listPortalReleases,
  portalIdentity,
  portalReleaseDetail,
  removePortalCredit,
  requirePortalCustomer,
  resolvePortalReviewItem,
  stagePortalUpload,
  submitPortalRelease,
  updatePortalCredit,
  updatePortalRelease,
  updatePortalTrack,
  uploadPortalMaster,
  stagePortalMasterUpload,
  completePortalMasterUpload,
} from "../lib/portal.server";
import { portalReleaseAccess } from "../lib/automations.server";
import {
  applyReleaseCreationModeration,
  assertCustomerCanCreateRelease,
  assertReleaseArtistEditable,
  getCustomerReleaseCreationPolicy,
  getReleaseArtistEditLock,
} from "../lib/moderation.server";
import db from "../db.server";
import { deleteReleaseDraft } from "../lib/release-drafts.server";
import {
  completePortalArtistImage,
  listPortalArtistProfiles,
  stagePortalArtistImage,
  updatePortalArtistProfile,
} from "../lib/artist-profile.server";
import {
  getR2SignedReadUrl,
  localStorageReadStream,
  localStorageStat,
} from "../lib/storage.server";
import { apiErrorResponse } from "../lib/http-security.server";
import {
  listCommerceDownloads,
  recordCommerceDownload,
  resolveCommerceDownload,
} from "../lib/commerce-entitlements.server";

function pathFromRequest(request) {
  const pathname = new URL(request.url).pathname;
  return pathname
    .replace(/^\/releasecore-proxy\/?/, "")
    .replace(/^\/+|\/+$/g, "");
}

function errorResponse(request, error) {
  return apiErrorResponse(request, error, {
    context: "artist portal request",
    fallback: "ReleaseCore could not complete this request.",
  });
}

async function assertRequestReleaseArtistEditable(request, identity) {
  const formData = await request.clone().formData();
  const releaseId = String(formData.get("releaseId") || "");
  if (!releaseId) return;
  await assertReleaseArtistEditable({
    shop: identity.shop,
    releaseId,
  });
}

async function masterAudioResponse({ request, identity, fileId }) {
  const file = await db.releaseFile.findFirst({
    where: { id: fileId, kind: "MASTER_WAV" },
  });
  if (!file || !file.storageKey) {
    return new Response("Audio not found.", { status: 404 });
  }

  const release = await getPortalRelease({
    shop: identity.shop,
    customerId: identity.customerId,
    releaseId: file.releaseId,
  });
  if (!release) {
    return new Response("Audio not found.", { status: 404 });
  }

  if (file.storageProvider === "R2") {
    const signedUrl = await getR2SignedReadUrl(file.storageKey, {
      filename: file.filename || "master.wav",
      mimeType: file.mimeType || "audio/wav",
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: signedUrl,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (file.storageProvider !== "LOCAL_DEV") {
    return new Response("Audio not found.", { status: 404 });
  }
  const info = localStorageStat(file.storageKey);
  const resolvedInfo = await info;
  const total = resolvedInfo.size;
  const range = request.headers.get("range");
  const headers = {
    "Content-Type": file.mimeType || "audio/wav",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="${String(
      file.filename || "master.wav",
    ).replace(/["\r\n]/g, "_")}"`,
  };
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2]
      ? Math.min(Number(match[2]), total - 1)
      : total - 1;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      start > end ||
      start >= total
    ) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }
    const stream = localStorageReadStream(file.storageKey, { start, end });
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${total}`,
      },
    });
  }
  const stream = localStorageReadStream(file.storageKey);
  return new Response(Readable.toWeb(stream), {
    status: 200,
    headers: {
      ...headers,
      "Content-Length": String(total),
    },
  });
}

async function commerceDownloadResponse({ identity, entitlementId }) {
  const orderId = identity.url.searchParams.get("order");
  const token = identity.url.searchParams.get("token");
  const format = identity.url.searchParams.get("format");

  const { entitlement, file, format: resolvedFormat } =
    await resolveCommerceDownload({
      shop: identity.shop,
      customerId: identity.customerId,
      orderId,
      token,
      entitlementId,
      format,
    });

  await recordCommerceDownload({
    shop: identity.shop,
    entitlementId: entitlement.id,
    customerId: identity.customerId,
    format: resolvedFormat,
    releaseFileId: file.id,
  });

  if (file.storageProvider === "R2") {
    const signedUrl = await getR2SignedReadUrl(file.storageKey, {
      filename: file.filename || `download.${resolvedFormat}`,
      mimeType:
        file.mimeType ||
        (resolvedFormat === "flac" ? "audio/flac" : "audio/mpeg"),
      disposition: "attachment",
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: signedUrl,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (file.storageProvider !== "LOCAL_DEV") {
    return new Response("Download not available.", { status: 404 });
  }

  const info = await localStorageStat(file.storageKey);
  const stream = localStorageReadStream(file.storageKey);
  const filename = String(
    file.filename || `download.${resolvedFormat}`,
  ).replace(/["\r\n]/g, "_");

  return new Response(Readable.toWeb(stream), {
    status: 200,
    headers: {
      "Content-Type":
        file.mimeType ||
        (resolvedFormat === "flac" ? "audio/flac" : "audio/mpeg"),
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export const loader = async ({ request }) => {
  try {
    const context = await authenticate.public.appProxy(request);
    const identity = portalIdentity(request, context.session);
    const path = pathFromRequest(request);
    if (path === "downloads") {
      const orderId = identity.url.searchParams.get("order");
      const token = identity.url.searchParams.get("token");
      const downloads = await listCommerceDownloads({
        shop: identity.shop,
        customerId: identity.customerId,
        orderId,
        token,
      });
      return Response.json({ ok: true, downloads });
    }

    const commerceFileMatch = path.match(/^downloads\/([^/]+)\/file$/);
    if (commerceFileMatch) {
      return commerceDownloadResponse({
        identity,
        entitlementId: commerceFileMatch[1],
      });
    }

    requirePortalCustomer(identity);

    const membership = await portalMembership({
      admin: context.admin,
      shop: identity.shop,
      customerId: identity.customerId,
    });
    if (!membership.allowed) {
      return Response.json(
        {
          ok: false,
          membershipRequired: true,
          membership,
          error:
            membership.message ||
            "Your account does not have Artist Portal access.",
        },
        { status: 403 },
      );
    }

    const creationPolicy = await getCustomerReleaseCreationPolicy({
      shop: identity.shop,
      customerId: identity.customerId,
    });

    if (path === "portal/dashboard") {
      const dashboard = await portalDashboardState({
        admin: context.admin,
        shop: identity.shop,
        customerId: identity.customerId,
        selectedArtistId: identity.url.searchParams.get("artist"),
      });
      dashboard.access = applyReleaseCreationModeration(
        dashboard.access,
        creationPolicy,
      );
      return Response.json({ ok: true, ...dashboard });
    }

    const audioMatch = path.match(/^portal\/audio\/([^/]+)$/);
    if (audioMatch) {
      return masterAudioResponse({
        request,
        identity,
        fileId: audioMatch[1],
      });
    }

    if (path === "portal/profile") {
      const profiles = await listPortalArtistProfiles(identity);
      return Response.json({ ok: true, ...profiles });
    }

    if (path === "portal/releases") {
      const limit = identity.url.searchParams.get("limit");
      const artistId = identity.url.searchParams.get("artist");
      const releases = await listPortalReleases({
        ...identity,
        admin: context.admin,
        limit,
        artistId,
      });
      const access = applyReleaseCreationModeration(
        await portalReleaseAccess({
          admin: context.admin,
          shop: identity.shop,
          customerId: identity.customerId,
        }),
        creationPolicy,
      );
      return Response.json({ ok: true, releases, access });
    }

    const detailMatch = path.match(/^portal\/releases\/([^/]+)$/);
    if (detailMatch) {
      const releaseDetail = await portalReleaseDetail({
        ...identity,
        admin: context.admin,
        releaseId: detailMatch[1],
      });
      if (!releaseDetail) {
        return Response.json(
          { ok: false, error: "Release not found." },
          { status: 404 },
        );
      }
      const lock = await getReleaseArtistEditLock({
        shop: identity.shop,
        releaseId: detailMatch[1],
      });
      const release = {
        ...releaseDetail,
        editable: Boolean(releaseDetail.editable) && !lock.locked,
        artistEditLocked: lock.locked,
        artistEditLockReason: lock.reason,
      };
      const portalSettings = await db.appSettings.findUnique({
        where: { shop: identity.shop },
      });
      const releaseAccess = await portalReleaseAccess({
        admin: context.admin,
        shop: identity.shop,
        customerId: identity.customerId,
      });
      return Response.json({
        ok: true,
        release,
        options: {
          genres: GENRES,
          languages: LANGUAGES,
          creditRoles: configuredCreditRoles(portalSettings),
          proOptions: PRO_OPTIONS,
          labelOptions: releaseAccess.labelAccount?.labelOptions || [],
          pLineOptions: releaseAccess.labelAccount?.pLineOptions || [],
          labelAccount: releaseAccess.labelAccount || null,
        },
      });
    }

    return Response.json(
      { ok: false, error: "Portal endpoint not found." },
      { status: 404 },
    );
  } catch (error) {
    return errorResponse(request, error);
  }
};

export const action = async ({ request }) => {
  try {
    const context = await authenticate.public.appProxy(request);
    const identity = portalIdentity(request, context.session);
    requirePortalCustomer(identity);
    const path = pathFromRequest(request);

    const membership = await portalMembership({
      admin: context.admin,
      shop: identity.shop,
      customerId: identity.customerId,
    });
    if (!membership.allowed) {
      return Response.json(
        {
          ok: false,
          membershipRequired: true,
          membership,
          error:
            membership.message ||
            "Your account does not have Artist Portal access.",
        },
        { status: 403 },
      );
    }

    const creationPolicy = await getCustomerReleaseCreationPolicy({
      shop: identity.shop,
      customerId: identity.customerId,
    });

    if (path === "portal/uploads/master/stage") {
      await assertRequestReleaseArtistEditable(request, identity);
      const target = await stagePortalMasterUpload({
        request,
        admin: context.admin,
        ...identity,
      });
      return Response.json({ ok: true, target });
    }

    if (path === "portal/uploads/master/complete") {
      await assertRequestReleaseArtistEditable(request, identity);
      const file = await completePortalMasterUpload({
        request,
        admin: context.admin,
        ...identity,
      });
      return Response.json({ ok: true, file });
    }

    if (path === "portal/uploads/master") {
      await assertReleaseArtistEditable({
        shop: identity.shop,
        releaseId:
          identity.url.searchParams.get("releaseId") || "",
      });
      const file = await uploadPortalMaster({
        request,
        admin: context.admin,
        ...identity,
        url: identity.url,
      });
      return Response.json({ ok: true, file });
    }

    const formData = await request.formData();

    if (path === "portal/onboarding") {
      const artist = await savePortalOnboarding({
        admin: context.admin,
        ...identity,
        formData,
      });
      const dashboard = await portalDashboardState({
        admin: context.admin,
        shop: identity.shop,
        customerId: identity.customerId,
        selectedArtistId: artist.id,
      });
      dashboard.access = applyReleaseCreationModeration(
        dashboard.access,
        creationPolicy,
      );
      return Response.json({ ok: true, artist, ...dashboard });
    }

    if (path === "portal/label") {
      const intent = String(formData.get("intent") || "");
      const access = await portalReleaseAccess({
        admin: context.admin,
        shop: identity.shop,
        customerId: identity.customerId,
      });

      if (!access.labelAccount?.enabled) {
        return Response.json(
          {
            ok: false,
            error:
              "This account is not configured as a label/team account.",
          },
          { status: 403 },
        );
      }

      if (intent === "save-label") {
        const settings =
          (await db.appSettings.findUnique({
            where: { shop: identity.shop },
          })) || {};
        const label = await savePortalLabelName({
          shop: identity.shop,
          customerId: identity.customerId,
          customerTags: access.customerTags || [],
          settings,
          name: formData.get("name"),
        });
        const dashboard = await portalDashboardState({
          admin: context.admin,
          shop: identity.shop,
          customerId: identity.customerId,
          selectedArtistId: identity.url.searchParams.get("artist"),
        });
        dashboard.access = applyReleaseCreationModeration(
          dashboard.access,
          creationPolicy,
        );
        return Response.json({
          ok: true,
          label,
          ...dashboard,
        });
      }

      if (intent === "create-artist") {
        const artist = await createPortalArtistProfile({
          admin: context.admin,
          ...identity,
          name: formData.get("artistName"),
        });
        const dashboard = await portalDashboardState({
          admin: context.admin,
          shop: identity.shop,
          customerId: identity.customerId,
          selectedArtistId: artist.id,
        });
        dashboard.access = applyReleaseCreationModeration(
          dashboard.access,
          creationPolicy,
        );
        return Response.json({
          ok: true,
          artist,
          ...dashboard,
        });
      }

      return Response.json(
        {
          ok: false,
          error: "Unknown label/team action.",
        },
        { status: 400 },
      );
    }

    if (path === "portal/profile") {
      const artist = await updatePortalArtistProfile({
        ...identity,
        formData,
      });
      return Response.json({ ok: true, artist });
    }

    if (path === "portal/profile/image/stage") {
      const target = await stagePortalArtistImage({
        admin: context.admin,
        ...identity,
        formData,
      });
      return Response.json({ ok: true, target });
    }

    if (path === "portal/profile/image/complete") {
      const image = await completePortalArtistImage({
        admin: context.admin,
        ...identity,
        formData,
      });
      return Response.json({ ok: true, ...image });
    }

    if (path === "portal/uploads/stage") {
      await assertReleaseArtistEditable({
        shop: identity.shop,
        releaseId: String(formData.get("releaseId") || ""),
      });
      const target = await stagePortalUpload({
        admin: context.admin,
        ...identity,
        formData,
      });
      return Response.json({ ok: true, target });
    }

    if (path === "portal/uploads/complete") {
      await assertReleaseArtistEditable({
        shop: identity.shop,
        releaseId: String(formData.get("releaseId") || ""),
      });
      const file = await completePortalUpload({
        admin: context.admin,
        ...identity,
        formData,
      });
      return Response.json({ ok: true, file });
    }

    if (path !== "portal/releases") {
      return Response.json(
        { ok: false, error: "Portal endpoint not found." },
        { status: 404 },
      );
    }

    const intent = String(formData.get("intent") || "");
    const releaseId = String(formData.get("releaseId") || "");
    const trackId = String(formData.get("trackId") || "");

    if (intent === "create-artist") {
      const artist = await createPortalArtistProfile({
        admin: context.admin,
        ...identity,
        name: formData.get("artistName"),
      });
      return Response.json({ ok: true, artist });
    }
    if (intent === "create-release") {
      assertCustomerCanCreateRelease(creationPolicy);
      const release = await createPortalRelease({
        admin: context.admin,
        ...identity,
        type: formData.get("type"),
        title: formData.get("title"),
        artistName: formData.get("artistName"),
      });
      return Response.json({ ok: true, releaseId: release.id });
    }

    if (releaseId) {
      await assertReleaseArtistEditable({
        shop: identity.shop,
        releaseId,
      });
    }

    if (intent === "update-release") {
      await updatePortalRelease({
        admin: context.admin,
        ...identity,
        releaseId,
        formData,
      });
      return Response.json({ ok: true });
    }
    if (intent === "add-track") {
      const track = await addPortalTrack({
        ...identity,
        releaseId,
      });
      return Response.json({ ok: true, trackId: track.id });
    }
    if (intent === "update-track") {
      await updatePortalTrack({
        ...identity,
        releaseId,
        trackId,
        formData,
      });
      return Response.json({ ok: true });
    }
    if (intent === "add-credit") {
      await addPortalCredit({
        ...identity,
        releaseId,
        trackId,
        formData,
      });
      return Response.json({ ok: true });
    }
    if (intent === "update-credit") {
      await updatePortalCredit({
        ...identity,
        releaseId,
        trackId,
        creditId: String(formData.get("creditId") || ""),
        formData,
      });
      return Response.json({ ok: true });
    }
    if (intent === "remove-credit") {
      await removePortalCredit({
        ...identity,
        releaseId,
        trackId,
        creditId: String(formData.get("creditId") || ""),
      });
      return Response.json({ ok: true });
    }
    if (intent === "delete-draft") {
      const deleted = await deleteReleaseDraft({
        shop: identity.shop,
        ownerCustomerId: identity.customerId,
        releaseId,
      });
      return Response.json({ ok: true, deleted });
    }
    if (intent === "submit-release") {
      await submitPortalRelease({
        admin: context.admin,
        ...identity,
        releaseId,
      });
      return Response.json({ ok: true });
    }
    if (intent === "resolve-review-item") {
      await resolvePortalReviewItem({
        ...identity,
        releaseId,
        reviewItemId: String(formData.get("reviewItemId") || ""),
      });
      return Response.json({ ok: true });
    }

    return Response.json(
      { ok: false, error: "Unknown portal action." },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(request, error);
  }
};
