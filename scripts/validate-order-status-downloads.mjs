import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
let failed = false;

const read = (relative) =>
  fs.readFileSync(path.join(root, relative), "utf8");

const exists = (relative) =>
  fs.existsSync(path.join(root, relative));

const fail = (message) => {
  failed = true;
  console.error(
    `ReleaseCore order-status delivery validation failed: ${message}`,
  );
};

const libraryConfig =
  "extensions/releasecore-purchased-music/shopify.extension.toml";
const librarySource =
  "extensions/releasecore-purchased-music/src/MusicDownloads.jsx";

const orderConfig =
  "extensions/releasecore-order-status/shopify.extension.toml";
const orderSource =
  "extensions/releasecore-order-status/src/OrderDownloads.jsx";

for (const relative of [
  "app/lib/commerce-library.server.js",
  "app/routes/customer-account.order-downloads.jsx",
  libraryConfig,
  librarySource,
  orderConfig,
  orderSource,
]) {
  if (!exists(relative)) {
    fail(`${relative} is missing.`);
  }
}

if (exists("app/lib/commerce-library.server.js")) {
  const source = read(
    "app/lib/commerce-library.server.js",
  );

  for (const marker of [
    "orderStatusHasReleaseCoreProducts",
    "buildCustomerOrderDownloads",
    "shopifyOrderGid",
    "commerceOrderId: order.id",
    "customerId: normalizedCustomer",
    "directDownloadPath",
    "status: ACTIVE",
  ]) {
    if (!source.includes(marker)) {
      fail(
        `purchased-music service is missing ${marker}.`,
      );
    }
  }

  if (source.includes('kind: "MASTER_WAV"')) {
    fail(
      "order-status delivery must not directly expose MASTER_WAV.",
    );
  }
}

if (
  exists(
    "app/routes/customer-account.order-downloads.jsx",
  )
) {
  const source = read(
    "app/routes/customer-account.order-downloads.jsx",
  );

  for (const marker of [
    "authenticate.public.customerAccount",
    "cors(Response.json(",
    'intent === "probe"',
    'intent === "library"',
    "sessionToken?.dest",
    "sessionToken?.sub",
    "orderStatusHasReleaseCoreProducts",
    "buildCustomerOrderDownloads",
    "requiresLogin: true",
  ]) {
    if (!source.includes(marker)) {
      fail(
        `order-status backend route is missing ${marker}.`,
      );
    }
  }

  if (/return\s+cors\s*\(\s*\{/.test(source)) {
    fail(
      "order-status route passes a plain object to Shopify cors().",
    );
  }
}

if (exists(libraryConfig)) {
  const source = read(libraryConfig);

  if (
    !source.includes(
      'handle = "releasecore-purchased-music"',
    )
  ) {
    fail(
      "Purchased Music extension handle is incorrect.",
    );
  }

  if (
    !source.includes(
      'target = "customer-account.page.render"',
    )
  ) {
    fail(
      "Purchased Music extension lost customer-account.page.render.",
    );
  }

  if (
    source.includes(
      'target = "customer-account.order-status.block.render"',
    )
  ) {
    fail(
      "Purchased Music full-page extension still contains the Order Status target.",
    );
  }

  if (
    !source.includes(
      'module = "./src/MusicDownloads.jsx"',
    )
  ) {
    fail(
      "Purchased Music full-page module is incorrect.",
    );
  }

  if (!source.includes("network_access = true")) {
    fail(
      "Purchased Music extension lost network access.",
    );
  }
}

if (exists(orderConfig)) {
  const source = read(orderConfig);

  for (const marker of [
    'handle = "releasecore-order-status"',
    'target = "customer-account.order-status.block.render"',
    'module = "./src/OrderDownloads.jsx"',
    "network_access = true",
    'key = "api_base_url"',
  ]) {
    if (!source.includes(marker)) {
      fail(
        `Order Status extension config is missing ${marker}.`,
      );
    }
  }

  if (
    source.includes(
      'target = "customer-account.page.render"',
    )
  ) {
    fail(
      "Order Status extension must not contain a full-page target.",
    );
  }

  const uid =
    source.match(
      /^\s*uid\s*=\s*"([^"]+)"/m,
    )?.[1];

  if (!uid) {
    fail(
      "Order Status extension does not contain a Shopify-generated UID.",
    );
  }
}

if (exists(orderSource)) {
  const source = read(orderSource);

  for (const marker of [
    "shopify.order.value",
    "shopify.lines.value",
    "shopify.authenticationState.value",
    "shopify.requireLogin()",
    "shopify.sessionToken.get()",
    "/customer-account/order-downloads",
    "lineComponents",
    "merchandise?.product?.id",
    "format.downloadPath",
    'target="_blank"',
  ]) {
    if (!source.includes(marker)) {
      fail(
        `Order Status extension is missing ${marker}.`,
      );
    }
  }

  if (
    !/intent:\s*['"]probe['"]/.test(source)
  ) {
    fail(
      "Order Status extension is missing probe intent.",
    );
  }

  if (
    !/intent:\s*['"]library['"]/.test(source)
  ) {
    fail(
      "Order Status extension is missing library intent.",
    );
  }
}

if (
  exists(
    "extensions/releasecore-purchased-music/src/OrderDownloads.jsx",
  )
) {
  fail(
    "OrderDownloads.jsx should not remain inside the full-page Purchased Music extension.",
  );
}

if (exists("package.json")) {
  const pkg = JSON.parse(
    read("package.json"),
  );

  if (
    pkg.scripts?.["check:order-status-downloads"] !==
    "node scripts/validate-order-status-downloads.mjs"
  ) {
    fail(
      "package.json is missing check:order-status-downloads.",
    );
  }

  if (
    !String(pkg.scripts?.check || "").includes(
      "npm run check:order-status-downloads",
    )
  ) {
    fail(
      "npm run check does not include check:order-status-downloads.",
    );
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  "ReleaseCore order-status delivery validation passed.",
);
