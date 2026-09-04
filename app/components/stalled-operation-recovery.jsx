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
    <div className="rc-operation-recovery" role="status">
      <div className="rc-operation-recovery__head">
        <div>
          <strong>Stalled operation recovery</strong>
          <span>
            ReleaseCore detected work that has exceeded its normal running
            window. Restarting abandons that attempt and queues a fresh copy
            without removing completed release data.
          </span>
        </div>
      </div>

      {error ? (
        <div className="rc-operation-recovery__error">{error}</div>
      ) : null}

      {restartable.map((job) => (
        <div className="rc-operation-recovery__row" key={job.id}>
          <div>
            <strong>{job.label}</strong>
            <span>
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
