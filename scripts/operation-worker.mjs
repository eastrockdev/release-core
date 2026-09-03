#!/usr/bin/env node
import process from "node:process";

const secret = String(
  process.env.RELEASECORE_WORKER_SECRET || "",
);
const port = String(process.env.PORT || "3000");
const baseUrl = String(
  process.env.RELEASECORE_WORKER_BASE_URL ||
    `http://127.0.0.1:${port}`,
).replace(/\/+$/, "");

if (!secret) {
  console.error(
    "ReleaseCore operation worker requires RELEASECORE_WORKER_SECRET.",
  );
  process.exit(1);
}

let stopping = false;

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
  });
}

console.log(
  "ReleaseCore operation worker started.",
);

while (!stopping) {
  try {
    const response = await fetch(
      `${baseUrl}/internal/operation-jobs/drain`,
      {
        method: "POST",
        headers: {
          "x-releasecore-worker-secret": secret,
        },
        signal: AbortSignal.timeout(30 * 60 * 1000),
      },
    );

    if (!response.ok) {
      if (response.status === 404) {
        console.error(
          "ReleaseCore operation worker could not authenticate with the local web process.",
        );
        await sleep(5_000);
        continue;
      }

      console.warn(
        `ReleaseCore operation worker drain returned HTTP ${response.status}.`,
      );
      await sleep(3_000);
      continue;
    }

    const data = await response.json();
    if (data?.processed) {
      continue;
    }

    await sleep(1_500);
  } catch (error) {
    if (stopping) break;
    console.warn(
      "ReleaseCore operation worker is waiting for the local web process.",
      {
        message:
          error instanceof Error
            ? error.message
            : String(error || ""),
      },
    );
    await sleep(3_000);
  }
}

console.log(
  "ReleaseCore operation worker stopped.",
);
