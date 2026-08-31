export const UPC_MODES = ["AGGREGATOR", "GS1"];

export function normalizeGs1CompanyPrefix(value) {
  return String(value || "").replace(/\D/g, "").trim();
}

export function validateGs1CompanyPrefix(prefix) {
  const normalized = normalizeGs1CompanyPrefix(prefix);
  if (!/^\d{6,10}$/.test(normalized)) {
    throw new Error("GS1 U.P.C. Company Prefix must contain 6 to 10 digits.");
  }
  return normalized;
}

export function itemReferenceWidth(companyPrefix) {
  const prefix = validateGs1CompanyPrefix(companyPrefix);
  return 11 - prefix.length;
}

export function maxItemReference(companyPrefix) {
  return 10 ** itemReferenceWidth(companyPrefix) - 1;
}

export function gtin12CheckDigit(firstEleven) {
  const body = String(firstEleven || "");
  if (!/^\d{11}$/.test(body)) throw new Error("GTIN-12 check digit requires exactly 11 digits.");
  const total = body.split("").reduce((sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return String((10 - (total % 10)) % 10);
}

export function buildUpc({ companyPrefix, itemReference }) {
  const prefix = validateGs1CompanyPrefix(companyPrefix);
  const width = itemReferenceWidth(prefix);
  const number = Number(itemReference);
  const max = maxItemReference(prefix);
  if (!Number.isInteger(number) || number < 0 || number > max) {
    throw new Error(`Item Reference must be a whole number between 0 and ${max}.`);
  }
  const body = `${prefix}${String(number).padStart(width, "0")}`;
  return `${body}${gtin12CheckDigit(body)}`;
}

export function isValidUpc(value) {
  const code = String(value || "").replace(/\D/g, "");
  if (!/^\d{12}$/.test(code)) return false;
  return gtin12CheckDigit(code.slice(0, 11)) === code.slice(-1);
}

export function upcModeLabel(mode) {
  return mode === "GS1" ? "ReleaseCore generates GTIN-12 / UPC" : "Aggregator or admin provides UPC";
}
