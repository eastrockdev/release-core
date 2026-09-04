import {
  Link,
  useLoaderData,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  loadOperationalMetrics,
  operationalMetricsWindow,
} from "../lib/operational-metrics.server";
import {
  EmptyState,
  FilterBar,
  MetricCard,
  MetricGrid,
  PageIntro,
  StatusBadge,
} from "../components/releasecore-ui";

const WINDOWS = [7, 30, 90];

export const loader = async ({ request }) => {
  const { session } =
    await authenticate.admin(request);
  const days =
    operationalMetricsWindow(request);

  return loadOperationalMetrics({
    shop: session.shop,
    days,
  });
};

function formatDuration(value) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {
    return "—";
  }

  const ms = Number(value);
  if (ms < 1_000) {
    return `${Math.round(ms)} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1_000).toFixed(
      ms < 10_000 ? 1 : 0,
    )} sec`;
  }
  if (ms < 3_600_000) {
    return `${(ms / 60_000).toFixed(1)} min`;
  }
  return `${(ms / 3_600_000).toFixed(1)} hr`;
}

function formatRate(value) {
  return value === null ||
    value === undefined
    ? "—"
    : `${Number(value).toFixed(1)}%`;
}

function operationLabel(value) {
  return String(value || "operation")
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase(),
    );
}

