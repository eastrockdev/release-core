export const AUTOMATION_EVENT_KEYS = [
  "SUBMITTED",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
  "PROCESSING",
  "SUBMITTED_TO_STORES",
  "DELIVERED",
  "SHOPIFY_PRODUCTS_SYNCED",
];
export const AUTOMATION_CHANNELS = { ARTIST_EMAIL:"ARTIST_EMAIL", ADMIN_EMAIL:"ADMIN_EMAIL", SHOPIFY_FLOW:"SHOPIFY_FLOW" };
export function parseEventList(value){return new Set(String(value||"").split(",").map(item=>item.trim().toUpperCase()).filter(Boolean));}
export function normalizeEventKey(type){const key=String(type||"").toUpperCase();if(key==="RESUBMITTED")return"SUBMITTED";if(key==="DISTRIBUTION_CORRECTION_REQUESTED")return"CHANGES_REQUESTED";if(key==="DISTRIBUTION_PROCESSING")return"PROCESSING";if(key==="DISTRIBUTION_SUBMITTED_TO_STORES")return"SUBMITTED_TO_STORES";if(key==="DISTRIBUTION_DELIVERED")return"DELIVERED";return key;}

export function customerNumericId(customerId) {
  const raw = String(customerId || "").trim();
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/Customer\/(\d+)$/);
  return match?.[1] || null;
}
