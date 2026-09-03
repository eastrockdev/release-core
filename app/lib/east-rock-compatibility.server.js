import { deploymentProfileId } from "./deployment-profile.server";

const EAST_ROCK_PROFILE = "east-rock";

function clean(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

function metafield(key, type, value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  return {
    namespace: "custom",
    key,
    type,
    value: String(value),
  };
}

function listMetafield(key, values) {
  const cleanValues = [
    ...new Set(
      (values || [])
        .map(clean)
        .filter(Boolean),
    ),
  ];

  if (!cleanValues.length) {
    return null;
  }

  return {
    namespace: "custom",
    key,
    type: "list.single_line_text_field",
    value: JSON.stringify(cleanValues),
  };
}

function names(assignments, role) {
  return (assignments || [])
    .filter(
      (assignment) =>
        assignment.role === role,
    )
    .map(
      (assignment) =>
        assignment.artist?.name,
    )
    .filter(Boolean);
}

function contributorNames(track, role) {
  return (track?.credits || [])
    .filter(
      (credit) =>
        credit.role === role,
    )
    .map(
      (credit) =>
        credit.contributor?.stageName ||
        credit.contributor?.legalName,
    )
    .filter(Boolean);
}

function joinedCredits(track, role) {
  const values =
    contributorNames(
      track,
      role,
    );

  return values.length
    ? values.join(", ")
    : null;
}

function releaseTypeLabel(type) {
  const value =
    String(type || "")
      .trim()
      .toUpperCase();

  if (value === "SINGLE") {
    return "Single";
  }

  if (value === "EP") {
    return "EP";
  }

  if (value === "ALBUM") {
    return "Album";
  }

  return clean(type);
}

function distributionStatusLabel(status) {
  const value =
    String(status || "")
      .trim()
      .toUpperCase();

  const labels = {
    NOT_QUEUED: "Not queued",
    QUEUED: "Queued",
    IN_REVIEW: "In review",
    APPROVED: "Approved",
    SCHEDULED: "Scheduled",
    LIVE: "Live",
    TAKEDOWN_REQUESTED: "Takedown requested",
    TAKEDOWN: "Takedown",
    REJECTED: "Rejected",
  };

  return (
    labels[value] ||
    clean(status)
  );
}

function legacyGenre(value) {
  const genre =
    clean(value);

  if (!genre) {
    return null;
  }

  const aliases = {
    "Hip-Hop/Rap": "Hip-hop",
    "Hip Hop/Rap": "Hip-hop",
    "Hip-Hop": "Hip-hop",
  };

  return (
    aliases[genre] ||
    genre
  );
}

function releaseDateValue(value) {
  if (!value) return null;

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  return date
    .toISOString()
    .slice(0, 10);
}

function previewFileId(track) {
  return (
    (track?.files || []).find(
      (file) =>
        file.kind === "PREVIEW_MP3" &&
        String(
          file.storageKey || "",
        ).startsWith(
          "gid://shopify/",
        ),
    )?.storageKey ||
    null
  );
}

function customerReference(value) {
  const raw =
    clean(value);

  if (!raw) return null;

  if (
    raw.startsWith(
      "gid://shopify/Customer/",
    )
  ) {
    return raw;
  }

  if (/^\d+$/.test(raw)) {
    return `gid://shopify/Customer/${raw}`;
  }

  return null;
}

function releaseProductReference(release) {
  const candidates = [
    release?.shopifyProductId,
    release?.shopifyBundleProductId,
    release?.bundleProductId,
  ];

  return (
    candidates.find(
      (value) =>
        String(
          value || "",
        ).startsWith(
          "gid://shopify/Product/",
        ),
    ) ||
    null
  );
}

export function eastRockCompatibilityEnabled() {
  return (
    deploymentProfileId() ===
    EAST_ROCK_PROFILE
  );
}

export function buildEastRockTrackProductMetafields({
  release,
  track,
}) {
  if (
    !eastRockCompatibilityEnabled()
  ) {
    return [];
  }

  const primary =
    names(
      track?.artists,
      "PRIMARY",
    );

  const featured =
    names(
      track?.artists,
      "FEATURED",
    );

  const associatedAlbum =
    String(
      release?.type || "",
    ).toUpperCase() ===
      "SINGLE"
      ? null
      : releaseProductReference(
          release,
        );

  return [
    listMetafield(
      "download_format",
      [
        "FLAC",
        "MP3",
      ],
    ),
    metafield(
      "music_genre",
      "single_line_text_field",
      legacyGenre(
        release?.primaryGenre,
      ),
    ),
    metafield(
      "associated_album",
      "product_reference",
      associatedAlbum,
    ),
    metafield(
      "audio_preview",
      "file_reference",
      previewFileId(
        track,
      ),
    ),
    metafield(
      "cover_art_designer",
      "single_line_text_field",
      joinedCredits(
        track,
        "COVER_ART_DESIGNER",
      ),
    ),
    metafield(
      "distribution_status",
      "single_line_text_field",
      distributionStatusLabel(
        release?.distributionStatus,
      ),
    ),
    listMetafield(
      "artist_featured",
      featured,
    ),
    metafield(
      "mastering_engineer",
      "single_line_text_field",
      joinedCredits(
        track,
        "MASTERING_ENGINEER",
      ),
    ),
    metafield(
      "mixing_engineer",
      "single_line_text_field",
      joinedCredits(
        track,
        "MIXING_ENGINEER",
      ),
    ),
    metafield(
      "parental_advisory",
      "single_line_text_field",
      track?.explicit
        ? "Explicit"
        : "Clean",
    ),
    metafield(
      "recording_engineer",
      "single_line_text_field",
      joinedCredits(
        track,
        "RECORDING_ENGINEER",
      ),
    ),
    listMetafield(
      "artist_primary",
      primary.length
        ? primary
        : [
            release?.artistName,
          ],
    ),
    metafield(
      "release_date",
      "date",
      releaseDateValue(
        release?.releaseDate,
      ),
    metafield(
      "pre_order_date",
      "date",
      release?.preOrderDate
        ? releaseDateValue(release.preOrderDate)
        : null,
    ),
    ),
    metafield(
      "release_type",
      "single_line_text_field",
      releaseTypeLabel(
        release?.type,
      ),
    ),
    metafield(
      "release_upc",
      "single_line_text_field",
      release?.upc,
    ),
    metafield(
      "single_isrc",
      "single_line_text_field",
      String(
        release?.type || "",
      ).toUpperCase() ===
        "SINGLE"
        ? track?.isrc
        : null,
    ),
    metafield(
      "song_producer",
      "single_line_text_field",
      joinedCredits(
        track,
        "PRODUCER",
      ),
    ),
    metafield(
      "streaming_url",
      "url",
      release?.streamingUrl,
    ),
    metafield(
      "submitted_by",
      "customer_reference",
      customerReference(
        release?.ownerCustomerId,
      ),
    ),
    metafield(
      "track_album_order_number",
      "number_integer",
      String(
        release?.type || "",
      ).toUpperCase() ===
        "SINGLE"
        ? null
        : track?.position,
    ),
  ].filter(Boolean);
}

export function eastRockCompatibilityMap() {
  return {
    "custom.download_format":
      "ReleaseCore customer download formats",
    "custom.music_genre":
      "release.primaryGenre",
    "custom.associated_album":
      "Release-level Shopify Album/EP product reference when available",
    "custom.audio_preview":
      "track PREVIEW_MP3 Shopify file reference",
    "custom.cover_art_designer":
      "COVER_ART_DESIGNER credits",
    "custom.distribution_status":
      "release.distributionStatus",
    "custom.artist_featured":
      "track FEATURED artists",
    "custom.mastering_engineer":
      "MASTERING_ENGINEER credits",
    "custom.mixing_engineer":
      "MIXING_ENGINEER credits",
    "custom.parental_advisory":
      "track.explicit",
    "custom.recording_engineer":
      "RECORDING_ENGINEER credits",
    "custom.artist_primary":
      "track PRIMARY artists",
    "custom.release_date":
      "release.releaseDate",
    "custom.pre_order_date": "release.preOrderDate",
    "custom.release_type":
      "release.type",
    "custom.release_upc":
      "release.upc",
    "custom.single_isrc":
      "single track ISRC",
    "custom.song_producer":
      "PRODUCER credits",
    "custom.streaming_url":
      "release.streamingUrl",
    "custom.submitted_by":
      "release.ownerCustomerId",
    "custom.track_album_order_number":
      "track.position for Album/EP",
  };
}
