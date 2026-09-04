import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticatedPost } from "../lib/authenticated-post";
import { revalidateInPlace } from "../lib/revalidate-in-place";

function distributionReleaseId(pathname) {
  const match = String(pathname || "").match(/^\/app\/distribution\/([^/]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function StalledOperationRecovery() {
  const location = useLocation();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const releaseId = useMemo(
    () => distributionReleaseId(location.pathname),
    [location.pathname],
  );
  const [jobs, setJobs] = useState([]);
  const [host, setHost] = useState(null);
  const [busyJobId, setBusyJobId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setJobs([]);
    setHost(null);
    setError("");
    setBusyJobId(null);

    if (!releaseId) return undefined;

    let cancelled = false;
    let timer = null;

    const poll = async () => {
      try {
        const formData = new FormData();
        formData.set("intent", "list");
        const result = await authenticatedPost(
          shopify,
          `/api/operation-jobs/${releaseId}`,
          formData,
        );
        if (!cancelled) setJobs(result.jobs || []);
      } catch {
        // The Distribution Workspace already owns its regular status polling.
        // Recovery polling is intentionally quiet if the lightweight request
        // temporarily fails.
      }
      if (!cancelled) {
        timer = window.setTimeout(poll, 5000);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [releaseId, shopify]);

  useEffect(() => {
    if (!releaseId) return undefined;

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
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [releaseId, jobs.length]);

  const restartable = jobs.filter((job) => job.restartable);
  if (!releaseId || !host || !restartable.length) return null;

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
        `/api/operation-jobs/${releaseId}`,
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
    <div style={styles.panel} role="status">
      <div style={styles.heading}>
        <span style={styles.icon} aria-hidden="true">↻</span>
        <div>
          <strong style={styles.title}>Stalled operation recovery</strong>
          <span style={styles.copy}>
            ReleaseCore detected work that has exceeded its normal running
            window. Restarting abandons that attempt and queues a fresh copy
            without removing completed release data.
          </span>
        </div>
      </div>

      {error ? <div style={styles.error}>{error}</div> : null}

      {restartable.map((job) => (
        <div style={styles.row} key={job.id}>
          <div style={styles.jobCopy}>
            <strong style={styles.jobTitle}>{job.label}</strong>
            <span style={styles.copy}>
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

const styles = {
  panel: {
    display: "grid",
    gap: 12,
    border: "1px solid #e6c86c",
    borderRadius: 14,
    padding: 14,
    background: "#fffaf0",
  },
  heading: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    flex: "0 0 auto",
    background: "#fff2c7",
    color: "#7a5b00",
    fontSize: 20,
    lineHeight: 1,
  },
  title: {
    display: "block",
    color: "#2f2f2f",
    fontSize: 14,
    lineHeight: 1.35,
  },
  copy: {
    display: "block",
    marginTop: 4,
    color: "#6d6250",
    fontSize: 12,
    lineHeight: 1.45,
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    borderTop: "1px solid #ead9aa",
    paddingTop: 12,
  },
  jobCopy: {
    minWidth: 0,
    flex: "1 1 auto",
  },
  jobTitle: {
    display: "block",
    color: "#343434",
    fontSize: 13,
  },
  error: {
    borderRadius: 9,
    padding: "9px 10px",
    background: "#fff1f0",
    color: "#8e1f0b",
    fontSize: 12,
    lineHeight: 1.4,
  },
};