import db from "../db.server";
import { publicError } from "./http-security.server";
import {
  DELIVERY_CHANNELS,
  baseChannelEnabled,
  deliveryChannel,
  validDeliveryChannelKey,
  validTerritoryCode,
} from "./delivery-plan";

const CHANNEL_MODES = new Set([
  "ALL",
  "INCLUDE_ONLY",
  "EXCLUDE",
  "SOCIAL_ONLY",
]);
const TERRITORY_MODES = new Set([
  "WORLDWIDE",
  "INCLUDE",
  "EXCLUDE",
]);
const OVERRIDE_STATES = new Set([
  "INHERIT",
  "ENABLED",
  "DISABLED",
]);
const OVERRIDE_TERRITORY_MODES = new Set([
  "INHERIT",
  ...TERRITORY_MODES,
]);

function clean(value, max = 1000) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, max) : null;
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueValidChannels(values) {
  return [
    ...new Set(
      jsonArray(values)
        .map((value) => String(value || "").trim())
        .filter(validDeliveryChannelKey),
    ),
  ];
}

function uniqueValidTerritories(values) {
  return [
    ...new Set(
      jsonArray(values)
        .map((value) =>
          String(value || "").trim().toUpperCase(),
        )
        .filter(validTerritoryCode),
    ),
  ].sort();
}

