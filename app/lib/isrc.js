export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
export const REGISTRANT_CODE_PATTERN = /^[A-Z0-9]{3}$/;
export const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
export const ISRC_MODES = ["AUTO", "ADMIN"];

export function isrcAssignmentMode(settings = {}) {
  const mode = String(settings?.isrcMode || "").toUpperCase();
  if (ISRC_MODES.includes(mode)) return mode;
  return settings?.autoAssignIsrc === false ? "ADMIN" : "AUTO";
}

export function normalizeIsrc(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function validateIsrc(value) {
  const code = normalizeIsrc(value);
  if (!ISRC_PATTERN.test(code)) {
    throw new Error(
      "Enter a valid 12-character ISRC, such as USABC2600001.",
    );
  }
  return code;
}

export function normalizeCountryCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function normalizeRegistrantCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function isrcReferenceYear(date = new Date()) {
  return date.getUTCFullYear();
}

export function isrcYearDigits(year = isrcReferenceYear()) {
  return String(year).slice(-2).padStart(2, "0");
}

export function isIsrcConfigured(settings) {
  return Boolean(
    settings &&
      COUNTRY_CODE_PATTERN.test(normalizeCountryCode(settings.countryCode)) &&
      REGISTRANT_CODE_PATTERN.test(normalizeRegistrantCode(settings.registrantCode)),
  );
}

export function buildIsrc({ countryCode, registrantCode, year, designation }) {
  const country = normalizeCountryCode(countryCode);
  const registrant = normalizeRegistrantCode(registrantCode);
  const numericDesignation = Number(designation);

  if (!COUNTRY_CODE_PATTERN.test(country)) {
    throw new Error("ISRC Country Code must contain exactly 2 letters.");
  }
  if (!REGISTRANT_CODE_PATTERN.test(registrant)) {
    throw new Error("ISRC Registrant Code must contain exactly 3 letters or numbers.");
  }
  if (!Number.isInteger(numericDesignation) || numericDesignation < 1 || numericDesignation > 99999) {
    throw new Error("ISRC Designation Code must be between 00001 and 99999.");
  }

  return `${country}${registrant}${isrcYearDigits(year)}${String(numericDesignation).padStart(5, "0")}`;
}
