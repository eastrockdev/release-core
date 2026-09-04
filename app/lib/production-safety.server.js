import process from "node:process";
import db from "../db.server";
import {
  deploymentProfile,
  deploymentProfileId,
} from "./deployment-profile.server";
import { publicError } from "./http-security.server";

const PRODUCTION_TARGETS = {
  releasecore: {
    distribution: "app_store",
    appUrl:
      "https://releasecore-web-production.up.railway.app",
  },
  "east-rock": {
    distribution: "single_merchant",
    appUrl:
      "https://releasecore-er-production.up.railway.app",
  },
};

function clean(value) {
  return String(value ?? "").trim();
}

function normalizedUrl(value) {
  return clean(value).replace(/\/+$/, "");
}

export function productionSafetyReport() {
  const rawProfile = clean(
    process.env.RELEASECORE_DEPLOYMENT_PROFILE,
  );
  const profileId = deploymentProfileId();
  const nodeEnvironment = clean(process.env.NODE_ENV);
  const distribution = clean(
    process.env.RELEASECORE_APP_DISTRIBUTION,
  );
  const appUrl = normalizedUrl(
    process.env.SHOPIFY_APP_URL,
  );
  const production = nodeEnvironment === "production";

  let profile = null;
  let profileError = null;

  try {
    profile = deploymentProfile(profileId);
  } catch (error) {
    profileError =
      error instanceof Error
        ? error.message
        : "Deployment profile could not be loaded.";
  }

  const target = PRODUCTION_TARGETS[profileId] || null;
  const checks = [
    {
      key: "profile-file",
      label: "Deployment profile file",
      passed:
        Boolean(profile) &&
        profile?.id === profileId,
      detail: profileError
        ? "Profile could not be loaded."
        : `Profile ${profileId} is available.`,
    },
    {
      key: "profile-env",
      label: "Deployment profile environment",
      passed: rawProfile === profileId,
      detail: rawProfile
        ? `RELEASECORE_DEPLOYMENT_PROFILE=${rawProfile}`
        : "RELEASECORE_DEPLOYMENT_PROFILE is missing.",
    },
    {
      key: "distribution",
      label: "Distribution mode",
      passed:
        Boolean(profile) &&
        distribution === profile?.distribution &&
        (!target ||
          distribution === target.distribution),
      detail: distribution
        ? `Distribution mode: ${distribution}`
        : "Distribution mode is missing.",
    },
    {
      key: "app-url",
      label: "Production application URL",
      passed:
        !target ||
        appUrl === normalizedUrl(target.appUrl),
      detail: appUrl
        ? `Application origin: ${appUrl}`
        : "SHOPIFY_APP_URL is missing.",
    },
  ];

  return {
    production,
    nodeEnvironment:
      nodeEnvironment || "not set",
    profileId,
    profileLabel:
      profile?.label || profileId,
    distribution:
      distribution || "not set",
    appUrl:
      appUrl || "not set",
    checks,
    ready:
      !production ||
      checks.every((check) => check.passed),
  };
}

export function assertProductionRuntimeSafety() {
  const report = productionSafetyReport();

  if (report.production && !report.ready) {
    throw publicError(
      "Production safety blocked this mutation because this service no longer matches its ReleaseCore deployment profile. Review Production Safety before retrying.",
      { status: 503 },
    );
  }

  return report;
}

function mutationRequestId(request) {
  const value = clean(
    request.headers.get(
      "x-releasecore-mutation-id",
    ),
  );

  if (
    !value ||
    value.length < 8 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw publicError(
      "ReleaseCore could not verify this high-impact request. Refresh the app and try the action again.",
      { status: 400 },
    );
  }

  return value;
}

export function requireSafetyConfirmation(
  confirmation,
  expected,
) {
  if (!expected) return;

  if (clean(confirmation) !== expected) {
    throw publicError(
      `Type ${expected} exactly to confirm this high-impact action.`,
      { status: 400 },
    );
  }
}

export async function claimHighImpactMutation({
  request,
  shop,
  operation,
  entityType = null,
  entityId = null,
  confirmation = "",
  expectedConfirmation = null,
}) {
  assertProductionRuntimeSafety();
  requireSafetyConfirmation(
    confirmation,
    expectedConfirmation,
  );

  const requestId = mutationRequestId(request);
  const deploymentProfile =
    deploymentProfileId();

  try {
    return await db.productionMutation.create({
      data: {
        shop,
        deploymentProfile,
        requestId,
        operation,
        entityType,
        entityId,
      },
    });
  } catch (error) {
    if (error?.code === "P2002") {
      throw publicError(
        "This high-impact action was already submitted. Refresh the page before trying it again.",
        { status: 409 },
      );
    }
    throw error;
  }
}

export async function listRecentProductionMutations({
  shop,
  take = 25,
}) {
  const rows = await db.productionMutation.findMany({
    where: {
      shop,
      deploymentProfile:
        deploymentProfileId(),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(
      100,
      Math.max(1, Number(take) || 25),
    ),
  });

  return rows.map((row) => ({
    id: row.id,
    operation: row.operation,
    entityType: row.entityType,
    entityId: row.entityId,
    requestReference:
      row.requestId.slice(0, 8),
    createdAt: row.createdAt,
  }));
}
