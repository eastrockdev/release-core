import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, "utf8");
}

const portalServer = read("app/lib/portal.server.js");
const proxy = read("app/routes/releasecore-proxy.$.jsx");
const portalAccess = read("app/routes/app.portal-access.jsx");
const portalCss = read(
  "extensions/releasecore-artist-portal/assets/releasecore-portal.css",
);
const trackInfo = read(
  "app/routes/app.release_.$releaseId.track.$trackId.jsx",
);
const adminCss = read("app/styles/releasecore-admin.css");
const tenantHardening = read(
  "scripts/validate-tenant-hardening.mjs",
);

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

need(
  portalServer,
  "export function portalReleaseCustomerWhere",
  "Portal release access helper is missing.",
);
need(
  portalServer,
  'role: "PRIMARY"',
  "Automatic release visibility is not restricted to primary artist access.",
);
need(
  portalServer,
  "portalAccess:",
  "Portal release access does not consult PortalArtistAccess.",
);
need(
  portalServer,
  "where: portalReleaseCustomerWhere({ shop, customerId })",
  "Portal release list is still creator-only.",
);
need(
  proxy,
  "getPortalRelease({",
  "Master audio does not reuse artist-aware release authorization.",
);
need(
  portalAccess,
  "customersByArtist",
  "Admin Portal Access does not calculate automatic artist-based release visibility.",
);
need(
  portalAccess,
  "visible release",
  "Portal member cards do not describe dynamically visible releases.",
);
need(
  portalCss,
  "[data-timeline-parent][hidden]",
  "Storefront timeline child fields are not force-hidden when disabled.",
);
need(
  portalCss,
  "display: none !important",
  "Storefront timeline hide rule can still be overridden by the theme.",
);

// M15.3.1 moved per-track credits out of the Release workspace and into
// Edit Track Info. Validate the roles-only layout where it now actually lives.
need(
  trackInfo,
  `className={\`rc-track-info-credit\${`,
  "Edit Track Info credit rows do not expose the mode-aware layout class.",
);
need(
  trackInfo,
  `" rc-track-info-credit--roles-only"`,
  "Existing Admin credit rows do not collapse when splits are off.",
);
need(
  trackInfo,
  `className={\`rc-track-info-add-credit\${`,
  "Edit Track Info Add Credit row does not expose the mode-aware layout class.",
);
need(
  trackInfo,
  `" rc-track-info-add-credit--roles-only"`,
  "Admin Add Credit row does not collapse when splits are off.",
);

need(
  adminCss,
  ".rc-track-info-credit--roles-only",
  "Credits-only existing-credit layout CSS is missing.",
);
need(
  adminCss,
  "grid-template-columns: minmax(190px, 1fr) minmax(160px, 220px) auto;",
  "Credits-only existing-credit layout does not use three columns.",
);
need(
  adminCss,
  ".rc-track-info-add-credit--roles-only",
  "Credits-only Add Credit layout CSS is missing.",
);
need(
  adminCss,
  "grid-template-columns: minmax(220px, 1fr) minmax(160px, 220px) auto;",
  "Credits-only Add Credit layout does not use three columns.",
);

if (
  tenantHardening.includes(
    "where: { id: releaseId, shop, ownerCustomerId: customerId }",
  ) ||
  tenantHardening.includes(
    "where: { shop, ownerCustomerId: customerId }",
  )
) {
  failures.push(
    "Tenant hardening validator still requires owner-only portal query markers.",
  );
}
need(
  tenantHardening,
  "portalReleaseCustomerWhere",
  "Tenant hardening validator does not verify artist-aware portal authorization.",
);

if (failures.length) {
  console.error(
    "ReleaseCore M14.4.5 validation failed:",
  );
  failures.forEach((failure) =>
    console.error(` - ${failure}`),
  );
  process.exit(1);
}

console.log(
  "ReleaseCore M14.4.5 artist/release access validation passed.",
);
