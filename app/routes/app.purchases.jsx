import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useFetcher,
  useLoaderData,
  useRevalidator,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import {
  listPurchasedMusicAdmin,
  rebuildPurchasedReleaseFiles,
  rebuildPurchasedTrackFiles,
} from "../lib/commerce-library.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return listPurchasedMusicAdmin({
    shop: session.shop,
    limit: 50,
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
    if (intent === "rebuild-track") {
      const trackId = String(formData.get("trackId") || "");
      const format = String(formData.get("format") || "");
      if (!trackId) {
        return {
          ok: false,
          error: "Choose a track to rebuild.",
        };
      }

      const result = await rebuildPurchasedTrackFiles({
        shop: session.shop,
        trackId,
        format: format || null,
      });

      return {
        ok: result.errors.length === 0,
        message: result.errors.length
          ? `${result.prepared} file(s) rebuilt; ${result.errors.length} failed.`
          : `${result.prepared} customer file(s) rebuilt.`,
        errors: result.errors,
      };
    }

    if (intent === "rebuild-release") {
      const releaseId = String(
        formData.get("releaseId") || "",
      );
      if (!releaseId) {
        return {
          ok: false,
          error: "Choose a release to rebuild.",
        };
      }

      const result = await rebuildPurchasedReleaseFiles({
        shop: session.shop,
        releaseId,
      });

      return {
        ok: result.errors.length === 0,
        message: result.errors.length
          ? `${result.prepared} file(s) rebuilt; ${result.errors.length} failed.`
          : `${result.prepared} customer file(s) rebuilt.`,
        errors: result.errors,
      };
    }

    return {
      ok: false,
      error: "Unknown purchased-music action.",
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "ReleaseCore could not update customer files.",
    };
  }
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function stateTone(state) {
  if (state === "READY") {
    return {
      background: "#eaf7ee",
      color: "#176c37",
    };
  }
  if (state === "STALE") {
    return {
      background: "#fff4df",
      color: "#8a5700",
    };
  }
  if (state === "NO_MASTER") {
    return {
      background: "#fdecec",
      color: "#9b1c1c",
    };
  }
  return {
    background: "#f1f1f1",
    color: "#525252",
  };
}

function Stat({ label, value }) {
  return (
    <div style={styles.stat}>
      <strong style={styles.statValue}>{value}</strong>
      <span style={styles.statLabel}>{label}</span>
    </div>
  );
}

function StatePill({ state }) {
  const palette = stateTone(state);
  return (
    <span
      style={{
        ...styles.statePill,
        ...palette,
      }}
    >
      {String(state || "MISSING").replaceAll("_", " ")}
    </span>
  );
}

