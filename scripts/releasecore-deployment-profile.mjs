import process from "node:process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  join,
} from "node:path";
import {
  spawnSync,
} from "node:child_process";

const root = process.cwd();

function fail(message) {
  console.error(`\nReleaseCore deployment profile: ${message}\n`);
  process.exit(1);
}

function profileFile(id) {
  return join(
    root,
    "deployments",
    `${id}.profile.json`,
  );
}

function loadProfile(id) {
  const file = profileFile(id);

  if (!existsSync(file)) {
    fail(`Unknown profile "${id}".`);
  }

  const profile = JSON.parse(
    readFileSync(file, "utf8"),
  );

  if (
    profile?.schemaVersion !== 1 ||
    profile?.id !== id
  ) {
    fail(`Profile "${id}" is invalid.`);
  }

  return profile;
}

function configPath(profile) {
  return join(
    root,
    profile.shopifyConfigFile,
  );
}

function extract(source, key) {
  return (
    source.match(
      new RegExp(
        `^${key}\\s*=\\s*"([^"]*)"`,
        "m",
      ),
    )?.[1] || null
  );
}

function setString(source, key, value) {
  const pattern = new RegExp(
    `^${key}\\s*=\\s*"[^"]*"`,
    "m",
  );

  if (pattern.test(source)) {
    return source.replace(
      pattern,
      `${key} = "${value}"`,
    );
  }

  return `${key} = "${value}"\n${source}`;
}

