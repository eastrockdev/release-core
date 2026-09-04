import db from "../db.server";
import { deleteMasterStorageObject } from "./storage.server";
import { safeDiagnosticText } from "./http-security.server";
import { PRIVACY_TOPICS } from "./privacy";

export { PRIVACY_TOPICS } from "./privacy";

const ACTIVE_STATUSES = ["PENDING", "FAILED"];
const MAX_ATTEMPTS = 10;

function customerIdFromPayload(payload) {
  const raw = payload?.customer?.id;
  return raw == null ? null : String(raw);
}

function customerEmailFromPayload(payload) {
  const value = String(payload?.customer?.email || "").trim().toLowerCase();
  return value || null;
}

function requestIdFor(topic, payload) {
  if (topic === PRIVACY_TOPICS.DATA_REQUEST && payload?.data_request?.id != null) {
    return String(payload.data_request.id);
  }
  if (topic === PRIVACY_TOPICS.CUSTOMER_REDACT && payload?.customer?.id != null) {
    return String(payload.customer.id);
  }
  if (topic === PRIVACY_TOPICS.SHOP_REDACT && payload?.shop_id != null) {
    return String(payload.shop_id);
  }
  return `${topic}:${Date.now()}`;
}

export async function enqueuePrivacyRequest({ shop, topic, payload }) {
  if (!Object.values(PRIVACY_TOPICS).includes(topic)) {
    throw new Error(`Unsupported privacy webhook topic: ${topic}`);
  }

  const shopifyRequestId = requestIdFor(topic, payload);
  const customerId = customerIdFromPayload(payload);
  const customerEmail = customerEmailFromPayload(payload);

  return db.privacyRequest.upsert({
    where: { shop_topic_shopifyRequestId: { shop, topic, shopifyRequestId } },
    create: {
      shop,
      topic,
      shopifyRequestId,
      customerId,
      customerEmail,
      status: "PENDING",
    },
    update: {
      customerId,
      customerEmail,
      status: "PENDING",
      lastError: null,
    },
  });
}

