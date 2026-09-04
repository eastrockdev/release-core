import db from "../db.server";
import { deploymentProfileId } from "./deployment-profile.server";
import {
  customerIsPortalMember,
} from "./portal-access-rules.server";
import {
  customerNumericId,
  portalReleaseAccess,
} from "./automations.server";
import { listPortalReleases } from "./portal.server";
import { publicError } from "./http-security.server";

const clean = (value) => String(value ?? "").trim() || null;

function normalizeTags(tags) {
  return (tags || [])
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);
}

function hasTag(tags, pattern) {
  return normalizeTags(tags).some((tag) => pattern.test(tag));
}

function membershipLabel(tags) {
  if (deploymentProfileId() !== "east-rock") return "ReleaseCore";
  if (hasTag(tags, /^RLIAB_(?:LIFETIME_)?PARTNER$/i)) return "RLIAB Partner";
  if (hasTag(tags, /^RLIAB_PRO$/i)) return "RLIAB Pro";
  if (hasTag(tags, /^RLIAB$/i)) return "RLIAB Starter";
  return "RLIAB";
}

function membershipTier(tags) {
  if (deploymentProfileId() !== "east-rock") return "MEMBER";
  if (hasTag(tags, /^RLIAB_(?:LIFETIME_)?PARTNER$/i)) return "PARTNER";
  if (hasTag(tags, /^RLIAB_PRO$/i)) return "PRO";
  if (hasTag(tags, /^RLIAB$/i)) return "STARTER";
  return "MEMBER";
}

async function shopifyCustomerWithLegacyProfile(admin, customerId) {
  const numeric = customerNumericId(customerId);
  if (!admin || !numeric) return null;

  const response = await admin.graphql(
    `#graphql
      query ReleaseCorePortalDashboardCustomer($id: ID!) {
        customer(id: $id) {
          id
          displayName
          email
          tags
          artistStageName: metafield(namespace: "custom", key: "artist_stage_name") { value }
          proIpi: metafield(namespace: "custom", key: "pro_ipi") { value }
          proAffiliation: metafield(namespace: "custom", key: "pro_affiliation") { value }
          spotifyArtist: metafield(namespace: "custom", key: "artist_url_spotify") { value }
          appleMusicArtist: metafield(namespace: "custom", key: "artist_url_apple") { value }
          publisherName: metafield(namespace: "custom", key: "publisher_name") { value }
          publisherIpi: metafield(namespace: "custom", key: "publisher_ipi") { value }
        }
      }`,
    { variables: { id: `gid://shopify/Customer/${numeric}` } },
  );
  const json = await response.json();
  return json?.data?.customer || null;
}

export async function portalMembership({ admin, customerId }) {
  const customer = await shopifyCustomerWithLegacyProfile(admin, customerId);
  const tags = normalizeTags(customer?.tags);
  const allowed = customerIsPortalMember(tags);

  return {
    allowed,
    label: membershipLabel(tags),
    tier: membershipTier(tags),
    customer: customer
      ? {
          id: customer.id,
          displayName: customer.displayName,
          email: customer.email,
        }
      : null,
    tags,
    message: allowed
      ? null
      : deploymentProfileId() === "east-rock"
        ? "This customer account does not have an active RLIAB membership tag yet. If you just subscribed, Shopify Flow may still be activating access."
        : "This customer account does not currently have portal access.",
  };
}

function legacyPrefill(customer) {
  if (!customer) return null;
  return {
    name: clean(customer.artistStageName?.value),
    legalName: clean(customer.displayName),
    email: clean(customer.email),
    pro: clean(customer.proAffiliation?.value),
    ipi: clean(customer.proIpi?.value),
    publisherName: clean(customer.publisherName?.value),
    publisherIpi: clean(customer.publisherIpi?.value),
    spotifyUrl: clean(customer.spotifyArtist?.value),
    appleMusicUrl: clean(customer.appleMusicArtist?.value),
  };
}

