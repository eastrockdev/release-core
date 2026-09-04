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
  listCustomerReleaseCreationPolicies,
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
        ownerCustomerId: true,
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

  const portalCustomers = shopifyCustomers.filter((customer) =>
    customerIsPortalMember(customer.tags),
  );
  const customerPolicies = await listCustomerReleaseCreationPolicies({
    shop: session.shop,
    customerIds: portalCustomers.map((customer) => customer.id),
  });

  const customers = portalCustomers
    .map((customer) => {
      const numericId = customerNumericId(customer.id);
      const policy = customerPolicies.get(numericId) || {
        disabled: false,
        reason: null,
      };
      return {
        id: customer.id,
        numericId,
        displayName: customer.displayName,
        email: customer.email,
        tags: customer.tags || [],
        releaseCreationDisabled: Boolean(policy.disabled),
        releaseCreationDisabledReason: policy.reason || null,
      };
    })
    .filter((customer) =>
      includesQuery(
        [customer.displayName, customer.email, ...(customer.tags || [])],
        q,
      ),
    );

  const lockByRelease = new Map();
  for (const lock of locks) {
    if (!lockByRelease.has(lock.releaseId)) {
      lockByRelease.set(lock.releaseId, lock);
    }
  }

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
          release.id,
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
    totals: {
      usersBlocked: customers.filter((item) => item.releaseCreationDisabled)
        .length,
      releasesLocked: moderatedReleases.filter((item) => item.lock).length,
    },
  };
};

export const action = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    const form = await request.formData();
    const intent = String(form.get("intent") || "");

    if (intent === "set-release-creation") {
      const disabled = String(form.get("disabled") || "false") === "true";
      const result = await setCustomerReleaseCreationDisabled({
        shop: session.shop,
        customerId: form.get("customerId"),
        disabled,
        reason: form.get("reason"),
        actorLabel: "Shopify admin",
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
      message:
        payload.error ||
        "ReleaseCore could not update moderation controls.",
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
          title="Control artist release access without changing the catalog."
        >
          Freeze artist editing on an individual release or stop a portal user
          from creating new releases. Shopify administrators keep full
          ReleaseCore access in either state.
        </PageIntro>
      </s-section>

      {result?.message ? (
        <s-section>
          <div
            className={`rc-notice ${
              result.ok ? "rc-notice--good" : "rc-notice--bad"
            }`}
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
            Restrictions are stored and audited inside ReleaseCore. They do not
            require changing Shopify customer tags or app permissions.
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
                    <span style={styles.meta}>
                      {customer.email || customer.numericId}
                    </span>
                  </div>
                  <span
                    className={`rc-status-badge ${
                      customer.releaseCreationDisabled
                        ? "rc-status-badge--bad"
                        : "rc-status-badge--good"
                    }`}
                  >
                    {customer.releaseCreationDisabled
                      ? "Creation disabled"
                      : "Creation allowed"}
                  </span>
                </div>

                <p style={styles.copy}>
                  {customer.releaseCreationDisabled
                    ? "This user can still view and manage releases they already have access to, but cannot create another release."
                    : "This user can create releases according to their normal ReleaseCore tier and release-type permissions."}
                </p>

                {customer.releaseCreationDisabledReason ? (
                  <div style={styles.reasonBox}>
                    {customer.releaseCreationDisabledReason}
                  </div>
                ) : null}

                <Form method="post" style={styles.customerAction}>
                  <input
                    type="hidden"
                    name="intent"
                    value="set-release-creation"
                  />
                  <input
                    type="hidden"
                    name="customerId"
                    value={customer.id}
                  />
                  <input
                    type="hidden"
                    name="disabled"
                    value={customer.releaseCreationDisabled ? "false" : "true"}
                  />
                  {!customer.releaseCreationDisabled ? (
                    <input
                      className="rc-control"
                      name="reason"
                      placeholder="Optional moderation reason"
                    />
                  ) : null}
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
          <div style={styles.empty}>
            No eligible Artist Portal users match this filter.
          </div>
        )}
      </s-section>

      <s-section heading="Release artist editing">
        <div style={styles.sectionIntro}>
          <strong>{data.totals.releasesLocked} locked</strong>
          <span>
            A locked release stays visible to the artist, but release fields,
            tracks, credits and uploads render read only and portal mutations
            are rejected server-side.
          </span>
        </div>

        {data.releases.length ? (
          <div style={styles.releaseList}>
            {data.releases.map((release) => (
              <article key={release.id} style={styles.releaseRow}>
                <div style={styles.releaseIdentity}>
                  <div style={styles.releaseMark} aria-hidden="true">
                    {release.lock ? "Locked" : "Open"}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <strong style={styles.cardTitle}>
                      {release.title || "Untitled Release"}
                    </strong>
                    <span style={styles.meta}>
                      {typeLabel(release.type)} ·{" "}
                      {release.primaryArtists.join(", ") ||
                        "Artist not assigned"}{" "}
                      · {String(release.status || "DRAFT").replaceAll("_", " ")}
                    </span>
                    {release.lock?.reason ? (
                      <span style={styles.lockReason}>
                        {release.lock.reason}
                      </span>
                    ) : null}
                  </div>
                </div>

                <Form method="post" style={styles.lockForm}>
                  <input
                    type="hidden"
                    name="intent"
                    value="set-release-lock"
                  />
                  <input
                    type="hidden"
                    name="releaseId"
                    value={release.id}
                  />
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
                        placeholder="Optional reason shown on blocked changes"
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
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
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
  reasonBox: {
    borderRadius: 10,
    padding: "9px 10px",
    marginBottom: 12,
    background: "#fff4df",
    color: "#765000",
    fontSize: 12,
    lineHeight: 1.45,
  },
  customerAction: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },
  releaseList: {
    display: "grid",
    gap: 10,
  },
  releaseRow: {
    display: "flex",
    gap: 16,
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    border: "1px solid #e3e3e3",
    borderRadius: 14,
    padding: 14,
    background: "#fff",
  },
  releaseIdentity: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    minWidth: 260,
    flex: "1 1 340px",
  },
  releaseMark: {
    minWidth: 52,
    height: 36,
    padding: "0 9px",
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    background: "#f3f3f3",
    color: "#555",
    fontSize: 11,
    fontWeight: 700,
    flex: "0 0 auto",
  },
  lockForm: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
    flex: "1 1 340px",
    justifyContent: "flex-end",
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
