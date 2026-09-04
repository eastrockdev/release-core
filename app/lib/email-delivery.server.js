import { sendResendEmail } from "./resend.server";
import { sendSmtpEmail } from "./smtp.server";

export const EMAIL_DELIVERY_PROVIDERS = Object.freeze({
  RESEND: "RESEND",
  SMTP: "SMTP",
});

export function emailDeliveryProvider(settings) {
  return String(settings?.emailDeliveryProvider || "SMTP").toUpperCase() === "RESEND"
    ? EMAIL_DELIVERY_PROVIDERS.RESEND
    : EMAIL_DELIVERY_PROVIDERS.SMTP;
}

export async function sendAutomationEmail(args) {
  const provider = emailDeliveryProvider(args?.settings);
  if (provider === EMAIL_DELIVERY_PROVIDERS.RESEND) {
    return sendResendEmail(args);
  }
  return sendSmtpEmail(args);
}
