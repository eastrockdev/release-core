import { CORE_CREDIT_ROLES } from "./credit-types";
export { configuredCreditRoles, isConfiguredCreditRole, normalizeCreditRole, parseAdditionalCreditRoles } from "./credit-types";

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

const LANGUAGE_CODE_ALIASES = Object.freeze({
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  ar: "Arabic",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  hi: "Hindi",
  bn: "Bengali",
  pa: "Punjabi",
  ur: "Urdu",
  ru: "Russian",
  pl: "Polish",
  tr: "Turkish",
  el: "Greek",
  he: "Hebrew",
  iw: "Hebrew",
  sv: "Swedish",
  no: "Norwegian",
  da: "Danish",
  fi: "Finnish",
  is: "Icelandic",
  cs: "Czech",
  sk: "Slovak",
  hu: "Hungarian",
  ro: "Romanian",
  uk: "Ukrainian",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  in: "Indonesian",
  ms: "Malay",
  sw: "Swahili",
  zxx: "Instrumental / No linguistic content",
  instrumental: "Instrumental / No linguistic content",
  "no linguistic content": "Instrumental / No linguistic content",
  "instrumental / no linguistic content": "Instrumental / No linguistic content",
});

export function normalizeLanguage(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const canonical = LANGUAGES.find(
    (language) => language.localeCompare(raw, undefined, { sensitivity: "base" }) === 0,
  );
  if (canonical) return canonical;

  const key = raw.toLowerCase().replace(/_/g, "-");
  if (LANGUAGE_CODE_ALIASES[key]) return LANGUAGE_CODE_ALIASES[key];

  const baseCode = key.split("-")[0];
  return LANGUAGE_CODE_ALIASES[baseCode] || null;
}

export const ARTIST_ROLES = ["PRIMARY", "FEATURED"];
export const CREDIT_ROLES = CORE_CREDIT_ROLES;

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
