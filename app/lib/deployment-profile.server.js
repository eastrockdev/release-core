import process from "node:process";
import fs from "node:fs";
import path from "node:path";

const PROFILE_ENV = "RELEASECORE_DEPLOYMENT_PROFILE";

function rootDir() {
  return process.cwd();
}

function clean(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

export function deploymentProfileId() {
  return (
    clean(process.env[PROFILE_ENV]) ||
    "releasecore"
  );
}

export function deploymentProfilePath(id = deploymentProfileId()) {
  return path.join(
    rootDir(),
    "deployments",
    `${id}.profile.json`,
  );
}

export function deploymentProfile(id = deploymentProfileId()) {
  const file = deploymentProfilePath(id);

  if (!fs.existsSync(file)) {
    throw new Error(
      `Unknown ReleaseCore deployment profile "${id}". Expected ${file}.`,
    );
  }

  const profile = JSON.parse(
    fs.readFileSync(file, "utf8"),
  );

  if (
    profile?.schemaVersion !== 1 ||
    profile?.id !== id
  ) {
    throw new Error(
      `ReleaseCore deployment profile "${id}" is invalid.`,
    );
  }

  return profile;
}

export function deploymentBrand(id = deploymentProfileId()) {
  return deploymentProfile(id).customerBrand || {};
}
