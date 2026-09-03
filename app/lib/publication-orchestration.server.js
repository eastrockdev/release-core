import db from "../db.server";
import { publicError, safeDiagnosticText } from "./http-security.server";
import {
  getReleaseProductState,
  getTrackProductState,
  publishProductToOnlineStore,
  setProductStatus,
  unpublishProductFromOnlineStore,
} from "./shopify-catalog.server";

export const PUBLICATION_ORCHESTRATION_MODES = [
  "PUBLISH_NOW",
  "SCHEDULE_RELEASE",
  "KEEP_UNPUBLISHED",
  "UNPUBLISH_ALL",
];

const MODE_COPY = {
  PUBLISH_NOW: {
    label: "Publish now",
    description:
      "Activate every linked product and publish the complete release to the Online Store immediately.",
  },
  SCHEDULE_RELEASE: {
    label: "Schedule",
    description:
      "Schedule the complete release using the release timeline. Pre-order dates take precedence when enabled.",
  },
  KEEP_UNPUBLISHED: {
    label: "Keep unpublished",
    description:
      "Keep every linked Shopify product active for catalog work while removing it from the Online Store.",
  },
  UNPUBLISH_ALL: {
    label: "Unpublish everything",
    description:
      "Remove the complete release from the Online Store and return linked products to Draft.",
  },
};

function clean(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function datePart(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function validTime(value) {
  const text = clean(value);
  return text && /^([01]\d|2[0-3]):[0-5]\d$/.test(text)
    ? text
    : null;
}

function formatDateTime(iso, timeZone) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function localDateTimeToUtcIso({
  date,
  time = "00:00",
  timeZone = "UTC",
}) {
  const dateMatch = String(date || "").match(
    /^(\d{4})-(\d{2})-(\d{2})$/,
  );
  const timeMatch = String(time || "").match(
    /^(\d{2}):(\d{2})$/,
  );

  if (!dateMatch || !timeMatch) {
    throw publicError(
      "ReleaseCore could not resolve the publication date/time.",
      { status: 409, code: "INVALID_PUBLICATION_TIME" },
    );
  }

  const desired = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: 0,
  };

  const desiredUtcNumber = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    0,
  );

  let guess = desiredUtcNumber;

  // Iterate because the IANA timezone offset can differ from UTC and can
  // change around daylight-saving boundaries.
  for (let index = 0; index < 4; index += 1) {
    const observed = zonedParts(new Date(guess), timeZone);
    const observedUtcNumber = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const delta = desiredUtcNumber - observedUtcNumber;
    guess += delta;
    if (Math.abs(delta) < 1000) break;
  }

  return new Date(guess).toISOString();
}

async function getShopTimezone(admin) {
  try {
    const response = await admin.graphql(`#graphql
      query ReleaseCorePublicationTimezone {
        shop {
          ianaTimezone
        }
      }
    `);
    const json = await response.json();
    const queryErrors = (json?.errors || [])
      .map((error) => String(error?.message || "").trim())
      .filter(Boolean);
    if (queryErrors.length) {
      throw new Error(queryErrors.join(" "));
    }

    const timeZone = clean(json?.data?.shop?.ianaTimezone);
    if (timeZone) {
      // Throws RangeError if Shopify ever returns an invalid timezone.
      new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
      return {
        timeZone,
        warning: null,
      };
    }
  } catch (error) {
    return {
      timeZone: "UTC",
      warning:
        `Shopify store timezone could not be read; ReleaseCore is previewing schedule times in UTC. ${safeDiagnosticText(error?.message || error, 300)}`,
    };
  }

  return {
    timeZone: "UTC",
    warning:
      "Shopify store timezone was unavailable, so ReleaseCore is previewing schedule times in UTC.",
  };
}

