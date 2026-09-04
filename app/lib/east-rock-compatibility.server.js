import { deploymentProfileId } from "./deployment-profile.server";

const EAST_ROCK_PROFILE = "east-rock";

function clean(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

function metafield(key, type, value) {
  if (value === null || value === undefined || value === "") return null;
  return {
    namespace: "custom",
    key,
    type,
    value: String(value),
  };
}

function listMetafield(key, values) {
  const cleanValues = [
    ...new Set((values || []).map(clean).filter(Boolean)),
  ];
  if (!cleanValues.length) return null;
  return {
    namespace: "custom",
    key,
    type: "list.single_line_text_field",
    value: JSON.stringify(cleanValues),
  };
}

function names(assignments, role) {
  return (assignments || [])
    .filter((assignment) => assignment.role === role)
    .map((assignment) => assignment.artist?.name)
    .filter(Boolean);
}

function contributorNames(track, role) {
  return (track?.credits || [])
    .filter((credit) => credit.role === role)
    .map(
      (credit) =>
        credit.contributor?.stageName || credit.contributor?.legalName,
    )
    .filter(Boolean);
}

function joinedCredits(track, role) {
  const values = contributorNames(track, role);
  return values.length ? values.join(", ") : null;
}

function uniqueEastRockNames(values) {
  const seen = new Set();
  const result = [];

  for (const value of values || []) {
    const name = clean(value);
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }

  return result;
}

function releaseContributorNames(release, role) {
  return uniqueEastRockNames(
    (release?.tracks || []).flatMap((track) =>
      contributorNames(track, role),
    ),
  );
}

function joinedReleaseCredits(release, role) {
  const values = releaseContributorNames(release, role);
  return values.length ? values.join(", ") : null;
}

function releaseTypeLabel(type) {
  const value = String(type || "").trim().toUpperCase();
  if (value === "SINGLE") return "Single";
  if (value === "EP") return "EP";
  if (value === "ALBUM") return "Album";
  return clean(type);
}

function releasePrimaryArtists(release) {
  return uniqueEastRockNames([
    ...names(release?.artists, "PRIMARY"),
    ...(release?.tracks || []).flatMap((track) =>
      names(track?.artists, "PRIMARY"),
    ),
    release?.artistName,
  ]);
}

function releaseArtistName(release) {
  const primary = releasePrimaryArtists(release);
  return primary.length ? primary.join(" & ") : null;
}

function trackArtistName(release, track) {
  const primary = names(track?.artists, "PRIMARY");
  return primary.join(" & ") || releaseArtistName(release);
}

function releaseFeaturedArtists(release) {
  return uniqueEastRockNames([
    ...names(release?.artists, "FEATURED"),
    ...(release?.tracks || []).flatMap((track) =>
      names(track?.artists, "FEATURED"),
    ),
  ]);
}

export const EAST_ROCK_PARENTAL_ADVISORY_CHOICES = [
  "Explicit",
  "Non-Explicit",
  "Cleaned Version",
];

export function eastRockParentalAdvisoryValue(track) {
  if (track?.explicit) return "Explicit";

  const version = String(track?.version || "").trim().toLowerCase();
  if (/\bclean(?:ed)?\b/.test(version)) return "Cleaned Version";
  return "Non-Explicit";
}

export const EAST_ROCK_DISTRIBUTION_STATUS_CHOICES = [
  "Pending Review",
  "In-Review",
  "Submitted",
  "Rejected",
  "Approved",
  "Live",
  "Takedown",
  "Copyright",
];

export function eastRockDistributionStatusValue(release) {
  const releaseStatus = String(release?.status || "").trim().toUpperCase();
  const distributionStatus = String(release?.distributionStatus || "")
    .trim()
    .toUpperCase();

  if (
    distributionStatus === "TAKEDOWN" ||
    distributionStatus === "TAKEDOWN_REQUESTED"
  ) {
    return "Takedown";
  }

  if (
    releaseStatus === "COPYRIGHT" ||
    distributionStatus === "COPYRIGHT"
  ) {
    return "Copyright";
  }

  if (releaseStatus === "REJECTED") return "Rejected";
  if (distributionStatus === "DELIVERED") return "Live";
  if (releaseStatus === "APPROVED") return "Approved";

  if (
    releaseStatus === "IN_REVIEW" ||
    releaseStatus === "CHANGES_REQUESTED" ||
    distributionStatus === "RETURNED_FOR_CORRECTIONS"
  ) {
    return "In-Review";
  }

  if (releaseStatus === "SUBMITTED") return "Submitted";
  return "Pending Review";
}

function legacyGenre(value) {
  const genre = clean(value);
  if (!genre) return null;

  const aliases = {
    "Hip-Hop/Rap": "Hip-hop",
    "Hip Hop/Rap": "Hip-hop",
    "Hip-Hop": "Hip-hop",
  };

  return aliases[genre] || genre;
}

function releaseDateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function previewFileId(track) {
  return (
    (track?.files || []).find(
      (file) =>
        file.kind === "PREVIEW_MP3" &&
        String(file.storageKey || "").startsWith("gid://shopify/"),
    )?.storageKey || null
  );
}

function customerReference(value) {
  const raw = clean(value);
  if (!raw) return null;
  if (raw.startsWith("gid://shopify/Customer/")) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/Customer/${raw}`;
  return null;
}

function releaseProductReference(release) {
  const candidates = [
    release?.shopifyReleaseProductId,
    release?.shopifyProductId,
    release?.shopifyBundleProductId,
    release?.bundleProductId,
  ];

  return (
    candidates.find((value) =>
      String(value || "").startsWith("gid://shopify/Product/"),
    ) || null
  );
}

export function eastRockCompatibilityEnabled() {
  return deploymentProfileId() === EAST_ROCK_PROFILE;
}

export function buildEastRockTrackProductMetafields({ release, track }) {
  if (!eastRockCompatibilityEnabled()) return [];

  const primary = names(track?.artists, "PRIMARY");
  const featured = names(track?.artists, "FEATURED");
  const associatedAlbum =
    String(release?.type || "").toUpperCase() === "SINGLE"
      ? null
      : releaseProductReference(release);

  return [
    listMetafield("download_format", ["FLAC", "MP3"]),
    metafield("music_genre", "single_line_text_field", legacyGenre(release?.primaryGenre)),
    metafield("associated_album", "product_reference", associatedAlbum),
    metafield("audio_preview", "file_reference", previewFileId(track)),
    metafield("cover_art_designer", "single_line_text_field", joinedCredits(track, "COVER_ART_DESIGNER")),
    metafield(
      "distribution_status",
      "single_line_text_field",
      eastRockDistributionStatusValue(
        release,
      ),
    ),

    // Keep both East Rock generations populated. The current storefront reads
    // release_artist / featured_artists, while older RLIAB data used
    // artist_primary / artist_featured.
    listMetafield("artist_featured", featured),
    listMetafield("featured_artists", featured),
    metafield("mastering_engineer", "single_line_text_field", joinedCredits(track, "MASTERING_ENGINEER")),
    metafield("mixing_engineer", "single_line_text_field", joinedCredits(track, "MIXING_ENGINEER")),
    metafield(
      "parental_advisory",
      "single_line_text_field",
      eastRockParentalAdvisoryValue(
        track,
      ),
    ),
    metafield("recording_engineer", "single_line_text_field", joinedCredits(track, "RECORDING_ENGINEER")),
    listMetafield("artist_primary", primary.length ? primary : [release?.artistName]),
    metafield("release_artist", "single_line_text_field", trackArtistName(release, track)),
    metafield("release_date", "date", releaseDateValue(release?.releaseDate)),
    metafield("pre_order_date", "date", releaseDateValue(release?.preOrderDate)),
    metafield("release_type", "single_line_text_field", releaseTypeLabel(release?.type)),
    metafield("release_upc", "single_line_text_field", release?.upc),
    metafield(
      "single_isrc",
      "single_line_text_field",
      String(release?.type || "").toUpperCase() === "SINGLE"
        ? track?.isrc
        : null,
    ),
    metafield("song_producer", "single_line_text_field", joinedCredits(track, "PRODUCER")),
    metafield("streaming_url", "url", release?.streamingUrl),
    metafield("submitted_by", "customer_reference", customerReference(release?.ownerCustomerId)),
    metafield(
      "track_album_order_number",
      "number_integer",
      String(release?.type || "").toUpperCase() === "SINGLE"
        ? null
        : track?.position,
    ),
  ].filter(Boolean);
}

export function buildEastRockReleaseProductMetafields({ release }) {
  if (!eastRockCompatibilityEnabled()) return [];

  const primary = releasePrimaryArtists(release);
  const featured = releaseFeaturedArtists(release);
  const anyExplicit = (release?.tracks || []).some((track) => track?.explicit);
  const parental = anyExplicit ? "Explicit" : "Non-Explicit";

  return [
    listMetafield("download_format", ["FLAC", "MP3"]),
    metafield("music_genre", "single_line_text_field", legacyGenre(release?.primaryGenre)),
    metafield("cover_art_designer", "single_line_text_field", joinedReleaseCredits(release, "COVER_ART_DESIGNER")),
    metafield(
      "distribution_status",
      "single_line_text_field",
      eastRockDistributionStatusValue(
        release,
      ),
    ),
    listMetafield("artist_featured", featured),
    listMetafield("featured_artists", featured),
    metafield("mastering_engineer", "single_line_text_field", joinedReleaseCredits(release, "MASTERING_ENGINEER")),
    metafield("mixing_engineer", "single_line_text_field", joinedReleaseCredits(release, "MIXING_ENGINEER")),
    metafield("parental_advisory", "single_line_text_field", parental),
    metafield("recording_engineer", "single_line_text_field", joinedReleaseCredits(release, "RECORDING_ENGINEER")),
    listMetafield("artist_primary", primary.length ? primary : [release?.artistName]),
    metafield("release_artist", "single_line_text_field", releaseArtistName(release)),
    metafield("release_date", "date", releaseDateValue(release?.releaseDate)),
    metafield("pre_order_date", "date", releaseDateValue(release?.preOrderDate)),
    metafield("release_type", "single_line_text_field", releaseTypeLabel(release?.type)),
    metafield("release_upc", "single_line_text_field", release?.upc),
    metafield("song_producer", "single_line_text_field", joinedReleaseCredits(release, "PRODUCER")),
    metafield("streaming_url", "url", release?.streamingUrl),
    metafield("submitted_by", "customer_reference", customerReference(release?.ownerCustomerId)),
  ].filter(Boolean);
}

export function eastRockCompatibilityMap() {
  return {
    "custom.download_format": "ReleaseCore customer download formats",
    "custom.music_genre": "release.primaryGenre",
    "custom.associated_album": "Release-level Shopify Album/EP product reference when available",
    "custom.audio_preview": "track PREVIEW_MP3 Shopify file reference",
    "custom.cover_art_designer": "COVER_ART_DESIGNER credits",
    "custom.distribution_status": "release.distributionStatus",
    "custom.artist_featured": "track/release FEATURED artists (legacy)",
    "custom.featured_artists": "track/release FEATURED artists (current East Rock storefront)",
    "custom.mastering_engineer": "MASTERING_ENGINEER credits",
    "custom.mixing_engineer": "MIXING_ENGINEER credits",
    "custom.parental_advisory": "track/release explicit state",
    "custom.recording_engineer": "RECORDING_ENGINEER credits",
    "custom.artist_primary": "track/release PRIMARY artists (legacy)",
    "custom.release_artist": "track/release PRIMARY artist display name (current East Rock storefront)",
    "custom.release_date": "release.releaseDate",
    "custom.pre_order_date": "release.preOrderDate",
    "custom.release_type": "release.type",
    "custom.release_upc": "release.upc",
    "custom.single_isrc": "single track ISRC",
    "custom.song_producer": "PRODUCER credits",
    "custom.streaming_url": "release.streamingUrl",
    "custom.submitted_by": "release.ownerCustomerId",
    "custom.track_album_order_number": "track.position for Album/EP",
  };
}
