import { createHmac, timingSafeEqual } from "node:crypto";

import db from "../db.server";
import { publicError } from "./http-security.server";
import {
  inspectCustomerDownloadFiles,
  enabledCustomerDownloadFormats,
  ensureCustomerDownloadFile,
  normalizedCustomerDownloadSettings,
} from "./customer-downloads.server";

const ACTIVE = "ACTIVE";
const REVOKED = "REVOKED";

function clean(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

function asId(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function productGid(value) {
  const id = clean(value);
  if (!id) return null;
  if (id.startsWith("gid://shopify/Product/")) return id;
  if (/^\d+$/.test(id)) return `gid://shopify/Product/${id}`;
  return null;
}

function parsedDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function entitlementSecret() {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error(
      "SHOPIFY_API_SECRET is required for digital purchase access tokens.",
    );
  }
  return secret;
}

export function guestOrderAccessToken(shop, shopifyOrderId) {
  const normalizedShop = clean(shop);
  const normalizedOrder = asId(shopifyOrderId);
  if (!normalizedShop || !normalizedOrder) {
    throw new Error("Shop and Shopify order ID are required.");
  }

  return createHmac("sha256", entitlementSecret())
    .update(`releasecore-order-download:${normalizedShop}:${normalizedOrder}`)
    .digest("base64url");
}

export function verifyGuestOrderAccessToken(shop, shopifyOrderId, token) {
  const supplied = clean(token);
  if (!supplied) return false;

  const expected = guestOrderAccessToken(shop, shopifyOrderId);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function markWebhookEvent(tx, { shop, topic, resourceId }) {
  const existing = await tx.commerceWebhookEvent.findUnique({
    where: {
      shop_topic_resourceId: { shop, topic, resourceId },
    },
  });

  if (existing) return false;

  await tx.commerceWebhookEvent.create({
    data: { shop, topic, resourceId },
  });
  return true;
}

async function catalogMatchesForOrder(shop, lineItems) {
  const productIds = [
    ...new Set(
      (lineItems || [])
        .map((line) => productGid(line?.product_id))
        .filter(Boolean),
    ),
  ];

  if (!productIds.length) {
    return { tracksByProduct: new Map(), releasesByProduct: new Map() };
  }

  const [tracks, releases] = await Promise.all([
    db.track.findMany({
      where: {
        shopifyProductId: { in: productIds },
        release: { shop },
      },
      select: { id: true, releaseId: true, shopifyProductId: true },
    }),
    db.release.findMany({
      where: {
        shop,
        shopifyReleaseProductId: { in: productIds },
      },
      select: {
        id: true,
        shopifyReleaseProductId: true,
        tracks: {
          orderBy: { position: "asc" },
          select: { id: true, releaseId: true },
        },
      },
    }),
  ]);

  return {
    tracksByProduct: new Map(
      tracks
        .filter((track) => track.shopifyProductId)
        .map((track) => [track.shopifyProductId, track]),
    ),
    releasesByProduct: new Map(
      releases
        .filter((release) => release.shopifyReleaseProductId)
        .map((release) => [release.shopifyReleaseProductId, release]),
    ),
  };
}

function entitlementCandidates(lineItems, matches) {
  const result = [];

  for (const line of lineItems || []) {
    const sourceProductId = productGid(line?.product_id);
    const shopifyLineItemId =
      asId(line?.id) || clean(line?.admin_graphql_api_id);
    if (!sourceProductId || !shopifyLineItemId) continue;

    const directTrack = matches.tracksByProduct.get(sourceProductId);
    if (directTrack) {
      result.push({
        shopifyLineItemId,
        salesLineItemGroupId: asId(line?.sales_line_item_group_id),
        trackId: directTrack.id,
        releaseId: directTrack.releaseId,
        sourceProductId,
        sourceKind: line?.sales_line_item_group_id
          ? "BUNDLE_COMPONENT"
          : "TRACK",
        quantity: Math.max(1, Number(line?.quantity) || 1),
      });
      continue;
    }

    const release = matches.releasesByProduct.get(sourceProductId);
    if (!release) continue;

    for (const track of release.tracks || []) {
      result.push({
        shopifyLineItemId,
        salesLineItemGroupId: asId(line?.sales_line_item_group_id),
        trackId: track.id,
        releaseId: track.releaseId,
        sourceProductId,
        sourceKind: "RELEASE",
        quantity: Math.max(1, Number(line?.quantity) || 1),
      });
    }
  }

  return result;
}

export async function processPaidOrder({ shop, payload }) {
  const shopifyOrderId = asId(payload?.id);
  if (!shop || !shopifyOrderId) {
    throw new Error(
      "Shopify paid-order webhook is missing its shop or order ID.",
    );
  }

  const lineItems = Array.isArray(payload?.line_items)
    ? payload.line_items
    : [];
  const matches = await catalogMatchesForOrder(shop, lineItems);
  const candidates = entitlementCandidates(lineItems, matches);
  const trackIds = [...new Set(candidates.map((item) => item.trackId))];

  const metadata = {
    shopifyOrderGid: clean(payload?.admin_graphql_api_id),
    orderName: clean(payload?.name),
    customerId: asId(payload?.customer?.id),
    currency: clean(payload?.currency),
    status: "PAID",
    paidAt:
      parsedDate(payload?.processed_at) ||
      parsedDate(payload?.updated_at) ||
      parsedDate(payload?.created_at) ||
      new Date(),
    cancelledAt: null,
  };

  return db.$transaction(async (tx) => {
    const fresh = await markWebhookEvent(tx, {
      shop,
      topic: "orders/paid",
      resourceId: shopifyOrderId,
    });

    if (!fresh) {
      return {
        duplicate: true,
        entitlements: 0,
        shopifyOrderId,
        trackIds,
      };
    }

    const order = await tx.commerceOrder.upsert({
      where: { shop_shopifyOrderId: { shop, shopifyOrderId } },
      create: { shop, shopifyOrderId, ...metadata },
      update: metadata,
    });

    let granted = 0;
    for (const candidate of candidates) {
      await tx.commerceEntitlement.upsert({
        where: {
          shop_shopifyOrderId_shopifyLineItemId_trackId: {
            shop,
            shopifyOrderId,
            shopifyLineItemId: candidate.shopifyLineItemId,
            trackId: candidate.trackId,
          },
        },
        create: {
          shop,
          commerceOrderId: order.id,
          shopifyOrderId,
          customerId: metadata.customerId,
          ...candidate,
          status: ACTIVE,
        },
        update: {
          customerId: metadata.customerId,
          salesLineItemGroupId: candidate.salesLineItemGroupId,
          sourceProductId: candidate.sourceProductId,
          sourceKind: candidate.sourceKind,
          quantity: candidate.quantity,
          refundedQuantity: 0,
          status: ACTIVE,
          revokedAt: null,
          revokeReason: null,
        },
      });
      granted += 1;
    }

    return {
      duplicate: false,
      entitlements: granted,
      orderId: order.id,
      shopifyOrderId,
      trackIds,
    };
  });
}

export async function processCancelledOrder({ shop, payload }) {
  const shopifyOrderId = asId(payload?.id);
  if (!shop || !shopifyOrderId) {
    throw new Error(
      "Shopify cancelled-order webhook is missing its shop or order ID.",
    );
  }

  return db.$transaction(async (tx) => {
    const fresh = await markWebhookEvent(tx, {
      shop,
      topic: "orders/cancelled",
      resourceId: shopifyOrderId,
    });
    if (!fresh) return { duplicate: true, revoked: 0 };

    const cancelledAt =
      parsedDate(payload?.cancelled_at) ||
      parsedDate(payload?.updated_at) ||
      new Date();

    await tx.commerceOrder.updateMany({
      where: { shop, shopifyOrderId },
      data: { status: "CANCELLED", cancelledAt },
    });

    const result = await tx.commerceEntitlement.updateMany({
      where: { shop, shopifyOrderId, status: ACTIVE },
      data: {
        status: REVOKED,
        revokedAt: cancelledAt,
        revokeReason: "ORDER_CANCELLED",
      },
    });

    return { duplicate: false, revoked: result.count };
  });
}

export async function processRefund({ shop, payload }) {
  const refundId = asId(payload?.id);
  const shopifyOrderId = asId(payload?.order_id);
  if (!shop || !refundId || !shopifyOrderId) {
    throw new Error(
      "Shopify refund webhook is missing its shop, refund ID, or order ID.",
    );
  }

  const refundedByLine = new Map();
  for (const item of payload?.refund_line_items || []) {
    const lineId =
      asId(item?.line_item_id) ||
      asId(item?.line_item?.id) ||
      clean(item?.line_item?.admin_graphql_api_id);
    if (!lineId) continue;

    refundedByLine.set(
      lineId,
      (refundedByLine.get(lineId) || 0) +
        Math.max(1, Number(item?.quantity) || 1),
    );
  }

  return db.$transaction(async (tx) => {
    const fresh = await markWebhookEvent(tx, {
      shop,
      topic: "refunds/create",
      resourceId: refundId,
    });
    if (!fresh) return { duplicate: true, revoked: 0 };
    if (!refundedByLine.size) return { duplicate: false, revoked: 0 };

    const entitlements = await tx.commerceEntitlement.findMany({
      where: {
        shop,
        shopifyOrderId,
        shopifyLineItemId: { in: [...refundedByLine.keys()] },
      },
    });

    let revoked = 0;
    const revokedAt =
      parsedDate(payload?.processed_at) ||
      parsedDate(payload?.created_at) ||
      new Date();

    for (const entitlement of entitlements) {
      const refundQuantity =
        refundedByLine.get(entitlement.shopifyLineItemId) || 0;
      const nextRefunded = Math.min(
        entitlement.quantity,
        entitlement.refundedQuantity + refundQuantity,
      );
      const shouldRevoke = nextRefunded >= entitlement.quantity;

      await tx.commerceEntitlement.update({
        where: { id: entitlement.id },
        data: {
          refundedQuantity: nextRefunded,
          ...(shouldRevoke
            ? {
                status: REVOKED,
                revokedAt,
                revokeReason: "REFUNDED",
              }
            : {}),
        },
      });

      if (shouldRevoke && entitlement.status !== REVOKED) revoked += 1;
    }

    return { duplicate: false, revoked };
  });
}

function requireGuestAccess({ shop, orderId, token }) {
  if (!orderId || !verifyGuestOrderAccessToken(shop, orderId, token)) {
    throw publicError("A valid purchase access link is required.", {
      status: 401,
    });
  }
}

async function authorizedEntitlements({
  shop,
  customerId,
  orderId,
  token,
}) {
  if (customerId) {
    return db.commerceEntitlement.findMany({
      where: {
        shop,
        customerId: String(customerId),
        status: ACTIVE,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  requireGuestAccess({ shop, orderId, token });
  return db.commerceEntitlement.findMany({
    where: {
      shop,
      shopifyOrderId: String(orderId),
      status: ACTIVE,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function listCommerceDownloads({
  shop,
  customerId,
  orderId,
  token,
}) {
  const settings = await db.appSettings.findUnique({ where: { shop } });
  const normalized = normalizedCustomerDownloadSettings(settings || {});
  if (!normalized.enabled) return [];

  const formats = enabledCustomerDownloadFormats(settings || {});
  const entitlements = await authorizedEntitlements({
    shop,
    customerId,
    orderId,
    token,
  });

  const byTrack = new Map();
  for (const entitlement of entitlements) {
    if (!byTrack.has(entitlement.trackId)) {
      byTrack.set(entitlement.trackId, entitlement);
    }
  }

  const chosen = [...byTrack.values()];
  if (!chosen.length) return [];

  const trackIds = chosen.map((item) => item.trackId);
  const [tracks, states] = await Promise.all([
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
  ]);

  const tracksById = new Map(tracks.map((track) => [track.id, track]));

  return chosen
    .map((entitlement) => {
      const track = tracksById.get(entitlement.trackId);
      if (!track) return null;
      const trackStates = states.get(track.id) || {};

      const guestSuffix =
        !customerId && orderId && token
          ? `&order=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`
          : "";

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
        formats: formats.map((format) => ({
          format,
          label: format.toUpperCase(),
          ready: Boolean(trackStates[format]?.ready),
          state:
            trackStates[format]?.state ||
            (trackStates[format]?.ready ? "READY" : "MISSING"),
          filename: trackStates[format]?.filename || null,
          sizeBytes: trackStates[format]?.sizeBytes || null,
          downloadPath: `/apps/releasecore/downloads/${entitlement.id}/file?format=${format}${guestSuffix}`,
        })),
      };
    })
    .filter(Boolean);
}

export async function resolveCommerceDownload({
  shop,
  customerId,
  orderId,
  token,
  entitlementId,
  format,
}) {
  const entitlement = await db.commerceEntitlement.findFirst({
    where: { id: entitlementId, shop, status: ACTIVE },
  });

  if (!entitlement) {
    throw publicError("This download is not available.", { status: 404 });
  }

  const customerAuthorized =
    customerId &&
    entitlement.customerId &&
    String(customerId) === String(entitlement.customerId);

  const guestAuthorized =
    !customerAuthorized &&
    orderId &&
    String(orderId) === String(entitlement.shopifyOrderId) &&
    verifyGuestOrderAccessToken(shop, orderId, token);

  if (!customerAuthorized && !guestAuthorized) {
    throw publicError(
      "This purchase does not belong to the current customer.",
      { status: 403 },
    );
  }

  const settings = await db.appSettings.findUnique({ where: { shop } });
  const formats = enabledCustomerDownloadFormats(settings || {});
  if (!formats.length) {
    throw publicError("Customer music downloads are disabled.", { status: 403 });
  }

  const requested = String(format || formats[0]).trim().toLowerCase();
  if (!formats.includes(requested)) {
    throw publicError("That customer download format is not enabled.", {
      status: 404,
    });
  }

  const file = await ensureCustomerDownloadFile({
    shop,
    trackId: entitlement.trackId,
    format: requested,
  });

  return { entitlement, file, format: requested };
}

export async function recordCommerceDownload({
  shop,
  entitlementId,
  customerId,
  format,
  releaseFileId,
}) {
  return db.commerceDownload.create({
    data: {
      shop,
      entitlementId,
      customerId: customerId ? String(customerId) : null,
      format: format ? String(format).toUpperCase() : null,
      releaseFileId: releaseFileId || null,
    },
  });
}

export async function redactCommerceCustomer({ shop, customerId }) {
  if (!shop || !customerId) {
    return { orders: 0, entitlements: 0, downloads: 0 };
  }

  const value = String(customerId);
  return db.$transaction(async (tx) => {
    const [orders, entitlements, downloads] = await Promise.all([
      tx.commerceOrder.updateMany({
        where: { shop, customerId: value },
        data: { customerId: null },
      }),
      tx.commerceEntitlement.updateMany({
        where: { shop, customerId: value },
        data: { customerId: null },
      }),
      tx.commerceDownload.updateMany({
        where: { shop, customerId: value },
        data: { customerId: null },
      }),
    ]);

    return {
      orders: orders.count,
      entitlements: entitlements.count,
      downloads: downloads.count,
    };
  });
}

export async function redactCommerceShop({ shop }) {
  if (!shop) return;
  await db.commerceOrder.deleteMany({ where: { shop } });
  await db.commerceWebhookEvent.deleteMany({ where: { shop } });
}
