import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { PRIVACY_TOPICS } from "../lib/privacy";
import { PageIntro, StatusBadge } from "../components/releasecore-ui";

const topicLabel = (topic) => ({
  [PRIVACY_TOPICS.DATA_REQUEST]: "Customer data request",
  [PRIVACY_TOPICS.CUSTOMER_REDACT]: "Customer redaction",
  [PRIVACY_TOPICS.SHOP_REDACT]: "Shop redaction",
}[topic] || topic);

const statusTone = (status) => ({
  COMPLETED: "success",
  FAILED: "critical",
  PROCESSING: "info",
  PENDING: "warning",
}[status] || "neutral");

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const requests = await db.privacyRequest.findMany({
    where: { shop: session.shop },
    orderBy: { requestedAt: "desc" },
    take: 100,
    select: {
      id: true,
      topic: true,
      shopifyRequestId: true,
      customerId: true,
      customerEmail: true,
      status: true,
      attempts: true,
      lastError: true,
      requestedAt: true,
      processedAt: true,
    },
  });
  return { requests };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const requestId = String(formData.get("requestId") || "");
  const privacyRequest = await db.privacyRequest.findFirst({ where: { id: requestId, shop: session.shop } });
  if (!privacyRequest) return { ok: false, message: "Privacy request not found." };
  try {
    await db.privacyRequest.update({ where: { id: requestId }, data: { status: "PENDING", lastError: null } });
    const { processPrivacyRequestById } = await import("../lib/privacy.server");
    await processPrivacyRequestById(requestId);
    return { ok: true, message: "Privacy request processed." };
  } catch {
    return { ok: false, message: "ReleaseCore could not process this privacy request. Review the request status and retry." };
  }
};

export default function PrivacyPage() {
  const { requests } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const busyId = navigation.formData?.get("requestId") || null;

  return (
    <s-page heading="Privacy">
      <s-section>
        <PageIntro eyebrow="Compliance" title="Privacy requests">
          ReleaseCore records Shopify privacy requests, prepares customer-data exports, and processes required redactions. Completed customer data requests can be downloaded here and provided to the store owner.
        </PageIntro>
        {actionData?.message ? (
          <div className={`rc-notice ${actionData.ok ? "rc-notice--good" : "rc-notice--bad"}`} style={{ marginTop: 16 }}>
            {actionData.message}
          </div>
        ) : null}
      </s-section>

      <s-section heading={`Requests (${requests.length})`}>
        <div style={styles.list}>
          {requests.length ? requests.map((item) => {
            const canDownload = item.topic === PRIVACY_TOPICS.DATA_REQUEST && item.status === "COMPLETED";
            const canRetry = item.status === "FAILED" || item.status === "PENDING";
            return (
              <article key={item.id} style={styles.card}>
                <div style={styles.head}>
                  <div>
                    <strong>{topicLabel(item.topic)}</strong>
                    <div style={styles.meta}>Shopify request {item.shopifyRequestId} · {new Date(item.requestedAt).toLocaleString()}</div>
                  </div>
                  <StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge>
                </div>

                {item.customerEmail || item.customerId ? (
                  <div style={styles.customer}>
                    <span>{item.customerEmail || "Customer"}</span>
                    {item.customerId ? <span style={styles.meta}>Customer ID {item.customerId}</span> : null}
                  </div>
                ) : null}

                {item.lastError ? <div className="rc-notice rc-notice--bad">{item.lastError}</div> : null}

                <div style={styles.actions}>
                  {canDownload ? (
                    <a className="rc-button rc-button--primary" href={`/app/privacy/${item.id}`}>
                      Download customer data
                    </a>
                  ) : null}
                  {canRetry ? (
                    <Form method="post">
                      <input type="hidden" name="requestId" value={item.id} />
                      <button className="rc-button" type="submit" disabled={busyId === item.id}>
                        {busyId === item.id ? "Processing…" : "Retry request"}
                      </button>
                    </Form>
                  ) : null}
                  {item.processedAt ? <span style={styles.meta}>Completed {new Date(item.processedAt).toLocaleString()}</span> : null}
                </div>
              </article>
            );
          }) : (
            <div className="rc-empty-state">
              <strong className="rc-empty-state__title">No privacy requests</strong>
              <div className="rc-empty-state__copy">Shopify compliance requests will appear here when received.</div>
            </div>
          )}
        </div>
      </s-section>
    </s-page>
  );
}

const styles = {
  list: { display: "grid", gap: 12 },
  card: { border: "1px solid var(--rc-border)", borderRadius: "var(--rc-radius-lg)", padding: 16, display: "grid", gap: 12, background: "var(--rc-surface)" },
  head: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  meta: { color: "var(--rc-muted)", fontSize: 13, marginTop: 3 },
  customer: { display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" },
  actions: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
};