function parseDateOnly(value, label) {
  const raw = clean(value, 20);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw publicError(`Choose a valid ${label}.`, {
      status: 400,
    });
  }

  const date = new Date(`${raw}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw publicError(`Choose a valid ${label}.`, {
      status: 400,
    });
  }
  return date;
}

function dateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addWeeks(date, weeks) {
  if (!date || !weeks) return null;
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + Number(weeks) * 7);
  return result;
}

function legacyChannelKey(label) {
  const normalized = String(label || "").trim().toLowerCase();
  if (!normalized) return null;
  return (
    DELIVERY_CHANNELS.find(
      (channel) => channel.label.toLowerCase() === normalized,
    )?.key || null
  );
}

function defaultPlanFromRelease(release) {
  const exclusiveChannelKey =
    release.exclusiveEnabled
      ? legacyChannelKey(release.exclusivePartner)
      : null;
  const exclusiveStartDate =
    exclusiveChannelKey && release.releaseDate
      ? release.releaseDate
      : null;
  const exclusiveEndDate =
    exclusiveStartDate && release.exclusivePeriodWeeks
      ? addWeeks(
          exclusiveStartDate,
          release.exclusivePeriodWeeks,
        )
      : null;

  return {
    id: null,
    shop: release.shop,
    releaseId: release.id,
    channelMode:
      release.availability === "SOCIAL_ONLY"
        ? "SOCIAL_ONLY"
        : "ALL",
    channelKeys: [],
    territoryMode: "WORLDWIDE",
    territoryCodes: [],
    exclusiveChannelKey,
    exclusiveStartDate,
    exclusiveEndDate,
    notes: null,
    createdAt: null,
    updatedAt: null,
    overrides: [],
  };
}

function normalizedPlanRecord(plan) {
  return {
    ...plan,
    channelKeys: uniqueValidChannels(plan.channelKeys),
    territoryCodes: uniqueValidTerritories(
      plan.territoryCodes,
    ),
    overrides: (plan.overrides || []).map((override) => ({
      ...override,
      territoryCodes: uniqueValidTerritories(
        override.territoryCodes,
      ),
    })),
  };
}

function effectiveDate({
  releaseDate,
  overrideDate,
  plan,
  channelKey,
}) {
  let date = overrideDate || releaseDate || null;
  let holdback = false;

  if (
    plan.exclusiveChannelKey &&
    plan.exclusiveStartDate &&
    plan.exclusiveEndDate
  ) {
    if (channelKey === plan.exclusiveChannelKey) {
      date = overrideDate || plan.exclusiveStartDate || date;
    } else {
      const end = new Date(plan.exclusiveEndDate);
      const current = date ? new Date(date) : null;
      if (!current || current < end) {
        date = end;
        holdback = true;
      }
    }
  }

  return { date, holdback };
}

export function buildEffectiveDeliveryPlan({
  release,
  plan,
}) {
  const safePlan = normalizedPlanRecord(plan);
  const overrides = new Map(
    safePlan.overrides.map((override) => [
      override.channelKey,
      override,
    ]),
  );

  const channels = DELIVERY_CHANNELS.map((channel) => {
    const override = overrides.get(channel.key) || null;
    let enabled = baseChannelEnabled(safePlan, channel);

    if (override?.enabledState === "ENABLED") {
      enabled = true;
    } else if (override?.enabledState === "DISABLED") {
      enabled = false;
    }

    const territoryMode =
      override?.territoryMode &&
      override.territoryMode !== "INHERIT"
        ? override.territoryMode
        : safePlan.territoryMode;
    const territoryCodes =
      override?.territoryMode &&
      override.territoryMode !== "INHERIT"
        ? override.territoryCodes
        : safePlan.territoryCodes;

    const timing = effectiveDate({
      releaseDate: release.releaseDate,
      overrideDate: override?.releaseDate,
      plan: safePlan,
      channelKey: channel.key,
    });

    return {
      ...channel,
      enabled,
      releaseDate: timing.date,
      exclusiveHoldback: timing.holdback,
      territoryMode,
      territoryCodes,
      override,
    };
  });

  return {
    channels,
    enabledChannels: channels.filter((channel) => channel.enabled),
    disabledChannels: channels.filter((channel) => !channel.enabled),
    overrideCount: safePlan.overrides.length,
  };
}

async function ownedRelease(tx, shop, releaseId) {
  const release = await tx.release.findFirst({
    where: { id: releaseId, shop },
    select: {
      id: true,
      shop: true,
      type: true,
      title: true,
      status: true,
      releaseDate: true,
      availability: true,
      exclusiveEnabled: true,
      exclusivePartner: true,
      exclusivePeriodWeeks: true,
    },
  });

  if (!release) {
    throw publicError("Release not found.", {
      status: 404,
    });
  }
  return release;
}

async function existingPlan(tx, releaseId) {
  return tx.releaseDeliveryPlan.findUnique({
    where: { releaseId },
    include: {
      overrides: {
        orderBy: { updatedAt: "desc" },
      },
    },
  });
}

async function ensurePlan(tx, release) {
  const current = await existingPlan(tx, release.id);
  if (current) return current;

  const defaults = defaultPlanFromRelease(release);
  return tx.releaseDeliveryPlan.create({
    data: {
      shop: release.shop,
      releaseId: release.id,
      channelMode: defaults.channelMode,
      channelKeys: defaults.channelKeys,
      territoryMode: defaults.territoryMode,
      territoryCodes: defaults.territoryCodes,
      exclusiveChannelKey:
        defaults.exclusiveChannelKey,
      exclusiveStartDate:
        defaults.exclusiveStartDate,
      exclusiveEndDate: defaults.exclusiveEndDate,
    },
    include: {
      overrides: true,
    },
  });
}

function legacyExclusivePeriodWeeks(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms <= 0) return null;
  const weeks = Math.round(ms / (7 * 24 * 60 * 60 * 1000));
  return [2, 4, 6, 8].includes(weeks) ? weeks : null;
}

export async function loadReleaseDeliveryPlan({
  shop,
  releaseId,
}) {
  const release = await db.release.findFirst({
    where: { id: releaseId, shop },
    select: {
      id: true,
      shop: true,
      type: true,
      title: true,
      status: true,
      releaseDate: true,
      availability: true,
      exclusiveEnabled: true,
      exclusivePartner: true,
      exclusivePeriodWeeks: true,
    },
  });

  if (!release) return null;

  const stored = await db.releaseDeliveryPlan.findUnique({
    where: { releaseId },
    include: {
      overrides: {
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  const plan = normalizedPlanRecord(
    stored || defaultPlanFromRelease(release),
  );
  const effective = buildEffectiveDeliveryPlan({
    release,
    plan,
  });

  return {
    release,
    plan,
    effective,
  };
}

export async function saveReleaseDeliveryPlan({
  shop,
  releaseId,
  channelMode,
  channelKeys = [],
  territoryMode,
  territoryCodes = [],
  exclusiveChannelKey = null,
  exclusiveStartDate = null,
  exclusiveEndDate = null,
  notes = null,
  actorLabel = "Shopify admin",
}) {
  const mode = String(channelMode || "");
  if (!CHANNEL_MODES.has(mode)) {
    throw publicError(
      "Choose a valid platform availability mode.",
      { status: 400 },
    );
  }

  const channels = uniqueValidChannels(channelKeys);
  if (
    ["INCLUDE_ONLY", "EXCLUDE"].includes(mode) &&
    !channels.length
  ) {
    throw publicError(
      "Choose at least one platform for the selected include/exclude mode.",
      { status: 400 },
    );
  }

  const territory = String(territoryMode || "");
  if (!TERRITORY_MODES.has(territory)) {
    throw publicError(
      "Choose a valid territory availability mode.",
      { status: 400 },
    );
  }

  const territories = uniqueValidTerritories(
    territoryCodes,
  );
  if (
    ["INCLUDE", "EXCLUDE"].includes(territory) &&
    !territories.length
  ) {
    throw publicError(
      "Choose at least one territory for the selected territory mode.",
      { status: 400 },
    );
  }

  const exclusiveKey = clean(
    exclusiveChannelKey,
    80,
  );
  if (
    exclusiveKey &&
    !validDeliveryChannelKey(exclusiveKey)
  ) {
    throw publicError(
      "Choose a valid exclusive platform.",
      { status: 400 },
    );
  }

  if (
    exclusiveKey &&
    mode === "INCLUDE_ONLY" &&
    !channels.includes(exclusiveKey)
  ) {
    throw publicError(
      "The exclusive platform must be included in the release plan.",
      { status: 400 },
    );
  }

  if (
    exclusiveKey &&
    mode === "EXCLUDE" &&
    channels.includes(exclusiveKey)
  ) {
    throw publicError(
      "The exclusive platform cannot also be excluded from the release plan.",
      { status: 400 },
    );
  }

  if (
    exclusiveKey &&
    mode === "SOCIAL_ONLY" &&
    deliveryChannel(exclusiveKey)?.kind !== "SOCIAL"
  ) {
    throw publicError(
      "A social-only plan can only use a social platform for exclusivity.",
      { status: 400 },
    );
  }

  const start = parseDateOnly(
    exclusiveStartDate,
    "exclusive start date",
  );
  const end = parseDateOnly(
    exclusiveEndDate,
    "exclusive end date",
  );

  if (exclusiveKey && (!start || !end)) {
    throw publicError(
      "Choose both the start and end dates for an exclusive window.",
      { status: 400 },
    );
  }
  if (!exclusiveKey && (start || end)) {
    throw publicError(
      "Choose an exclusive platform before adding exclusive dates.",
      { status: 400 },
    );
  }
  if (start && end && end <= start) {
    throw publicError(
      "Exclusive end date must be after the exclusive start date.",
      { status: 400 },
    );
  }

  return db.$transaction(async (tx) => {
    const release = await ownedRelease(
      tx,
      shop,
      releaseId,
    );

    const plan = await tx.releaseDeliveryPlan.upsert({
      where: { releaseId: release.id },
      create: {
        shop,
        releaseId: release.id,
        channelMode: mode,
        channelKeys: channels,
        territoryMode: territory,
        territoryCodes: territories,
        exclusiveChannelKey: exclusiveKey,
        exclusiveStartDate: start,
        exclusiveEndDate: end,
        notes: clean(notes),
      },
      update: {
        channelMode: mode,
        channelKeys: channels,
        territoryMode: territory,
        territoryCodes: territories,
        exclusiveChannelKey: exclusiveKey,
        exclusiveStartDate: start,
        exclusiveEndDate: end,
        notes: clean(notes),
      },
      include: {
        overrides: true,
      },
    });

    const exclusive = exclusiveKey
      ? deliveryChannel(exclusiveKey)
      : null;

    await tx.release.update({
      where: { id: release.id },
      data: {
        availability:
          mode === "SOCIAL_ONLY"
            ? "SOCIAL_ONLY"
            : "ALL_CURRENT_FUTURE",
        exclusiveEnabled: Boolean(exclusiveKey),
        exclusivePartner: exclusive?.label || null,
        exclusivePeriodWeeks:
          legacyExclusivePeriodWeeks(start, end),
      },
    });

    await tx.submissionEvent.create({
      data: {
        releaseId: release.id,
        type: "DELIVERY_PLAN_UPDATED",
        actorLabel,
        message: `Delivery plan updated: ${mode}, ${territory}${exclusive ? `, exclusive window on ${exclusive.label}` : ""}.`,
      },
    });

    return normalizedPlanRecord(plan);
  });
}

export async function saveReleaseDeliveryChannel({
  shop,
  releaseId,
  channelKey,
  enabledState = "INHERIT",
  releaseDate = null,
  territoryMode = "INHERIT",
  territoryCodes = [],
  notes = null,
  actorLabel = "Shopify admin",
}) {
  const key = String(channelKey || "");
  const channel = deliveryChannel(key);
  if (!channel) {
    throw publicError(
      "Choose a valid platform.",
      { status: 400 },
    );
  }

  const state = String(enabledState || "INHERIT");
  if (!OVERRIDE_STATES.has(state)) {
    throw publicError(
      "Choose a valid platform override state.",
      { status: 400 },
    );
  }

  const territory = String(
    territoryMode || "INHERIT",
  );
  if (!OVERRIDE_TERRITORY_MODES.has(territory)) {
    throw publicError(
      "Choose a valid platform territory mode.",
      { status: 400 },
    );
  }

  const territories = uniqueValidTerritories(
    territoryCodes,
  );
  if (
    ["INCLUDE", "EXCLUDE"].includes(territory) &&
    !territories.length
  ) {
    throw publicError(
      "Choose at least one territory for this platform exception.",
      { status: 400 },
    );
  }

  const date = parseDateOnly(
    releaseDate,
    "platform release date",
  );

  return db.$transaction(async (tx) => {
    const release = await ownedRelease(
      tx,
      shop,
      releaseId,
    );
    const plan = await ensurePlan(tx, release);

    const override =
      await tx.releaseDeliveryChannel.upsert({
        where: {
          planId_channelKey: {
            planId: plan.id,
            channelKey: key,
          },
        },
        create: {
          shop,
          planId: plan.id,
          channelKey: key,
          enabledState: state,
          releaseDate: date,
          territoryMode: territory,
          territoryCodes: territories,
          notes: clean(notes, 800),
        },
        update: {
          enabledState: state,
          releaseDate: date,
          territoryMode: territory,
          territoryCodes: territories,
          notes: clean(notes, 800),
        },
      });

    await tx.submissionEvent.create({
      data: {
        releaseId: release.id,
        type: "DELIVERY_CHANNEL_UPDATED",
        actorLabel,
        message: `${channel.label} delivery exception updated.`,
      },
    });

    return override;
  });
}

export async function removeReleaseDeliveryChannel({
  shop,
  releaseId,
  channelKey,
  actorLabel = "Shopify admin",
}) {
  const key = String(channelKey || "");
  const channel = deliveryChannel(key);
  if (!channel) {
    throw publicError(
      "Choose a valid platform.",
      { status: 400 },
    );
  }

  return db.$transaction(async (tx) => {
    const release = await ownedRelease(
      tx,
      shop,
      releaseId,
    );
    const plan = await existingPlan(tx, release.id);

    if (!plan) {
      return { removed: false };
    }

    const override =
      await tx.releaseDeliveryChannel.findUnique({
        where: {
          planId_channelKey: {
            planId: plan.id,
            channelKey: key,
          },
        },
      });

    if (!override) {
      return { removed: false };
    }

    await tx.releaseDeliveryChannel.delete({
      where: { id: override.id },
    });

    await tx.submissionEvent.create({
      data: {
        releaseId: release.id,
        type: "DELIVERY_CHANNEL_REMOVED",
        actorLabel,
        message: `${channel.label} delivery exception removed.`,
      },
    });

    return { removed: true };
  });
}

export function serializeDeliveryPlanForExport({
  release,
  plan,
  effective,
}) {
  return {
    version: 1,
    releaseId: release.id,
    releaseTitle: release.title,
    releaseDate: dateOnly(release.releaseDate),
    channelMode: plan.channelMode,
    channelKeys: plan.channelKeys,
    territoryMode: plan.territoryMode,
    territoryCodes: plan.territoryCodes,
    exclusivity: plan.exclusiveChannelKey
      ? {
          channelKey: plan.exclusiveChannelKey,
          startDate: dateOnly(plan.exclusiveStartDate),
          endDate: dateOnly(plan.exclusiveEndDate),
        }
      : null,
    channels: effective.channels.map((channel) => ({
      key: channel.key,
      label: channel.label,
      kind: channel.kind,
      enabled: channel.enabled,
      releaseDate: dateOnly(channel.releaseDate),
      territoryMode: channel.territoryMode,
      territoryCodes: channel.territoryCodes,
      exclusiveHoldback: channel.exclusiveHoldback,
    })),
  };
}
