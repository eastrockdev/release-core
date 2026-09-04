#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

if (process.env.NODE_ENV === "production") {
  const profile = String(
    process.env.RELEASECORE_DEPLOYMENT_PROFILE || "",
  ).trim();

  const validation = spawnSync(
    process.execPath,
    [
      "scripts/validate-production-environment.mjs",
      "--profile",
      profile,
    ],
    {
      env: process.env,
      stdio: "inherit",
    },
  );

  if (validation.status !== 0) {
    console.error(
      "ReleaseCore production supervisor refused to start because environment validation failed.",
    );
    process.exit(validation.status || 1);
  }
}

const secret = randomBytes(32).toString("hex");
const workerId = [
  String(
    process.env.RELEASECORE_DEPLOYMENT_PROFILE ||
      "releasecore",
  ),
  process.pid,
  randomUUID().slice(0, 8),
].join("-");

const sharedEnv = {
  ...process.env,
  RELEASECORE_WORKER_SECRET: secret,
  RELEASECORE_WORKER_ID: workerId,
};

const web = spawn(
  "npm",
  ["run", "start"],
  {
    env: sharedEnv,
    stdio: "inherit",
  },
);

const worker = spawn(
  process.execPath,
  ["scripts/operation-worker.mjs"],
  {
    env: sharedEnv,
    stdio: "inherit",
  },
);

let shuttingDown = false;

function terminate(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (!web.killed) web.kill("SIGTERM");
  if (!worker.killed) worker.kill("SIGTERM");

  const timer = setTimeout(() => {
    if (!web.killed) web.kill("SIGKILL");
    if (!worker.killed) worker.kill("SIGKILL");
  }, 5_000);
  timer.unref();

  process.exitCode = code;
}

web.on("exit", (code, signal) => {
  if (!shuttingDown) {
    console.error(
      "ReleaseCore web process exited; stopping operation worker.",
      { code, signal },
    );
    terminate(code || 1);
  }
});

worker.on("exit", (code, signal) => {
  if (!shuttingDown) {
    console.error(
      "ReleaseCore operation worker exited; restarting the container through the platform supervisor.",
      { code, signal },
    );
    terminate(code || 1);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => terminate(0));
}
