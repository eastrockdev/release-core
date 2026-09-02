export const FILE_KINDS = {
  COVER_ART: "COVER_ART",
  MASTER_WAV: "MASTER_WAV",
  PREVIEW_MP3: "PREVIEW_MP3",
  SPLIT_SHEET: "SPLIT_SHEET",
  SUPPORTING_DOCUMENT: "SUPPORTING_DOCUMENT",
};

function uploadValidationError(message) {
  const error = new Error(message);
  error.name = "ReleaseCoreUploadValidationError";
  error.status = 400;
  error.expose = true;
  return error;
}

export const FILE_LIMITS = {
  COVER_ART: 20 * 1024 * 1024,
  MASTER_WAV: 500 * 1024 * 1024,
  PREVIEW_MP3: 20 * 1024 * 1024,
  SPLIT_SHEET: 20 * 1024 * 1024,
  SUPPORTING_DOCUMENT: 20 * 1024 * 1024,
};

export function fileKindLabel(kind) {
  switch (kind) {
    case FILE_KINDS.COVER_ART: return "Cover artwork";
    case FILE_KINDS.MASTER_WAV: return "Master WAV";
    case FILE_KINDS.PREVIEW_MP3: return "MP3 preview";
    case FILE_KINDS.SPLIT_SHEET: return "Split sheet";
    case FILE_KINDS.SUPPORTING_DOCUMENT: return "Supporting document";
    default: return "File";
  }
}

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** index;
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

export function isReplaceableKind(kind) {
  return kind === FILE_KINDS.COVER_ART || kind === FILE_KINDS.MASTER_WAV || kind === FILE_KINDS.PREVIEW_MP3 || kind === FILE_KINDS.SPLIT_SHEET;
}

export function stagedResourceForKind(kind) {
  return kind === FILE_KINDS.COVER_ART ? "IMAGE" : "FILE";
}

export function fileContentTypeForKind(kind) {
  return kind === FILE_KINDS.COVER_ART ? "IMAGE" : "FILE";
}

export function validateUploadDescriptor({ kind, filename, mimeType, sizeBytes, trackId }) {
  const name = String(filename || "").trim();
  let mime = String(mimeType || "").toLowerCase();
  const size = Number(sizeBytes || 0);
  if (!Object.values(FILE_KINDS).includes(kind)) throw uploadValidationError("Unknown file type.");
  if (!name) throw uploadValidationError("A filename is required.");
  if (!Number.isFinite(size) || size <= 0) throw uploadValidationError("The selected file is empty or its size could not be read.");
  if (size > FILE_LIMITS[kind]) throw uploadValidationError(`${fileKindLabel(kind)} exceeds the ${formatBytes(FILE_LIMITS[kind])} upload limit.`);

  const lower = name.toLowerCase();
  if (!mime) {
    if (lower.endsWith(".png")) mime = "image/png";
    else if (/\.jpe?g$/.test(lower)) mime = "image/jpeg";
    else if (lower.endsWith(".pdf")) mime = "application/pdf";
    else if (lower.endsWith(".wav")) mime = "audio/wav";
    else if (lower.endsWith(".mp3")) mime = "audio/mpeg";
  }
  if (kind === FILE_KINDS.COVER_ART) {
    if (!/\.(jpe?g|png)$/.test(lower) || (mime && !["image/jpeg", "image/png"].includes(mime))) {
      throw uploadValidationError("Cover artwork must be a JPG or PNG image.");
    }
  }
  if (kind === FILE_KINDS.MASTER_WAV) {
    if (!trackId) throw uploadValidationError("A master WAV must belong to a track.");
    if (!lower.endsWith(".wav")) throw uploadValidationError("Track masters must be WAV files.");
  }
  if (kind === FILE_KINDS.PREVIEW_MP3) {
    if (!trackId) throw uploadValidationError("An MP3 preview must belong to a track.");
    if (!lower.endsWith(".mp3")) throw uploadValidationError("Audio previews must be MP3 files.");
  }
  if (kind === FILE_KINDS.SPLIT_SHEET) {
    if (!lower.endsWith(".pdf") || (mime && mime !== "application/pdf")) throw uploadValidationError("Split sheets must be uploaded as PDF files.");
  }
  if (kind === FILE_KINDS.SUPPORTING_DOCUMENT) {
    if (!/\.(pdf|jpe?g|png)$/.test(lower)) throw uploadValidationError("Supporting documents must be PDF, JPG, or PNG files.");
  }
  return { name, mime: mime || "application/octet-stream", size };
}
