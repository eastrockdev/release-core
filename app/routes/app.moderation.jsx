import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { customerNumericId } from "../lib/automations";
import { customerIsPortalMember } from "../lib/portal-access-rules.server";
import {
  PORTAL_EDIT_LOCK_STATUS,
  PORTAL_EDIT_LOCK_TYPE,
  customerReleaseCreationDisabled,
  releaseCreationDisabledTag,
  setCustomerReleaseCreationDisabled,
  setReleaseArtistEditLock,
} from "../lib/moderation.server";
import { apiErrorResponse } from "../lib/http-security.server";
import { PageIntro } from "../components/releasecore-ui";
import { typeLabel } from "../lib/releasecore";

async function listShopifyCustomers(admin) {
  const customers = [];
  let after = null;

  for (let page = 0; page < 20; page += 1) {
    const response = await admin.graphql(
      `#graphql
        query ReleaseCoreModerationCustomers($after: String) {
          customers(first: 100, after: $after, sortKey: UPDATED_AT, reverse: true) {
            nodes { id displayName email tags }
            pageInfo { hasNextPage endCursor }
          }
        }
      `,
      { variables: { after } },
    );
    const json = await response.json();
    const connection = json?.data?.customers;
    customers.push(...(connection?.nodes || []));
    if (!connection?.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) {
      break;
    }
    after = connection.pageInfo.endCursor;
  }

  return customers;
}

function includesQuery(values, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return values
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim();

  const [shopifyCustomers, releases, locks] = await Promise.all([
    listShopifyCustomers(admin),
    db.release.findMany({
      where: { shop: session.shop },
      orderBy: { updatedAt: "desc" },
      take: 300,
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        distributionStatus: true,
        ownerCustomerId: true,
        updatedAt: true,
        artists: {
          where: { role: "PRIMARY" },
          orderBy: { position: "asc" },
          select: {
            artist: { select: { id: true, name: true } },
          },
        },
      },
    }),
    db.releaseLifecycleRequest.findMany({
      where: {
        shop: session.shop,
        type: PORTAL_EDIT_LOCK_TYPE,
        status: PORTAL_EDIT_LOCK_STATUS,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        releaseId: true,
        reason: true,
        createdAt: true,
      },
    }),
  ]);

  const lockByRelease = new Map();
  for (const lock of locks) {
    if (!lockByRelease.has(lock.releaseId)) {
      lockByRelease.set(lock.releaseId, lock);
    }
  }

  const customers = shopifyCustomers
    .filter((customer) => customerIsPortalMember(customer.tags))
    .map((customer) => ({
      id: customer.id,
      numericId: customerNumericId(customer.id),
      displayName: customer.displayName,
      email: customer.email,
      tags: customer.tags || [],
      releaseCreationDisabled: customerReleaseCreationDisabled(customer.tags),
    }))
    .filter((customer) =>
      includesQuery(
        [customer.displayName, customer.email, ...(customer.tags || [])],
        q,
      ),
    );

  const moderatedReleases = releases
    .map((release) => ({
      ...release,
      lock: lockByRelease.get(release.id) || null,
      primaryArtists: release.artists
        .map((item) => item.artist?.name)
        .filter(Boolean),
    }))
    .filter((release) =>
      includesQuery(
        [
          release.title,
          release.type,
          release.status,
          release.ownerCustomerId,
          ...release.primaryArtists,
        ],
        q,
      ),
    );

  return {
    q,
    customers,
    releases: moderatedReleases,
    restrictionTag: releaseCreationDisabledTag(),
    totals: {
      usersBlocked: customers.filter((item) => item.releaseCreationDisabled).length,
      releasesLocked: moderatedReleases.filter((item) => item.lock).length,
    },
  };
};