export async function buildCustomerDataExport(request) {
  if (!request.customerId) throw new Error("Customer data request is missing a customer ID.");
  const customerId = request.customerId;
  const email = request.customerEmail;

  const [releases, contributors, portalAccess, portalPolicy, deliveries] = await Promise.all([
    db.release.findMany({
      where: { shop: request.shop, ownerCustomerId: customerId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        title: true,
        status: true,
        distributionStatus: true,
        upc: true,
        catalogNumber: true,
        primaryGenre: true,
        releaseDate: true,
        submittedAt: true,
        createdAt: true,
        updatedAt: true,
        artists: {
          orderBy: { position: "asc" },
          select: { role: true, artist: { select: { name: true } } },
        },
        tracks: {
          orderBy: { position: "asc" },
          select: {
            position: true,
            title: true,
            version: true,
            language: true,
            explicit: true,
            isrc: true,
            lyrics: true,
            artists: { orderBy: { position: "asc" }, select: { role: true, artist: { select: { name: true } } } },
            credits: { select: { role: true, ownershipPercent: true, contributor: { select: { legalName: true, stageName: true, pro: true, ipi: true, publisherName: true } } } },
          },
        },
        files: {
          select: { kind: true, filename: true, url: true, mimeType: true, sizeBytes: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    db.contributor.findMany({
      where: { shop: request.shop, ownerCustomerId: customerId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        legalName: true,
        stageName: true,
        email: true,
        pro: true,
        ipi: true,
        publisherName: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.portalArtistAccess.findMany({
      where: { shop: request.shop, customerId },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        createdAt: true,
        updatedAt: true,
        artist: {
          select: {
            id: true,
            name: true,
            legalName: true,
            email: true,
            spotifyUrl: true,
            appleMusicUrl: true,
            websiteUrl: true,
            imageUrl: true,
            biography: true,
            pro: true,
            ipi: true,
            instagramUrl: true,
            facebookUrl: true,
            tiktokUrl: true,
            youtubeUrl: true,
            xUrl: true,
            notes: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    }),
    db.portalCustomerPolicy.findUnique({
      where: { shop_customerId: { shop: request.shop, customerId } },
      select: { artistMode: true, createdAt: true, updatedAt: true, soloArtist: { select: { id: true, name: true } } },
    }),
    db.notificationDelivery.findMany({
      where: {
        shop: request.shop,
        ...(email ? { recipient: { in: [customerId, email] } } : { recipient: customerId }),
      },
      orderBy: { createdAt: "asc" },
      select: { channel: true, recipient: true, status: true, attempts: true, sentAt: true, createdAt: true },
    }),
  ]);

  return JSON.parse(JSON.stringify({
    generatedAt: new Date().toISOString(),
    request: {
      shop: request.shop,
      shopifyRequestId: request.shopifyRequestId,
      customerId,
      customerEmail: email,
    },
    portal: {
      policy: portalPolicy,
      artistAccess: portalAccess,
    },
    releases,
    contributors,
    notificationDeliveries: deliveries,
  }));
}

function redactText(value, tokens) {
  if (!value) return value;
  let next = String(value);
  for (const token of tokens.filter(Boolean)) next = next.split(token).join("[redacted customer]");
  return next;
}

async function redactCustomer(request) {
  if (!request.customerId) throw new Error("Customer redaction request is missing a customer ID.");
  const customerId = request.customerId;
  const email = request.customerEmail;
  const tokens = [customerId, email].filter(Boolean);

  const events = tokens.length
    ? await db.submissionEvent.findMany({
        where: {
          release: { shop: request.shop },
          OR: tokens.map((token) => ({ message: { contains: token } })),
        },
        select: { id: true, message: true },
      })
    : [];

  await db.$transaction(async (tx) => {
    await tx.portalArtistAccess.deleteMany({ where: { shop: request.shop, customerId } });
    await tx.portalCustomerPolicy.deleteMany({ where: { shop: request.shop, customerId } });
    await tx.release.updateMany({ where: { shop: request.shop, ownerCustomerId: customerId }, data: { ownerCustomerId: null } });
    await tx.contributor.updateMany({ where: { shop: request.shop, ownerCustomerId: customerId }, data: { ownerCustomerId: null } });

    if (tokens.length) {
      await tx.notificationDelivery.updateMany({
        where: { shop: request.shop, recipient: { in: tokens } },
        data: { recipient: null, lastError: null },
      });
      for (const event of events) {
        await tx.submissionEvent.update({
          where: { id: event.id },
          data: { message: redactText(event.message, tokens) },
        });
      }
    }

    await tx.privacyRequest.updateMany({
      where: {
        shop: request.shop,
        OR: [
          { customerId },
          ...(email ? [{ customerEmail: email }] : []),
        ],
      },
      data: { customerId: null, customerEmail: null },
    });
  });
}

async function deletePrivateShopFiles(shop) {
  const files = await db.releaseFile.findMany({
    where: {
      release: { shop },
      storageProvider: { in: ["R2", "LOCAL_DEV"] },
      storageKey: { not: null },
    },
    select: {
      storageProvider: true,
      storageKey: true,
      releaseId: true,
      trackId: true,
    },
  });

  const failures = [];
  for (let offset = 0; offset < files.length; offset += 20) {
    const batch = files.slice(offset, offset + 20);
    const results = await Promise.allSettled(
      batch.map((file) => deleteMasterStorageObject({
        storageProvider: file.storageProvider,
        storageKey: file.storageKey,
        shop,
        releaseId: file.releaseId,
        trackId: file.trackId,
      })),
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") failures.push({ file: batch[index], error: result.reason });
    });
  }

  if (failures.length) {
    throw new Error(`ReleaseCore could not remove ${failures.length} private storage object(s) for shop redaction.`);
  }
}

async function redactShop(request) {
  await deletePrivateShopFiles(request.shop);

  await db.$transaction(async (tx) => {
    await tx.release.deleteMany({ where: { shop: request.shop } });
    await tx.portalArtistAccess.deleteMany({ where: { shop: request.shop } });
    await tx.portalCustomerPolicy.deleteMany({ where: { shop: request.shop } });
    await tx.artist.deleteMany({ where: { shop: request.shop } });
    await tx.contributor.deleteMany({ where: { shop: request.shop } });
    await tx.notificationDelivery.deleteMany({ where: { shop: request.shop } });
    await tx.appSettings.deleteMany({ where: { shop: request.shop } });
    await tx.isrcSequence.deleteMany({ where: { shop: request.shop } });
    await tx.upcSequence.deleteMany({ where: { shop: request.shop } });
    await tx.catalogSequence.deleteMany({ where: { shop: request.shop } });
    await tx.session.deleteMany({ where: { shop: request.shop } });
    await tx.privacyRequest.deleteMany({ where: { shop: request.shop } });
  });
}

export async function processPrivacyRequestById(id) {
  const claimed = await db.privacyRequest.updateMany({
    where: { id, status: { in: ACTIVE_STATUSES }, attempts: { lt: MAX_ATTEMPTS } },
    data: { status: "PROCESSING", attempts: { increment: 1 }, lastError: null },
  });
  if (!claimed.count) return null;

  const request = await db.privacyRequest.findUnique({ where: { id } });
  if (!request) return null;

  try {
    if (request.topic === PRIVACY_TOPICS.DATA_REQUEST) {
      await buildCustomerDataExport(request);
      return db.privacyRequest.update({
        where: { id },
        data: { status: "COMPLETED", processedAt: new Date(), lastError: null },
      });
    }

    if (request.topic === PRIVACY_TOPICS.CUSTOMER_REDACT) {
      await redactCustomer(request);
      return db.privacyRequest.update({
        where: { id },
        data: { status: "COMPLETED", customerId: null, customerEmail: null, processedAt: new Date(), lastError: null },
      });
    }

    if (request.topic === PRIVACY_TOPICS.SHOP_REDACT) {
      await redactShop(request);
      return null;
    }

    throw new Error(`Unsupported privacy request topic: ${request.topic}`);
  } catch (error) {
    const message = safeDiagnosticText(error instanceof Error ? error.message : error, 1000) || "Privacy request processing failed.";
    await db.privacyRequest.updateMany({
      where: { id },
      data: { status: "FAILED", lastError: message },
    });
    console.error("ReleaseCore privacy request failed", { id, topic: request.topic, shop: request.shop, error: message });
    throw error;
  }
}
