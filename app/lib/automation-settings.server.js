import db from "../db.server";
import { AUTOMATION_EVENT_KEYS } from "./automations.server";
import { publicError } from "./http-security.server";
import {
  encryptSmtpPassword,
  smtpEncryptionConfigured,
  verifySmtpConnection,
} from "./smtp.server";
import { encryptResendApiKey } from "./resend.server";
import {
  EMAIL_DELIVERY_PROVIDERS,
  emailDeliveryProvider,
  sendAutomationEmail,
} from "./email-delivery.server";

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
      resendApiKeyStored: false,
      encryptionConfigured: smtpEncryptionConfigured(),
    };
  }

  const { smtpPasswordEncrypted, resendApiKeyEncrypted, ...settings } = stored;
  return {
    settings,
    smtpPasswordStored: Boolean(smtpPasswordEncrypted),
    resendApiKeyStored: Boolean(resendApiKeyEncrypted),
    encryptionConfigured: smtpEncryptionConfigured(),
  };
}

function normalizeEmailDeliveryProvider(value) {
  return String(value || "SMTP").toUpperCase() === "RESEND"
    ? EMAIL_DELIVERY_PROVIDERS.RESEND
    : EMAIL_DELIVERY_PROVIDERS.SMTP;
}

async function saveAccessSettingsFromForm({ shop, form }) {
  const releaseTagMatchMode =
    String(form.get("releaseTagMatchMode") || "ANY").toUpperCase() === "ALL"
      ? "ALL"
      : "ANY";

  const data = {
    releaseSingleEnabled: form.get("releaseSingleEnabled") === "on",
    releaseSingleRequiredTags: normalizeTags(form.get("releaseSingleRequiredTags")),
    releaseEpEnabled: form.get("releaseEpEnabled") === "on",
    releaseEpRequiredTags: normalizeTags(form.get("releaseEpRequiredTags")),
    releaseAlbumEnabled: form.get("releaseAlbumEnabled") === "on",
    releaseAlbumRequiredTags: normalizeTags(form.get("releaseAlbumRequiredTags")),
    releaseTagMatchMode,
    releaseAccessLockMessage: text(form.get("releaseAccessLockMessage")),
    flowEvents: normalizeEvents(form.get("flowEvents")),
  };

  return db.appSettings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
}

