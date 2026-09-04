import {
  useLoaderData,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  listRecentProductionMutations,
  productionSafetyReport,
} from "../lib/production-safety.server";
import {
  EmptyState,
  PageIntro,
  StatusBadge,
} from "../components/releasecore-ui";

export const loader = async ({ request }) => {
  const { session } =
    await authenticate.admin(request);

  const [report, recentMutations] =
    await Promise.all([
      Promise.resolve(
        productionSafetyReport(),
      ),
      listRecentProductionMutations({
        shop: session.shop,
        take: 25,
      }),
    ]);

  return {
    report,
    recentMutations,
  };
};

function CheckRow({ check }) {
  return (
    <div className="rc-safety-check">
      <div>
        <strong>{check.label}</strong>
        <span>{check.detail}</span>
      </div>
      <StatusBadge
        tone={check.passed ? "good" : "critical"}
      >
        {check.passed ? "Pass" : "Blocked"}
      </StatusBadge>
    </div>
  );
}

export default function ProductionSafetyPage() {
  const { report, recentMutations } =
    useLoaderData();

  return (
    <s-page heading="Production Safety">
      <s-section>
        <PageIntro
          eyebrow="M16.8 · Production safeguards"
          title="High-impact writes stay bound to the right deployment."
        >
          ReleaseCore validates production profile
          configuration before startup and again before
          protected mutations. Destructive maintenance
          actions also require explicit confirmation and
          replay protection.
        </PageIntro>
      </s-section>

      <s-section heading="Runtime safety">
        <div
          className={`rc-safety-state ${
            report.ready
              ? "rc-safety-state--good"
              : "rc-safety-state--bad"
          }`}
        >
          <div>
            <strong>
              {report.production
                ? report.ready
                  ? "Production guard active"
                  : "Production guard blocked"
                : "Development mode"}
            </strong>
            <span>
              {report.profileLabel} ·{" "}
              {report.distribution}
            </span>
          </div>
          <StatusBadge
            tone={
              report.ready ? "good" : "critical"
            }
          >
            {report.ready ? "Ready" : "Blocked"}
          </StatusBadge>
        </div>

        <div className="rc-safety-checks">
          {report.checks.map((check) => (
            <CheckRow
              check={check}
              key={check.key}
            />
          ))}
        </div>
      </s-section>

      <s-section heading="Protected actions">
        <div className="rc-safety-grid">
          <div className="rc-safety-card">
            <strong>Explicit destructive confirmation</strong>
            <span>
              Artist merges, contributor merges,
              permanent unused-record deletion, draft
              deletion, track deletion, and reopening a
              finalized workflow require a matching safety
              phrase.
            </span>
          </div>
          <div className="rc-safety-card">
            <strong>Mutation replay protection</strong>
            <span>
              High-impact browser requests receive a unique
              mutation ID. Replaying the same request is
              blocked by a database uniqueness guard.
            </span>
          </div>
          <div className="rc-safety-card">
            <strong>Startup profile gate</strong>
            <span>
              Production environment validation runs before
              Prisma migrations and again before the web
              process and operation worker are started.
            </span>
          </div>
          <div className="rc-safety-card">
            <strong>Background publication safety</strong>
            <span>
              Shopify publication work continues through the
              durable M16.2 operation-job path with its
              existing idempotency and deployment-profile
              isolation.
            </span>
          </div>
        </div>
      </s-section>

      <s-section heading="Recent protected mutations">
        {recentMutations.length ? (
          <div className="rc-directory-list">
            {recentMutations.map((mutation) => (
              <div
                className="rc-directory-row"
                key={mutation.id}
              >
                <div>
                  <strong>
                    {mutation.operation
                      .replaceAll("-", " ")
                      .replaceAll("_", " ")}
                  </strong>
                  <div className="rc-directory-row__meta">
                    {mutation.entityType ||
                      "ReleaseCore operation"}
                    {mutation.entityId
                      ? ` · ${mutation.entityId}`
                      : ""}
                    {` · Request ${mutation.requestReference}`}
                  </div>
                </div>
                <span className="rc-directory-row__aside">
                  {new Date(
                    mutation.createdAt,
                  ).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No protected mutations recorded yet">
            High-impact administrative writes will appear
            here after they are claimed by the production
            safety guard.
          </EmptyState>
        )}
      </s-section>

      <s-section>
        <div className="rc-operations-footer">
          <span>
            This page never exposes API secrets, database
            credentials, worker secrets, or signed storage
            URLs.
          </span>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);