export const action = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const form = await request.formData();
    const intent = String(form.get("intent") || "");

    if (intent === "set-release-creation") {
      const disabled = String(form.get("disabled") || "false") === "true";
      const result = await setCustomerReleaseCreationDisabled({
        admin,
        customerId: form.get("customerId"),
        disabled,
      });
      return {
        ok: true,
        message: disabled
          ? `Release creation disabled for customer ${result.customerId}.`
          : `Release creation restored for customer ${result.customerId}.`,
      };
    }

    if (intent === "set-release-lock") {
      const locked = String(form.get("locked") || "false") === "true";
      const releaseId = String(form.get("releaseId") || "");
      await setReleaseArtistEditLock({
        shop: session.shop,
        releaseId,
        locked,
        reason: form.get("reason"),
        actorLabel: "Shopify admin",
      });
      return {
        ok: true,
        message: locked
          ? "Artist editing locked for this release."
          : "Artist editing unlocked for this release.",
      };
    }

    return {
      ok: false,
      message: "Unknown moderation action.",
    };
  } catch (error) {
    const response = apiErrorResponse(request, error, {
      context: "moderation mutation",
      fallback: "ReleaseCore could not update moderation controls.",
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: false,
      message: payload.error || "ReleaseCore could not update moderation controls.",
    };
  }
};

export default function Moderation() {
  const data = useLoaderData();
  const result = useActionData();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <s-page heading="Moderation">
      <s-section>
        <PageIntro
          eyebrow="Artist Portal controls"
          title="Control release access without changing the catalog."
        >
          Freeze artist editing on an individual release or stop a portal user
          from creating new releases. These controls do not prevent Shopify
          administrators from managing the catalog inside ReleaseCore.
        </PageIntro>
      </s-section>

      {result?.message ? (
        <s-section>
          <div
            className={`rc-notice ${result.ok ? "rc-notice--good" : "rc-notice--bad"}`}
            role="status"
          >
            {result.message}
          </div>
        </s-section>
      ) : null}

      <s-section>
        <Form method="get" style={styles.search}>
          <input
            className="rc-control"
            name="q"
            defaultValue={data.q}
            placeholder="Search users, artists or releases"
          />
          <button className="rc-button rc-button--primary" type="submit">
            Search
          </button>
          {data.q ? (
            <a className="rc-button rc-button--tertiary" href="/app/moderation">
              Clear
            </a>
          ) : null}
        </Form>
      </s-section>

      <s-section heading="User release creation">
        <div style={styles.sectionIntro}>
          <strong>{data.totals.usersBlocked} restricted</strong>
          <span>
            Blocking a user adds the <code>{data.restrictionTag}</code> customer
            tag and disables every release type in the Artist Portal.
          </span>
        </div>

        {data.customers.length ? (
          <div style={styles.cardGrid}>
            {data.customers.map((customer) => (
              <article key={customer.id} style={styles.card}>
                <div style={styles.cardHeader}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={styles.cardTitle}>
                      {customer.displayName || "Shopify customer"}
                    </strong>
                    <span style={styles.meta}>{customer.email || customer.numericId}</span>
                  </div>
                  <span
                    className={`rc-status-badge ${
                      customer.releaseCreationDisabled
                        ? "rc-status-badge--bad"
                        : "rc-status-badge--good"
                    }`}
                  >
                    {customer.releaseCreationDisabled ? "Creation disabled" : "Creation allowed"}
                  </span>
                </div>

                <p style={styles.copy}>
                  {customer.releaseCreationDisabled
                    ? "This user can view and manage releases they already have access to, but cannot create another release."
                    : "This user can create releases according to their normal ReleaseCore tier and release-type permissions."}
                </p>

                <Form method="post">
                  <input type="hidden" name="intent" value="set-release-creation" />
                  <input type="hidden" name="customerId" value={customer.id} />
                  <input
                    type="hidden"
                    name="disabled"
                    value={customer.releaseCreationDisabled ? "false" : "true"}
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className={
                      customer.releaseCreationDisabled
                        ? "rc-button rc-button--primary"
                        : "rc-button rc-button--danger"
                    }
                  >
                    {customer.releaseCreationDisabled
                      ? "Restore release creation"
                      : "Disable release creation"}
                  </button>
                </Form>
              </article>
            ))}
          </div>
        ) : (
          <div style={styles.empty}>No eligible Artist Portal users match this filter.</div>
        )}
      </s-section>

      <s-section heading="Release artist editing">
        <div style={styles.sectionIntro}>
          <strong>{data.totals.releasesLocked} locked</strong>
          <span>
            A locked release stays visible to the artist, but its release fields,
            tracks, credits and uploads become read only and portal mutations are rejected server-side.
          </span>
        </div>

        {data.releases.length ? (
          <div style={styles.releaseList}>
            {data.releases.map((release) => (
              <article key={release.id} style={styles.releaseRow}>
                <div style={styles.releaseIdentity}>
                  <div style={styles.releaseMark} aria-hidden="true">
                    {release.lock ? "🔒" : "♪"}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <strong style={styles.cardTitle}>{release.title || "Untitled Release"}</strong>
                    <span style={styles.meta}>
                      {typeLabel(release.type)} · {release.primaryArtists.join(", ") || "Artist not assigned"} · {String(release.status || "DRAFT").replaceAll("_", " ")}
                    </span>
                    {release.lock?.reason ? (
                      <span style={styles.lockReason}>{release.lock.reason}</span>
                    ) : null}
                  </div>
                </div>

                <Form method="post" style={styles.lockForm}>
                  <input type="hidden" name="intent" value="set-release-lock" />
                  <input type="hidden" name="releaseId" value={release.id} />
                  {release.lock ? (
                    <>
                      <input type="hidden" name="locked" value="false" />
                      <button
                        type="submit"
                        disabled={busy}
                        className="rc-button rc-button--primary"
                      >
                        Unlock artist editing
                      </button>
                    </>
                  ) : (
                    <>
                      <input type="hidden" name="locked" value="true" />
                      <input
                        className="rc-control"
                        name="reason"
                        placeholder="Optional reason shown if a blocked save is attempted"
                      />
                      <button
                        type="submit"
                        disabled={busy}
                        className="rc-button rc-button--danger"
                      >
                        Lock artist editing
                      </button>
                    </>
                  )}
                </Form>
              </article>
            ))}
          </div>
        ) : (
          <div style={styles.empty}>No releases match this filter.</div>
        )}
      </s-section>
    </s-page>
  );
}

