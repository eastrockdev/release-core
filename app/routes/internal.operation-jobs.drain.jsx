import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import process from "node:process";
import { drainOneOperationJob } from "../lib/operation-jobs.server";
import { safeDiagnosticText } from "../lib/http-security.server";

function validWorkerSecret(request) {
  const expected = String(
    process.env.RELEASECORE_WORKER_SECRET || "",
  );
  const received = String(
    request.headers.get("x-releasecore-worker-secret") ||
      "",
  );

  if (!expected || !received) return false;

  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);

  if (expectedBytes.length !== receivedBytes.length) {
    return false;
  }

  return timingSafeEqual(
    expectedBytes,
    receivedBytes,
  );
}

export const action = async ({ request }) => {
  if (
    request.method !== "POST" ||
    !validWorkerSecret(request)
  ) {
    return new Response("Not found", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    const result = await drainOneOperationJob({
      profile:
        process.env.RELEASECORE_DEPLOYMENT_PROFILE ||
        "releasecore",
      workerId:
        process.env.RELEASECORE_WORKER_ID ||
        "releasecore-worker",
    });

    return Response.json(
      { ok: true, ...result },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "ReleaseCore operation worker drain failed",
      {
        message: safeDiagnosticText(
          error instanceof Error
            ? error.message
            : String(error || ""),
          1000,
        ),
      },
    );

    return Response.json(
      {
        ok: false,
        error: "Operation worker drain failed.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
};
