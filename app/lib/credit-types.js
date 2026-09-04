export const CORE_CREDIT_ROLES = Object.freeze([
  "SONGWRITER",
  "COMPOSER",
  "PRODUCER",
  "RECORDING_ENGINEER",
  "MIXING_ENGINEER",
  "MASTERING_ENGINEER",
  "COVER_ART_PHOTOGRAPHER",
  "COVER_ART_DESIGNER",
  "OTHER",
]);

const MAX_CUSTOM_CREDIT_ROLES = 32;
const MAX_CREDIT_ROLE_LENGTH = 64;

export function normalizeCreditRole(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, MAX_CREDIT_ROLE_LENGTH);
}

function rawAdditionalRoles(value) {
  if (Array.isArray(value)) return value;

  const text = String(value ?? "").trim();
  if (!text) return [];

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to newline/comma parsing for legacy/manual values.
    }
  }

  return text.split(/[\n,]+/);
}

export function parseAdditionalCreditRoles(value) {
  const core = new Set(CORE_CREDIT_ROLES);
  const seen = new Set();
  const result = [];

  for (const item of rawAdditionalRoles(value)) {
    const role = normalizeCreditRole(item);
    if (!role || core.has(role) || seen.has(role)) continue;
    seen.add(role);
    result.push(role);
    if (result.length >= MAX_CUSTOM_CREDIT_ROLES) break;
  }

  return result;
}

export function serializeAdditionalCreditRoles(value) {
  const roles = parseAdditionalCreditRoles(value);
  return roles.length ? roles.join("\n") : null;
}

export function configuredCreditRoles(settingsOrValue = {}) {
  const value =
    typeof settingsOrValue === "string" || Array.isArray(settingsOrValue)
      ? settingsOrValue
      : settingsOrValue?.additionalCreditRoles;

  return [
    ...CORE_CREDIT_ROLES,
    ...parseAdditionalCreditRoles(value),
  ];
}

export function isConfiguredCreditRole(role, settingsOrValue = {}) {
  const normalized = normalizeCreditRole(role);
  return configuredCreditRoles(settingsOrValue).includes(normalized);
}
