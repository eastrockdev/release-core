import { publicError } from "./http-security.server";

export const RELEASE_AVAILABILITY_OPTIONS = [
  "ALL_CURRENT_FUTURE",
  "CURRENT_ONLY",
];

export const EXCLUSIVE_PERIOD_OPTIONS = [2, 4, 6, 8];

function clean(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

function checked(formData, name) {
  return ["true", "1", "yes", "on"].includes(
    String(formData.get(name) || "").trim().toLowerCase(),
  );
}

function dateOnly(value, label) {
  const raw = clean(value);
  if (!raw) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw publicError(`Choose a valid ${label.toLowerCase()}.`, { status: 400 });
  }

  return raw;
}

function releaseDateOnly(value) {
  if (!value) return null;

  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
}

function dateValue(raw) {
  return raw ? new Date(`${raw}T12:00:00.000Z`) : null;
}

function normalizeReleaseTime(formData) {
  const hour = Number(clean(formData.get("releaseTimeHour")));
  const minute = Number(clean(formData.get("releaseTimeMinute")));
  const meridiem = String(
    formData.get("releaseTimeMeridiem") || "",
  ).trim().toUpperCase();

  if (
    !Number.isInteger(hour) ||
    hour < 1 ||
    hour > 12 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    !["AM", "PM"].includes(meridiem)
  ) {
    throw publicError("Choose a valid release time.", { status: 400 });
  }

  const hour24 =
    meridiem === "AM"
      ? hour === 12
        ? 0
        : hour
      : hour === 12
        ? 12
        : hour + 12;

  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseReleaseTimelineFormData(
  formData,
  { releaseDate = null } = {},
) {
  const availability =
    clean(formData.get("availability")) || "ALL_CURRENT_FUTURE";

  if (!RELEASE_AVAILABILITY_OPTIONS.includes(availability)) {
    throw publicError("Choose a valid release availability option.", {
      status: 400,
    });
  }

  const releaseDateRaw = releaseDateOnly(releaseDate);

  const preOrderEnabled = checked(formData, "preOrderEnabled");
  const preOrderDateRaw = dateOnly(
    formData.get("preOrderDate"),
    "Pre-order date",
  );

  if (preOrderEnabled && !preOrderDateRaw) {
    throw publicError(
      "Choose a pre-order date when the pre-order window is enabled.",
      { status: 400 },
    );
  }

  if (
    preOrderEnabled &&
    releaseDateRaw &&
    preOrderDateRaw >= releaseDateRaw
  ) {
    throw publicError(
      "Pre-order date must be before the release date.",
      { status: 400 },
    );
  }

  const releaseTimeEnabled = checked(formData, "releaseTimeEnabled");
  const releaseTime = releaseTimeEnabled
    ? normalizeReleaseTime(formData)
    : null;

  const exclusiveEnabled = checked(formData, "exclusiveEnabled");
  const exclusivePartner = clean(formData.get("exclusivePartner"));
  const exclusivePeriodRaw = clean(
    formData.get("exclusivePeriodWeeks"),
  );
  const exclusivePeriodWeeks = exclusivePeriodRaw
    ? Number(exclusivePeriodRaw)
    : null;

  if (exclusiveEnabled && !exclusivePartner) {
    throw publicError(
      "Choose an exclusive partner when the exclusive window is enabled.",
      { status: 400 },
    );
  }

  if (
    exclusiveEnabled &&
    !EXCLUSIVE_PERIOD_OPTIONS.includes(exclusivePeriodWeeks)
  ) {
    throw publicError(
      "Choose an exclusivity period of 2, 4, 6, or 8 weeks.",
      { status: 400 },
    );
  }

  return {
    availability,
    preOrderEnabled,
    preOrderDate: preOrderEnabled ? dateValue(preOrderDateRaw) : null,
    preOrderAudioPreviews:
      preOrderEnabled && checked(formData, "preOrderAudioPreviews"),
    releaseTimeEnabled,
    releaseTime,
    synchronousReleaseUnlocking:
      releaseTimeEnabled &&
      checked(formData, "synchronousReleaseUnlocking"),
    exclusiveEnabled,
    exclusivePartner: exclusiveEnabled ? exclusivePartner : null,
    exclusivePeriodWeeks: exclusiveEnabled ? exclusivePeriodWeeks : null,
  };
}