const styles = {
  search: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 1fr) auto auto",
    gap: 10,
    alignItems: "center",
  },
  sectionIntro: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "baseline",
    marginBottom: 14,
    color: "#666",
  },
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: 12,
  },
  card: {
    border: "1px solid #e3e3e3",
    borderRadius: 14,
    padding: 16,
    background: "#fff",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  cardTitle: {
    display: "block",
    fontSize: 15,
    lineHeight: 1.35,
  },
  meta: {
    display: "block",
    marginTop: 4,
    color: "#6b6b6b",
    fontSize: 13,
    lineHeight: 1.45,
  },
  copy: {
    color: "#666",
    fontSize: 13,
    lineHeight: 1.55,
    margin: "12px 0 14px",
  },
  releaseList: {
    display: "grid",
    gap: 10,
  },
  releaseRow: {
    display: "grid",
    gridTemplateColumns: "minmax(260px, 1fr) minmax(280px, 420px)",
    gap: 16,
    alignItems: "center",
    border: "1px solid #e3e3e3",
    borderRadius: 14,
    padding: 14,
    background: "#fff",
  },
  releaseIdentity: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    minWidth: 0,
  },
  releaseMark: {
    width: 40,
    height: 40,
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    background: "#f3f3f3",
    flex: "0 0 auto",
  },
  lockForm: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 8,
    alignItems: "center",
  },
  lockReason: {
    display: "block",
    marginTop: 6,
    color: "#8a5700",
    fontSize: 12,
    lineHeight: 1.4,
  },
  empty: {
    border: "1px dashed #d2d2d2",
    borderRadius: 14,
    padding: 22,
    color: "#777",
    textAlign: "center",
  },
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
