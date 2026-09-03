import fs from "node:fs";

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, "utf8");
}

const compatibility = read("app/lib/east-rock-compatibility.server.js");
const isrc = read("app/lib/isrc.server.js");

const failures = [];
const need = (source, marker, message) => {
  if (!source.includes(marker)) failures.push(message);
};

for (const choice of [
  "Pending Review",
  "In-Review",
  "Submitted",
  "Rejected",
  "Approved",
  "Live",
  "Takedown",
  "Copyright",
]) {
  need(
    compatibility,
    `"${choice}"`,
    `East Rock distribution status choice is missing: ${choice}`,
  );
}

need(
  compatibility,
  "export function eastRockDistributionStatusValue",
  "East Rock status mapper is missing.",
);
need(
  compatibility,
  'distributionStatus === "DELIVERED"',
  "Delivered releases are not explicitly mapped.",
);
need(
  compatibility,
  'return "Live";',
  "Delivered releases do not map to Live.",
);
need(
  compatibility,
  'releaseStatus === "APPROVED"',
  "Approved release mapping is missing.",
);
need(
  compatibility,
  'return "Approved";',
  "Approved releases do not map to Approved.",
);
need(
  compatibility,
  "eastRockDistributionStatusValue(\n        release,",
  "Track product compatibility metafields do not use the new mapper.",
);

if (
  compatibility.includes('NOT_QUEUED: "Not queued"') ||
  compatibility.includes('QUEUED: "Queued"') ||
  compatibility.includes('SCHEDULED: "Scheduled"')
) {
  failures.push(
    "Legacy East Rock distribution compatibility still emits values outside the configured Shopify choices.",
  );
}

need(
  isrc,
  'import { publicError } from "./http-security.server";',
  "ISRC business-rule failures are not exposed safely.",
);
need(
  isrc,
  "function validateAdminIsrc",
  "Admin ISRC validation wrapper is missing.",
);
need(
  isrc,
  'code: "INVALID_ISRC"',
  "Invalid ISRCs do not return a public validation code.",
);
need(
  isrc,
  "function duplicateIsrcError",
  "Duplicate ISRC helper is missing.",
);
need(
  isrc,
  'code: "ISRC_ALREADY_ASSIGNED"',
  "Duplicate ISRCs do not return a public conflict code.",
);
need(
  isrc,
  "use Add existing song to move that imported Single into the EP/Album",
  "Duplicate ISRC guidance does not point admins to the catalog-safe existing-song workflow.",
);
need(
  isrc,
  "include: { release: true }",
  "Duplicate ISRC conflict lookup does not resolve same-store release context.",
);

if (failures.length) {
  console.error("ReleaseCore M14.4.7 validation failed:");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log("ReleaseCore M14.4.7 East Rock sync/ISRC validation passed.");
