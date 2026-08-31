import { authenticate } from "../shopify.server";
import db from "../db.server";
import { AUTOMATION_EVENT_KEYS } from "../lib/automations.server";
import {
  encryptSmtpPassword,
  sendSmtpEmail,
  verifySmtpConnection,
} from "../lib/smtp.server";

const text = (value) => {
  const normalized = String(value || "").trim();
  return normalized || null;
};

const normalizeEvents = (value) => {
  const allowed = new Set(AUTOMATION_EVENT_KEYS);
  return [
    ...new Set(
      String(value || "")
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter((item) => allowed.has(item)),
    ),
  ].join(",");
};

const normalizeTags = (value) =>
  [
    ...new Set(
      String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].join(", ") || null;

function smtpSecurity(value) {
  const normalized = String(value || "STARTTLS").toUpperCase();
  return ["STARTTLS", "SSL_TLS", "NONE"].includes(normalized)
    ? normalized
    : "STARTTLS";
}

function smtpPort(value) {
  const port = Number(value || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP port must be between 1 and 65535.");
  }
  return port;
}

async function settingsForShop(shop) {
  return (await db.appSettings.findUnique({ where: { shop } })) || null;
}

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  }

  try {
    const { session } = await authenticate.admin(request);
    const form = await request.formData();
    const intent = String(form.get("intent") || "");

    if (intent === "save-automation") {
      const releaseTagMatchMode =
        String(form.get("releaseTagMatchMode") || "ANY").toUpperCase() === "ALL"
          ? "ALL"
          : "ANY";
      const existing = await settingsForShop(session.shop);
      const suppliedPassword = String(form.get("smtpPassword") || "");
      const clearPassword = form.get("clearSmtpPassword") === "on";
      let smtpPasswordEncrypted = existing?.smtpPasswordEncrypted || null;

      if (clearPassword) smtpPasswordEncrypted = null;
      else if (suppliedPassword) smtpPasswordEncrypted = encryptSmtpPassword(suppliedPassword);

      const data = {
        releaseSingleEnabled: form.get("releaseSingleEnabled") === "on",
        releaseSingleRequiredTags: normalizeTags(form.get("releaseSingleRequiredTags")),
        releaseEpEnabled: form.get("releaseEpEnabled") === "on",
        releaseEpRequiredTags: normalizeTags(form.get("releaseEpRequiredTags")),
        releaseAlbumEnabled: form.get("releaseAlbumEnabled") === "on",
        releaseAlbumRequiredTags: normalizeTags(form.get("releaseAlbumRequiredTags")),
        releaseTagMatchMode,
        releaseAccessLockMessage: text(form.get("releaseAccessLockMessage")),
        artistEmailEvents: normalizeEvents(form.get("artistEmailEvents")),
        adminEmailEvents: normalizeEvents(form.get("adminEmailEvents")),
        flowEvents: normalizeEvents(form.get("flowEvents")),

        smtpEnabled: form.get("smtpEnabled") === "on",
        smtpHost: text(form.get("smtpHost")),
        smtpPort: smtpPort(form.get("smtpPort")),
        smtpSecurity: smtpSecurity(form.get("smtpSecurity")),
        smtpUsername: text(form.get("smtpUsername")),
        smtpPasswordEncrypted,

        emailSenderName: text(form.get("emailSenderName")),
        emailFromAddress: text(form.get("emailFromAddress")),
        emailReplyTo: text(form.get("emailReplyTo")),
        adminNotificationEmail: text(form.get("adminNotificationEmail")),
        emailBrandName: text(form.get("emailBrandName")),
        emailFooterText: text(form.get("emailFooterText")),
        portalUrl: text(form.get("portalUrl")),
      };

      await db.appSettings.upsert({
        where: { shop: session.shop },
        create: { shop: session.shop, ...data },
        update: data,
      });

      return Response.json({ ok: true, message: "Automation, access and SMTP settings saved." });
    }

    if (intent === "test-smtp") {
      const settings = await settingsForShop(session.shop);
      if (!settings) throw new Error("Save your SMTP settings before testing the connection.");
      await verifySmtpConnection(settings);
      return Response.json({ ok: true, message: "SMTP connection and authentication succeeded." });
    }

    if (intent === "send-test-email") {
      const settings = await settingsForShop(session.shop);
      if (!settings) throw new Error("Save your SMTP settings before sending a test email.");
      const to = text(form.get("testEmail")) || settings.adminNotificationEmail || settings.emailFromAddress;
      if (!to) throw new Error("Enter a test recipient or configure an internal notification email.");
      const messageId = await sendSmtpEmail({
        settings,
        to,
        subject: "ReleaseCore SMTP test",
        html: '<div style="font-family:Arial,sans-serif;line-height:1.55"><h2>ReleaseCore SMTP is connected.</h2><p>This test message was sent through the SMTP server configured for this Shopify store.</p></div>',
        text: "ReleaseCore SMTP is connected. This test message was sent through the SMTP server configured for this Shopify store.",
      });
      return Response.json({ ok: true, message: `Test email sent to ${to}.`, messageId });
    }

    return Response.json({ ok: false, error: "Unknown automation action." }, { status: 400 });
  } catch (error) {
    console.error("ReleaseCore automation settings failed", error);
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not process automation settings.",
      },
      { status: 500 },
    );
  }
};
