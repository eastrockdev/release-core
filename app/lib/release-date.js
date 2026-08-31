const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeLeadTimeDays(value, fallback = 14) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(365, Math.trunc(number)));
}

export function utcDateOnly(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addUtcCalendarDays(date = new Date(), days = 0) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0));
  copy.setUTCDate(copy.getUTCDate() + normalizeLeadTimeDays(days, 0));
  return copy;
}

export function releaseDatePolicy(settings = {}, now = new Date()) {
  const enabled = Boolean(settings?.releaseLeadTimeEnabled);
  const days = normalizeLeadTimeDays(settings?.releaseLeadTimeDays, 14);
  const minDate = enabled ? utcDateOnly(addUtcCalendarDays(now, days)) : null;
  return { enabled, days, minDate };
}

export function releaseDateOnly(value) {
  if (!value) return null;
  if (typeof value === "string" && DATE_ONLY.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return utcDateOnly(date);
}

export function validateReleaseDateLeadTime(value, settings = {}, now = new Date()) {
  const dateOnly = releaseDateOnly(value);
  if (!dateOnly) return { ok: true, policy: releaseDatePolicy(settings, now), dateOnly: null };
  const policy = releaseDatePolicy(settings, now);
  if (!policy.enabled || !policy.minDate || dateOnly >= policy.minDate) {
    return { ok: true, policy, dateOnly };
  }
  return {
    ok: false,
    policy,
    dateOnly,
    message: `Choose a release date at least ${policy.days} day${policy.days === 1 ? "" : "s"} from today. The earliest available date is ${policy.minDate}.`,
  };
}
