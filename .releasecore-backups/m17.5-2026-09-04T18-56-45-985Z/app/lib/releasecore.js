export const RELEASE_TYPES = ["SINGLE", "EP", "ALBUM"];

export const GENRES = [
  "Alternative",
  "Blues",
  "Children's Music",
  "Christian & Gospel",
  "Classical",
  "Comedy",
  "Country",
  "Dance",
  "Electronic",
  "Folk",
  "Hip-Hop/Rap",
  "Holiday",
  "Jazz",
  "Latin",
  "Metal",
  "New Age",
  "Pop",
  "Punk",
  "R&B/Soul",
  "Reggae",
  "Rock",
  "Singer/Songwriter",
  "Soundtrack",
  "Spoken Word",
  "World",
  "Other",
];

export const LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Dutch",
  "Arabic",
  "Chinese",
  "Japanese",
  "Korean",
  "Hindi",
  "Bengali",
  "Punjabi",
  "Urdu",
  "Russian",
  "Polish",
  "Turkish",
  "Greek",
  "Hebrew",
  "Swedish",
  "Norwegian",
  "Danish",
  "Finnish",
  "Icelandic",
  "Czech",
  "Slovak",
  "Hungarian",
  "Romanian",
  "Ukrainian",
  "Vietnamese",
  "Thai",
  "Indonesian",
  "Malay",
  "Swahili",
  "Other",
  "Instrumental / No linguistic content",
];

export const ARTIST_ROLES = ["PRIMARY", "FEATURED"];
export const CREDIT_ROLES = [
  "SONGWRITER",
  "COMPOSER",
  "PRODUCER",
  "RECORDING_ENGINEER",
  "MIXING_ENGINEER",
  "MASTERING_ENGINEER",
  "COVER_ART_PHOTOGRAPHER",
  "COVER_ART_DESIGNER",
  "OTHER",
];

export const PRO_OPTIONS = ["ASCAP", "BMI", "SESAC", "GMR", "SOCAN", "PRS", "APRA AMCOS", "SACEM", "Other"];

export function typeLabel(type) {
  if (type === "EP") return "EP";
  if (type === "ALBUM") return "Album";
  return "Single";
}

export function starterTitle(type) {
  if (type === "EP") return "Untitled EP";
  if (type === "ALBUM") return "Untitled Album";
  return "Untitled Single";
}

export function isValidReleaseType(type) {
  return RELEASE_TYPES.includes(String(type || "").toUpperCase());
}

export function formatDate(value) {
  if (!value) return "Not set";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function dateInputValue(value) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export function trackNeedsTitle(track) {
  return !track?.title || /^untitled track$/i.test(track.title.trim());
}

export function artistRoleLabel(role) {
  return role === "FEATURED" ? "Featured" : "Primary";
}

export function creditRoleLabel(role) {
  return String(role || "")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isPublishingRole(role) {
  return role === "SONGWRITER" || role === "COMPOSER";
}

export function contributorDisplayName(contributor) {
  return contributor?.stageName || contributor?.legalName || "Unnamed contributor";
}
