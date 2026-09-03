import { createHmac, timingSafeEqual } from "node:crypto";

import db from "../db.server";
import { publicError } from "./http-security.server";
import {
  enabledCustomerDownloadFormats,
  ensureCustomerDownloadFile,
  inspectCustomerDownloadFiles,
  rebuildCustomerDownloadFiles,
} from "./customer-downloads.server";
import {
  guestOrderAccessToken,
  recordCommerceDownload,
} from "./commerce-entitlements.server";

const ACTIVE = "ACTIVE";
const TOKEN_LIFETIME_SECONDS = 15 * 60;

function clean(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

function secret() {
  const value = process.env.SHOPIFY_API_SECRET;
  if (!value) {
    throw new Error(
      "SHOPIFY_API_SECRET is required for purchased-music download tokens.",
    );
  }
  return value;
}

export function customerIdFromSubject(subject) {
  const value = clean(subject);
  if (!value) return null;

  const gid = value.match(/^gid:\/\/shopify\/Customer\/(\d+)$/);
  if (gid) return gid[1];

  return /^\d+$/.test(value) ? value : null;
}

export function shopFromCustomerAccountDestination(destination) {
  const value = clean(destination);
  if (!value) return null;

  try {
    const url = new URL(
      value.includes("://") ? value : `https://${value}`,
    );
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function signedMessage({
  shop,
  customerId,
  entitlementId,
  format,
  expires,
}) {
  return [
    "releasecore-customer-download",
    shop,
    customerId,
    entitlementId,
    format,
    String(expires),
  ].join(":");
}

function customerDownloadToken(input) {
  return createHmac("sha256", secret())
    .update(signedMessage(input))
    .digest("base64url");
}

function verifyToken(input, supplied) {
  const token = clean(supplied);
  if (!token) return false;

  const expected = customerDownloadToken(input);
  const left = Buffer.from(token);
  const right = Buffer.from(expected);

  return (
    left.length === right.length &&
    timingSafeEqual(left, right)
  );
}

function directDownloadPath({
  shop,
  customerId,
  entitlementId,
  format,
}) {
  const expires =
    Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS;
  const token = customerDownloadToken({
    shop,
    customerId,
    entitlementId,
    format,
    expires,
  });

  const params = new URLSearchParams({
    entitlement: entitlementId,
    format,
    expires: String(expires),
    token,
  });

  return `/customer-downloads/file?${params.toString()}`;
}

function dateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function releaseGroups(items) {
  const groups = new Map();

  for (const item of items) {
    if (!groups.has(item.releaseId)) {
      groups.set(item.releaseId, {
        releaseId: item.releaseId,
        releaseTitle: item.releaseTitle,
        releaseType: item.releaseType,
        coverUrl: item.coverUrl,
        purchaseDate: item.purchaseDate,
        orderName: item.orderName,
        tracks: [],
      });
    }

    const group = groups.get(item.releaseId);
    const itemDate = item.purchaseDate
      ? new Date(item.purchaseDate).getTime()
      : 0;
    const groupDate = group.purchaseDate
      ? new Date(group.purchaseDate).getTime()
      : 0;

    if (itemDate > groupDate) {
      group.purchaseDate = item.purchaseDate;
      group.orderName = item.orderName;
    }

    group.tracks.push({
      entitlementId: item.entitlementId,
      trackId: item.trackId,
      title: item.trackTitle,
      version: item.trackVersion,
      position: item.trackPosition,
      downloadCount: item.downloadCount,
      formats: item.formats,
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      tracks: group.tracks.sort(
        (left, right) =>
          Number(left.position || 0) - Number(right.position || 0),
      ),
    }))
    .sort(
      (left, right) =>
        new Date(right.purchaseDate || 0).getTime() -
        new Date(left.purchaseDate || 0).getTime(),
    );
}

export async function buildCustomerAccountLibrary({
  shop,
  customerId,
}) {
  const normalizedCustomer = String(customerId || "").trim();
  if (!shop || !normalizedCustomer) {
    throw publicError(
      "ReleaseCore could not identify the signed-in customer.",
      { status: 401 },
    );
  }

  const entitlements = await db.commerceEntitlement.findMany({
    where: {
      shop,
      customerId: normalizedCustomer,
      status: ACTIVE,
    },
    include: {
      order: true,
      downloads: {
        select: { id: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const byTrack = new Map();
  for (const entitlement of entitlements) {
    if (!byTrack.has(entitlement.trackId)) {
      byTrack.set(entitlement.trackId, entitlement);
    }
  }

  const chosen = [...byTrack.values()];
  if (!chosen.length) {
    return {
      releases: [],
      formats: [],
      summary: {
        releases: 0,
        tracks: 0,
        downloads: 0,
      },
    };
  }

  const trackIds = chosen.map((item) => item.trackId);
  const [tracks, states, settings] = await Promise.all([
    db.track.findMany({
      where: {
        id: { in: trackIds },
        release: { shop },
      },
      select: {
        id: true,
        title: true,
        version: true,
        position: true,
        release: {
          select: {
            id: true,
            title: true,
            type: true,
            files: {
              where: { kind: "COVER_ART" },
              orderBy: { updatedAt: "desc" },
              take: 1,
              select: { url: true },
            },
          },
        },
      },
    }),
    inspectCustomerDownloadFiles({ shop, trackIds }),
    db.appSettings.findUnique({ where: { shop } }),
  ]);

  const formats = enabledCustomerDownloadFormats(settings || {});
  const tracksById = new Map(
    tracks.map((track) => [track.id, track]),
  );

  const items = chosen
    .map((entitlement) => {
      const track = tracksById.get(entitlement.trackId);
      if (!track) return null;

      const trackStates = states.get(track.id) || {};

      return {
        entitlementId: entitlement.id,
        trackId: track.id,
        trackTitle: track.title,
        trackVersion: track.version,
        trackPosition: track.position,
        releaseId: track.release.id,
        releaseTitle: track.release.title,
        releaseType: track.release.type,
        coverUrl: track.release.files?.[0]?.url || null,
        purchaseDate: dateValue(
          entitlement.order?.paidAt ||
            entitlement.order?.createdAt ||
            entitlement.createdAt,
        ),
        orderName:
          entitlement.order?.orderName ||
          `Order ${entitlement.shopifyOrderId}`,
        downloadCount: entitlement.downloads.length,
        formats: formats.map((format) => {
          const state = trackStates[format] || {
            state: "MISSING",
            ready: false,
          };

          return {
            format,
            label: format.toUpperCase(),
            state: state.state || "MISSING",
            ready: state.state === "READY",
            filename: state.filename || null,
            sizeBytes: state.sizeBytes || null,
            downloadPath:
              state.state === "NO_MASTER"
                ? null
                : directDownloadPath({
                    shop,
                    customerId: normalizedCustomer,
                    entitlementId: entitlement.id,
                    format,
                  }),
          };
        }),
      };
    })
    .filter(Boolean);

  const releases = releaseGroups(items);

  return {
    releases,
    formats,
    summary: {
      releases: releases.length,
      tracks: items.length,
      downloads: items.reduce(
        (sum, item) => sum + item.downloadCount,
        0,
      ),
    },
  };
}

function normalizeProductGids(values) {
  const prefix = "gid://shopify/Product/";
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value.startsWith(prefix)) return false;
      const numeric = value.slice(prefix.length);
      return numeric.length > 0 && [...numeric].every((character) => character >= "0" && character <= "9");
    })
    .slice(0, 100))];
}

function numericOrderId(value) {
  const normalized = String(value || "").trim();
  const prefix = "gid://shopify/Order/";
  const candidate = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
  if (!candidate.length) return null;
  return [...candidate].every((character) => character >= "0" && character <= "9") ? candidate : null;
}

export async function orderStatusHasReleaseCoreProducts({ shop, productIds }) {
  const ids = normalizeProductGids(productIds);
  if (!shop || !ids.length) return false;
  const [track, release] = await Promise.all([
    db.track.findFirst({ where: { shopifyProductId: { in: ids }, release: { shop } }, select: { id: true } }),
    db.release.findFirst({ where: { shop, shopifyReleaseProductId: { in: ids } }, select: { id: true } }),
  ]);
  return Boolean(track || release);
}

export async function buildCustomerOrderDownloads({ shop, customerId, orderId }) {
  const normalizedCustomer = String(customerId || "").trim();
  const normalizedOrder = String(orderId || "").trim();
  const numericOrder = numericOrderId(normalizedOrder);
  if (!shop || !normalizedCustomer || !normalizedOrder) throw publicError("ReleaseCore could not identify this customer order.", { status: 401 });

  const order = await db.commerceOrder.findFirst({
    where: {
      shop,
      customerId: normalizedCustomer,
      OR: [
        { shopifyOrderGid: normalizedOrder },
        ...(numericOrder ? [{ shopifyOrderId: numericOrder }] : []),
      ],
    },
  });

  if (!order) return { releases: [], formats: [], orderName: null, summary: { releases: 0, tracks: 0, downloads: 0 } };

  const entitlements = await db.commerceEntitlement.findMany({
    where: { shop, commerceOrderId: order.id, customerId: normalizedCustomer, status: ACTIVE },
    include: { downloads: { select: { id: true } } },
    orderBy: { createdAt: "asc" },
  });

  const byTrack = new Map();
  for (const entitlement of entitlements) if (!byTrack.has(entitlement.trackId)) byTrack.set(entitlement.trackId, entitlement);
  const chosen = [...byTrack.values()];
  const orderName = order.orderName || `Order ${order.shopifyOrderId}`;
  if (!chosen.length) return { releases: [], formats: [], orderName, summary: { releases: 0, tracks: 0, downloads: 0 } };

  const trackIds = chosen.map((item) => item.trackId);
  const [tracks, states, settings] = await Promise.all([
    db.track.findMany({
      where: { id: { in: trackIds }, release: { shop } },
      select: {
        id: true, title: true, version: true, position: true,
        release: { select: { id: true, title: true, type: true, files: { where: { kind: "COVER_ART" }, orderBy: { updatedAt: "desc" }, take: 1, select: { url: true } } } },
      },
    }),
    inspectCustomerDownloadFiles({ shop, trackIds }),
    db.appSettings.findUnique({ where: { shop } }),
  ]);

  const formats = enabledCustomerDownloadFormats(settings || {});
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  const purchaseDate = dateValue(order.paidAt || order.createdAt);

  const items = chosen.map((entitlement) => {
    const track = tracksById.get(entitlement.trackId);
    if (!track) return null;
    const trackStates = states.get(track.id) || {};
    return {
      entitlementId: entitlement.id,
      trackId: track.id,
      trackTitle: track.title,
      trackVersion: track.version,
      trackPosition: track.position,
      releaseId: track.release.id,
      releaseTitle: track.release.title,
      releaseType: track.release.type,
      coverUrl: track.release.files?.[0]?.url || null,
      purchaseDate,
      orderName,
      downloadCount: entitlement.downloads.length,
      formats: formats.map((format) => {
        const state = trackStates[format] || { state: "MISSING", ready: false };
        return {
          format,
          label: format.toUpperCase(),
          state: state.state || "MISSING",
          ready: state.state === "READY",
          filename: state.filename || null,
          sizeBytes: state.sizeBytes || null,
          downloadPath: state.state === "NO_MASTER" ? null : directDownloadPath({ shop, customerId: normalizedCustomer, entitlementId: entitlement.id, format }),
        };
      }),
    };
  }).filter(Boolean);

  const releases = releaseGroups(items);
  return {
    releases,
    formats,
    orderName,
    summary: {
      releases: releases.length,
      tracks: items.length,
      downloads: items.reduce((sum, item) => sum + item.downloadCount, 0),
    },
  };
}

export async function resolveCustomerAccountDownload({
  entitlementId,
  format,
  expires,
  token,
}) {
  const requested = String(format || "").trim().toLowerCase();
  const expiry = Number(expires);

  if (
    !entitlementId ||
    !requested ||
    !Number.isInteger(expiry)
  ) {
    throw publicError("This download link is invalid.", {
      status: 401,
    });
  }

  const now = Math.floor(Date.now() / 1000);
  if (expiry < now || expiry > now + TOKEN_LIFETIME_SECONDS + 60) {
    throw publicError(
      "This download link has expired. Return to Music downloads and try again.",
      { status: 401 },
    );
  }

  const entitlement = await db.commerceEntitlement.findFirst({
    where: {
      id: entitlementId,
      status: ACTIVE,
    },
  });

  if (!entitlement?.shop || !entitlement?.customerId) {
    throw publicError("This purchase is no longer available.", {
      status: 404,
    });
  }

  const shop = entitlement.shop;
  const normalizedCustomer = String(entitlement.customerId);

  if (
    !verifyToken(
      {
        shop,
        customerId: normalizedCustomer,
        entitlementId,
        format: requested,
        expires: expiry,
      },
      token,
    )
  ) {
    throw publicError("This download link is invalid.", {
      status: 401,
    });
  }

  const settings = await db.appSettings.findUnique({
    where: { shop },
  });
  const enabled = enabledCustomerDownloadFormats(settings || {});

  if (!enabled.includes(requested)) {
    throw publicError(
      "That customer download format is not enabled.",
      { status: 404 },
    );
  }

  const file = await ensureCustomerDownloadFile({
    shop,
    trackId: entitlement.trackId,
    format: requested,
  });

  await recordCommerceDownload({
    shop,
    entitlementId: entitlement.id,
    customerId: normalizedCustomer,
    format: requested,
    releaseFileId: file.id,
  });

  return {
    entitlement,
    file,
    format: requested,
  };
}

export async function listPurchasedMusicAdmin({
  shop,
  limit = 40,
}) {
  const take = Math.max(1, Math.min(100, Number(limit) || 40));

  const [
    orders,
    orderCount,
    activeCount,
    revokedCount,
    downloadCount,
  ] = await Promise.all([
    db.commerceOrder.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take,
      include: {
        entitlements: {
          orderBy: { createdAt: "asc" },
          include: {
            downloads: {
              orderBy: { downloadedAt: "desc" },
              take: 8,
            },
          },
        },
      },
    }),
    db.commerceOrder.count({ where: { shop } }),
    db.commerceEntitlement.count({
      where: { shop, status: ACTIVE },
    }),
    db.commerceEntitlement.count({
      where: { shop, status: { not: ACTIVE } },
    }),
    db.commerceDownload.count({ where: { shop } }),
  ]);

  const entitlements = orders.flatMap(
    (order) => order.entitlements || [],
  );
  const trackIds = [
    ...new Set(entitlements.map((item) => item.trackId)),
  ];
  const releaseIds = [
    ...new Set(entitlements.map((item) => item.releaseId)),
  ];

  const [tracks, releases, states] = await Promise.all([
    trackIds.length
      ? db.track.findMany({
          where: {
            id: { in: trackIds },
            release: { shop },
          },
          select: {
            id: true,
            title: true,
            version: true,
            position: true,
            releaseId: true,
          },
        })
      : [],
    releaseIds.length
      ? db.release.findMany({
          where: { id: { in: releaseIds }, shop },
          select: {
            id: true,
            title: true,
            type: true,
            files: {
              where: { kind: "COVER_ART" },
              orderBy: { updatedAt: "desc" },
              take: 1,
              select: { url: true },
            },
          },
        })
      : [],
    inspectCustomerDownloadFiles({ shop, trackIds }),
  ]);

  const tracksById = new Map(
    tracks.map((track) => [track.id, track]),
  );
  const releasesById = new Map(
    releases.map((release) => [release.id, release]),
  );

  return {
    summary: {
      orders: orderCount,
      activeEntitlements: activeCount,
      revokedEntitlements: revokedCount,
      downloads: downloadCount,
    },
    orders: orders.map((order) => ({
      id: order.id,
      shopifyOrderId: order.shopifyOrderId,
      orderName:
        order.orderName || `Order ${order.shopifyOrderId}`,
      customerId: order.customerId,
      status: order.status,
      paidAt: dateValue(order.paidAt || order.createdAt),
      cancelledAt: dateValue(order.cancelledAt),
      guestUrl: order.customerId
        ? null
        : `https://${shop}/pages/music-downloads?order=${encodeURIComponent(
            order.shopifyOrderId,
          )}&token=${encodeURIComponent(
            guestOrderAccessToken(shop, order.shopifyOrderId),
          )}`,
      entitlements: (order.entitlements || []).map(
        (entitlement) => {
          const track = tracksById.get(entitlement.trackId);
          const release = releasesById.get(entitlement.releaseId);
          const trackStates = states.get(entitlement.trackId) || {};

          return {
            id: entitlement.id,
            status: entitlement.status,
            sourceKind: entitlement.sourceKind,
            trackId: entitlement.trackId,
            trackTitle:
              track?.title || "Unavailable track",
            trackVersion: track?.version || null,
            trackPosition: track?.position || null,
            releaseId: entitlement.releaseId,
            releaseTitle:
              release?.title || "Unavailable release",
            releaseType: release?.type || null,
            coverUrl: release?.files?.[0]?.url || null,
            refundedQuantity: entitlement.refundedQuantity,
            quantity: entitlement.quantity,
            revokeReason: entitlement.revokeReason,
            formats: Object.entries(trackStates).map(
              ([format, state]) => ({
                format,
                ...state,
              }),
            ),
            downloadCount:
              entitlement.downloads?.length || 0,
            recentDownloads:
              entitlement.downloads?.map((download) => ({
                id: download.id,
                format: download.format,
                downloadedAt: dateValue(
                  download.downloadedAt,
                ),
              })) || [],
          };
        },
      ),
    })),
  };
}

export async function rebuildPurchasedTrackFiles({
  shop,
  trackId,
  format = null,
}) {
  const formats = format
    ? [String(format).trim().toLowerCase()]
    : null;

  return rebuildCustomerDownloadFiles({
    shop,
    trackIds: [trackId],
    formats,
  });
}

export async function rebuildPurchasedReleaseFiles({
  shop,
  releaseId,
}) {
  const release = await db.release.findFirst({
    where: { id: releaseId, shop },
    select: {
      id: true,
      tracks: {
        orderBy: { position: "asc" },
        select: { id: true },
      },
    },
  });

  if (!release) {
    throw publicError("Release not found.", { status: 404 });
  }

  return rebuildCustomerDownloadFiles({
    shop,
    trackIds: release.tracks.map((track) => track.id),
  });
}
