import crypto from "node:crypto";

const CIPHER = "aes-256-gcm";
const IV_BYTES = 12;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

function encryptionKey() {
  const secret = String(process.env.RELEASECORE_ENCRYPTION_KEY || "").trim();
  if (!secret) {
    throw new Error(
      "RELEASECORE_ENCRYPTION_KEY is not configured. Add a private server-side encryption key before saving Resend credentials.",
    );
  }
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export function encryptResendApiKey(apiKey) {
  const value = String(apiKey || "").trim();
  if (!value) return null;

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptResendApiKey(payload) {
  const raw = String(payload || "");
  if (!raw) return "";

  const [version, ivB64, tagB64, dataB64] = raw.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored Resend API key could not be decrypted because its format is invalid.");
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

function safeHeaderText(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function sender(settings) {
  const address = safeHeaderText(settings?.emailFromAddress);
  if (!address) {
    throw new Error("Email from address is not configured in ReleaseCore Automation settings.");
  }

  const name = safeHeaderText(
    settings?.emailSenderName || settings?.emailBrandName || "ReleaseCore",
  );
  return name ? `${name} <${address}>` : address;
}

function safeResendError(payload, status) {
  const message =
    payload && typeof payload === "object"
      ? payload.message || payload.error || payload.name
      : null;
  return String(message || `Resend returned HTTP ${status}.`).slice(0, 500);
}

export async function sendResendEmail({ settings, to, subject, html, text }) {
  if (!settings?.smtpEnabled) {
    throw new Error("Email delivery is disabled in ReleaseCore Automation settings.");
  }

  const recipient = String(to || "").trim();
  if (!recipient) throw new Error("Email recipient is missing.");

  const apiKey = settings?.resendApiKeyEncrypted
    ? decryptResendApiKey(settings.resendApiKeyEncrypted)
    : "";
  if (!apiKey) {
    throw new Error("Resend API key is not configured.");
  }

  const payload = {
    from: sender(settings),
    to: [recipient],
    subject: String(subject || "").trim() || "ReleaseCore notification",
  };

  if (html) payload.html = String(html);
  if (text) payload.text = String(text);

  const replyTo = safeHeaderText(settings?.emailReplyTo);
  if (replyTo) payload.reply_to = replyTo;

  let response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const reason =
      error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "Connection timeout"
        : String(error?.message || error || "Unknown network error");
    throw new Error(`Resend API request failed: ${reason}`);
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(`Resend API error: ${safeResendError(body, response.status)}`);
  }

  const messageId = String(body?.id || "").trim();
  if (!messageId) {
    throw new Error("Resend accepted the request but did not return an email id.");
  }

  return messageId;
}
