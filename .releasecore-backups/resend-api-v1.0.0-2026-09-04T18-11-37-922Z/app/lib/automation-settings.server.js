import db from "../db.server";
import { AUTOMATION_EVENT_KEYS } from "./automations.server";
import { publicError } from "./http-security.server";
import {
  encryptSmtpPassword,
  sendSmtpEmail,
  smtpEncryptionConfigured,
  verifySmtpConnection,
} from "./smtp.server";

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

function normalizeSmtpSecurity(value) {
  const normalized = String(value || "STARTTLS").toUpperCase();
  return ["STARTTLS", "SSL_TLS", "NONE"].includes(normalized)
    ? normalized
    : "STARTTLS";
}

function normalizeSmtpPort(value) {
  const port = Number(value || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw publicError("SMTP port must be between 1 and 65535.", { status: 400 });
  }
  return port;
}

export function automationSettingsForShop(shop) {
  return db.appSettings.findUnique({ where: { shop } });
}

export async function loadAutomationSettings(shop) {
  const stored = await automationSettingsForShop(shop);
  if (!stored) {
    return {
      settings: null,
      smtpPasswordStored: false,
      encryptionConfigured: smtpEncryptionConfigured(),
    };
  }
  const { smtpPasswordEncrypted, ...settings } = stored;
  return {
    settings,
    smtpPasswordStored: Boolean(smtpPasswordEncrypted),
    encryptionConfigured: smtpEncryptionConfigured(),
  };
}

// RELEASECORE_SMTP_HOTFIX_V101: SMTP save/test actions use one deterministic persistence path.
async function saveAutomationSettingsFromForm({ shop, form }) {
  const releaseTagMatchMode =
    String(form.get("releaseTagMatchMode") || "ANY").toUpperCase() === "ALL"
      ? "ALL"
      : "ANY";

  const existing = await automationSettingsForShop(shop);
  const suppliedPassword = String(form.get("smtpPassword") || "");
  const clearPassword = form.get("clearSmtpPassword") === "on";
  let smtpPasswordEncrypted = existing?.smtpPasswordEncrypted || null;

  if (clearPassword) smtpPasswordEncrypted = null;
  else if (suppliedPassword) {
    smtpPasswordEncrypted = encryptSmtpPassword(suppliedPassword);
  }

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
    smtpPort: normalizeSmtpPort(form.get("smtpPort")),
    smtpSecurity: normalizeSmtpSecurity(form.get("smtpSecurity")),
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

  return db.appSettings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
}

function requireEnabledSmtp(settings, message) {
  if (!settings?.smtpEnabled) {
    throw publicError(message, { status: 400 });
  }
  if (!String(settings.smtpHost || "").trim()) {
    throw publicError("Enter an SMTP host before testing email delivery.", { status: 400 });
  }
  if (String(settings.smtpUsername || "").trim() && !settings.smtpPasswordEncrypted) {
    throw publicError("Enter and save the SMTP password before testing email delivery.", { status: 400 });
  }
}

export async function performAutomationSettingsAction({ shop, form }) {
  const intent = String(form.get("intent") || "");

  if (intent === "save-automation") {
    await saveAutomationSettingsFromForm({ shop, form });
    return { message: "Automation, access and SMTP settings saved." };
  }

  if (intent === "test-smtp") {
    const settings = form.get("smtpSettingsIncluded") === "on"
      ? await saveAutomationSettingsFromForm({ shop, form })
      : await automationSettingsForShop(shop);

    if (!settings) {
      throw publicError("Save your SMTP settings before testing the connection.", {
        status: 400,
      });
    }

    requireEnabledSmtp(
      settings,
      "Enable SMTP email delivery before testing the connection.",
    );

    try {
      await verifySmtpConnection(settings);
    } catch (error) {
      throw publicError(
        "SMTP connection failed: " + String(error?.message || error || "Unknown SMTP error").slice(0, 500),
        { status: 400 },
      );
    }

    return { message: "SMTP connection and authentication succeeded." };
  }

  if (intent === "send-test-email") {
    const settings = form.get("smtpSettingsIncluded") === "on"
      ? await saveAutomationSettingsFromForm({ shop, form })
      : await automationSettingsForShop(shop);

    if (!settings) {
      throw publicError(
        "Save your SMTP settings before sending a test email.",
        { status: 400 },
      );
    }

    requireEnabledSmtp(
      settings,
      "Enable SMTP email delivery before sending a test email.",
    );

    const to =
      text(form.get("testEmail")) ||
      settings.adminNotificationEmail ||
      settings.emailFromAddress;

    if (!to) {
      throw publicError(
        "Enter a test recipient or configure an internal notification email.",
        { status: 400 },
      );
    }

    let messageId;
    try {
      messageId = await sendSmtpEmail({
        settings,
        to,
        subject: "ReleaseCore SMTP test",
        html: '<div style="font-family:Arial,sans-serif;line-height:1.55"><h2>ReleaseCore SMTP is connected.</h2><p>This test message was sent through the SMTP server configured for this Shopify store.</p></div>',
        text: "ReleaseCore SMTP is connected. This test message was sent through the SMTP server configured for this Shopify store.",
      });
    } catch (error) {
      throw publicError(
        "SMTP test email failed: " + String(error?.message || error || "Unknown SMTP error").slice(0, 500),
        { status: 400 },
      );
    }

    return { message: "Test email sent to " + to + ".", messageId };
  }

  throw publicError("Unknown automation action.", { status: 400 });
}
