import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const file = path.join(
  process.cwd(),
  "shopify.app.east-rock.toml",
);

function fail(message) {
  console.error(
    `ReleaseCore East Rock app proxy validation failed: ${message}`,
  );
  process.exit(1);
}

if (!fs.existsSync(file)) {
  fail("shopify.app.east-rock.toml is missing.");
}

const source = fs.readFileSync(file, "utf8");

for (const expected of [
  "[app_proxy]",
  'url = "/releasecore-proxy"',
  'prefix = "apps"',
  'subpath = "releasecore"',
  "write_app_proxy",
]) {
  if (!source.includes(expected)) {
    fail(`Missing ${expected}.`);
  }
}

console.log(
  "ReleaseCore East Rock app proxy validation passed.",
);
