import { useState } from "react";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { authenticatedPost } from "../lib/authenticated-post";
import { AUTOMATION_CHANNELS, normalizeEventKey } from "../lib/automations";
import { PageIntro, ReleaseArtwork, StatusBadge } from "../components/releasecore-ui";
import { safeDiagnosticText } from "../lib/http-security.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const events = await db.submissionEvent.findMany({
    where: { release: { shop: session.shop } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      release: {
        select: {
          id: true,
          title: true,
          type: true,
          ownerCustomerId: true,
          files: {
            where: { kind: "COVER_ART", trackId: null },
            select: { kind: true, url: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
      deliveries: true,
    },
  });

  return {
    events: events.map((event) => ({
      ...event,
      deliveries: event.deliveries.map((delivery) => ({
        ...delivery,
        lastError: delivery.lastError ? safeDiagnosticText(delivery.lastError, 600) : null,
      })),
    })),
  };
};

const channelLabel = (channel) => ({
  ARTIST_EMAIL: "Artist email",
  ADMIN_EMAIL: "Internal email",
  SHOPIFY_FLOW: "Shopify Flow",
}[channel] || channel);

const deliveryLabel = (status) => ({
  SENT: "Sent",
  FAILED: "Failed",
  PENDING: "Pending",
  SKIPPED: "Not sent",
}[status] || String(status || "Unknown").toLowerCase().replace(/_/g, " "));

const deliveryTone = (status) => {
  if (status === "SENT") return "good";
  if (status === "FAILED") return "critical";
  if (status === "PENDING") return "warning";
  return "neutral";
};

export default function Notifications() {
  const { events } = useLoaderData();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const retry = async (eventId, channel) => {
    const key = `${eventId}:${channel}`;
    setBusy(key);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("eventId", eventId);
      form.set("channel", channel);
      const response = await authenticatedPost(shopify, "/api/notifications", form);
      setNotice({ tone: "good", message: response.message });
      await revalidator.revalidate();
    } catch (error) {
      setNotice({ tone: "bad", message: error.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <s-page heading="Notifications">
      <s-button slot="primary-action" variant="primary" onClick={() => navigate("/app/settings/email")}>Email settings</s-button>

      <s-section>
        <PageIntro
          title="Review messages sent by ReleaseCore."
          actions={<s-button onClick={() => navigate("/app/settings/email")}>Email settings</s-button>}
        >
          See what was sent to artists and your team, confirm Shopify Flow triggers, and retry an individual delivery when something fails.
        </PageIntro>
      </s-section>

      {notice ? (
        <s-section>
          <div className={`rc-notice ${notice.tone === "good" ? "rc-notice--good" : "rc-notice--bad"}`}>{notice.message}</div>
        </s-section>
      ) : null}

      <s-section heading="Delivery history">
        <div style={styles.list}>
          {events.length ? events.map((event) => (
            <article key={event.id} style={styles.event}>
              <div style={styles.eventHead}>
                <div style={styles.releaseHead}>
                  <ReleaseArtwork release={event.release} size="small" />
                  <div>
                    <strong>{event.release.title}</strong>
                    <div style={styles.meta}>{normalizeEventKey(event.type)} · {new Date(event.createdAt).toLocaleString()}</div>
                  </div>
                </div>
                <div style={styles.meta}>{event.actorLabel || "ReleaseCore"}</div>
              </div>

              {event.message ? <div style={styles.message}>{event.message}</div> : null}

              <div style={styles.deliveryGrid}>
                {Object.values(AUTOMATION_CHANNELS).map((channel) => {
                  const delivery = event.deliveries.find((item) => item.channel === channel);
                  const status = delivery?.status || null;
                  return (
                    <div key={channel} className="rc-notification-delivery" style={styles.delivery}>
                      <div>
                        <strong>{channelLabel(channel)}</strong>
                        <div style={styles.statusLine}>
                          {delivery ? <StatusBadge tone={deliveryTone(status)}>{deliveryLabel(status)}</StatusBadge> : <StatusBadge tone="neutral">Not triggered</StatusBadge>}
                          {delivery ? <span style={styles.meta}>{delivery.attempts} attempt{delivery.attempts === 1 ? "" : "s"}</span> : null}
                        </div>
                        {delivery?.lastError ? <div style={styles.error}>{delivery.lastError}</div> : null}
                      </div>
                      <button
                        type="button"
                        className="rc-button rc-button--compact"
                        disabled={busy === `${event.id}:${channel}`}
                        onClick={() => retry(event.id, channel)}
                      >
                        {status === "SENT" ? "Send again" : "Retry"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </article>
          )) : (
            <div style={styles.empty}>No notification activity yet.</div>
          )}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (args) => boundary.headers(args);

const styles = {
  list: { display: "grid", gap: 12 },
  event: { padding: 13, border: "1px solid #dedede", borderRadius: 12, background: "#fff" },
  eventHead: { display: "flex", justifyContent: "space-between", gap: 12 },
  releaseHead: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  message: { fontSize: 13, marginTop: 10, color: "#444" },
  deliveryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8, marginTop: 14 },
  delivery: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: 10, border: "1px solid #eee", borderRadius: 9, background: "#fafafa" },
  statusLine: { display: "flex", alignItems: "center", gap: 8, marginTop: 6 },
  meta: { fontSize: 12, color: "#6d7175", marginTop: 3 },
  error: { fontSize: 11, color: "#a21b12", marginTop: 6, maxWidth: 340 },
  empty: { padding: 18, color: "#6d7175" },
};
