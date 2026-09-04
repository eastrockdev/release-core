export const CATALOG_RELATIONSHIP_TYPES = Object.freeze([
  {
    value: "EDITION_OF",
    label: "Edition of",
    shortLabel: "Edition",
    summary:
      "A general alternate edition of the source release.",
    identifierGuidance:
      "Classify each track individually. Edition type alone never determines whether a recording keeps or receives a different identifier.",
  },
  {
    value: "DELUXE_OF",
    label: "Deluxe edition of",
    shortLabel: "Deluxe",
    summary:
      "A deluxe version that expands or revises the source release.",
    identifierGuidance:
      "Unchanged recordings can be marked Same recording; bonus, alternate, remixed, edited, or replaced audio should be reviewed independently.",
  },
  {
    value: "EXPANDED_OF",
    label: "Expanded edition of",
    shortLabel: "Expanded",
    summary:
      "An expanded edition with additional catalog material.",
    identifierGuidance:
      "Map unchanged recordings explicitly and classify newly added or materially changed audio as New recording.",
  },
  {
    value: "REMASTER_OF",
    label: "Remaster of",
    shortLabel: "Remaster",
    summary:
      "A remastered presentation derived from the source release.",
    identifierGuidance:
      "Do not infer identifier reuse from the word remaster. Confirm the recording lineage and delivery requirements track by track.",
  },
  {
    value: "CLEAN_VERSION_OF",
    label: "Clean version of",
    shortLabel: "Clean version",
    summary:
      "A clean or edited version of the source release.",
    identifierGuidance:
      "Clean edits commonly represent altered audio. Mark each track based on the actual recording rather than copying source identifiers automatically.",
  },
  {
    value: "EXPLICIT_VERSION_OF",
    label: "Explicit version of",
    shortLabel: "Explicit version",
    summary:
      "An explicit counterpart of another release edition.",
    identifierGuidance:
      "Explicit and clean counterparts may differ at the recording level. Review each mapped track before deciding identifier treatment.",
  },
  {
    value: "INSTRUMENTAL_OF",
    label: "Instrumental version of",
    shortLabel: "Instrumental",
    summary:
      "An instrumental counterpart derived from the source catalog.",
    identifierGuidance:
      "Instrumental audio should not be assumed to be the same recording as the vocal version. Classify the actual recording relationship explicitly.",
  },
  {
    value: "REISSUE_OF",
    label: "Reissue of",
    shortLabel: "Reissue",
    summary:
      "A later reissue of an existing catalog release.",
    identifierGuidance:
      "A reissue can contain unchanged recordings or changed assets. Use track lineage to distinguish them instead of treating the whole release uniformly.",
  },
  {
    value: "ANNIVERSARY_OF",
    label: "Anniversary edition of",
    shortLabel: "Anniversary",
    summary:
      "An anniversary edition derived from an earlier release.",
    identifierGuidance:
      "Anniversary editions often mix unchanged catalog recordings with new or alternate material. Classify each track separately.",
  },
  {
    value: "REMIX_OF",
    label: "Remix edition of",
    shortLabel: "Remix",
    summary:
      "A release whose audio is primarily remixed from the source catalog.",
    identifierGuidance:
      "Remixed audio should be reviewed as a distinct recording unless the distributor has explicitly confirmed otherwise.",
  },
]);

export const RECORDING_RELATIONSHIP_TYPES = Object.freeze([
  {
    value: "UNKNOWN",
    label: "Not classified",
    summary:
      "The track is mapped to a source track, but recording identity has not been decided.",
  },
  {
    value: "SAME_RECORDING",
    label: "Same recording",
    summary:
      "The current track represents the same underlying recording as the mapped source track.",
  },
  {
    value: "NEW_RECORDING",
    label: "New / changed recording",
    summary:
      "The current track represents different or materially changed audio and should be treated independently.",
  },
]);

export function catalogRelationshipDefinition(value) {
  return (
    CATALOG_RELATIONSHIP_TYPES.find(
      (item) => item.value === String(value || ""),
    ) || CATALOG_RELATIONSHIP_TYPES[0]
  );
}

export function isCatalogRelationshipType(value) {
  return CATALOG_RELATIONSHIP_TYPES.some(
    (item) => item.value === String(value || ""),
  );
}

export function recordingRelationshipDefinition(value) {
  return (
    RECORDING_RELATIONSHIP_TYPES.find(
      (item) => item.value === String(value || ""),
    ) || RECORDING_RELATIONSHIP_TYPES[0]
  );
}

export function isRecordingRelationshipType(value) {
  return RECORDING_RELATIONSHIP_TYPES.some(
    (item) => item.value === String(value || ""),
  );
}

export function recordingLineageStatus({
  recordingRelationship,
  currentIsrc,
  sourceIsrc,
}) {
  const kind = String(recordingRelationship || "UNKNOWN");
  const current = String(currentIsrc || "").trim();
  const source = String(sourceIsrc || "").trim();

  if (kind === "UNKNOWN") {
    return {
      tone: "neutral",
      label: "Needs classification",
      message:
        "Choose Same recording or New / changed recording before using this lineage for identifier decisions.",
    };
  }

  if (kind === "SAME_RECORDING") {
    if (source && current && source === current) {
      return {
        tone: "good",
        label: "Identifiers aligned",
        message:
          "Both track appearances currently show the same ISRC. ReleaseCore records the lineage but does not alter identifiers automatically.",
      };
    }

    if (source && current && source !== current) {
      return {
        tone: "warning",
        label: "ISRC review",
        message:
          "This is marked as the same recording, but the track appearances currently have different ISRCs. Review the identifier assignment before delivery.",
      };
    }

    if (source && !current) {
      return {
        tone: "info",
        label: "Source ISRC available",
        message:
          `The source track has ISRC ${source}. ReleaseCore will not copy it automatically; confirm the recording and distributor requirements first.`,
      };
    }

    if (!source && current) {
      return {
        tone: "info",
        label: "Source identifier missing",
        message:
          "The current track has an ISRC but the mapped source track does not. Confirm the source catalog record before relying on this lineage.",
      };
    }

    return {
      tone: "warning",
      label: "Identifiers missing",
      message:
        "Both appearances are marked as the same recording, but neither currently has an ISRC.",
    };
  }

  if (current) {
    return {
      tone: "good",
      label: "Independent identifier",
      message:
        "This track is classified as new or changed audio and currently has its own identifier.",
    };
  }

  return {
    tone: "warning",
    label: "Needs identifier",
    message:
      "This track is classified as new or changed audio but does not currently have an ISRC.",
  };
}