export async function resolveReleasePublicationSchedule({
  admin,
  release,
}) {
  const timezoneResult = await getShopTimezone(admin);
  const timeZone = timezoneResult.timeZone;
  const warnings = [];
  const blockers = [];

  if (timezoneResult.warning) {
    warnings.push(timezoneResult.warning);
  }

  const preOrderEnabled = Boolean(release?.preOrderEnabled);
  const preOrderDate = datePart(release?.preOrderDate);
  const releaseDate = datePart(release?.releaseDate);
  const releaseTime = validTime(release?.releaseTime);
  const releaseTimeEnabled = Boolean(release?.releaseTimeEnabled);

  let basis = null;
  let date = null;
  let time = "00:00";

  if (preOrderEnabled) {
    basis = "PRE_ORDER";
    date = preOrderDate;
    if (!date) {
      blockers.push(
        "Pre-order is enabled, but the release does not have a valid pre-order date.",
      );
    } else {
      warnings.push(
        release?.preOrderAudioPreviews
          ? "Products will become visible when the pre-order window opens, with pre-order audio previews enabled by release metadata."
          : "Products will become visible when the pre-order window opens. Pre-order audio previews are disabled by release metadata.",
      );
    }
  } else {
    basis = "RELEASE";
    date = releaseDate;
    if (!date) {
      blockers.push(
        "Set a release date before scheduling storefront publication.",
      );
    }

    if (releaseTimeEnabled) {
      if (releaseTime) {
        time = releaseTime;
      } else {
        blockers.push(
          "Release time is enabled, but the saved release time is invalid or missing.",
        );
      }
    }
  }

  if (
    basis === "RELEASE" &&
    releaseTimeEnabled &&
    release?.synchronousReleaseUnlocking
  ) {
    warnings.push(
      "Synchronous release unlocking is enabled. Shopify uses the single store publication instant shown below; DSP territory-local behavior remains separate distribution metadata.",
    );
  } else if (basis === "RELEASE" && releaseTimeEnabled) {
    warnings.push(
      "Shopify Online Store scheduling uses one store publication instant. Territory-local DSP unlocking does not create separate Shopify publication times.",
    );
  }

  if (blockers.length) {
    return {
      available: false,
      basis,
      date,
      time,
      timeZone,
      iso: null,
      label: null,
      blockers,
      warnings,
    };
  }

  const iso = localDateTimeToUtcIso({
    date,
    time,
    timeZone,
  });

  if (new Date(iso).getTime() <= Date.now()) {
    blockers.push(
      basis === "PRE_ORDER"
        ? "The pre-order storefront publication time has already passed. Use Publish now to open the current pre-order window."
        : "The storefront release publication time has already passed. Use Publish now instead of scheduling.",
    );
    return {
      available: false,
      basis,
      date,
      time,
      timeZone,
      iso,
      label: formatDateTime(iso, timeZone),
      blockers,
      warnings,
    };
  }

  return {
    available: true,
    basis,
    date,
    time,
    timeZone,
    iso,
    label: formatDateTime(iso, timeZone),
    blockers,
    warnings,
  };
}

function currentPublicationLabel(state, linked) {
  if (!linked) return "Not created";
  if (!state) return "Shopify link needs repair";
  if (state.status === "DRAFT") return "Draft";
  if (state.onlineStore?.scheduled) {
    const label = state.onlineStore.publishDate
      ? new Date(state.onlineStore.publishDate).toLocaleString()
      : "release date";
    return `Scheduled ${label}`;
  }
  if (state.onlineStore?.isPublished) return "Published";
  if (state.status === "ACTIVE") return "Active / unpublished";
  return state.status || "Connected";
}

function desiredPublicationLabel(mode, schedule) {
  if (mode === "PUBLISH_NOW") return "Published now";
  if (mode === "SCHEDULE_RELEASE") {
    return schedule?.available
      ? `Scheduled ${schedule.label}`
      : "Schedule unavailable";
  }
  if (mode === "KEEP_UNPUBLISHED") {
    return "Active / unpublished";
  }
  if (mode === "UNPUBLISH_ALL") {
    return "Draft / unpublished";
  }
  return "Unknown";
}

function publicationTargets(release) {
  const tracks = (release?.tracks || []).map((track) => ({
    kind: "TRACK",
    trackId: track.id,
    productId: track.shopifyProductId || null,
    title: `${track.position}. ${track.title || "Untitled Track"}`,
    state: track.shopifyState || null,
  }));

  const isAlbumOrEp = ["ALBUM", "EP"].includes(
    String(release?.type || "").toUpperCase(),
  );

  if (!isAlbumOrEp) return tracks;

  return [
    ...tracks,
    {
      kind: "RELEASE",
      trackId: null,
      productId: release.shopifyReleaseProductId || null,
      title:
        String(release.type).toUpperCase() === "EP"
          ? `${release.title} · EP parent`
          : `${release.title} · Album parent`,
      state: release.shopifyReleaseState || null,
    },
  ];
}

