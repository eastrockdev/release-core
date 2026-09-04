import db from "../db.server";
import { deploymentProfileId } from "./deployment-profile.server";
import {
  customerCanManageMultipleArtists,
  portalMultiArtistTag,
} from "./portal-access-rules.server";
import { publicError } from "./http-security.server";

const FALLBACK_LABEL_ARTIST_LIMIT = 5;

function clean(value) {
  return String(value ?? "").trim();
}

function normalizedTagSet(tags) {
  return new Set(
    (tags || [])
      .map((tag) => clean(tag).toUpperCase())
      .filter(Boolean),
  );
}

function safeLimit(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 100);
}

export function normalizePortalLabelPlans(value) {
  const source = Array.isArray(value)
    ? value
    : (() => {
        if (!value) return [];
        try {
          const parsed = JSON.parse(String(value));
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();

  const seen = new Set();
  const plans = [];

  for (const item of source) {
    const tag = clean(item?.tag);
    const normalized = tag.toUpperCase();
    if (!tag || seen.has(normalized)) continue;
    seen.add(normalized);
    plans.push({
      tag,
      maxArtists: safeLimit(item?.maxArtists, 1),
    });
  }

  return plans.slice(0, 30);
}

export function resolvePortalLabelPlan({ tags = [], settings = {} }) {
  const tagSet = normalizedTagSet(tags);
  const configured = normalizePortalLabelPlans(settings?.portalLabelPlans)
    .filter((plan) => tagSet.has(plan.tag.toUpperCase()))
    .sort((a, b) => b.maxArtists - a.maxArtists);

  if (configured.length) {
    return {
      ...configured[0],
      fallback: false,
    };
  }

  if (customerCanManageMultipleArtists(tags)) {
    return {
      tag: portalMultiArtistTag(),
      maxArtists: FALLBACK_LABEL_ARTIST_LIMIT,
      fallback: true,
    };
  }

  return null;
}

export function portalLabelMerchantIdentity(settings = {}) {
  const eastRock = deploymentProfileId() === "east-rock";
  const labelName =
    clean(settings?.defaultLabelName) ||
    (eastRock ? "East Rock Entertainment" : "ReleaseCore");
  const pLineHolder =
    clean(settings?.defaultCopyrightHolder) ||
    labelName;

  return {
    labelName,
    pLineHolder,
  };
}

export async function portalLabelAccount({
  shop,
  customerId,
  customerTags = [],
  settings = {},
  artistCount = null,
}) {
  const plan = resolvePortalLabelPlan({
    tags: customerTags,
    settings,
  });

  const numeric = String(customerId || "");
  const [record, count] = await Promise.all([
    numeric
      ? db.portalLabelAccount
          .findUnique({
            where: {
              shop_customerId: {
                shop,
                customerId: numeric,
              },
            },
          })
          .catch(() => null)
      : Promise.resolve(null),
    Number.isInteger(artistCount)
      ? Promise.resolve(artistCount)
      : numeric
        ? db.portalArtistAccess.count({
            where: { shop, customerId: numeric },
          })
        : Promise.resolve(0),
  ]);

  const merchant = portalLabelMerchantIdentity(settings);
  const enabled = Boolean(plan);
  const maxArtists = enabled ? plan.maxArtists : 1;
  const labelName = clean(record?.name) || null;

  const labelOptions = [merchant.labelName];
  const pLineOptions = [merchant.pLineHolder];
  if (enabled && labelName) {
    if (!labelOptions.includes(labelName)) labelOptions.push(labelName);
    if (!pLineOptions.includes(labelName)) pLineOptions.push(labelName);
  }

  return {
    enabled,
    name: labelName,
    sourceTag: plan?.tag || null,
    maxArtists,
    artistCount: count,
    remainingArtists: Math.max(0, maxArtists - count),
    canCreateArtist: enabled && count < maxArtists,
    fallbackPlan: Boolean(plan?.fallback),
    merchantLabelName: merchant.labelName,
    merchantPLineHolder: merchant.pLineHolder,
    labelOptions,
    pLineOptions,
  };
}

export async function savePortalLabelName({
  shop,
  customerId,
  customerTags = [],
  settings = {},
  name,
}) {
  const plan = resolvePortalLabelPlan({
    tags: customerTags,
    settings,
  });
  if (!plan) {
    throw publicError(
      "This account is not configured as a label/team account.",
      { status: 403 },
    );
  }

  const cleanName = clean(name);
  if (!cleanName) {
    throw publicError("Enter your team or label name.");
  }
  if (cleanName.length > 100) {
    throw publicError("Team or label names must be 100 characters or fewer.");
  }

  return db.portalLabelAccount.upsert({
    where: {
      shop_customerId: {
        shop,
        customerId: String(customerId || ""),
      },
    },
    create: {
      shop,
      customerId: String(customerId || ""),
      name: cleanName,
      sourceTag: plan.tag,
      artistLimit: plan.maxArtists,
    },
    update: {
      name: cleanName,
      sourceTag: plan.tag,
      artistLimit: plan.maxArtists,
    },
  });
}

export function validatePortalDistributionChoice({
  value,
  options,
  fallback,
  fieldLabel,
}) {
  const submitted = clean(value);
  if (!submitted) return fallback || null;
  if (!(options || []).includes(submitted)) {
    throw publicError(
      `Choose a valid ${fieldLabel}.`,
      { status: 400 },
    );
  }
  return submitted;
}