function profileCompletion(artist) {
  if (!artist) {
    return {
      percent: 0,
      complete: 0,
      total: 8,
      missing: ["Artist name", "Legal name", "PRO", "IPI / CAE", "Biography", "Photo", "Spotify", "Apple Music"],
    };
  }

  const fields = [
    ["name", "Artist name"],
    ["legalName", "Legal name"],
    ["pro", "PRO"],
    ["ipi", "IPI / CAE"],
    ["biography", "Biography"],
    ["imageUrl", "Photo"],
    ["spotifyUrl", "Spotify"],
    ["appleMusicUrl", "Apple Music"],
  ];
  const missing = fields
    .filter(([key]) => !String(artist?.[key] || "").trim())
    .map(([, label]) => label);
  const complete = fields.length - missing.length;
  return {
    percent: Math.round((complete / fields.length) * 100),
    complete,
    total: fields.length,
    missing,
  };
}

function releaseStats(releases) {
  const now = Date.now();
  let attention = 0;
  let upcoming = 0;
  let live = 0;
  let active = 0;

  for (const release of releases || []) {
    if (
      release.status === "CHANGES_REQUESTED" ||
      Number(release.openReviewItems || 0) > 0
    ) attention += 1;

    const releaseTime = release.releaseDate
      ? new Date(release.releaseDate).getTime()
      : NaN;
    if (Number.isFinite(releaseTime) && releaseTime > now) upcoming += 1;

    if (release.distributionStatus === "DELIVERED") live += 1;
    if (["DRAFT", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(release.status)) {
      active += 1;
    }
  }

  return {
    total: (releases || []).length,
    active,
    upcoming,
    attention,
    live,
  };
}

async function fullPortalArtists({ shop, customerId }) {
  const numeric = customerNumericId(customerId) || String(customerId || "");
  const rows = await db.portalArtistAccess.findMany({
    where: { shop, customerId: numeric },
    include: { artist: true },
    orderBy: { createdAt: "asc" },
  });

  const seen = new Set();
  const artists = [];
  for (const row of rows) {
    if (!row.artist?.id || seen.has(row.artist.id)) continue;
    seen.add(row.artist.id);
    artists.push(row.artist);
  }

  const policy = await db.portalCustomerPolicy
    .findUnique({
      where: { shop_customerId: { shop, customerId: numeric } },
      include: { soloArtist: true },
    })
    .catch(() => null);

  if (policy?.soloArtist?.id && !seen.has(policy.soloArtist.id)) {
    artists.push(policy.soloArtist);
  }

  return artists;
}

async function contributorsForArtist({ shop, artistId }) {
  if (!artistId) return [];
  const rows = await db.artistContributor.findMany({
    where: {
      artistId,
      artist: { shop },
    },
    include: { contributor: true },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({
    id: row.contributor.id,
    legalName: row.contributor.legalName,
    stageName: row.contributor.stageName,
    email: row.contributor.email,
    pro: row.contributor.pro,
    ipi: row.contributor.ipi,
    publisherName: row.contributor.publisherName,
    relationshipType: row.relationshipType,
  }));
}

export async function portalDashboardState({
  admin,
  shop,
  customerId,
  selectedArtistId = null,
}) {
  const [membership, access, artists] = await Promise.all([
    portalMembership({ admin, shop, customerId }),
    portalReleaseAccess({ admin, shop, customerId }),
    fullPortalArtists({ shop, customerId }),
  ]);

  if (!membership.allowed) {
    return {
      membership,
      access,
      artists: [],
      selectedArtist: null,
      releases: [],
      recentReleases: [],
      stats: releaseStats([]),
      profileCompletion: profileCompletion(null),
      contributors: [],
      onboarding: {
        required: false,
        legacyPrefill: null,
      },
    };
  }

  const selectedArtist =
    artists.find((artist) => artist.id === selectedArtistId) ||
    artists[0] ||
    null;

  const [customer, contributors, releases] = await Promise.all([
    shopifyCustomerWithLegacyProfile(admin, customerId),
    contributorsForArtist({
      shop,
      artistId: selectedArtist?.id,
    }),
    selectedArtist
      ? listPortalReleases({
          shop,
          customerId,
          admin,
          artistId: selectedArtist.id,
        })
      : Promise.resolve([]),
  ]);

  return {
    membership,
    access,
    artists,
    selectedArtist,
    releases,
    recentReleases: releases.slice(0, 4),
    stats: releaseStats(releases),
    profileCompletion: profileCompletion(selectedArtist),
    contributors,
    onboarding: {
      required: artists.length === 0,
      legacyPrefill: artists.length ? null : legacyPrefill(customer),
      legacySourceAvailable: Boolean(
        customer?.artistStageName?.value ||
        customer?.proIpi?.value ||
        customer?.proAffiliation?.value ||
        customer?.spotifyArtist?.value ||
        customer?.appleMusicArtist?.value,
      ),
    },
  };
}

function onboardingData(formData, customer) {
  return {
    name: clean(formData.get("name")),
    legalName: clean(formData.get("legalName")),
    email: clean(formData.get("email")) || clean(customer?.email),
    pro: clean(formData.get("pro")),
    ipi: clean(formData.get("ipi")),
    publisherName: clean(formData.get("publisherName")),
    publisherIpi: clean(formData.get("publisherIpi")),
    spotifyUrl: clean(formData.get("spotifyUrl")),
    appleMusicUrl: clean(formData.get("appleMusicUrl")),
    websiteUrl: clean(formData.get("websiteUrl")),
  };
}

export async function savePortalOnboarding({
  admin,
  shop,
  customerId,
  formData,
}) {
  const membership = await portalMembership({ admin, shop, customerId });
  if (!membership.allowed) {
    throw publicError(
      membership.message || "Your customer account does not have portal access.",
      { status: 403 },
    );
  }

  const access = await portalReleaseAccess({ admin, shop, customerId });
  const numeric = customerNumericId(customerId) || String(customerId || "");
  const requestedArtistId = clean(formData.get("artistId"));
  const customer = await shopifyCustomerWithLegacyProfile(admin, customerId);
  const data = onboardingData(formData, customer);

  let existingArtist = null;
  if (requestedArtistId) {
    const row = await db.portalArtistAccess.findFirst({
      where: {
        shop,
        customerId: numeric,
        artistId: requestedArtistId,
      },
      include: { artist: true },
    });
    existingArtist = row?.artist || null;
    if (!existingArtist) {
      throw publicError("You do not have access to that artist profile.", {
        status: 403,
      });
    }
  } else if (
    access.artistAccess?.artists?.length === 1 &&
    !access.artistAccess?.canManageMultipleArtists
  ) {
    existingArtist = await db.artist.findFirst({
      where: {
        shop,
        id: access.artistAccess.artists[0].id,
      },
    });
  }

  if (!data.name && !existingArtist?.name) {
    throw publicError("Artist / stage name is required.");
  }

  const settings = await db.appSettings.findUnique({
    where: { shop },
    select: { lockArtistNameEditing: true },
  });
  const lockArtistName = settings?.lockArtistNameEditing ?? true;

  if (existingArtist) {
    return db.artist.update({
      where: { id: existingArtist.id },
      data: {
        name:
          lockArtistName && existingArtist.name
            ? existingArtist.name
            : data.name || existingArtist.name,
        legalName: data.legalName,
        email: data.email,
        pro: data.pro,
        ipi: data.ipi,
        publisherName: data.publisherName,
        publisherIpi: data.publisherIpi,
        spotifyUrl: data.spotifyUrl,
        appleMusicUrl: data.appleMusicUrl,
        websiteUrl: data.websiteUrl,
      },
    });
  }

  if (
    access.artistAccess?.artists?.length &&
    !access.artistAccess?.canManageMultipleArtists
  ) {
    throw publicError(
      "This customer account already has an artist associated with it.",
      { status: 409 },
    );
  }

  return db.artist.create({
    data: {
      shop,
      name: data.name,
      legalName: data.legalName,
      email: data.email,
      pro: data.pro,
      ipi: data.ipi,
      publisherName: data.publisherName,
      publisherIpi: data.publisherIpi,
      spotifyUrl: data.spotifyUrl,
      appleMusicUrl: data.appleMusicUrl,
      websiteUrl: data.websiteUrl,
      portalAccess: {
        create: {
          shop,
          customerId: numeric,
          role: "OWNER",
        },
      },
    },
  });
}
