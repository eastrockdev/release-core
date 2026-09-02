import { authenticate } from "../shopify.server";
import db from "../db.server";
import { AUTOMATION_CHANNELS, dispatchReleaseEvent } from "../lib/automations.server";
import { apiErrorResponse, safeDiagnosticText } from "../lib/http-security.server";
import { findShopSubmissionEvent } from "../lib/tenant-db.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  try {
    const { admin, session } = await authenticate.admin(request);
    const form = await request.formData();
    const eventId = String(form.get("eventId") || "");
    const channel = String(form.get("channel") || "");
    if (!Object.values(AUTOMATION_CHANNELS).includes(channel)) return Response.json({ ok: false, error: "Choose a valid notification channel." }, { status: 400 });
    const event = await findShopSubmissionEvent(session.shop, eventId);
    if (!event) return Response.json({ ok: false, error: "Release event not found." }, { status: 404 });
    const deliveries = await dispatchReleaseEvent({ admin, shop: session.shop, eventId, forceChannels: [channel] });
    const delivery = deliveries.find((item) => item.channel === channel) || await db.notificationDelivery.findFirst({ where: { eventId, channel, shop: session.shop } });
    if (delivery?.status === "FAILED") return Response.json({ ok: false, error: safeDiagnosticText(delivery.lastError || "Delivery failed.", 600) }, { status: 409 });
    return Response.json({ ok: true, message: `${channel.replaceAll("_", " ").toLowerCase()} triggered.` });
  } catch (error) {
    return apiErrorResponse(request, error, { context: "notification retry", fallback: "Could not retry delivery." });
  }
};
