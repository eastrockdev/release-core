import db from "../db.server";
import { customerNumericId } from "./automations";
import { deploymentProfileId } from "./deployment-profile.server";
import { publicError } from "./http-security.server";

export const PORTAL_EDIT_LOCK_TYPE = "PORTAL_EDIT_LOCK";
export const PORTAL_EDIT_LOCK_STATUS = "ACTIVE";

export function releaseCreationDisabledTag() {
  return deploymentProfileId() === "east-rock"
    ? "RLIAB_RELEASE_CREATION_DISABLED"
    : "RELEASECORE_RELEASE_CREATION_DISABLED";
}

function normalizedTags(tags) {
  return new Set(
    (tags || [])
      .map((tag) => String(tag || "").trim().toUpperCase())
      .filter(Boolean),
  );
}

export function customerReleaseCreationDisabled(tags) {
  return normalizedTags(tags).has(
    releaseCreationDisabledTag().toUpperCase(),
  );
}

export function releaseCreationDisabledMessage() {
  return "Release creation has been disabled for this account by a ReleaseCore administrator.";
}

export function applyReleaseCreationModeration(access, tags) {
  if (!customerReleaseCreationDisabled(tags)) return access;

  const reason = releaseCreationDisabledMessage();
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

export function assertCustomerCanCreateRelease(tags) {
  if (!customerReleaseCreationDisabled(tags)) return;
  throw publicError(releaseCreationDisabledMessage(), {
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
    select: { id: true, title: true },
  });
  if (!release) {
    throw publicError("Release not found.", { status: 404 });
  }

  const cleanReason = String(reason || "").trim() ||
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
          resolutionNote: "Artist editing unlocked by a ReleaseCore administrator.",
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
  admin,
  customerId,
  disabled,
}) {
  const numericId = customerNumericId(customerId);
  if (!numericId) {
    throw publicError("Choose a valid Shopify customer.", { status: 400 });
  }

  const tag = releaseCreationDisabledTag();
  const mutation = disabled
    ? `#graphql
        mutation ReleaseCoreModerationTagsAdd($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            node { id }
            userErrors { field message }
          }
        }`
    : `#graphql
        mutation ReleaseCoreModerationTagsRemove($id: ID!, $tags: [String!]!) {
          tagsRemove(id: $id, tags: $tags) {
            node { id }
            userErrors { field message }
          }
        }`;

  const response = await admin.graphql(mutation, {
    variables: {
      id: `gid://shopify/Customer/${numericId}`,
      tags: [tag],
    },
  });
  const json = await response.json();
  const payload = disabled ? json?.data?.tagsAdd : json?.data?.tagsRemove;
  const errors = payload?.userErrors || [];
  if (errors.length) {
    throw publicError(errors.map((item) => item.message).join(" "), {
      status: 400,
    });
  }
  if (!payload?.node?.id) {
    throw publicError("Shopify customer not found.", { status: 404 });
  }

  return {
    customerId: numericId,
    disabled: Boolean(disabled),
    tag,
  };
}
