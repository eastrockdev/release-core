export const CATALOG_OPERATION_TYPES = [
  {
    value: "CORRECTION",
    label: "Correction",
    shortLabel: "Correction",
    description:
      "Fix incorrect catalog metadata or identifiers without intentionally changing the creative release.",
  },
  {
    value: "UPDATE",
    label: "Update",
    shortLabel: "Update",
    description:
      "Request a deliberate change to metadata, artwork, audio, rights, or availability after the catalog record exists.",
  },
  {
    value: "TAKEDOWN",
    label: "Full release takedown",
    shortLabel: "Takedown",
    description:
      "Request removal of the complete release from downstream distribution. The ReleaseCore catalog record is preserved.",
  },
];

export const CATALOG_OPERATION_CATEGORIES = [
  { value: "METADATA", label: "Metadata" },
  { value: "AUDIO", label: "Audio master" },
  { value: "ARTWORK", label: "Artwork" },
  { value: "CREDITS", label: "Credits / publishing" },
  { value: "IDENTIFIERS", label: "Identifiers" },
  { value: "RIGHTS", label: "Rights / ownership" },
  { value: "AVAILABILITY", label: "Stores / territories" },
  { value: "OTHER", label: "Other" },
];

export const CATALOG_OPERATION_STATUSES = [
  { value: "REQUESTED", label: "Requested", tone: "warn" },
  { value: "APPROVED", label: "Approved", tone: "info" },
  { value: "IN_PROGRESS", label: "In progress", tone: "info" },
  { value: "COMPLETED", label: "Completed", tone: "good" },
  { value: "REJECTED", label: "Rejected", tone: "bad" },
  { value: "CANCELLED", label: "Cancelled", tone: "neutral" },
];

export const CATALOG_OPERATION_TRANSITIONS = {
  REQUESTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function catalogOperationTypeDefinition(value) {
  return (
    CATALOG_OPERATION_TYPES.find(
      (item) => item.value === String(value || "").toUpperCase(),
    ) || CATALOG_OPERATION_TYPES[0]
  );
}

export function catalogOperationStatusDefinition(value) {
  return (
    CATALOG_OPERATION_STATUSES.find(
      (item) => item.value === String(value || "").toUpperCase(),
    ) || CATALOG_OPERATION_STATUSES[0]
  );
}

export function catalogOperationCategoryLabel(value) {
  if (String(value || "").toUpperCase() === "FULL_TAKEDOWN") {
    return "Full release takedown";
  }
  return (
    CATALOG_OPERATION_CATEGORIES.find(
      (item) => item.value === String(value || "").toUpperCase(),
    )?.label || "Other"
  );
}

export function catalogOperationNextStatuses(status) {
  return CATALOG_OPERATION_TRANSITIONS[
    String(status || "").toUpperCase()
  ] || [];
}

export function normalizeManualCatalogNumber(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code) {
    throw new Error("Enter a catalog number.");
  }
  if (code.length > 64) {
    throw new Error("Catalog numbers can be up to 64 characters.");
  }
  if (!/^[A-Z0-9][A-Z0-9._/-]*$/.test(code)) {
    throw new Error(
      "Catalog numbers can use letters, numbers, periods, underscores, slashes, and hyphens.",
    );
  }
  return code;
}