function defaultModeForTargets(targets, schedule) {
  const linked = targets.filter((target) => target.productId);
  if (!linked.length) return "KEEP_UNPUBLISHED";

  const allDraft = linked.every(
    (target) => target.state?.status === "DRAFT",
  );
  if (allDraft) return "UNPUBLISH_ALL";

  const allPublishedNow = linked.every(
    (target) =>
      target.state?.onlineStore?.isPublished &&
      !target.state?.onlineStore?.scheduled,
  );
  if (allPublishedNow) return "PUBLISH_NOW";

  const allScheduled = linked.every(
    (target) => target.state?.onlineStore?.scheduled,
  );
  if (allScheduled && schedule?.available) {
    return "SCHEDULE_RELEASE";
  }

  return "KEEP_UNPUBLISHED";
}

function modeAvailability(mode, {
  targets,
  schedule,
}) {
  const linked = targets.filter((target) => target.productId);
  const missing = targets.filter((target) => !target.productId);
  const stale = linked.filter((target) => !target.state);

  if (mode === "PUBLISH_NOW") {
    const blockers = [];
    if (missing.length) {
      blockers.push(
        `${missing.length} required Shopify product${missing.length === 1 ? " is" : "s are"} not linked yet.`,
      );
    }
    if (stale.length) {
      blockers.push(
        `${stale.length} linked Shopify product${stale.length === 1 ? " needs" : "s need"} repair before publication.`,
      );
    }
    return {
      allowed: !blockers.length && linked.length > 0,
      blockers,
    };
  }

  if (mode === "SCHEDULE_RELEASE") {
    const publication = modeAvailability("PUBLISH_NOW", {
      targets,
      schedule,
    });
    const blockers = [...publication.blockers];
    if (!schedule?.available) {
      blockers.push(...(schedule?.blockers || ["Publication schedule is unavailable."]));
    }
    return {
      allowed: !blockers.length && linked.length > 0,
      blockers,
    };
  }

  if (mode === "KEEP_UNPUBLISHED" || mode === "UNPUBLISH_ALL") {
    return {
      allowed: linked.length > 0,
      blockers: linked.length
        ? []
        : ["No linked Shopify products are available to update."],
    };
  }

  return {
    allowed: false,
    blockers: ["Unknown publication mode."],
  };
}

export async function hydratePublicationReleaseState({
  admin,
  release,
}) {
  const tracks = await Promise.all(
    (release?.tracks || []).map(async (track) => ({
      ...track,
      shopifyState: track.shopifyProductId
        ? await getTrackProductState(
            admin,
            track.shopifyProductId,
          )
        : null,
    })),
  );

  const shopifyReleaseState = release?.shopifyReleaseProductId
    ? await getReleaseProductState(
        admin,
        release.shopifyReleaseProductId,
      )
    : null;

  return {
    ...release,
    tracks,
    shopifyReleaseState,
  };
}

export async function buildPublicationOrchestration({
  admin,
  release,
}) {
  const schedule =
    await resolveReleasePublicationSchedule({
      admin,
      release,
    });
  const targets = publicationTargets(release);
  const linked = targets.filter((target) => target.productId);
  const missing = targets.filter((target) => !target.productId);

  const summary = {
    expected: targets.length,
    linked: linked.length,
    missing: missing.length,
    published: linked.filter(
      (target) =>
        target.state?.onlineStore?.isPublished &&
        !target.state?.onlineStore?.scheduled,
    ).length,
    scheduled: linked.filter(
      (target) => target.state?.onlineStore?.scheduled,
    ).length,
    activeUnpublished: linked.filter(
      (target) =>
        target.state?.status === "ACTIVE" &&
        !target.state?.onlineStore?.isPublished,
    ).length,
    draft: linked.filter(
      (target) => target.state?.status === "DRAFT",
    ).length,
    stale: linked.filter((target) => !target.state).length,
  };

  const modes = PUBLICATION_ORCHESTRATION_MODES.map(
    (mode) => ({
      id: mode,
      ...MODE_COPY[mode],
      desiredLabel: desiredPublicationLabel(
        mode,
        schedule,
      ),
      ...modeAvailability(mode, {
        targets,
        schedule,
      }),
    }),
  );

  return {
    schedule,
    summary,
    targets: targets.map((target) => ({
      kind: target.kind,
      trackId: target.trackId,
      productId: target.productId,
      title: target.title,
      currentLabel: currentPublicationLabel(
        target.state,
        Boolean(target.productId),
      ),
      state: target.state
        ? {
            status: target.state.status,
            published:
              Boolean(
                target.state.onlineStore?.isPublished,
              ),
            scheduled:
              Boolean(
                target.state.onlineStore?.scheduled,
              ),
            publishDate:
              target.state.onlineStore?.publishDate ||
              null,
          }
        : null,
    })),
    missing: missing.map((target) => ({
      kind: target.kind,
      trackId: target.trackId,
      title: target.title,
    })),
    modes,
    defaultMode: defaultModeForTargets(
      targets,
      schedule,
    ),
  };
}

