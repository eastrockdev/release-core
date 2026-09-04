import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import BaseDistributionWorkspace from "../lib/distribution-workspace-view";
import { authenticatedPost } from "../lib/authenticated-post";
import { revalidateInPlace } from "../lib/revalidate-in-place";

// The preserved base view owns the full "Background operations" workspace,
// action idempotencyKey generation, and window.crypto?.randomUUID?.() usage.
export { loader, headers } from "../lib/distribution-workspace-view";

function StalledOperationRecovery() {
  const data = useLoaderData();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const [jobs, setJobs] = useState(data.operationJobs || []);
  const [host, setHost] = useState(null);
  const [busyJobId, setBusyJobId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setJobs(data.operationJobs || []);
  }, [data.operationJobs]);

  useEffect(() => {
    let cancelled = false;
    let observer = null;

    const resolveHost = () => {
      if (cancelled) return;
      const target = document.querySelector(".rc-operation-jobs");
      if (target) {
        setHost(target);
        observer?.disconnect();
        observer = null;
      }
    };

    resolveHost();
    if (!document.querySelector(".rc-operation-jobs")) {
      observer = new MutationObserver(resolveHost);
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [jobs.length]);

  useEffect(() => {
    const hasActive = jobs.some((job) =>
      ["QUEUED", "RUNNING"].includes(job.status),
    );
    if (!hasActive) return undefined;

    let cancelled = false;
    let timer = null;

    const poll = async () => {
      try {
        const formData = new FormData();
        formData.set("intent", "list");
        const result = await authenticatedPost(
          shopify,
          `/api/operation-jobs/${data.release.id}`,
          formData,
        );
        if (!cancelled) setJobs(result.jobs || []);
      } catch {
        // The base workspace also polls this endpoint. Keep this recovery
        // helper quiet and try again on the next interval.
      }
      if (!cancelled) timer = window.setTimeout(poll, 5000);
    };

    timer = window.setTimeout(poll, 2500);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [data.release.id, jobs, shopify]);

  const restartable = jobs.filter((job) => job.restartable);
  if (!host || !restartable.length) return null;

  const restart = async (job) => {
    if (busyJobId) return;
    setBusyJobId(job.id);
    setError("");
    try {
      const formData = new FormData();
      formData.set("intent", "restart");
      formData.set("jobId", job.id);
      const result = await authenticatedPost(
        shopify,
        `/api/operation-jobs/${data.release.id}`,
        formData,
      );
      setJobs(result.jobs || []);
      shopify.toast.show(
        result.message || "Background operation restarted.",
      );
      await revalidateInPlace(revalidator);
    } catch (restartError) {
      setError(
        restartError?.message ||
          "ReleaseCore could not restart the stalled operation.",
      );
    } finally {
      setBusyJobId(null);
    }
  };

  return createPortal(
    <div style={styles.recoveryPanel}>
      <div style={styles.recoveryHeading}>
        <div>
          <strong>Stalled operation recovery</strong>
          <span style={styles.recoveryCopy}>
            ReleaseCore detected background work that has exceeded its normal
            running window. Restarting abandons that attempt and queues a fresh
            copy without removing completed release data.
          </span>
        </div>
      </div>
      {error ? <div style={styles.error}>{error}</div> : null}
      {restartable.map((job) => (
        <div style={styles.recoveryRow} key={job.id}>
          <div style={{ minWidth: 0 }}>
            <strong>{job.label}</strong>
            <span style={styles.recoveryCopy}>
              {job.restartReason || "This operation appears stalled."}
            </span>
          </div>
          <button
            type="button"
            className="rc-button rc-button--compact"
            disabled={Boolean(busyJobId)}
            onClick={() => restart(job)}
          >
            {busyJobId === job.id ? "Restarting…" : "Restart"}
          </button>
        </div>
      ))}
    </div>,
    host,
  );
}

export default function DistributionWorkspaceRoute() {
  return (
    <>
      <BaseDistributionWorkspace />
      <StalledOperationRecovery />
    </>
  );
}

const styles = {
  recoveryPanel: {
    border: "1px solid #e6c36a",
    borderRadius: 12,
    padding: 14,
    background: "#fffaf0",
    display: "grid",
    gap: 10,
  },
  recoveryHeading: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  recoveryCopy: {
    display: "block",
    marginTop: 4,
    color: "#6d5a25",
    fontSize: 12,
    lineHeight: 1.45,
  },
  recoveryRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    alignItems: "center",
    paddingTop: 10,
    borderTop: "1px solid #ead9aa",
  },
  error: {
    borderRadius: 8,
    padding: "9px 10px",
    background: "#fff1f0",
    color: "#8e1f0b",
    fontSize: 12,
  },
};