async function saveEmailSettingsFromForm({ shop, form }) {
  const existing = await automationSettingsForShop(shop);

  const suppliedPassword = String(form.get("smtpPassword") || "");
  const clearPassword = form.get("clearSmtpPassword") === "on";
  let smtpPasswordEncrypted = existing?.smtpPasswordEncrypted || null;
  if (clearPassword) smtpPasswordEncrypted = null;
  else if (suppliedPassword) smtpPasswordEncrypted = encryptSmtpPassword(suppliedPassword);

  const suppliedResendApiKey = String(form.get("resendApiKey") || "").trim();
  const clearResendApiKey = form.get("clearResendApiKey") === "on";
  let resendApiKeyEncrypted = existing?.resendApiKeyEncrypted || null;
  if (clearResendApiKey) resendApiKeyEncrypted = null;
  else if (suppliedResendApiKey) {
    resendApiKeyEncrypted = encryptResendApiKey(suppliedResendApiKey);
  }

  const provider = normalizeEmailDeliveryProvider(
    form.has("emailDeliveryProvider")
      ? form.get("emailDeliveryProvider")
      : existing?.emailDeliveryProvider,
  );

  const data = {
    artistEmailEvents: normalizeEvents(form.get("artistEmailEvents")),
    adminEmailEvents: normalizeEvents(form.get("adminEmailEvents")),
    smtpEnabled: form.get("smtpEnabled") === "on",
    smtpHost: text(form.get("smtpHost")),
    smtpPort: normalizeSmtpPort(form.get("smtpPort")),
    smtpSecurity: normalizeSmtpSecurity(form.get("smtpSecurity")),
    smtpUsername: text(form.get("smtpUsername")),
    smtpPasswordEncrypted,
    emailDeliveryProvider: provider,
    resendApiKeyEncrypted,
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

// Backward-compatible full save for any older UI still posting save-automation.
async function saveAutomationSettingsFromForm({ shop, form }) {
  await saveAccessSettingsFromForm({ shop, form });
  return saveEmailSettingsFromForm({ shop, form });
}

function requireEmailDelivery(settings, message) {
  if (!settings?.smtpEnabled) {
    throw publicError(message, { status: 400 });
  }

  const provider = emailDeliveryProvider(settings);
  if (provider === EMAIL_DELIVERY_PROVIDERS.RESEND) {
    if (!settings.resendApiKeyEncrypted) {
      throw publicError("Enter and save a Resend API key before testing email delivery.", { status: 400 });
    }
    if (!String(settings.emailFromAddress || "").trim()) {
      throw publicError("Enter a From address on a verified Resend sending domain.", { status: 400 });
    }
    return provider;
  }

  if (!String(settings.smtpHost || "").trim()) {
    throw publicError("Enter an SMTP host before testing email delivery.", { status: 400 });
  }
  if (String(settings.smtpUsername || "").trim() && !settings.smtpPasswordEncrypted) {
    throw publicError("Enter and save the SMTP password before testing email delivery.", { status: 400 });
  }
  return provider;
}

export async function performAutomationSettingsAction({ shop, form }) {
  const intent = String(form.get("intent") || "");

  if (intent === "save-access-settings") {
    await saveAccessSettingsFromForm({ shop, form });
    return { message: "Release access and Shopify Flow settings saved." };
  }

  if (intent === "save-email-settings") {
    const settings = await saveEmailSettingsFromForm({ shop, form });
    return {
      message: "Email delivery settings saved.",
      provider: emailDeliveryProvider(settings),
    };
  }

  if (intent === "save-automation") {
    const settings = await saveAutomationSettingsFromForm({ shop, form });
    return {
      message: "Automation, access and email delivery settings saved.",
      provider: emailDeliveryProvider(settings),
    };
  }

  if (intent === "test-email-provider" || intent === "test-smtp") {
    const settings = form.get("emailSettingsIncluded") === "on" || form.get("smtpSettingsIncluded") === "on"
      ? await saveEmailSettingsFromForm({ shop, form })
      : await automationSettingsForShop(shop);

    if (!settings) {
      throw publicError("Save your email delivery settings before testing.", { status: 400 });
    }

    const provider = requireEmailDelivery(
      settings,
      "Enable email delivery before testing the provider.",
    );

    if (provider === EMAIL_DELIVERY_PROVIDERS.RESEND) {
      return {
        message: "Resend settings are saved. Send a test email to verify the API key and sender domain.",
        provider,
      };
    }

    try {
      await verifySmtpConnection(settings);
    } catch (error) {
      throw publicError(
        "SMTP connection failed: " + String(error?.message || error || "Unknown SMTP error").slice(0, 500),
        { status: 400 },
      );
    }

    return { message: "SMTP connection and authentication succeeded.", provider };
  }

  if (intent === "send-test-email") {
    const settings = form.get("emailSettingsIncluded") === "on" || form.get("smtpSettingsIncluded") === "on"
      ? await saveEmailSettingsFromForm({ shop, form })
      : await automationSettingsForShop(shop);

    if (!settings) {
      throw publicError("Save your email delivery settings before sending a test email.", {
        status: 400,
      });
    }

    const provider = requireEmailDelivery(
      settings,
      "Enable email delivery before sending a test email.",
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
      messageId = await sendAutomationEmail({
        settings,
        to,
        subject: "ReleaseCore email delivery test",
        html: '<div style="font-family:Arial,sans-serif;line-height:1.55"><h2>ReleaseCore email delivery is connected.</h2><p>This test message was sent through the email provider configured for this Shopify store.</p></div>',
        text: "ReleaseCore email delivery is connected. This test message was sent through the email provider configured for this Shopify store.",
      });
    } catch (error) {
      const label = provider === EMAIL_DELIVERY_PROVIDERS.RESEND ? "Resend API" : "SMTP";
      throw publicError(
        label + " test email failed: " + String(error?.message || error || "Unknown email delivery error").slice(0, 500),
        { status: 400 },
      );
    }

    return { message: "Test email sent to " + to + ".", messageId, provider };
  }

  throw publicError("Unknown automation action.", { status: 400 });
}