function Feedback({ data }) {
  if (!data) return null;
  const good = data.ok;
  return (
    <div
      style={{
        ...styles.feedback,
        ...(good
          ? styles.feedbackGood
          : styles.feedbackBad),
      }}
    >
      {data.message || data.error}
      {data.errors?.length ? (
        <ul style={styles.errorList}>
          {data.errors.slice(0, 5).map((item) => (
            <li key={`${item.trackId}-${item.format}`}>
              {item.format.toUpperCase()}: {item.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function Purchases() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [copied, setCopied] = useState(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data?.ok, revalidator]);

  const releases = useMemo(() => {
    const map = new Map();
    for (const order of data.orders || []) {
      for (const entitlement of order.entitlements || []) {
        if (!map.has(entitlement.releaseId)) {
          map.set(entitlement.releaseId, {
            id: entitlement.releaseId,
            title: entitlement.releaseTitle,
          });
        }
      }
    }
    return [...map.values()];
  }, [data.orders]);

  const rebuild = (values) => {
    if (busy) return;
    fetcher.submit(values, { method: "post" });
  };

  const copyGuestUrl = async (order) => {
    if (!order.guestUrl) return;
    await navigator.clipboard.writeText(order.guestUrl);
    setCopied(order.id);
    window.setTimeout(() => setCopied(null), 1800);
  };

  return (
    <s-page heading="Purchases">
      <s-section>
        <div style={styles.hero}>
          <div>
            <div style={styles.eyebrow}>
              Digital purchase fulfillment
            </div>
            <div style={styles.heroTitle}>
              Purchased music and customer files.
            </div>
            <div style={styles.heroCopy}>
              Inspect paid-order entitlements, customer download
              history, derivative readiness and guest access.
              ReleaseCore never exposes the private WAV master to
              buyers.
            </div>
          </div>
        </div>
      </s-section>

      <Feedback data={fetcher.data} />

      <div style={styles.stats}>
        <Stat
          label="Orders"
          value={data.summary.orders}
        />
        <Stat
          label="Active entitlements"
          value={data.summary.activeEntitlements}
        />
        <Stat
          label="Revoked"
          value={data.summary.revokedEntitlements}
        />
        <Stat
          label="Downloads"
          value={data.summary.downloads}
        />
      </div>

      <s-section heading="Customer experience setup">
        <div style={styles.setupGrid}>
          <div style={styles.setupCard}>
            <strong>Online Store / guest purchases</strong>
            <p>
              Create a Shopify page using the handle{" "}
              <code>music-downloads</code>, then add the
              ReleaseCore <strong>Purchased music</strong> theme
              block. Signed-in storefront customers are detected
              automatically. Guest links use an order-specific
              signed token.
            </p>
          </div>
          <div style={styles.setupCard}>
            <strong>Customer Accounts</strong>
            <p>
              Add the ReleaseCore <strong>Music downloads</strong>
              full-page extension in Shopify&apos;s Checkout and
              accounts editor and add it to customer account
              navigation. The extension requires new customer
              accounts, protected customer-data access, and
              approved network access.
            </p>
          </div>
        </div>
      </s-section>

      {releases.length ? (
        <s-section heading="Customer file maintenance">
          <div style={styles.rebuildList}>
            {releases.map((release) => (
              <div key={release.id} style={styles.rebuildRow}>
                <span>{release.title}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    rebuild({
                      intent: "rebuild-release",
                      releaseId: release.id,
                    })
                  }
                  style={styles.secondaryButton}
                >
                  Rebuild release files
                </button>
              </div>
            ))}
          </div>
        </s-section>
      ) : null}

      <s-section heading="Recent purchase orders">
        {!data.orders?.length ? (
          <div style={styles.empty}>
            No ReleaseCore music purchases have been recorded yet.
          </div>
        ) : (
          <div style={styles.orderStack}>
            {data.orders.map((order) => (
              <article key={order.id} style={styles.orderCard}>
                <header style={styles.orderHeader}>
                  <div>
                    <div style={styles.orderTitle}>
                      {order.orderName}
                    </div>
                    <div style={styles.muted}>
                      {formatDate(order.paidAt)} ·{" "}
                      {order.customerId
                        ? `Customer ${order.customerId}`
                        : "Guest checkout"}{" "}
                      · {order.status}
                    </div>
                  </div>
                  {order.guestUrl ? (
                    <button
                      type="button"
                      onClick={() => copyGuestUrl(order)}
                      style={styles.secondaryButton}
                    >
                      {copied === order.id
                        ? "Copied"
                        : "Copy guest download link"}
                    </button>
                  ) : null}
                </header>

                <div style={styles.trackStack}>
                  {order.entitlements.map((entitlement) => (
                    <div
                      key={entitlement.id}
                      style={styles.trackRow}
                    >
                      <div style={styles.trackMain}>
                        {entitlement.coverUrl ? (
                          <img
                            src={entitlement.coverUrl}
                            alt=""
                            style={styles.cover}
                          />
                        ) : (
                          <div style={styles.coverPlaceholder}>
                            ♪
                          </div>
                        )}
                        <div style={{ minWidth: 0 }}>
                          <strong style={styles.trackTitle}>
                            {entitlement.trackTitle}
                            {entitlement.trackVersion
                              ? ` (${entitlement.trackVersion})`
                              : ""}
                          </strong>
                          <div style={styles.muted}>
                            {entitlement.releaseTitle} ·{" "}
                            {entitlement.sourceKind.replaceAll(
                              "_",
                              " ",
                            )}{" "}
                            · {entitlement.status}
                            {entitlement.revokeReason
                              ? ` · ${entitlement.revokeReason}`
                              : ""}
                          </div>
                          <div style={styles.formatRow}>
                            {entitlement.formats.length ? (
                              entitlement.formats.map((format) => (
                                <span
                                  key={format.format}
                                  style={styles.formatGroup}
                                >
                                  <strong>
                                    {format.format.toUpperCase()}
                                  </strong>
                                  <StatePill state={format.state} />
                                  {format.sizeBytes ? (
                                    <span style={styles.muted}>
                                      {formatBytes(
                                        format.sizeBytes,
                                      )}
                                    </span>
                                  ) : null}
                                </span>
                              ))
                            ) : (
                              <span style={styles.muted}>
                                Customer downloads disabled
                              </span>
                            )}
                          </div>
                          <div style={styles.muted}>
                            {entitlement.downloadCount} recorded
                            download
                            {entitlement.downloadCount === 1
                              ? ""
                              : "s"}
                            {entitlement.recentDownloads?.[0]
                              ? ` · Last ${formatDate(
                                  entitlement
                                    .recentDownloads[0]
                                    .downloadedAt,
                                )}`
                              : ""}
                          </div>
                        </div>
                      </div>

                      <div style={styles.trackActions}>
                        {entitlement.formats.map((format) => (
                          <button
                            key={format.format}
                            type="button"
                            disabled={
                              busy ||
                              format.state === "NO_MASTER"
                            }
                            onClick={() =>
                              rebuild({
                                intent: "rebuild-track",
                                trackId: entitlement.trackId,
                                format: format.format,
                              })
                            }
                            style={styles.secondaryButton}
                          >
                            Rebuild{" "}
                            {format.format.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);

const styles = {
  hero: {
    padding: "4px 0 8px",
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 750,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color: "#6d7175",
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: 750,
    lineHeight: 1.2,
    color: "#202223",
    marginBottom: 8,
  },
  heroCopy: {
    maxWidth: 820,
    color: "#6d7175",
    lineHeight: 1.5,
  },
  stats: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(150px,1fr))",
    gap: 12,
    margin: "16px 0",
  },
  stat: {
    border: "1px solid #e3e3e3",
    borderRadius: 14,
    padding: 16,
    background: "#fff",
    display: "grid",
    gap: 3,
  },
  statValue: {
    fontSize: 24,
    lineHeight: 1,
  },
  statLabel: {
    color: "#6d7175",
    fontSize: 12,
  },
  setupGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(260px,1fr))",
    gap: 12,
  },
  setupCard: {
    border: "1px solid #e3e3e3",
    borderRadius: 12,
    padding: 16,
    lineHeight: 1.5,
  },
  rebuildList: {
    display: "grid",
    gap: 8,
  },
  rebuildRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottom: "1px solid #eee",
    padding: "9px 0",
  },
  orderStack: {
    display: "grid",
    gap: 14,
  },
  orderCard: {
    border: "1px solid #dedede",
    borderRadius: 14,
    background: "#fff",
    overflow: "hidden",
  },
  orderHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottom: "1px solid #eee",
    flexWrap: "wrap",
  },
  orderTitle: {
    fontSize: 16,
    fontWeight: 750,
    marginBottom: 3,
  },
  trackStack: {
    display: "grid",
  },
  trackRow: {
    padding: 14,
    borderBottom: "1px solid #f0f0f0",
    display: "flex",
    gap: 14,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  trackMain: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flex: "1 1 440px",
    minWidth: 0,
  },
  cover: {
    width: 64,
    height: 64,
    borderRadius: 9,
    objectFit: "cover",
    flex: "0 0 auto",
  },
  coverPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 9,
    display: "grid",
    placeItems: "center",
    background: "#f1f1f1",
    fontSize: 22,
    flex: "0 0 auto",
  },
  trackTitle: {
    display: "block",
    fontSize: 14,
    marginBottom: 4,
  },
  muted: {
    fontSize: 12,
    color: "#6d7175",
    lineHeight: 1.4,
  },
  formatRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    margin: "7px 0",
  },
  formatGroup: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
  },
  statePill: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 20,
    borderRadius: 999,
    padding: "0 8px",
    fontSize: 10,
    fontWeight: 750,
  },
  trackActions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  secondaryButton: {
    appearance: "none",
    border: "1px solid #c9c9c9",
    borderRadius: 8,
    padding: "8px 11px",
    background: "#fff",
    color: "#202223",
    font: "inherit",
    fontSize: 12,
    fontWeight: 650,
    cursor: "pointer",
  },
  feedback: {
    margin: "12px 0",
    padding: "12px 14px",
    borderRadius: 10,
    fontSize: 13,
  },
  feedbackGood: {
    background: "#eaf7ee",
    color: "#176c37",
  },
  feedbackBad: {
    background: "#fdecec",
    color: "#9b1c1c",
  },
  errorList: {
    margin: "8px 0 0",
    paddingLeft: 18,
  },
  empty: {
    border: "1px dashed #c9c9c9",
    borderRadius: 12,
    padding: 22,
    color: "#6d7175",
  },
};