function setBoolean(source, key, value) {
  const pattern = new RegExp(
    `^${key}\\s*=\\s*(true|false)`,
    "m",
  );

  if (!pattern.test(source)) {
    return source;
  }

  return source.replace(
    pattern,
    `${key} = ${value ? "true" : "false"}`,
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(
    command,
    args,
    {
      cwd: root,
      stdio: options.capture
        ? ["inherit", "pipe", "pipe"]
        : "inherit",
      encoding: "utf8",
      env: process.env,
    },
  );

  if (result.error?.code === "ENOENT") {
    fail(
      `${command} was not found. Use the Node environment where Shopify CLI works.`,
    );
  }

  if (result.status !== 0) {
    const detail = options.capture
      ? (
          result.stdout ||
          result.stderr ||
          ""
        ).trim()
      : "";

    fail(
      `${command} ${args.join(" ")} failed.${detail ? `\n\n${detail}` : ""}`,
    );
  }

  return result;
}

function patchLinkedConfig(profile) {
  const file = configPath(profile);

  if (!existsSync(file)) {
    fail(
      `${profile.shopifyConfigFile} does not exist.`,
    );
  }

  let source = readFileSync(
    file,
    "utf8",
  );

  source = setString(
    source,
    "name",
    profile.appName,
  );

  if (
    profile.appHandle &&
    /^handle\s*=/m.test(source)
  ) {
    source = setString(
      source,
      "handle",
      profile.appHandle,
    );
  }

  // Production profile: never let `app dev` rewrite the dedicated app URL.
  source = setBoolean(
    source,
    "automatically_update_urls_on_dev",
    false,
  );

  writeFileSync(
    file,
    source,
    "utf8",
  );

  return source;
}

function configureUrl(profile, appUrl) {
  if (!/^https:\/\//i.test(appUrl)) {
    fail(
      "Production app URL must be HTTPS.",
    );
  }

  if (
    /localhost|127\.0\.0\.1|trycloudflare\.com/i.test(
      appUrl,
    )
  ) {
    fail(
      "Refusing to use a local/tunnel URL as the East Rock production URL.",
    );
  }

  const file = configPath(profile);
  let source = readFileSync(
    file,
    "utf8",
  );

  source = setString(
    source,
    "application_url",
    appUrl.replace(/\/+$/, ""),
  );

  const authStart = source.indexOf(
    "[auth]",
  );

  if (authStart >= 0) {
    const tail = source.slice(authStart);
    const redirectPattern =
      /redirect_urls\s*=\s*\[[\s\S]*?\]/m;

    if (
      redirectPattern.test(
        tail,
      )
    ) {
      const updatedTail = tail.replace(
        redirectPattern,
        `redirect_urls = [\n  "${appUrl.replace(/\/+$/, "")}/api/auth"\n]`,
      );

      source =
        source.slice(0, authStart) +
        updatedTail;
    }
  }

  writeFileSync(
    file,
    source,
    "utf8",
  );

  console.log(
    `Configured ${profile.label} application URL: ${appUrl}`,
  );
}

function genericClientId() {
  for (const fileName of [
    "shopify.app.releasecore.toml",
    "shopify.app.toml",
  ]) {
    const file = join(
      root,
      fileName,
    );

    if (!existsSync(file)) {
      continue;
    }

    const id = extract(
      readFileSync(file, "utf8"),
      "client_id",
    );

    if (id) return id;
  }

  return null;
}

function validate(profile, {
  requireProductionUrl = false,
} = {}) {
  const file = configPath(profile);

  if (!existsSync(file)) {
    fail(
      `${profile.shopifyConfigFile} has not been linked yet. Run the link command first.`,
    );
  }

  const source = readFileSync(
    file,
    "utf8",
  );

  const clientId = extract(
    source,
    "client_id",
  );

  if (!clientId) {
    fail(
      `${profile.shopifyConfigFile} is missing client_id.`,
    );
  }

  if (
    profile.id !== "releasecore" &&
    clientId === genericClientId()
  ) {
    fail(
      `${profile.label} is linked to the generic ReleaseCore Shopify app. It must use a separate Shopify app/client ID.`,
    );
  }

  const name = extract(
    source,
    "name",
  );

  if (
    name !== profile.appName
  ) {
    fail(
      `${profile.shopifyConfigFile} should use app name "${profile.appName}", found "${name || "missing"}".`,
    );
  }

  const appUrl = extract(
    source,
    "application_url",
  );

  if (
    requireProductionUrl &&
    (
      !appUrl ||
      !/^https:\/\//i.test(appUrl) ||
      /localhost|127\.0\.0\.1|trycloudflare\.com/i.test(
        appUrl,
      )
    )
  ) {
    fail(
      `${profile.label} needs a permanent HTTPS production application_url before deployment.`,
    );
  }

  for (const forbidden of [
    "http://localhost",
    "https://localhost",
    "127.0.0.1",
    "trycloudflare.com",
  ]) {
    if (
      requireProductionUrl &&
      source.includes(
        forbidden,
      )
    ) {
      fail(
        `${profile.shopifyConfigFile} contains development URL "${forbidden}".`,
      );
    }
  }

  const distribution =
    profile.distribution;

  if (
    ![
      "app_store",
      "single_merchant",
    ].includes(
      distribution,
    )
  ) {
    fail(
      `Unsupported profile distribution "${distribution}".`,
    );
  }

  console.log(
    `${profile.label} deployment profile validation passed.`,
  );

  return {
    clientId,
    appUrl,
    distribution,
  };
}

function writeEnvExample(profile) {
  const result = validate(
    profile,
    {
      requireProductionUrl: false,
    },
  );

  const appUrl =
    result.appUrl ||
    "https://YOUR-EAST-ROCK-RELEASECORE-SERVICE.up.railway.app";

  const target = join(
    root,
    `.env.${profile.id}.example`,
  );

  const source = `# ${profile.label} ReleaseCore deployment
# Public app identifier from Shopify config:
SHOPIFY_API_KEY=${result.clientId}

# Copy the matching secret from the Shopify Dev Dashboard:
SHOPIFY_API_SECRET=REPLACE_WITH_EAST_ROCK_APP_SECRET

# Dedicated production application host:
SHOPIFY_APP_URL=${appUrl}

# M14 deployment selectors:
RELEASECORE_DEPLOYMENT_PROFILE=${profile.id}
RELEASECORE_APP_DISTRIBUTION=${profile.distribution}

# Keep the existing ReleaseCore production infrastructure values:
# DATABASE_URL=
# SESSION_SECRET=
# R2_ACCOUNT_ID=
# R2_ACCESS_KEY_ID=
# R2_SECRET_ACCESS_KEY=
# R2_BUCKET=
`;

  writeFileSync(
    target,
    source,
    "utf8",
  );

  console.log(
    `Wrote ${target}`,
  );
}

function link(profile) {
  if (
    profile.id ===
    "releasecore"
  ) {
    fail(
      "The generic ReleaseCore app is already the canonical configuration.",
    );
  }

  const file =
    configPath(profile);

  if (
    existsSync(file)
  ) {
    fail(
      `${profile.shopifyConfigFile} already exists. Delete it only if you intentionally want to re-link this profile.`,
    );
  }

  console.log(`
Link a SEPARATE Shopify app for ${profile.label}.

When Shopify CLI prompts:
  • select/create the dedicated East Rock app
  • do NOT select the generic ReleaseCore App Store app

After linking, choose CUSTOM distribution for that East Rock app in the
Shopify Dev/Partner Dashboard.
`);

  run(
    "shopify",
    [
      "app",
      "config",
      "link",
      "--file-name",
      profile.shopifyConfigFile,
    ],
  );

  patchLinkedConfig(
    profile,
  );

  validate(
    profile,
    {
      requireProductionUrl: false,
    },
  );

  writeEnvExample(
    profile,
  );

  console.log(`
${profile.label} app configuration is linked.

Next:
  1. Set its distribution method to Custom in Shopify's Dev/Partner Dashboard.
  2. Clone the Railway ReleaseCore service for East Rock.
  3. Give the clone the East Rock app's SHOPIFY_API_KEY / SHOPIFY_API_SECRET.
  4. Set:
       RELEASECORE_DEPLOYMENT_PROFILE=${profile.id}
       RELEASECORE_APP_DISTRIBUTION=${profile.distribution}
  5. Configure the permanent Railway application URL:
       npm run profile:east-rock -- configure-url https://YOUR-SERVICE.up.railway.app
`);
}

function deploy(profile) {
  validate(
    profile,
    {
      requireProductionUrl: true,
    },
  );

  run(
    "npm",
    [
      "run",
      "check",
    ],
  );

  run(
    "shopify",
    [
      "app",
      "config",
      "validate",
      "--config",
      profile.shopifyConfig,
    ],
  );

  console.log(`
About to deploy ${profile.label}.
Shopify config: ${profile.shopifyConfigFile}
Distribution runtime: ${profile.distribution}
`);

  run(
    "shopify",
    [
      "app",
      "deploy",
      "--config",
      profile.shopifyConfig,
    ],
  );
}

const profileId =
  process.argv[2] ||
  "east-rock";
const command =
  process.argv[3] ||
  "status";

const profile =
  loadProfile(profileId);

if (
  command === "link"
) {
  link(profile);
} else if (
  command === "configure-url"
) {
  const url =
    process.argv[4];

  if (!url) {
    fail(
      "Usage: npm run profile:east-rock -- configure-url https://your-production-host",
    );
  }

  patchLinkedConfig(
    profile,
  );
  configureUrl(
    profile,
    url,
  );
  validate(
    profile,
    {
      requireProductionUrl: true,
    },
  );
  writeEnvExample(
    profile,
  );
} else if (
  command === "validate"
) {
  validate(
    profile,
    {
      requireProductionUrl:
        profile.id !==
        "releasecore",
    },
  );
} else if (
  command === "env"
) {
  writeEnvExample(
    profile,
  );
} else if (
  command === "deploy"
) {
  deploy(
    profile,
  );
} else if (
  command === "status"
) {
  const file =
    configPath(profile);

  console.log(
    JSON.stringify(
      {
        profile:
          profile.id,
        label:
          profile.label,
        distribution:
          profile.distribution,
        shopifyConfigFile:
          profile.shopifyConfigFile,
        linked:
          existsSync(file),
        appName:
          profile.appName,
        customerBrand:
          profile.customerBrand,
      },
      null,
      2,
    ),
  );
} else {
  fail(
    `Unknown command "${command}". Use status, link, configure-url, validate, env, or deploy.`,
  );
}
