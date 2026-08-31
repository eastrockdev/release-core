export const CATALOG_MODES = ["AUTO", "MANUAL"];

export function normalizeCatalogPrefix(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 12);
}

export function catalogYearDigits(year = new Date().getFullYear()) {
  return String(year).slice(-2);
}

export function buildCatalogNumber({ prefix, includeYear = true, year = new Date().getFullYear(), sequence, width = 4 }) {
  const normalizedPrefix = normalizeCatalogPrefix(prefix);
  const numericSequence = Number(sequence);
  const numericWidth = Number(width);
  if (!normalizedPrefix) throw new Error("Catalog prefix is required.");
  if (!Number.isInteger(numericWidth) || numericWidth < 2 || numericWidth > 8) throw new Error("Catalog sequence width must be between 2 and 8 digits.");
  if (!Number.isInteger(numericSequence) || numericSequence < 1 || numericSequence > (10 ** numericWidth) - 1) throw new Error(`Catalog sequence must be between 1 and ${(10 ** numericWidth) - 1}.`);
  return `${normalizedPrefix}${includeYear ? catalogYearDigits(year) : ""}${String(numericSequence).padStart(numericWidth, "0")}`;
}

export function catalogModeLabel(mode) {
  return String(mode || "AUTO").toUpperCase() === "MANUAL" ? "Admin provides catalog number" : "ReleaseCore generates catalog numbers";
}
