import db from "../db.server";
import {
  customerCanManageMultipleArtists,
  portalMultiArtistTag,
} from "./portal-access-rules.server";

import { AUTOMATION_CHANNELS, parseEventList, normalizeEventKey } from "./automations";
import { sendAutomationEmail } from "./email-delivery.server";
import { safeDiagnosticText } from "./http-security.server";

import { customerNumericId } from "./automations";

export {
  AUTOMATION_CHANNELS,
  AUTOMATION_EVENT_KEYS,
  parseEventList,
  normalizeEventKey,
  customerNumericId,
} from "./automations";

export async function getShopifyCustomer(admin, customerId) {
  const numericId = customerNumericId(customerId);
  if (!admin || !numericId) return null;
  const response = await admin.graphql(
    `#graphql
      query ReleaseCoreCustomer($id: ID!) {
        customer(id: $id) {
          id
          displayName
          email
          tags
        }
      }`,
    { variables: { id: `gid://shopify/Customer/${numericId}` } },
  );
  const json = await response.json();
  return json?.data?.customer || null;
}

function parseTags(value) {
  return String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

function typeConfig(settings, type) {
  if (type === "EP") return { enabled: settings?.releaseEpEnabled ?? true, requiredTags: parseTags(settings?.releaseEpRequiredTags) };
  if (type === "ALBUM") return { enabled: settings?.releaseAlbumEnabled ?? true, requiredTags: parseTags(settings?.releaseAlbumRequiredTags) };
  return { enabled: settings?.releaseSingleEnabled ?? true, requiredTags: parseTags(settings?.releaseSingleRequiredTags) };
}

export function releaseTypeEligibility({ settings = {}, customerTags = [], type }) {
  const config = typeConfig(settings, type);
  const tags = new Set((customerTags || []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean));
  const required = config.requiredTags;
  const matchMode = String(settings?.releaseTagMatchMode || "ANY").toUpperCase() === "ALL" ? "ALL" : "ANY";
  const tagMatch = !required.length || (matchMode === "ALL"
    ? required.every((tag) => tags.has(tag.toLowerCase()))
    : required.some((tag) => tags.has(tag.toLowerCase())));
  const allowed = Boolean(config.enabled) && tagMatch;
  let reason = null;
  if (!config.enabled) reason = "This release type is currently unavailable.";
  else if (!tagMatch) reason = settings?.releaseAccessLockMessage || `Your account does not have the required access tag${required.length === 1 ? "" : "s"}.`;
  return { allowed, enabled: Boolean(config.enabled), requiredTags: required, matchMode, reason };
}

export async function portalReleaseAccess({ admin, shop, customerId }) {
  const settings = (await db.appSettings.findUnique({ where: { shop } })) || {};
  const numericCustomerId =
    customerNumericId(customerId) || String(customerId || "");

  const [customer, policy, artistAccessRows] = await Promise.all([
    getShopifyCustomer(admin, customerId),
    db.portalCustomerPolicy.findUnique({
      where: {
        shop_customerId: {
          shop,
          customerId: numericCustomerId,
        },
      },
      include: { soloArtist: true },
    }).catch(() => null),
    db.portalArtistAccess.findMany({
      where: {
        shop,
        customerId: numericCustomerId,
      },
      include: { artist: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const customerTags = customer?.tags || [];
  const multiArtistTag = portalMultiArtistTag();
  const canManageMultipleArtists =
    customerCanManageMultipleArtists(customerTags);

  const assignedArtists = [];
  const seenArtistIds = new Set();

  for (const row of artistAccessRows) {
    if (!row?.artist?.id || seenArtistIds.has(row.artist.id)) continue;
    seenArtistIds.add(row.artist.id);
    assignedArtists.push({
      id: row.artist.id,
      name: row.artist.name,
    });
  }

  if (
    policy?.soloArtist?.id &&
    !seenArtistIds.has(policy.soloArtist.id)
  ) {
    assignedArtists.push({
      id: policy.soloArtist.id,
      name: policy.soloArtist.name,
    });
  }

  const mode = canManageMultipleArtists ? "MULTI" : "SOLO";
  const soloArtist =
    mode === "SOLO" ? assignedArtists[0] || null : null;

  return {
    customerTags,
    customer: customer
      ? {
          id: customer.id,
          displayName: customer.displayName,
          email: customer.email,
        }
      : null,
    artistAccess: {
      mode,
      soloArtist,
      artists: assignedArtists,
      needsArtistSetup: assignedArtists.length === 0,
      canManageMultipleArtists,
      multiArtistTag,
    },
    options: {
      SINGLE: releaseTypeEligibility({
        settings,
        customerTags,
        type: "SINGLE",
      }),
      EP: releaseTypeEligibility({
        settings,
        customerTags,
        type: "EP",
      }),
      ALBUM: releaseTypeEligibility({
        settings,
        customerTags,
        type: "ALBUM",
      }),
    },
  };
}

function eventCopy(eventKey, release, event) {
  const title = release.title || "Your release";
  const copies = {
    SUBMITTED: { subject: `${title} was submitted`, heading: "Submission received", body: "Your release has been submitted and is ready for review." },
    CHANGES_REQUESTED: { subject: `Changes requested for ${title}`, heading: "Changes requested", body: event.message || "Your release needs changes before it can continue." },
    APPROVED: { subject: `${title} was approved`, heading: "Release approved", body: "Your release has been approved and moved into the distribution queue." },
    REJECTED: { subject: `${title} was not approved`, heading: "Release decision", body: event.message || "Your release was not approved." },
    PROCESSING: { subject: `${title} is being processed`, heading: "Distribution processing", body: "Your release is being prepared for delivery to stores." },
    SUBMITTED_TO_STORES: { subject: `${title} was submitted to stores`, heading: "Submitted to stores", body: "Your release has been submitted to the configured distribution partner or stores." },
    DELIVERED: { subject: `${title} distribution is complete`, heading: "Distribution complete", body: "ReleaseCore has marked this release as distribution complete." },
    SHOPIFY_PRODUCTS_SYNCED: { subject: `${title} Shopify products synced`, heading: "Shopify products synced", body: event.message || "Shopify product data was synchronized." },
  };
  return copies[eventKey] || { subject: `${title} update`, heading: "Release update", body: event.message || "Your release was updated." };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function emailHtml({ settings, release, event, eventKey }) {
  const copy = eventCopy(eventKey, release, event);
  const brand = settings?.emailBrandName || settings?.defaultLabelName || "ReleaseCore";
  const footer = settings?.emailFooterText || "This message was sent because this release is managed through ReleaseCore.";
  const portalUrl = settings?.portalUrl || "";
  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#191919"><table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:32px 16px"><table width="100%" style="max-width:620px;background:#fff;border:1px solid #e5e5e5;border-radius:14px" cellpadding="0" cellspacing="0" role="presentation"><tr><td style="padding:28px"><div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#666">${escapeHtml(brand)}</div><h1 style="font-size:28px;line-height:1.15;margin:10px 0 12px">${escapeHtml(copy.heading)}</h1><p style="font-size:16px;line-height:1.6;margin:0 0 20px;color:#444">${escapeHtml(copy.body)}</p><div style="padding:16px;border-radius:10px;background:#f7f7f7"><strong>${escapeHtml(release.title)}</strong><br><span style="color:#666">${escapeHtml(release.type)} · ${escapeHtml(release.artistName || "Artist")}</span></div>${portalUrl ? `<p style="margin:22px 0 0"><a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#191919;color:#fff;text-decoration:none;padding:11px 16px;border-radius:8px">Open release portal</a></p>` : ""}<p style="font-size:12px;line-height:1.5;color:#888;margin:28px 0 0">${escapeHtml(footer)}</p></td></tr></table></td></tr></table></body></html>`;
}

async function sendFlowTrigger({ admin, release, customerId, eventKey }) {
  if (!admin) throw new Error("Shopify Admin API is unavailable.");
  const numericCustomerId = customerNumericId(customerId);
  if (!numericCustomerId) throw new Error("This release has no Shopify customer owner for the Flow customer reference.");
  const response = await admin.graphql(
    `#graphql
      mutation ReleaseCoreFlowEvent($handle: String, $payload: JSON) {
        flowTriggerReceive(handle: $handle, payload: $payload) {
          userErrors { field message }
        }
      }`,
    {
      variables: {
        handle: "release-event-occurred",
        payload: {
          customer_id: Number(numericCustomerId),
          "Event type": eventKey,
          "Release ID": release.id,
          "Release title": release.title || "",
          "Release type": release.type || "",
          "Release status": release.status || "",
          "Distribution status": release.distributionStatus || "NOT_QUEUED",
          "UPC": release.upc || "",
          "Catalog number": release.catalogNumber || "",
          "Track count": Number(release.tracks?.length || 0),
        },
      },
    },
  );
  const json = await response.json();
  const errors = json?.data?.flowTriggerReceive?.userErrors || [];
  if (errors.length) throw new Error(errors.map((item) => item.message).join(" "));
  return "release-event-occurred";
}

async function deliveryAttempt({ shop, releaseId, eventId, channel, recipient, force, runner }) {
  const existing = await db.notificationDelivery.findUnique({ where: { eventId_channel: { eventId, channel } } });
  if (existing?.status === "SENT" && !force) return existing;
  const delivery = await db.notificationDelivery.upsert({
    where: { eventId_channel: { eventId, channel } },
    create: { shop, releaseId, eventId, channel, recipient: recipient || null, status: "PENDING", attempts: 1 },
    update: { recipient: recipient || null, status: "PENDING", attempts: { increment: 1 }, lastError: null },
  });
  try {
    const providerId = await runner();
    return db.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "SENT", providerId: providerId || null, lastError: null, sentAt: new Date() } });
  } catch (error) {
    return db.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", lastError: safeDiagnosticText(error instanceof Error ? error.message : "Delivery failed.", 600) } });
  }
}

export async function dispatchReleaseEvent({ admin, shop, eventId, forceChannels = [] }) {
  const event = await db.submissionEvent.findFirst({
    where: { id: eventId, release: { shop } },
    include: {
      release: {
        include: {
          tracks: { select: { id: true } },
          artists: { include: { artist: true }, orderBy: { position: "asc" } },
        },
      },
    },
  });
  if (!event?.release) return [];
  const release = event.release;
  const settings = (await db.appSettings.findUnique({ where: { shop } })) || {};
  const eventKey = normalizeEventKey(event.type);
  const customer = release.ownerCustomerId ? await getShopifyCustomer(admin, release.ownerCustomerId) : null;
  const copy = eventCopy(eventKey, release, event);
  const html = emailHtml({ settings, release, event, eventKey });
  const force = new Set(forceChannels);
  const results = [];

  if (parseEventList(settings.artistEmailEvents).has(eventKey) || force.has(AUTOMATION_CHANNELS.ARTIST_EMAIL)) {
    results.push(await deliveryAttempt({ shop, releaseId: release.id, eventId, channel: AUTOMATION_CHANNELS.ARTIST_EMAIL, recipient: customer?.email || null, force: force.has(AUTOMATION_CHANNELS.ARTIST_EMAIL), runner: () => { if (!customer?.email) throw new Error("The release owner has no Shopify customer email address."); return sendAutomationEmail({ settings, to: customer.email, subject: copy.subject, html }); } }));
  }
  if (parseEventList(settings.adminEmailEvents).has(eventKey) || force.has(AUTOMATION_CHANNELS.ADMIN_EMAIL)) {
    results.push(await deliveryAttempt({ shop, releaseId: release.id, eventId, channel: AUTOMATION_CHANNELS.ADMIN_EMAIL, recipient: settings.adminNotificationEmail || null, force: force.has(AUTOMATION_CHANNELS.ADMIN_EMAIL), runner: () => { if (!settings.adminNotificationEmail) throw new Error("Internal notification email is not configured."); return sendAutomationEmail({ settings, to: settings.adminNotificationEmail, subject: `[Admin] ${copy.subject}`, html }); } }));
  }
  if (parseEventList(settings.flowEvents).has(eventKey) || force.has(AUTOMATION_CHANNELS.SHOPIFY_FLOW)) {
    results.push(await deliveryAttempt({ shop, releaseId: release.id, eventId, channel: AUTOMATION_CHANNELS.SHOPIFY_FLOW, recipient: release.ownerCustomerId || null, force: force.has(AUTOMATION_CHANNELS.SHOPIFY_FLOW), runner: () => { if (!release.ownerCustomerId) throw new Error("Assign a Shopify customer owner before triggering Flow."); return sendFlowTrigger({ admin, release, customerId: release.ownerCustomerId, eventKey }); } }));
  }
  return results;
}

export async function dispatchLatestEvent({ admin, shop, releaseId, type }) {
  try {
    const event = await db.submissionEvent.findFirst({ where: { releaseId, type, release: { shop } }, orderBy: { createdAt: "desc" } });
    if (!event) return [];
    return await dispatchReleaseEvent({ admin, shop, eventId: event.id });
  } catch (error) {
    console.warn("ReleaseCore automation dispatch skipped", error);
    return [];
  }
}
