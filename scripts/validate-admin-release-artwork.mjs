import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
let failed = false;

const read = (relative) =>
  fs.readFileSync(
    path.join(root, relative),
    "utf8",
  );

const exists = (relative) =>
  fs.existsSync(
    path.join(root, relative),
  );

const fail = (message) => {
  failed = true;
  console.error(
    `ReleaseCore admin artwork validation failed: ${message}`,
  );
};

for (const relative of [
  "app/lib/release-artwork.server.js",
  "app/routes/app.release.$releaseId.jsx",
]) {
  if (!exists(relative)) {
    fail(`${relative} is missing.`);
  }
}

if (exists("app/lib/release-artwork.server.js")) {
  const source = read(
    "app/lib/release-artwork.server.js",
  );

  for (const marker of [
    "hydrateReleaseCoverUrl",
    "... on MediaImage",
    "fileStatus",
    "image {",
    "db.releaseFile",
    "cover.url = url",
  ]) {
    if (!source.includes(marker)) {
      fail(
        `artwork resolver is missing ${marker}.`,
      );
    }
  }
}

if (exists("app/routes/app.release.$releaseId.jsx")) {
  const source = read(
    "app/routes/app.release.$releaseId.jsx",
  );

  for (const marker of [
    "hydrateReleaseCoverUrl",
    "await hydrateReleaseCoverUrl",
  ]) {
    if (!source.includes(marker)) {
      fail(
        `Release route is missing ${marker}.`,
      );
    }
  }

  if (
    !/const\s*\{\s*session\s*,\s*admin\s*\}\s*=\s*await\s+authenticate\.admin\(request\)/m.test(
      source,
    )
  ) {
    fail(
      "Release route does not retain the Shopify Admin API client.",
    );
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  "ReleaseCore admin artwork validation passed.",
);