function TrendChart({
  title,
  buckets,
  emptyText,
}) {
  const max = Math.max(
    1,
    ...buckets.map((bucket) => bucket.total),
  );
  const hasData = buckets.some(
    (bucket) => bucket.total > 0,
  );

  if (!hasData) {
    return (
      <div className="rc-metrics-chart">
        <strong>{title}</strong>
        <div className="rc-metrics-chart__empty">
          {emptyText}
        </div>
      </div>
    );
  }

  return (
    <div className="rc-metrics-chart">
      <div className="rc-metrics-chart__heading">
        <strong>{title}</strong>
        <span>
          success · warning · failure
        </span>
      </div>
      <div
        className="rc-metrics-chart__plot"
        role="img"
        aria-label={`${title} trend`}
      >
        {buckets.map((bucket) => {
          const successHeight =
            (bucket.success / max) * 100;
          const warningHeight =
            (bucket.warning / max) * 100;
          const failureHeight =
            (bucket.failure / max) * 100;
          const label =
            new Date(
              bucket.start,
            ).toLocaleDateString();

          return (
            <div
              className="rc-metrics-chart__column"
              key={bucket.start}
              title={`${label}: ${bucket.success} success, ${bucket.warning} warning, ${bucket.failure} failure`}
            >
              <span
                className="rc-metrics-bar rc-metrics-bar--success"
                style={{
                  height: `${successHeight}%`,
                }}
              />
              <span
                className="rc-metrics-bar rc-metrics-bar--warning"
                style={{
                  height: `${warningHeight}%`,
                }}
              />
              <span
                className="rc-metrics-bar rc-metrics-bar--failure"
                style={{
                  height: `${failureHeight}%`,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="rc-metrics-chart__axis">
        <span>
          {new Date(
            buckets[0].start,
          ).toLocaleDateString()}
        </span>
        <span>
          {new Date(
            buckets[
              buckets.length - 1
            ].start,
          ).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

function OperationTable({
  title,
  rows,
  emptyTitle,
}) {
  return (
    <div className="rc-metrics-panel">
      <strong>{title}</strong>
      {rows.length ? (
        <div className="rc-metrics-operation-list">
          {rows.map((row) => (
            <div
              className="rc-metrics-operation-row"
              key={row.operation}
            >
              <span>
                {operationLabel(
                  row.operation,
                )}
              </span>
              <StatusBadge tone="neutral">
                {row.count}
              </StatusBadge>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title={emptyTitle}>
          No matching activity was recorded
          in this window.
        </EmptyState>
      )}
    </div>
  );
}

export default function OperationalMetrics() {
  const data = useLoaderData();

  const rangeText = `${new Date(
    data.window.start,
  ).toLocaleDateString()} – ${new Date(
    data.window.end,
  ).toLocaleDateString()}`;

  return (
    <s-page heading="Operational Metrics">
      <s-button
        slot="secondary-actions"
        href="/app/operations"
      >
        Back to Operations
      </s-button>

      <s-section>
        <PageIntro
          eyebrow="M16.9 · Production telemetry"
          title="Measure ReleaseCore from the workflow data it already trusts."
        >
          These metrics come from ReleaseCore&apos;s
          PostgreSQL workflow, background-job,
          diagnostics, notification, and production
          safety records. This page does not call Shopify
          or perform external writes.
        </PageIntro>

        <FilterBar
          active={String(data.window.days)}
          hrefFor={(value) =>
            `/app/operations/metrics?days=${value}`
          }
          items={WINDOWS.map((days) => ({
            value: String(days),
            label:
              days === 7
                ? "7 days"
                : days === 30
                  ? "30 days"
                  : "90 days",
          }))}
        />

        <div className="rc-metrics-window">
          <span>{rangeText}</span>
          <span>
            {data.window.bucketDays === 1
              ? "Daily trend buckets"
              : `${data.window.bucketDays}-day trend buckets`}
          </span>
        </div>
      </s-section>

      <s-section heading="Operational snapshot">
        <MetricGrid>
          <MetricCard
            label="Submitted releases"
            value={
              data.releaseThroughput.submitted
            }
            detail={`Releases submitted or resubmitted in the last ${data.window.days} days`}
          />
          <MetricCard
            label="Delivered releases"
            value={
              data.releaseThroughput.delivered
            }
            detail="Current delivered state updated in this window"
          />
          <MetricCard
            label="Job reliability"
            value={formatRate(
              data.jobs.successRate,
            )}
            detail={`${data.jobs.succeeded} succeeded · ${data.jobs.failed} failed`}
          />
          <MetricCard
            label="Shopify sync"
            value={formatRate(
              data.shopifySync.successRate,
            )}
            detail={`${data.shopifySync.successes} success · ${data.shopifySync.failures} failure`}
          />
          <MetricCard
            label="New system issues"
            value={data.systemIssues.new}
            detail={`${data.systemIssues.open} currently open`}
            href="/app/system-issues"
          />
          <MetricCard
            label="Protected writes"
            value={
              data.protectedWrites.total
            }
            detail="High-impact M16.8 mutation claims"
            href="/app/production-safety"
          />
        </MetricGrid>
      </s-section>

      <s-section heading="Release throughput">
        <MetricGrid>
          <MetricCard
            label="Created"
            value={
              data.releaseThroughput.created
            }
            detail="New local ReleaseCore releases"
          />
          <MetricCard
            label="Submitted"
            value={
              data.releaseThroughput.submitted
            }
            detail="Latest submission activity in window"
          />
          <MetricCard
            label="Approved"
            value={
              data.releaseThroughput.approved
            }
            detail="Current approved releases decided in window"
          />
          <MetricCard
            label="Delivered"
            value={
              data.releaseThroughput.delivered
            }
            detail="Current delivered releases updated in window"
          />
        </MetricGrid>
      </s-section>

      <s-section heading="Background jobs">
        <MetricGrid>
          <MetricCard
            label="Jobs created"
            value={data.jobs.created}
            detail={`${data.jobs.completed} completed in window`}
          />
          <MetricCard
            label="Succeeded"
            value={data.jobs.succeeded}
            detail={`${formatRate(data.jobs.successRate)} completion reliability`}
          />
          <MetricCard
            label="Failed"
            value={data.jobs.failed}
            detail={`${data.jobs.retries} retry attempt${data.jobs.retries === 1 ? "" : "s"} beyond initial attempts`}
          />
          <MetricCard
            label="Median queue wait"
            value={formatDuration(
              data.jobs.medianQueueWaitMs,
            )}
            detail={`p95 ${formatDuration(data.jobs.p95QueueWaitMs)}`}
          />
          <MetricCard
            label="Median runtime"
            value={formatDuration(
              data.jobs.medianRuntimeMs,
            )}
            detail={`p95 ${formatDuration(data.jobs.p95RuntimeMs)}`}
          />
          <MetricCard
            label="Current queue"
            value={
              data.jobs.queued +
              data.jobs.running
            }
            detail={`${data.jobs.queued} queued · ${data.jobs.running} running`}
          />
        </MetricGrid>

        {data.jobs.oldestQueuedMs !==
        null ? (
          <div className="rc-operations-note">
            Oldest queued job has been waiting{" "}
            {formatDuration(
              data.jobs.oldestQueuedMs,
            )}
            .
          </div>
        ) : null}

        {data.jobs.sampleCapped ? (
          <div className="rc-operations-note">
            Job latency/trend sampling reached
            the bounded {data.jobs.sampleSize}-job
            cap. Exact status counts above remain
            complete.
          </div>
        ) : null}

        <TrendChart
          title="Completed background jobs"
          buckets={data.jobs.trend}
          emptyText="No completed background jobs in this window."
        />
      </s-section>

      <s-section heading="Shopify sync reliability">
        <MetricGrid>
          <MetricCard
            label="Successful sync signals"
            value={
              data.shopifySync.successes
            }
          />
          <MetricCard
            label="Warnings"
            value={
              data.shopifySync.warnings
            }
          />
          <MetricCard
            label="Failures"
            value={
              data.shopifySync.failures
            }
          />
          <MetricCard
            label="Success rate"
            value={formatRate(
              data.shopifySync.successRate,
            )}
            detail="Successes ÷ successes + failures"
          />
        </MetricGrid>

        {data.shopifySync.trendCapped ? (
          <div className="rc-operations-note">
            Shopify sync trend rendering reached
            its bounded event sample. Exact totals
            above remain complete.
          </div>
        ) : null}

        <TrendChart
          title="Shopify sync signals"
          buckets={data.shopifySync.trend}
          emptyText="No Shopify sync signals in this window."
        />
      </s-section>

      <s-section heading="Diagnostics & communication">
        <MetricGrid>
          <MetricCard
            label="Open system issues"
            value={data.systemIssues.open}
            href="/app/system-issues"
          />
          <MetricCard
            label="Issue fingerprints seen"
            value={data.systemIssues.touched}
            detail={`${data.systemIssues.criticalOrError} critical/error fingerprints`}
          />
          <MetricCard
            label="Notification failures"
            value={
              data.notifications.failed
            }
            detail={`${data.notifications.total} notification records created`}
            href="/app/notifications"
          />
          <MetricCard
            label="Maintenance actions"
            value={
              data.maintenance.actions
            }
            detail="Audited Data Maintenance operations"
            href="/app/data-hygiene"
          />
        </MetricGrid>

        <div className="rc-metrics-two-column">
          <OperationTable
            title="Most frequent issue operations"
            rows={
              data.systemIssues.topOperations
            }
            emptyTitle="No issue operations"
          />
          <OperationTable
            title="Protected write activity"
            rows={
              data.protectedWrites.topOperations
            }
            emptyTitle="No protected writes"
          />
        </div>
      </s-section>

      <s-section>
        <div className="rc-operations-footer">
          <span>
            Generated{" "}
            {new Date(
              data.generatedAt,
            ).toLocaleString()}.
          </span>
          <Link to="/app/operations">
            Return to Operations →
          </Link>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);
