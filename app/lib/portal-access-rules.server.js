import { deploymentProfileId } from "./deployment-profile.server";

export function portalMultiArtistTag() {
  return deploymentProfileId() === "east-rock"
    ? "RLIAB_MULTI_ARTIST"
    : "RELEASECORE_MULTI_ARTIST";
}

function normalizeTags(tags) {
  return new Set(
    (tags || [])
      .map((tag) => String(tag || "").trim().toUpperCase())
      .filter(Boolean),
  );
}

export function customerCanManageMultipleArtists(tags) {
  return normalizeTags(tags).has(portalMultiArtistTag());
}

export function customerIsPortalMember(tags) {
  if (deploymentProfileId() !== "east-rock") return true;
  return (tags || []).some((tag) =>
    /^RLIAB(?:_|\s|$)/i.test(String(tag || "").trim()),
  );
}
