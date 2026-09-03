import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function requireText(path, text, message) {
  const source = read(path);
  if (!source.includes(text)) {
    throw new Error(`${message}\nMissing: ${text}\nFile: ${path}`);
  }
}

requireText(
  "app/lib/release-timeline.server.js",
  '"SOCIAL_ONLY"',
  "Release availability must include the Social Media Only option.",
);
requireText(
  "app/lib/release-timeline.server.js",
  'availability === "CURRENT_ONLY"',
  "Legacy CURRENT_ONLY values must normalize safely.",
);
requireText(
  "app/routes/app.release.$releaseId.jsx",
  "const [preOrderEnabled, setPreOrderEnabled]",
  "Admin pre-order children must be controlled by the parent toggle.",
);
requireText(
  "app/routes/app.release.$releaseId.jsx",
  '{preOrderEnabled ? (',
  "Admin pre-order children must be conditionally rendered.",
);
requireText(
  "extensions/releasecore-artist-portal/assets/releasecore-portal.js",
  'data-timeline-parent="preOrderEnabled"',
  "Artist Portal pre-order child controls must be dependent on the parent toggle.",
);
requireText(
  "extensions/releasecore-artist-portal/assets/releasecore-portal.js",
  'data-form="artist-setup"',
  "Artist Portal must prompt customers without artist access to create an artist.",
);
requireText(
  "app/routes/app.import.jsx",
  "const importedProductFilter",
  "Importer must construct a resource-picker exclusion filter.",
);
requireText(
  "app/routes/app.import.jsx",
  "query: importedProductFilter",
  "Importer must apply the exclusion filter to the Shopify resource picker.",
);
requireText(
  "app/lib/portal-access-rules.server.js",
  "RLIAB_MULTI_ARTIST",
  "East Rock multi-artist access must be tag-controlled.",
);
requireText(
  "app/routes/app.portal-access.jsx",
  "customerIsPortalMember",
  "Portal Access must list portal members instead of requiring a search first.",
);
requireText(
  "app/routes/app.portal-access.jsx",
  'form.set("intent", "save-artist-access")',
  "Portal Access must persist explicit customer-to-artist assignments.",
);
requireText(
  "app/routes/api.portal-access.jsx",
  'intent === "save-artist-access"',
  "Portal Access API must persist customer-to-artist assignments.",
);
requireText(
  "app/lib/automations.server.js",
  "artistAccessRows",
  "Storefront access must load persisted artist assignments.",
);
requireText(
  "app/lib/portal.server.js",
  "createPortalArtistProfile",
  "Storefront must support first-time artist profile creation.",
);
requireText(
  "app/lib/portal.server.js",
  "ownerCustomerId: customerId",
  "Signed-in storefront release creation must retain automatic customer ownership.",
);
requireText(
  "app/routes/releasecore-proxy.$.jsx",
  'intent === "create-artist"',
  "The app proxy must expose first-time artist creation.",
);

console.log("ReleaseCore M14.4.2 portal/timeline validation passed.");
