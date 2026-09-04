import db from "../db.server";
import { customerNumericId } from "./automations";
import { deploymentProfileId } from "./deployment-profile.server";
import { publicError } from "./http-security.server";

export const PORTAL_EDIT_LOCK_TYPE = "PORTAL_EDIT_LOCK";
export const PORTAL_EDIT_LOCK_STATUS = "ACTIVE";
export const RELEASE_CREATION_DISABLED_OPERATION =
  "PORTAL_RELEASE_CREATION_DISABLED";
export const RELEASE_CREATION_ENABLED_OPERATION =
  "PORTAL_RELEASE_CREATION_ENABLED";

function normalizedCustomerId(customerId) {
  return customerNumericId(customerId) || String(customerId || "").trim();
}

export function releaseCreationDisabledMessage(policy = null) {
  return (
    policy?.reason ||
    "Release creation has been disabled for this account by a ReleaseCore administrator."
  );
}

export function releaseCreationPolicyFromEvent(event) {
  if (!event) {
    return {
      disabled: false,
      reason: null,
      updatedAt: null,
    };
  }

  const details =
    event.details && typeof event.details === "object"
      ? event.details
      : {};
  const disabled =
    event.operation === RELEASE_CREATION_DISABLED_OPERATION;

  return {
    disabled,
    reason: disabled
      ? String(details.reason || event.summary || "").trim() || null
      : null,
    updatedAt: event.createdAt || null,
  };
}

export async function getCustomerReleaseCreationPolicy({
  shop,
  customerId,
}) {
  const sourceId = normalizedCustomerId(customerId);
  if (!sourceId) {
    return releaseCreationPolicyFromEvent(null);
  }

  const event = await db.dataMaintenanceEvent.findFirst({
    where: {
      shop,
      deploymentProfile: deploymentProfileId(),
      entityType: "PORTAL_CUSTOMER",
      sourceId,
      operation: {
        in: [
          RELEASE_CREATION_DISABLED_OPERATION,
          RELEASE_CREATION_ENABLED_OPERATION,
        ],
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return releaseCreationPolicyFromEvent(event);
}

export function applyReleaseCreationModeration(access, policy) {
  if (!policy?.disabled) return access;

  const reason = releaseCreationDisabledMessage(policy);
  const options = Object.fromEntries(
    Object.entries(access?.options || {}).map(([type, option]) => [
      type,
      {
        ...(option || {}),
        allowed: false,
        reason,
      },
    ]),
  );

  return {
    ...(access || {}),
    releaseCreationAllowed: false,
    releaseCreationDisabled: true,
    releaseCreationDisabledReason: reason,
    options,
  };
}

export function assertCustomerCanCreateRelease(policy) {
  if (!policy?.disabled) return;
  throw publicError(releaseCreationDisabledMessage(policy), {
    status: 403,
    code: "RELEASE_CREATION_DISABLED",
  });
}

export async function getReleaseArtistEditLock({ shop, releaseId }) {
  if (!releaseId) {
    return { locked: false, reason: null, id: null };
  }

  const lock = await db.releaseLifecycleRequest.findFirst({
    where: {
      shop,
      releaseId,
      type: PORTAL_EDIT_LOCK_TYPE,
      status: PORTAL_EDIT_LOCK_STATUS,
    },
    orderBy: { createdAt: "desc" },
  });

  return {
    locked: Boolean(lock),
    reason: lock?.reason || null,
    id: lock?.id || null,
    createdAt: lock?.createdAt || null,
  };
}

export async function assertReleaseArtistEditable({ shop, releaseId }) {
  if (!releaseId) return;
  const lock = await getReleaseArtistEditLock({ shop, releaseId });
  if (!lock.locked) return;

  throw publicError(
    lock.reason
      ? `This release is locked by a ReleaseCore administrator. ${lock.reason}`
      : "This release is locked by a ReleaseCore administrator and is read only in the Artist Portal.",
    {
      status: 423,
      code: "PORTAL_RELEASE_LOCKED",
    },
  );
}

export async function setReleaseArtistEditLock({
  shop,
  releaseId,
  locked,
  reason = null,
  actorLabel = "Shopify admin",
}) {
  const release = await db.release.findFirst({
    where: { id: releaseId, shop },
    select: { id: true },
  });
  if (!release) {
    throw publicError("Release not found.", { status: 404 });
  }

  const cleanReason =
    String(reason || "").trim() ||
    "Artist editing disabled by a ReleaseCore administrator.";
  const now = new Date();

  await db.$transaction(async (tx) => {
    const active = await tx.releaseLifecycleRequest.findFirst({
      where: {
        shop,
        releaseId,
        type: PORTAL_EDIT_LOCK_TYPE,
        status: PORTAL_EDIT_LOCK_STATUS,
      },
      orderBy: { createdAt: "desc" },
    });

    if (locked) {
      if (active) {
        await tx.releaseLifecycleRequest.update({
          where: { id: active.id },
          data: {
            reason: cleanReason,
            summary: "Artist editing locked",
            effectiveAt: active.effectiveAt || now,
            requestedBy: actorLabel,
          },
        });
      } else {
        await tx.releaseLifecycleRequest.create({
          data: {
            shop,
            releaseId,
            type: PORTAL_EDIT_LOCK_TYPE,
            category: "MODERATION",
            scope: "RELEASE",
            status: PORTAL_EDIT_LOCK_STATUS,
            summary: "Artist editing locked",
            reason: cleanReason,
            requestedBy: actorLabel,
            effectiveAt: now,
          },
        });

        await tx.submissionEvent.create({
          data: {
            releaseId,
            type: "PORTAL_EDIT_LOCKED",
            message: cleanReason,
            actorLabel,
          },
        });
      }
    } else if (active) {
      await tx.releaseLifecycleRequest.updateMany({
        where: {
          shop,
          releaseId,
          type: PORTAL_EDIT_LOCK_TYPE,
          status: PORTAL_EDIT_LOCK_STATUS,
        },
        data: {
          status: "RESOLVED",
          completedAt: now,
          resolutionNote:
            "Artist editing unlocked by a ReleaseCore administrator.",
        },
      });

      await tx.submissionEvent.create({
        data: {
          releaseId,
          type: "PORTAL_EDIT_UNLOCKED",
          message: "Artist editing unlocked.",
          actorLabel,
        },
      });
    }
  });

  return getReleaseArtistEditLock({ shop, releaseId });
}

export async function setCustomerReleaseCreationDisabled({
  shop,
  customerId,
  disabled,
  reason = null,
  actorLabel = "Shopify admin",
}) {
  const sourceId = normalizedCustomerId(customerId);
  if (!sourceId) {
    throw publicError("Choose a valid Shopify customer.", {
      status: 400,
    });
  }

  const cleanReason = String(reason || "").trim() || null;
  const operation = disabled
    ? RELEASE_CREATION_DISABLED_OPERATION
    : RELEASE_CREATION_ENABLED_OPERATION;
  const summary = disabled
    ? "Release creation disabled for Artist Portal user."
    : "Release creation restored for Artist Portal user.";

  await db.dataMaintenanceEvent.create({
    data: {
      shop,
      deploymentProfile: deploymentProfileId(),
      operation,
      entityType: "PORTAL_CUSTOMER",
      sourceId,
      summary,
      details: {
        disabled: Boolean(disabled),
        reason: cleanReason,
        actorLabel,
      },
    },
  });

  return {
    customerId: sourceId,
    disabled: Boolean(disabled),
    reason: cleanReason,
  };
}