function sameInstant(left, right) {
  if (!left || !right) return false;
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (
    Number.isNaN(leftDate.getTime()) ||
    Number.isNaN(rightDate.getTime())
  ) {
    return false;
  }
  return Math.abs(
    leftDate.getTime() - rightDate.getTime(),
  ) < 1000;
}

async function applyPublicationTarget({
  admin,
  target,
  mode,
  schedule,
}) {
  const state = target.state || null;

  if (mode === "PUBLISH_NOW") {
    if (
      state?.onlineStore?.isPublished &&
      !state?.onlineStore?.scheduled &&
      state?.status === "ACTIVE"
    ) {
      return { changed: false, action: "already published" };
    }

    if (state?.onlineStore?.isPublished) {
      await unpublishProductFromOnlineStore({
        admin,
        productId: target.productId,
      });
    }

    await publishProductToOnlineStore({
      admin,
      productId: target.productId,
    });
    return { changed: true, action: "published" };
  }

  if (mode === "SCHEDULE_RELEASE") {
    if (
      state?.onlineStore?.scheduled &&
      sameInstant(
        state.onlineStore.publishDate,
        schedule.iso,
      ) &&
      state?.status === "ACTIVE"
    ) {
      return { changed: false, action: "already scheduled" };
    }

    if (state?.onlineStore?.isPublished) {
      await unpublishProductFromOnlineStore({
        admin,
        productId: target.productId,
      });
    }

    await publishProductToOnlineStore({
      admin,
      productId: target.productId,
      publishDate: schedule.iso,
    });
    return { changed: true, action: "scheduled" };
  }

  if (mode === "KEEP_UNPUBLISHED") {
    let changed = false;

    if (state?.status !== "ACTIVE") {
      await setProductStatus(
        admin,
        target.productId,
        "ACTIVE",
      );
      changed = true;
    }

    if (!state || state?.onlineStore?.isPublished) {
      await unpublishProductFromOnlineStore({
        admin,
        productId: target.productId,
      });
      changed = true;
    }

    return {
      changed,
      action: changed
        ? "kept active and unpublished"
        : "already active and unpublished",
    };
  }

  if (mode === "UNPUBLISH_ALL") {
    let changed = false;

    if (!state || state?.onlineStore?.isPublished) {
      await unpublishProductFromOnlineStore({
        admin,
        productId: target.productId,
      });
      changed = true;
    }

    if (state?.status !== "DRAFT") {
      await setProductStatus(
        admin,
        target.productId,
        "DRAFT",
      );
      changed = true;
    }

    return {
      changed,
      action: changed
        ? "unpublished and moved to Draft"
        : "already Draft and unpublished",
    };
  }

  throw publicError(
    "Choose a valid storefront publication mode.",
    { status: 400 },
  );
}

function orderTargets(targets, mode) {
  const linked = targets.filter(
    (target) => target.productId,
  );

  if (
    mode === "PUBLISH_NOW" ||
    mode === "SCHEDULE_RELEASE"
  ) {
    // Components first, parent last.
    return [...linked].sort((left, right) => {
      if (left.kind === right.kind) return 0;
      return left.kind === "TRACK" ? -1 : 1;
    });
  }

  // Parent first when taking a release offline.
  return [...linked].sort((left, right) => {
    if (left.kind === right.kind) return 0;
    return left.kind === "RELEASE" ? -1 : 1;
  });
}

