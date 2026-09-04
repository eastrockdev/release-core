import db from "../db.server";
import { publicError } from "./http-security.server";
import {
  CATALOG_OPERATION_CATEGORIES,
  CATALOG_OPERATION_TRANSITIONS,
  CATALOG_OPERATION_TYPES,
  catalogOperationNextStatuses,
  normalizeManualCatalogNumber,
} from "./catalog-operations";
import { normalizeCatalogPrefix } from "./catalog";

function cleanText(value, maxLength, label, required = false) {
  const clean = String(value ?? "").trim();
  if (required && !clean) {
    throw publicError(`${label} is required.`, {
      status: 400,
      code: "CATALOG_OPERATION_INVALID",
    });
  }
  if (clean.length > maxLength) {
    throw publicError(
      `${label} can be up to ${maxLength} characters.`,
      {
        status: 400,
        code: "CATALOG_OPERATION_INVALID",
      },
    );
  }
  return clean || null;
}

function cleanDate(value, label = "Effective date") {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(`${raw}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw publicError(`${label} is invalid.`, {
      status: 400,
      code: "CATALOG_OPERATION_INVALID",
    });
  }
  return date;
}

function operationType(value) {
  const type = String(value || "").trim().toUpperCase();
  if (!CATALOG_OPERATION_TYPES.some((item) => item.value === type)) {
    throw publicError("Choose a valid catalog operation type.", {
      status: 400,
      code: "CATALOG_OPERATION_INVALID",
    });
  }
  return type;
}

function operationCategory(type, value) {
  if (type === "TAKEDOWN") return "FULL_TAKEDOWN";
  const category = String(value || "").trim().toUpperCase();
  if (
    !CATALOG_OPERATION_CATEGORIES.some(
      (item) => item.value === category,
    )
  ) {
    throw publicError("Choose a valid catalog operation category.", {
      status: 400,
      code: "CATALOG_OPERATION_INVALID",
    });
  }
  return category;
}

async function ownedRelease(tx, shop, releaseId, include = {}) {
  const release = await tx.release.findFirst({
    where: { id: releaseId, shop },
    include,
  });
  if (!release) {
    throw publicError("Release not found.", {
      status: 404,
      code: "RELEASE_NOT_FOUND",
    });
  }
  return release;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function advanceCatalogSequenceForManualCode(
  tx,
  { shop, code },
) {
  const settings = await tx.appSettings.findUnique({
    where: { shop },
  });
  const prefix = normalizeCatalogPrefix(settings?.catalogPrefix);
  if (!prefix) return;

  const width = Number(settings?.catalogSequenceWidth || 4);
  if (!Number.isInteger(width) || width < 2 || width > 8) return;

  const includeYear = settings?.catalogIncludeYear !== false;
  let sequenceValue = null;
  let yearKey = includeYear ? null : 0;

  if (includeYear) {
    const matcher = new RegExp(
      `^${escapeRegex(prefix)}(\\d{2})(\\d{${width}})$`,
      "i",
    );
    const match = code.match(matcher);
    if (!match) return;
    yearKey = 2000 + Number(match[1]);
    sequenceValue = Number(match[2]);
  } else {
    const matcher = new RegExp(
      `^${escapeRegex(prefix)}(\\d{${width}})$`,
      "i",
    );
    const match = code.match(matcher);
    if (!match) return;
    sequenceValue = Number(match[1]);
  }

  if (
    !Number.isInteger(sequenceValue) ||
    sequenceValue < 1 ||
    !Number.isInteger(yearKey)
  ) {
    return;
  }

  const key = {
    shop_prefix_yearKey: {
      shop,
      prefix,
      yearKey,
    },
  };

  const sequence = await tx.catalogSequence.findUnique({
    where: key,
  });
  const nextSequence = sequenceValue + 1;

  if (!sequence) {
    await tx.catalogSequence.create({
      data: {
        shop,
        prefix,
        yearKey,
        nextSequence,
      },
    });
    return;
  }

  if (sequence.nextSequence <= sequenceValue) {
    await tx.catalogSequence.update({
      where: { id: sequence.id },
      data: { nextSequence },
    });
  }
}

export async function loadCatalogOperationsWorkspace({
  shop,
  releaseId,
}) {
  const [release, settings] = await Promise.all([
    db.release.findFirst({
      where: { id: releaseId, shop },
      include: {
        artists: {
          include: { artist: true },
          orderBy: { position: "asc" },
        },
        tracks: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            position: true,
            title: true,
            isrc: true,
          },
        },
        lifecycleRequests: {
          orderBy: { createdAt: "desc" },
          include: {
            track: {
              select: {
                id: true,
                position: true,
                title: true,
                isrc: true,
              },
            },
          },
        },
      },
    }),
    db.appSettings.findUnique({
      where: { shop },
    }),
  ]);

  if (!release) {
    throw publicError("Release not found.", {
      status: 404,
      code: "RELEASE_NOT_FOUND",
    });
  }

  return {
    release,
    catalogSettings: {
      mode: settings?.catalogMode || "AUTO",
      prefix: settings?.catalogPrefix || "",
      includeYear: settings?.catalogIncludeYear !== false,
      sequenceWidth: Number(settings?.catalogSequenceWidth || 4),
    },
  };
}

export async function setManualCatalogNumber({
  shop,
  releaseId,
  value,
  actorLabel = "Shopify admin",
}) {
  let code;
  try {
    code = normalizeManualCatalogNumber(value);
  } catch (error) {
    throw publicError(
      error instanceof Error
        ? error.message
        : "Enter a valid catalog number.",
      {
        status: 400,
        code: "INVALID_CATALOG_NUMBER",
      },
    );
  }

  return db.$transaction(async (tx) => {
    const release = await ownedRelease(tx, shop, releaseId);
    const previousCode = release.catalogNumber || null;

    if (previousCode === code) {
      return {
        code,
        previousCode,
        changed: false,
        corrected: false,
      };
    }

    const duplicate = await tx.release.findFirst({
      where: {
        shop,
        id: { not: release.id },
        catalogNumber: {
          equals: code,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        title: true,
        catalogNumber: true,
      },
    });

    if (duplicate) {
      throw publicError(
        `Catalog number ${code} is already assigned to "${duplicate.title || "Untitled Release"}".`,
        {
          status: 409,
          code: "CATALOG_NUMBER_ALREADY_ASSIGNED",
        },
      );
    }

    const now = new Date();

    await tx.release.update({
      where: { id: release.id },
      data: {
        catalogNumber: code,
        catalogNumberAssignedAt: now,
      },
    });

    await advanceCatalogSequenceForManualCode(tx, {
      shop,
      code,
    });

    await tx.submissionEvent.create({
      data: {
        releaseId: release.id,
        type: previousCode
          ? "CATALOG_NUMBER_CORRECTED"
          : "CATALOG_NUMBER_ASSIGNED_MANUAL",
        message: previousCode
          ? `Catalog number corrected from ${previousCode} to ${code}.`
          : `Catalog number ${code} assigned manually.`,
        actorLabel,
      },
    });

    return {
      code,
      previousCode,
      changed: true,
      corrected: Boolean(previousCode),
    };
  });
}

export async function createCatalogLifecycleRequest({
  shop,
  releaseId,
  type,
  category,
  trackId,
  summary,
  reason,
  effectiveDate,
  actorLabel = "Shopify admin",
}) {
  const normalizedType = operationType(type);
  const normalizedCategory = operationCategory(
    normalizedType,
    category,
  );
  const cleanSummary = cleanText(
    summary,
    160,
    "Summary",
    true,
  );
  const cleanReason = cleanText(
    reason,
    3000,
    "Request details",
    true,
  );
  const effectiveAt = cleanDate(effectiveDate);

  return db.$transaction(async (tx) => {
    const release = await ownedRelease(tx, shop, releaseId, {
      tracks: {
        select: {
          id: true,
          position: true,
          title: true,
        },
      },
    });

    let selectedTrackId = String(trackId || "").trim() || null;

    if (normalizedType === "TAKEDOWN") {
      selectedTrackId = null;
    } else if (
      selectedTrackId &&
      !release.tracks.some((track) => track.id === selectedTrackId)
    ) {
      throw publicError(
        "Selected track does not belong to this release.",
        {
          status: 400,
          code: "CATALOG_OPERATION_INVALID_TRACK",
        },
      );
    }

    const request = await tx.releaseLifecycleRequest.create({
      data: {
        shop,
        releaseId: release.id,
        trackId: selectedTrackId,
        type: normalizedType,
        category: normalizedCategory,
        scope:
          normalizedType === "TAKEDOWN"
            ? "FULL_RELEASE"
            : selectedTrackId
              ? "TRACK"
              : "RELEASE",
        status: "REQUESTED",
        summary: cleanSummary,
        reason: cleanReason,
        effectiveAt,
        requestedBy: actorLabel,
      },
      include: {
        track: {
          select: {
            id: true,
            position: true,
            title: true,
          },
        },
      },
    });

    await tx.submissionEvent.create({
      data: {
        releaseId: release.id,
        trackId: selectedTrackId,
        type: `CATALOG_${normalizedType}_REQUESTED`,
        message: `${cleanSummary}${effectiveAt ? ` · requested effective ${effectiveAt.toISOString().slice(0, 10)}` : ""}`,
        actorLabel,
      },
    });

    return request;
  });
}

export async function getCatalogLifecycleRequestIdentity({
  shop,
  releaseId,
  requestId,
}) {
  return db.releaseLifecycleRequest.findFirst({
    where: {
      id: requestId,
      releaseId,
      shop,
      release: { shop },
    },
    select: {
      id: true,
      type: true,
      status: true,
      summary: true,
    },
  });
}

export async function transitionCatalogLifecycleRequest({
  shop,
  releaseId,
  requestId,
  nextStatus,
  resolutionNote,
  actorLabel = "Shopify admin",
}) {
  const desired = String(nextStatus || "").trim().toUpperCase();
  const cleanResolution = cleanText(
    resolutionNote,
    2000,
    "Resolution note",
    false,
  );

  return db.$transaction(async (tx) => {
    const request = await tx.releaseLifecycleRequest.findFirst({
      where: {
        id: requestId,
        releaseId,
        shop,
        release: { shop },
      },
    });

    if (!request) {
      throw publicError("Catalog operation not found.", {
        status: 404,
        code: "CATALOG_OPERATION_NOT_FOUND",
      });
    }

    const allowed = catalogOperationNextStatuses(request.status);
    if (!allowed.includes(desired)) {
      throw publicError(
        `A ${request.status.toLowerCase().replaceAll("_", " ")} request cannot move to ${desired.toLowerCase().replaceAll("_", " ")}.`,
        {
          status: 409,
          code: "CATALOG_OPERATION_INVALID_TRANSITION",
        },
      );
    }

    const now = new Date();
    const updated = await tx.releaseLifecycleRequest.update({
      where: { id: request.id },
      data: {
        status: desired,
        resolutionNote: cleanResolution,
        completedAt: desired === "COMPLETED" ? now : null,
      },
      include: {
        track: {
          select: {
            id: true,
            position: true,
            title: true,
          },
        },
      },
    });

    await tx.submissionEvent.create({
      data: {
        releaseId,
        trackId: request.trackId,
        type: `CATALOG_OPERATION_${desired}`,
        message: `${request.type} request "${request.summary}" moved from ${request.status} to ${desired}${cleanResolution ? ` · ${cleanResolution}` : ""}.`,
        actorLabel,
        fromStatus: request.status,
        toStatus: desired,
      },
    });

    return updated;
  });
}

export function serializeCatalogOperationsForExport(requests = []) {
  return requests.map((request) => ({
    id: request.id,
    type: request.type,
    category: request.category,
    scope: request.scope,
    status: request.status,
    trackId: request.trackId || null,
    summary: request.summary,
    reason: request.reason,
    effectiveAt: request.effectiveAt
      ? new Date(request.effectiveAt).toISOString()
      : null,
    resolutionNote: request.resolutionNote || null,
    requestedBy: request.requestedBy || null,
    completedAt: request.completedAt
      ? new Date(request.completedAt).toISOString()
      : null,
    createdAt: request.createdAt
      ? new Date(request.createdAt).toISOString()
      : null,
    updatedAt: request.updatedAt
      ? new Date(request.updatedAt).toISOString()
      : null,
  }));
}

export {
  CATALOG_OPERATION_TRANSITIONS,
};
