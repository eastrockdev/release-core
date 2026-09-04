import { authenticate } from "../shopify.server";
import {
  listReleaseOperationJobs,
  retryOperationJob,
} from "../lib/operation-jobs.server";
import {
  decorateRestartableOperationJobs,
  restartStalledOperationJob,
} from "../lib/operation-job-recovery.server";
import {
  apiErrorResponse,
  publicError,
} from "../lib/http-security.server";

async function listedJobs({ shop, releaseId }) {
  const jobs = await listReleaseOperationJobs({
    shop,
    releaseId,
    take: 10,
  });
  return decorateRestartableOperationJobs(jobs);
}

export const action = async ({ request, params }) => {
  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "Method not allowed." },
      { status: 405 },
    );
  }

  let shop = null;

  try {
    const { session } = await authenticate.admin(request);
    shop = session.shop;
    const releaseId = String(params.releaseId || "");
    const formData = await request.formData();
    const intent = String(formData.get("intent") || "");

    if (intent === "list") {
      const jobs = await listedJobs({ shop, releaseId });
      return Response.json({ ok: true, jobs });
    }

    if (intent === "retry" || intent === "restart") {
      const jobId = String(
        formData.get("jobId") || "",
      ).trim();
      if (!jobId) {
        throw publicError(
          "Select a background operation to retry or restart.",
          { status: 400 },
        );
      }

      const recovery = await restartStalledOperationJob({
        shop,
        releaseId,
        jobId,
      });

      if (!recovery.restarted) {
        await retryOperationJob({
          shop,
          releaseId,
          jobId,
        });
      }

      const jobs = await listedJobs({ shop, releaseId });

      return Response.json({
        ok: true,
        jobs,
        message: recovery.restarted
          ? "Stalled background operation restarted. The previous attempt was abandoned and fresh work was queued."
          : "Background operation queued for retry.",
      });
    }

    throw publicError(
      "Unsupported background-operation action.",
      { status: 400 },
    );
  } catch (error) {
    return apiErrorResponse(request, error, {
      context: "operation job mutation",
      operation: "operation-job-mutation",
      releaseId: params.releaseId,
      fallback:
        "ReleaseCore could not update the background operation.",
      shop,
    });
  }
};