function orchestrationEventType(mode) {
  if (mode === "PUBLISH_NOW") {
    return "SHOPIFY_PUBLICATION_PUBLISHED";
  }
  if (mode === "SCHEDULE_RELEASE") {
    return "SHOPIFY_PUBLICATION_SCHEDULED";
  }
  if (mode === "KEEP_UNPUBLISHED") {
    return "SHOPIFY_PUBLICATION_HELD";
  }
  return "SHOPIFY_PUBLICATION_UNPUBLISHED";
}

export async function orchestrateReleasePublication({
  admin,
  release,
  mode,
}) {
  const normalizedMode = String(mode || "")
    .trim()
    .toUpperCase();

  if (
    !PUBLICATION_ORCHESTRATION_MODES.includes(
      normalizedMode,
    )
  ) {
    throw publicError(
      "Choose a valid storefront publication mode.",
      { status: 400 },
    );
  }

  const hydrated =
    await hydratePublicationReleaseState({
      admin,
      release,
    });

  const plan = await buildPublicationOrchestration({
    admin,
    release: hydrated,
  });

  const selected = plan.modes.find(
    (item) => item.id === normalizedMode,
  );

  if (!selected?.allowed) {
    throw publicError(
      `Publication plan cannot run yet. ${(selected?.blockers || []).join(" ")}`,
      {
        status: 409,
        code: "PUBLICATION_PLAN_BLOCKED",
      },
    );
  }

  const targets = orderTargets(
    publicationTargets(hydrated),
    normalizedMode,
  );

  const changed = [];
  const unchanged = [];
  const failures = [];

  for (const target of targets) {
    try {
      const result = await applyPublicationTarget({
        admin,
        target,
        mode: normalizedMode,
        schedule: plan.schedule,
      });

      const item = {
        kind: target.kind,
        trackId: target.trackId,
        productId: target.productId,
        title: target.title,
        action: result.action,
      };

      if (result.changed) changed.push(item);
      else unchanged.push(item);
    } catch (error) {
      failures.push({
        kind: target.kind,
        trackId: target.trackId,
        productId: target.productId,
        title: target.title,
        message: safeDiagnosticText(
          error?.message || error,
          700,
        ),
      });
    }
  }

  const scheduleText =
    normalizedMode === "SCHEDULE_RELEASE" &&
    plan.schedule?.label
      ? ` for ${plan.schedule.label}`
      : "";

  if (changed.length || unchanged.length) {
    await db.submissionEvent.create({
      data: {
        releaseId: release.id,
        type: orchestrationEventType(
          normalizedMode,
        ),
        message:
          `${MODE_COPY[normalizedMode].label} applied to ${changed.length + unchanged.length} Shopify product${changed.length + unchanged.length === 1 ? "" : "s"}${scheduleText}.` +
          (changed.length
            ? ` ${changed.length} changed.`
            : " No state changes were required."),
        actorLabel: "Shopify admin",
      },
    });
  }

  if (failures.length) {
    await db.submissionEvent.create({
      data: {
        releaseId: release.id,
        type: "SHOPIFY_PUBLICATION_WARNING",
        message:
          `${failures.length} storefront publication item${failures.length === 1 ? "" : "s"} could not be updated: ` +
          failures
            .slice(0, 3)
            .map(
              (item) =>
                `${item.title}: ${item.message}`,
            )
            .join(" "),
        actorLabel: "Shopify admin",
      },
    });
  }

  if (
    failures.length &&
    !changed.length &&
    !unchanged.length
  ) {
    throw publicError(
      `ReleaseCore could not update storefront publication. ${failures
        .slice(0, 3)
        .map((item) => `${item.title}: ${item.message}`)
        .join(" ")}`,
      {
        status: 409,
        code: "PUBLICATION_ORCHESTRATION_FAILED",
      },
    );
  }

  return {
    mode: normalizedMode,
    changed,
    unchanged,
    failures,
    schedule: plan.schedule,
    message:
      normalizedMode === "SCHEDULE_RELEASE"
        ? `${changed.length + unchanged.length} Shopify product${changed.length + unchanged.length === 1 ? "" : "s"} scheduled${scheduleText}.`
        : `${MODE_COPY[normalizedMode].label} applied to ${changed.length + unchanged.length} Shopify product${changed.length + unchanged.length === 1 ? "" : "s"}.`,
    warning: failures.length
      ? `${failures.length} item${failures.length === 1 ? "" : "s"} still need attention.`
      : null,
  };
}
