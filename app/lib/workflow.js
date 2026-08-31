import { FILE_KINDS } from "./releasecore-files";
import { isPublishingRole, trackNeedsTitle } from "./releasecore";

export const RELEASE_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
];

export const DISTRIBUTION_STATUSES = [
  "NOT_QUEUED",
  "QUEUED",
  "PROCESSING",
  "SUBMITTED_TO_STORES",
  "RETURNED_FOR_CORRECTIONS",
  "DELIVERED",
];

export const WORKFLOW_INTENTS = new Set([
  "submit-release",
  "start-review",
  "request-changes",
  "resolve-review-item",
  "approve-release",
  "reject-release",
  "reopen-draft",
]);

export function statusLabel(status) {
  const labels = {
    DRAFT: "Draft",
    SUBMITTED: "Submitted",
    IN_REVIEW: "In review",
    CHANGES_REQUESTED: "Changes requested",
    APPROVED: "Approved",
    REJECTED: "Rejected",
  };
  return labels[status] || String(status || "Unknown").replaceAll("_", " ");
}

export function distributionStatusLabel(status) {
  const labels = {
    NOT_QUEUED: "Not queued",
    QUEUED: "Ready for distribution",
    PROCESSING: "Processing",
    SUBMITTED_TO_STORES: "Submitted to stores",
    RETURNED_FOR_CORRECTIONS: "Returned for corrections",
    DELIVERED: "Distribution complete",
  };
  return labels[status] || String(status || "Unknown").replaceAll("_", " ");
}

export function statusTone(status) {
  if (status === "APPROVED") return "good";
  if (status === "REJECTED") return "bad";
  if (status === "CHANGES_REQUESTED") return "warn";
  if (status === "SUBMITTED" || status === "IN_REVIEW") return "info";
  return "neutral";
}

export function distributionStatusTone(status) {
  if (status === "DELIVERED") return "good";
  if (status === "RETURNED_FOR_CORRECTIONS") return "warn";
  if (status === "PROCESSING" || status === "SUBMITTED_TO_STORES") return "info";
  return "neutral";
}

export function releaseIsEditable(status) {
  return status === "DRAFT" || status === "CHANGES_REQUESTED";
}

export function releaseCanSubmit(status) {
  return status === "DRAFT" || status === "CHANGES_REQUESTED";
}

export function releaseCanReview(status) {
  return status === "SUBMITTED" || status === "IN_REVIEW";
}

export function publishingTotal(track) {
  return (track?.credits || [])
    .filter((credit) => isPublishingRole(credit.role))
    .reduce((sum, credit) => sum + (credit.ownershipPercent || 0), 0);
}

export function requirementFlags(settings = {}) {
  return {
    requireLyrics: settings?.requireLyrics ?? true,
    requirePublishing: settings?.requirePublishing ?? true,
    requireSplitSheet: settings?.requireSplitSheet ?? false,
    requireCredits: settings?.requireCredits ?? false,
    requireIsrc: settings?.requireIsrc ?? true,
    requireTrackLanguage: settings?.requireTrackLanguage ?? true,
  };
}

export function calculateReleaseReadiness(release, settings = {}) {
  const blockers = [];
  const requirements = requirementFlags(settings);
  const tracks = release?.tracks || [];
  const releaseFiles = release?.files || [];
  const releaseArtists = release?.artists || [];

  const releaseTitleReady = Boolean(release?.title?.trim()) && !/^untitled (release|single|ep|album)$/i.test(release.title.trim());
  if (!releaseTitleReady) blockers.push({ code: "RELEASE_TITLE", message: "Give the release a final title." });
  if (!release?.primaryGenre) blockers.push({ code: "GENRE", message: "Choose a primary genre." });
  if (!release?.releaseDate) blockers.push({ code: "RELEASE_DATE", message: "Set the release date." });
  if (!releaseArtists.some((assignment) => assignment.role === "PRIMARY")) blockers.push({ code: "RELEASE_ARTIST", message: "Assign at least one primary release artist." });
  if (!releaseFiles.some((file) => file.kind === FILE_KINDS.COVER_ART)) blockers.push({ code: "COVER_ART", message: "Upload release cover artwork." });
  if (requirements.requireSplitSheet && !releaseFiles.some((file) => file.kind === FILE_KINDS.SPLIT_SHEET)) blockers.push({ code: "SPLIT_SHEET", message: "Upload the required split sheet." });
  if (!tracks.length) blockers.push({ code: "TRACKS", message: "Add at least one track." });

  let titledTracks = 0;
  let languageReady = 0;
  let isrcReady = 0;
  let masterReady = 0;
  let lyricsReady = 0;
  let artistReady = 0;
  let publishingReady = 0;
  let creditsReady = 0;

  tracks.forEach((track) => {
    const prefix = `Track ${track.position}`;
    if (!trackNeedsTitle(track)) titledTracks += 1;
    else blockers.push({ code: "TRACK_TITLE", trackId: track.id, message: `${prefix} needs a final title.` });

    if (track.language) languageReady += 1;
    else if (requirements.requireTrackLanguage) blockers.push({ code: "TRACK_LANGUAGE", trackId: track.id, message: `${prefix} needs a language.` });

    if (track.isrc) isrcReady += 1;
    else if (requirements.requireIsrc) blockers.push({ code: "ISRC", trackId: track.id, message: `${prefix} needs an assigned ISRC.` });

    if ((track.files || []).some((file) => file.kind === FILE_KINDS.MASTER_WAV)) masterReady += 1;
    else blockers.push({ code: "MASTER", trackId: track.id, message: `${prefix} needs a master WAV.` });

    const instrumental = track.language === "Instrumental / No linguistic content";
    if (instrumental || Boolean(track.lyrics?.trim())) lyricsReady += 1;
    else if (requirements.requireLyrics) blockers.push({ code: "LYRICS", trackId: track.id, message: `${prefix} needs lyrics or must be marked instrumental.` });

    if ((track.artists || []).some((assignment) => assignment.role === "PRIMARY")) artistReady += 1;
    else blockers.push({ code: "TRACK_ARTIST", trackId: track.id, message: `${prefix} needs a primary artist.` });

    if ((track.credits || []).length) creditsReady += 1;
    else if (requirements.requireCredits) blockers.push({ code: "CREDITS", trackId: track.id, message: `${prefix} needs at least one contributor credit.` });

    const split = publishingTotal(track);
    if (Math.abs(split - 100) < 0.00001) publishingReady += 1;
    else if (requirements.requirePublishing) blockers.push({ code: "PUBLISHING", trackId: track.id, message: `${prefix} publishing ownership totals ${split}%; it must equal 100%.` });
  });

  return {
    ready: blockers.length === 0,
    blockers,
    requirements,
    checks: {
      releaseTitleReady,
      genreReady: Boolean(release?.primaryGenre),
      releaseDateReady: Boolean(release?.releaseDate),
      releaseArtistReady: releaseArtists.some((assignment) => assignment.role === "PRIMARY"),
      artworkReady: releaseFiles.some((file) => file.kind === FILE_KINDS.COVER_ART),
      splitSheetReady: releaseFiles.some((file) => file.kind === FILE_KINDS.SPLIT_SHEET),
      titledTracks,
      languageReady,
      isrcReady,
      masterReady,
      lyricsReady,
      artistReady,
      publishingReady,
      creditsReady,
      totalTracks: tracks.length,
    },
  };
}
