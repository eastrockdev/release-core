import crypto from "node:crypto";

const CIPHER = "aes-256-gcm";
const IV_BYTES = 12;

function encryptionKey() {
  const secret = String(process.env.RELEASECORE_ENCRYPTION_KEY || "").trim();
  if (!secret) {
    throw new Error(
      "RELEASECORE_ENCRYPTION_KEY is not configured. Add a private server-side encryption key before saving SMTP credentials.",
    );
  }
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export function smtpEncryptionConfigured() {
  return Boolean(String(process.env.RELEASECORE_ENCRYPTION_KEY || "").trim());
}

export function encryptSmtpPassword(password) {
  const value = String(password || "");
  if (!value) return null;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSmtpPassword(payload) {
  const raw = String(payload || "");
  if (!raw) return "";
  const [version, ivB64, tagB64, dataB64] = raw.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored SMTP password could not be decrypted because its format is invalid.");
  }
  const decipher = crypto.createDecipheriv(
    CIPHER,
    encryptionKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function normalizedSecurity(value) {
  const security = String(value || "STARTTLS").toUpperCase();
  if (security === "SSL_TLS" || security === "NONE") return security;
  return "STARTTLS";
}

export function smtpTransportOptions(settings) {
  if (!settings?.smtpEnabled) {
    throw new Error("Custom SMTP delivery is disabled in ReleaseCore Automation settings.");
  }
  const host = String(settings.smtpHost || "").trim();
  const port = Number(settings.smtpPort || 587);
  const username = String(settings.smtpUsername || "").trim();
  if (!host) throw new Error("SMTP host is not configured.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP port must be between 1 and 65535.");
  }

  const security = normalizedSecurity(settings.smtpSecurity);
  const password = settings.smtpPasswordEncrypted
    ? decryptSmtpPassword(settings.smtpPasswordEncrypted)
    : "";

  const options = {
    host,
    port,
    secure: security === "SSL_TLS",
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: { rejectUnauthorized: true },
  };

  if (security === "STARTTLS") options.requireTLS = true;
  if (security === "NONE") options.ignoreTLS = true;
  if (username) options.auth = { user: username, pass: password };

  return options;
}

async function loadNodemailer() {
  try {
    const module = await import("nodemailer");
    return module.default || module;
  } catch (error) {
    throw new Error("Nodemailer is not installed. Run `npm install nodemailer` from the ReleaseCore project root.");
  }
}

export async function createSmtpTransport(settings) {
  const nodemailer = await loadNodemailer();
  return nodemailer.createTransport(smtpTransportOptions(settings));
}

export async function verifySmtpConnection(settings) {
  const transport = await createSmtpTransport(settings);
  try {
    await transport.verify();
    return true;
  } finally {
    transport.close();
  }
}

export async function sendSmtpEmail({ settings, to, subject, html, text }) {
  const recipient = String(to || "").trim();
  if (!recipient) throw new Error("Email recipient is missing.");
  const fromAddress = String(settings?.emailFromAddress || "").trim();
  if (!fromAddress) {
    throw new Error("Email from address is not configured in ReleaseCore Automation settings.");
  }
  const senderName = String(
    settings?.emailSenderName || settings?.emailBrandName || "ReleaseCore",
  ).trim();
  const safeSenderName = senderName.replace(/[<>\r\n]/g, "");
  const transport = await createSmtpTransport(settings);
  try {
    const result = await transport.sendMail({
      from: safeSenderName ? `${safeSenderName} <${fromAddress}>` : fromAddress,
      to: recipient,
      subject,
      html,
      ...(text ? { text } : {}),
      ...(settings?.emailReplyTo ? { replyTo: settings.emailReplyTo } : {}),
    });
    return result?.messageId || null;
  } finally {
    transport.close();
  }
}
