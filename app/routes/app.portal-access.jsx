import { useEffect, useMemo, useState } from "react";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { authenticatedPost } from "../lib/authenticated-post";
import { customerNumericId } from "../lib/automations";
import { typeLabel } from "../lib/releasecore";
import {
  customerCanManageMultipleArtists,
  customerIsPortalMember,
  portalMultiArtistTag,
} from "../lib/portal-access-rules.server";
import {
  CollapsibleSection,
  PageIntro,
  ReleaseArtwork,
} from "../components/releasecore-ui";

async function listShopifyCustomers(admin) {
  const customers = [];
  let after = null;

  for (let page = 0; page < 20; page += 1) {
    const response = await admin.graphql(
      `#graphql
        query ReleaseCorePortalCustomers($after: String) {
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

    if (!connection?.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) break;
    after = connection.pageInfo.endCursor;
  }

  return customers;
}

function matchesQuery(customer, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [
    customer.displayName,
    customer.email,
    ...(customer.tags || []),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim();

  const [releases, artists, shopifyCustomers] = await Promise.all([
    db.release.findMany({
      where: { shop: session.shop },
      orderBy: { updatedAt: "desc" },
      take: 250,
      include: {
        artists: { include: { artist: true }, orderBy: { position: "asc" } },
        files: {
          where: { kind: "COVER_ART", trackId: null },
          select: { kind: true, url: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        _count: { select: { tracks: true } },
      },
    }),
    db.artist.findMany({
      where: { shop: session.shop },
      orderBy: { name: "asc" },
      take: 500,
    }),
    listShopifyCustomers(admin),
  ]);

  const customers = shopifyCustomers
    .filter((customer) => customerIsPortalMember(customer.tags))
    .filter((customer) => matchesQuery(customer, q))
    .map((customer) => ({
      ...customer,
      canManageMultipleArtists: customerCanManageMultipleArtists(customer.tags),
    }));

  const numericIds = customers
    .map((customer) => customerNumericId(customer.id))
    .filter(Boolean);

  const accesses = numericIds.length
    ? await db.portalArtistAccess.findMany({
        where: { shop: session.shop, customerId: { in: numericIds } },
        include: { artist: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return {
    releases,
    customers,
    artists,
    accesses,
    q,
    multiArtistTag: portalMultiArtistTag(),
  };
};

export default function PortalAccess() {
  const data = useLoaderData();
  const nav = useNavigate();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const [q, setQ] = useState(data.q || "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const accessMap = useMemo(() => {
    const map = new Map();
    for (const access of data.accesses || []) {
      const list = map.get(access.customerId) || [];
      list.push(access);
      map.set(access.customerId, list);
    }
    return map;
  }, [data.accesses]);

  const customerMap = useMemo(
    () =>
      new Map(
        (data.customers || [])
          .map((customer) => [customerNumericId(customer.id), customer])
          .filter(([id]) => id),
      ),
    [data.customers],
  );

  const releasesByCustomer = useMemo(() => {
    const map = new Map();
    for (const release of data.releases || []) {
      if (!release.ownerCustomerId) continue;
      const list = map.get(release.ownerCustomerId) || [];
      list.push(release);
      map.set(release.ownerCustomerId, list);
    }
    return map;
  }, [data.releases]);

  const search = (event) => {
    event.preventDefault();
    nav(
      `/app/portal-access${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`,
    );
  };

  const post = async (form) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await authenticatedPost(
        shopify,
        "/api/portal-access",
        form,
      );
      setNotice({ tone: "good", message: result.message });
      shopify.toast.show(result.message || "Portal access updated");
      await revalidator.revalidate();
    } catch (error) {
      setNotice({
        tone: "bad",
        message:
          error instanceof Error
            ? error.message
            : "Could not update portal access.",
      });
    } finally {
      setBusy(false);
    }
  };

  const assignReleaseOwner = (releaseId, customerId) => {
    const form = new FormData();
    form.set("intent", "assign-owner");
    form.set("releaseId", releaseId);
    form.set("customerId", customerId || "");
    return post(form);
  };

  const saveArtistAccess = (customerId, artistIds) => {
    const form = new FormData();
    form.set("intent", "save-artist-access");
    form.set("customerId", customerId);
    for (const artistId of artistIds) form.append("artistId", artistId);
    return post(form);
  };

  return (
    <s-page heading="Portal access">
      <s-section>
        <PageIntro
          eyebrow="Artist Portal permissions"
          title="Every portal member and the artists they can distribute for."
        >
          Eligible customers appear here automatically. Release ownership is
          automatic when a signed-in customer creates a release, while artist
          access persists independently.
        </PageIntro>
      </s-section>

      {notice ? (
        <s-section>
          <div
            className={`rc-notice ${
              notice.tone === "bad" ? "rc-notice--bad" : "rc-notice--good"
            }`}
          >
            {notice.message}
          </div>
        </s-section>
      ) : null}

      <s-section heading="Portal members">
        <form
          className="rc-admin-search"
          onSubmit={search}
          style={styles.search}
        >
          <input
            className="rc-control"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Filter by customer name, email or tag"
          />
          <button className="rc-button rc-button--primary">Filter</button>
          {data.q ? (
            <button
              type="button"
              className="rc-button rc-button--tertiary"
              onClick={() => {
                setQ("");
                nav("/app/portal-access");
              }}
            >
              Clear
            </button>
          ) : null}
        </form>

        <div style={styles.permissionHelp}>
          <strong>Artist permission tags</strong>
          <span>
            One artist is the default. Add <code>{data.multiArtistTag}</code> to
            a Shopify customer to allow access to multiple artist identities.
          </span>
        </div>

        {data.customers.length ? (
          <div style={styles.customerGrid}>
            {data.customers.map((customer) => {
              const numericId = customerNumericId(customer.id);
              return (
                <CustomerAccessCard
                  key={customer.id}
                  customer={customer}
                  artists={data.artists}
                  accesses={accessMap.get(numericId) || []}
                  ownedReleases={releasesByCustomer.get(numericId) || []}
                  multiArtistTag={data.multiArtistTag}
                  busy={busy}
                  onSave={(artistIds) =>
                    saveArtistAccess(customer.id, artistIds)
                  }
                />
              );
            })}
          </div>
        ) : (
          <div style={styles.empty}>
            {data.q
              ? "No portal members match this filter."
              : "No portal members were found."}
          </div>
        )}
      </s-section>

      <CollapsibleSection
        icon="artist"
        title="Release ownership"
        description="Customer-created releases are assigned automatically. Use this only to repair or transfer ownership."
        summary={`${data.releases.length} releases`}
      >
        <div style={styles.list}>
          {data.releases.map((release) => {
            const owner = release.ownerCustomerId
              ? customerMap.get(release.ownerCustomerId)
              : null;
            return (
              <div
                key={release.id}
                className="rc-portal-release-row"
                style={styles.row}
              >
                <div style={styles.releaseIdentity}>
                  <ReleaseArtwork release={release} />
                  <div style={{ minWidth: 0 }}>
                    <strong>{release.title}</strong>
                    <div style={styles.meta}>
                      {typeLabel(release.type)} · {release._count.tracks} track
                      {release._count.tracks === 1 ? "" : "s"} ·{" "}
                      {(release.artists || [])
                        .filter((item) => item.role === "PRIMARY")
                        .map((item) => item.artist?.name)
                        .filter(Boolean)
                        .join(", ") || "Artist not set"}
                    </div>
                    <div style={styles.meta}>
                      Portal owner:{" "}
                      {owner?.displayName ||
                        owner?.email ||
                        release.ownerCustomerId ||
                        "Not assigned"}
                    </div>
                  </div>
                </div>

                <div
                  className="rc-portal-release-actions"
                  style={styles.assign}
                >
                  <select
                    className="rc-control"
                    defaultValue={release.ownerCustomerId || ""}
                    key={`${release.id}:${release.ownerCustomerId || ""}`}
                  >
                    <option value="">Not assigned</option>
                    {data.customers.map((customer) => {
                      const numericId = customerNumericId(customer.id);
                      return (
                        <option key={customer.id} value={numericId}>
                          {customer.displayName || customer.email} —{" "}
                          {customer.email || "no email"}
                        </option>
                      );
                    })}
                  </select>
                  <button
                    type="button"
                    disabled={busy}
                    className="rc-button rc-button--primary"
                    onClick={(event) => {
                      const select =
                        event.currentTarget.previousElementSibling;
                      assignReleaseOwner(release.id, select?.value || "");
                    }}
                  >
                    Save owner
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </CollapsibleSection>
    </s-page>
  );
}

function CustomerAccessCard({
  customer,
  artists,
  accesses,
  ownedReleases,
  multiArtistTag,
  busy,
  onSave,
}) {
  const canManageMultiple = Boolean(customer.canManageMultipleArtists);
  const accessKey = (accesses || [])
    .map((access) => access.artistId)
    .sort()
    .join("|");
  const [selectedIds, setSelectedIds] = useState(
    (accesses || []).map((access) => access.artistId),
  );

  useEffect(() => {
    setSelectedIds(accessKey ? accessKey.split("|") : []);
  }, [accessKey]);

  const setSingleArtist = (artistId) => {
    setSelectedIds(artistId ? [artistId] : []);
  };

  const toggleArtist = (artistId) => {
    setSelectedIds((current) =>
      current.includes(artistId)
        ? current.filter((id) => id !== artistId)
        : [...current, artistId],
    );
  };

  return (
    <div className="rc-portal-customer-card" style={styles.customer}>
      <div style={styles.customerHeading}>
        <div>
          <strong>{customer.displayName || customer.email || "Customer"}</strong>
          <div style={styles.meta}>{customer.email || "No email"}</div>
        </div>
        <span style={styles.permissionBadge}>
          {canManageMultiple ? "Multiple artists" : "One artist"}
        </span>
      </div>

      <div style={styles.tags}>
        {(customer.tags || []).length
          ? (customer.tags || []).join(", ")
          : "No Shopify customer tags"}
      </div>

      <div style={styles.policyBox}>
        <div style={styles.label}>Artist access</div>

        {canManageMultiple ? (
          <div style={styles.artistChecklist}>
            {artists.map((artist) => (
              <label key={artist.id} style={styles.artistCheck}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(artist.id)}
                  onChange={() => toggleArtist(artist.id)}
                />
                <span>{artist.name}</span>
              </label>
            ))}
          </div>
        ) : (
          <select
            className="rc-control"
            value={selectedIds[0] || ""}
            onChange={(event) => setSingleArtist(event.target.value)}
          >
            <option value="">No artist assigned yet</option>
            {artists.map((artist) => (
              <option key={artist.id} value={artist.id}>
                {artist.name}
              </option>
            ))}
          </select>
        )}

        <div style={styles.meta}>
          {canManageMultiple
            ? `${multiArtistTag} allows this customer to distribute for multiple assigned artists.`
            : `Add ${multiArtistTag} to this Shopify customer before assigning more than one artist.`}
        </div>

        <button
          type="button"
          disabled={busy}
          className="rc-button"
          onClick={() => onSave(selectedIds)}
        >
          Save artist access
        </button>
      </div>

      <div style={styles.ownerSummary}>
        <strong>
          {ownedReleases.length} owned release
          {ownedReleases.length === 1 ? "" : "s"}
        </strong>
        {ownedReleases.length ? (
          <span>
            {ownedReleases
              .slice(0, 4)
              .map((release) => release.title)
              .join(" · ")}
            {ownedReleases.length > 4
              ? ` · +${ownedReleases.length - 4} more`
              : ""}
          </span>
        ) : (
          <span>No releases assigned yet.</span>
        )}
      </div>
    </div>
  );
}

export const headers = (args) => boundary.headers(args);

const styles = {
  search: { display: "flex", gap: 8, flexWrap: "wrap" },
  customerGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
    gap: 12,
    marginTop: 14,
  },
  customer: {
    display: "grid",
    gap: 10,
    padding: 14,
    border: "1px solid #dedede",
    borderRadius: 12,
  },
  customerHeading: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  permissionBadge: {
    border: "1px solid #d6d6d6",
    borderRadius: 999,
    padding: "5px 9px",
    fontSize: 11,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  permissionHelp: {
    display: "grid",
    gap: 4,
    marginTop: 14,
    padding: 12,
    borderRadius: 10,
    background: "#f6f6f7",
    fontSize: 12,
    color: "#4a4a4a",
  },
  tags: {
    color: "#6d7175",
    fontSize: 11,
    lineHeight: 1.45,
  },
  policyBox: {
    display: "grid",
    gap: 9,
    paddingTop: 10,
    borderTop: "1px solid #ededed",
  },
  label: {
    fontSize: 11,
    fontWeight: 700,
    color: "#5c5f62",
  },
  artistChecklist: {
    display: "grid",
    gap: 6,
    maxHeight: 220,
    overflowY: "auto",
    padding: 10,
    border: "1px solid #d8d8d8",
    borderRadius: 9,
    background: "#fff",
  },
  artistCheck: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    fontSize: 12,
  },
  ownerSummary: {
    display: "grid",
    gap: 4,
    paddingTop: 10,
    borderTop: "1px solid #ededed",
    fontSize: 11,
    color: "#6d7175",
  },
  list: { display: "grid", gap: 10 },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(240px,1fr) minmax(320px,.9fr)",
    gap: 20,
    padding: 12,
    border: "1px solid #dedede",
    borderRadius: 10,
    alignItems: "center",
  },
  releaseIdentity: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  assign: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  meta: {
    fontSize: 12,
    color: "#6d7175",
    marginTop: 4,
  },
  empty: {
    padding: 14,
    color: "#6d7175",
  },
};
