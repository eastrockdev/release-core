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
  customerIsPortalMember,
  portalMultiArtistTag,
} from "../lib/portal-access-rules.server";
import {
  normalizePortalLabelPlans,
  resolvePortalLabelPlan,
} from "../lib/portal-labels.server";
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
        query ReleaseCoreUsersLabelsCustomers($after: String) {
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

  const [releases, artists, shopifyCustomers, settings, labels] =
    await Promise.all([
      db.release.findMany({
        where: { shop: session.shop },
        orderBy: { updatedAt: "desc" },
        take: 250,
        include: {
          artists: {
            include: { artist: true },
            orderBy: { position: "asc" },
          },
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
      db.appSettings.findUnique({
        where: { shop: session.shop },
      }),
      db.portalLabelAccount.findMany({
        where: { shop: session.shop },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

  const labelMap = new Map(
    labels.map((label) => [label.customerId, label]),
  );

  const customers = shopifyCustomers
    .filter((customer) => customerIsPortalMember(customer.tags))
    .filter((customer) => matchesQuery(customer, q))
    .map((customer) => {
      const numericId = customerNumericId(customer.id);
      const plan = resolvePortalLabelPlan({
        tags: customer.tags,
        settings: settings || {},
      });
      const label = numericId ? labelMap.get(numericId) : null;
      return {
        ...customer,
        numericId,
        labelPlan: plan,
        label: label
          ? {
              id: label.id,
              name: label.name,
              sourceTag: label.sourceTag,
            }
          : null,
      };
    });

  const numericIds = customers
    .map((customer) => customer.numericId)
    .filter(Boolean);

  const accesses = numericIds.length
    ? await db.portalArtistAccess.findMany({
        where: {
          shop: session.shop,
          customerId: { in: numericIds },
        },
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
    labelPlans: normalizePortalLabelPlans(settings?.portalLabelPlans),
    multiArtistTag: portalMultiArtistTag(),
  };
};

export default function UsersAndLabels() {
  const data = useLoaderData();
  const nav = useNavigate();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const [q, setQ] = useState(data.q || "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [plans, setPlans] = useState(
    data.labelPlans?.length
      ? data.labelPlans
      : [{ tag: data.multiArtistTag, maxArtists: 5 }],
  );

  useEffect(() => {
    if (data.labelPlans?.length) setPlans(data.labelPlans);
  }, [data.labelPlans]);

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
          .map((customer) => [customer.numericId, customer])
          .filter(([id]) => id),
      ),
    [data.customers],
  );

  const releasesByCustomer = useMemo(() => {
    const map = new Map();
    const customersByArtist = new Map();

    for (const access of data.accesses || []) {
      const customerIds =
        customersByArtist.get(access.artistId) || new Set();
      customerIds.add(access.customerId);
      customersByArtist.set(access.artistId, customerIds);
    }

    for (const release of data.releases || []) {
      const visibleCustomerIds = new Set();
      if (release.ownerCustomerId) {
        visibleCustomerIds.add(release.ownerCustomerId);
      }

      for (const assignment of release.artists || []) {
        if (assignment.role !== "PRIMARY") continue;
        for (const customerId of
          customersByArtist.get(assignment.artistId) || []) {
          visibleCustomerIds.add(customerId);
        }
      }

      for (const customerId of visibleCustomerIds) {
        const list = map.get(customerId) || [];
        list.push(release);
        map.set(customerId, list);
      }
    }

    return map;
  }, [data.accesses, data.releases]);

  const search = (event) => {
    event.preventDefault();
    nav(
      `/app/portal-access${
        q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""
      }`,
    );
  };

  const post = async (form) => {
    if (busy) return null;
    setBusy(true);
    setNotice(null);
    try {
      const result = await authenticatedPost(
        shopify,
        "/api/portal-access",
        form,
      );
      setNotice({ tone: "good", message: result.message });
      shopify.toast.show(
        result.message || "Users & Labels updated",
      );
      await revalidator.revalidate();
      return result;
    } catch (error) {
      setNotice({
        tone: "bad",
        message:
          error instanceof Error
            ? error.message
            : "Could not update Users & Labels.",
      });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const savePlans = () => {
    const form = new FormData();
    form.set("intent", "save-label-plans");
    form.set("plans", JSON.stringify(plans));
    return post(form);
  };

  const saveArtistAccess = (customerId, artistIds) => {
    const form = new FormData();
    form.set("intent", "save-artist-access");
    form.set("customerId", customerId);
    for (const artistId of artistIds) {
      form.append("artistId", artistId);
    }
    return post(form);
  };

  const saveLabelName = (customerId, name) => {
    const form = new FormData();
    form.set("intent", "save-label-name");
    form.set("customerId", customerId);
    form.set("name", name);
    return post(form);
  };

  const assignReleaseOwner = (releaseId, customerId) => {
    const form = new FormData();
    form.set("intent", "assign-owner");
    form.set("releaseId", releaseId);
    form.set("customerId", customerId || "");
    return post(form);
  };

  const addPlan = () => {
    setPlans((current) => [
      ...current,
      { tag: "", maxArtists: 5 },
    ]);
  };

  const updatePlan = (index, patch) => {
    setPlans((current) =>
      current.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    );
  };

  const removePlan = (index) => {
    setPlans((current) =>
      current.filter((_, i) => i !== index),
    );
  };

  return (
    <s-page heading="Users & Labels">
      <s-section>
        <PageIntro
          eyebrow="Artist Portal access"
          title="Users, artist teams and independent labels."
        >
          Single-artist customers stay focused on one identity.
          Customers with a configured label tag become team/label
          accounts, can build a roster up to the limit attached to
          that tag, and can use their own label name as a release
          label and ℗ line where allowed.
        </PageIntro>
      </s-section>

      {notice ? (
        <s-section>
          <div
            className={`rc-notice ${
              notice.tone === "bad"
                ? "rc-notice--bad"
                : "rc-notice--good"
            }`}
          >
            {notice.message}
          </div>
        </s-section>
      ) : null}

      <s-section heading="Label access tiers">
        <div style={styles.intro}>
          A Shopify customer becomes a label/team account when one
          of these tags is present. If multiple configured tags match,
          ReleaseCore uses the highest artist limit.
        </div>

        <div style={styles.planList}>
          {plans.map((plan, index) => (
            <div key={index} style={styles.planRow}>
              <label style={styles.field}>
                <span>Shopify customer tag</span>
                <input
                  className="rc-control"
                  value={plan.tag}
                  placeholder="RLIAB_MULTI_ARTIST"
                  onChange={(event) =>
                    updatePlan(index, {
                      tag: event.target.value,
                    })
                  }
                />
              </label>
              <label style={styles.field}>
                <span>Maximum artists</span>
                <input
                  className="rc-control"
                  type="number"
                  min="1"
                  max="100"
                  value={plan.maxArtists}
                  onChange={(event) =>
                    updatePlan(index, {
                      maxArtists: Number(
                        event.target.value || 1,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="rc-button rc-button--tertiary"
                onClick={() => removePlan(index)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div style={styles.actionRow}>
          <button
            type="button"
            className="rc-button"
            onClick={addPlan}
          >
            + Add tier
          </button>
          <button
            type="button"
            disabled={busy}
            className="rc-button rc-button--primary"
            onClick={savePlans}
          >
            Save label tiers
          </button>
        </div>

        <div style={styles.help}>
          Existing customers with the legacy{" "}
          <code>{data.multiArtistTag}</code> tag continue to work with
          a five-artist fallback until you save an explicit tier for
          that tag.
        </div>
      </s-section>

      <s-section heading="Users & rosters">
        <form
          className="rc-admin-search"
          onSubmit={search}
          style={styles.search}
        >
          <input
            className="rc-control"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Filter by customer, email, label or tag"
          />
          <button className="rc-button rc-button--primary">
            Filter
          </button>
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

        {data.customers.length ? (
          <div style={styles.customerGrid}>
            {data.customers.map((customer) => (
              <UserLabelCard
                key={customer.id}
                customer={customer}
                artists={data.artists}
                accesses={
                  accessMap.get(customer.numericId) || []
                }
                visibleReleases={
                  releasesByCustomer.get(customer.numericId) ||
                  []
                }
                busy={busy}
                onSaveArtists={(artistIds) =>
                  saveArtistAccess(customer.id, artistIds)
                }
                onSaveLabel={(name) =>
                  saveLabelName(customer.id, name)
                }
              />
            ))}
          </div>
        ) : (
          <div style={styles.empty}>
            {data.q
              ? "No portal users match this filter."
              : "No eligible portal users were found."}
          </div>
        )}
      </s-section>

      <CollapsibleSection
        icon="artist"
        title="Release ownership"
        description="Artist access drives normal release visibility. Use creator/owner assignment only for repair or transfer."
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
                      {typeLabel(release.type)} ·{" "}
                      {release._count.tracks} track
                      {release._count.tracks === 1 ? "" : "s"} ·{" "}
                      {(release.artists || [])
                        .filter(
                          (item) => item.role === "PRIMARY",
                        )
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

                <div style={styles.assign}>
                  <select
                    className="rc-control"
                    defaultValue={
                      release.ownerCustomerId || ""
                    }
                    key={`${release.id}:${
                      release.ownerCustomerId || ""
                    }`}
                  >
                    <option value="">Not assigned</option>
                    {data.customers.map((customer) => (
                      <option
                        key={customer.id}
                        value={customer.numericId}
                      >
                        {customer.displayName ||
                          customer.email}{" "}
                        — {customer.email || "no email"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy}
                    className="rc-button rc-button--primary"
                    onClick={(event) => {
                      const select =
                        event.currentTarget
                          .previousElementSibling;
                      assignReleaseOwner(
                        release.id,
                        select?.value || "",
                      );
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

function UserLabelCard({
  customer,
  artists,
  accesses,
  visibleReleases,
  busy,
  onSaveArtists,
  onSaveLabel,
}) {
  const isLabel = Boolean(customer.labelPlan);
  const maxArtists = isLabel
    ? customer.labelPlan.maxArtists
    : 1;
  const accessKey = (accesses || [])
    .map((access) => access.artistId)
    .sort()
    .join("|");
  const [selectedIds, setSelectedIds] = useState(
    (accesses || []).map((access) => access.artistId),
  );
  const [labelName, setLabelName] = useState(
    customer.label?.name || "",
  );

  useEffect(() => {
    setSelectedIds(accessKey ? accessKey.split("|") : []);
  }, [accessKey]);

  useEffect(() => {
    setLabelName(customer.label?.name || "");
  }, [customer.label?.name]);

  const toggleArtist = (artistId) => {
    setSelectedIds((current) => {
      if (current.includes(artistId)) {
        return current.filter((id) => id !== artistId);
      }
      if (current.length >= maxArtists) return current;
      return [...current, artistId];
    });
  };

  const setSingleArtist = (artistId) => {
    setSelectedIds(artistId ? [artistId] : []);
  };

  return (
    <article style={styles.customer}>
      <div style={styles.customerHeading}>
        <div style={{ minWidth: 0 }}>
          <strong>
            {customer.displayName ||
              customer.email ||
              "Customer"}
          </strong>
          <div style={styles.meta}>
            {customer.email || "No email"}
          </div>
        </div>
        <span
          style={{
            ...styles.permissionBadge,
            ...(isLabel
              ? styles.permissionBadgeLabel
              : {}),
          }}
        >
          {isLabel
            ? `Label · ${selectedIds.length}/${maxArtists}`
            : "Artist account"}
        </span>
      </div>

      <div style={styles.tags}>
        {(customer.tags || []).length
          ? (customer.tags || []).join(", ")
          : "No Shopify customer tags"}
      </div>

      {isLabel ? (
        <div style={styles.labelBox}>
          <div>
            <div style={styles.label}>Team / label identity</div>
            <div style={styles.meta}>
              Matched tag:{" "}
              <code>{customer.labelPlan.tag}</code> · up to{" "}
              {maxArtists} artists
            </div>
          </div>
          <div style={styles.inlineSave}>
            <input
              className="rc-control"
              value={labelName}
              onChange={(event) =>
                setLabelName(event.target.value)
              }
              placeholder="Independent label or team name"
            />
            <button
              type="button"
              disabled={busy}
              className="rc-button"
              onClick={() => onSaveLabel(labelName)}
            >
              Save label
            </button>
          </div>
          <div style={styles.meta}>
            Once set, this name becomes an artist-facing option for
            Release Label and ℗ Line alongside East Rock.
          </div>
        </div>
      ) : null}

      <div style={styles.policyBox}>
        <div style={styles.label}>
          {isLabel ? "Roster access" : "Artist access"}
        </div>

        {isLabel ? (
          <div style={styles.artistChecklist}>
            {artists.map((artist) => (
              <label key={artist.id} style={styles.artistCheck}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(artist.id)}
                  onChange={() => toggleArtist(artist.id)}
                  disabled={
                    !selectedIds.includes(artist.id) &&
                    selectedIds.length >= maxArtists
                  }
                />
                <span>{artist.name}</span>
              </label>
            ))}
          </div>
        ) : (
          <select
            className="rc-control"
            value={selectedIds[0] || ""}
            onChange={(event) =>
              setSingleArtist(event.target.value)
            }
          >
            <option value="">
              No artist assigned yet
            </option>
            {artists.map((artist) => (
              <option key={artist.id} value={artist.id}>
                {artist.name}
              </option>
            ))}
          </select>
        )}

        <div style={styles.policyFooter}>
          <span style={styles.meta}>
            {isLabel
              ? `${Math.max(
                  0,
                  maxArtists - selectedIds.length,
                )} roster slot${
                  Math.max(
                    0,
                    maxArtists - selectedIds.length,
                  ) === 1
                    ? ""
                    : "s"
                } remaining.`
              : "Single-artist accounts are limited to one artist identity."}
          </span>
          <button
            type="button"
            disabled={busy}
            className="rc-button rc-button--primary"
            onClick={() => onSaveArtists(selectedIds)}
          >
            Save access
          </button>
        </div>
      </div>

      <div style={styles.releaseSummary}>
        <strong>
          {visibleReleases.length} visible release
          {visibleReleases.length === 1 ? "" : "s"}
        </strong>
        <span style={styles.meta}>
          Visibility follows assigned primary artists.
        </span>
      </div>
    </article>
  );
}

const styles = {
  intro: {
    color: "var(--p-color-text-secondary, #616161)",
    lineHeight: 1.55,
    marginBottom: 14,
    maxWidth: 880,
  },
  search: {
    display: "grid",
    gridTemplateColumns: "minmax(240px, 1fr) auto auto",
    gap: 10,
    alignItems: "center",
    marginBottom: 16,
  },
  help: {
    marginTop: 12,
    color: "var(--p-color-text-secondary, #616161)",
    fontSize: 13,
    lineHeight: 1.5,
  },
  planList: {
    display: "grid",
    gap: 10,
  },
  planRow: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 1fr) 160px auto",
    gap: 10,
    alignItems: "end",
    padding: 12,
    border: "1px solid var(--p-color-border-secondary, #ddd)",
    borderRadius: 12,
  },
  field: {
    display: "grid",
    gap: 6,
    fontSize: 12,
    fontWeight: 650,
  },
  actionRow: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 12,
  },
  customerGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 14,
  },
  customer: {
    border: "1px solid var(--p-color-border-secondary, #ddd)",
    borderRadius: 16,
    background: "var(--p-color-bg-surface, #fff)",
    padding: 16,
    display: "grid",
    gap: 13,
  },
  customerHeading: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  meta: {
    color: "var(--p-color-text-secondary, #6b6b6b)",
    fontSize: 12,
    lineHeight: 1.45,
  },
  permissionBadge: {
    border: "1px solid var(--p-color-border-secondary, #ddd)",
    borderRadius: 999,
    padding: "5px 9px",
    fontSize: 11,
    fontWeight: 750,
    whiteSpace: "nowrap",
  },
  permissionBadgeLabel: {
    background: "rgba(126, 87, 255, .08)",
    borderColor: "rgba(126, 87, 255, .22)",
  },
  tags: {
    fontSize: 11,
    lineHeight: 1.45,
    color: "var(--p-color-text-secondary, #6b6b6b)",
    overflowWrap: "anywhere",
  },
  labelBox: {
    display: "grid",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    background: "rgba(126, 87, 255, .045)",
    border: "1px solid rgba(126, 87, 255, .16)",
  },
  inlineSave: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 8,
  },
  policyBox: {
    display: "grid",
    gap: 10,
    padding: 12,
    border: "1px solid var(--p-color-border-secondary, #ddd)",
    borderRadius: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: 760,
  },
  artistChecklist: {
    display: "grid",
    gap: 6,
    maxHeight: 220,
    overflow: "auto",
    paddingRight: 3,
  },
  artistCheck: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    minHeight: 30,
    fontSize: 13,
  },
  policyFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  releaseSummary: {
    display: "grid",
    gap: 3,
    paddingTop: 2,
  },
  empty: {
    padding: 20,
    border: "1px dashed var(--p-color-border-secondary, #ddd)",
    borderRadius: 14,
    color: "var(--p-color-text-secondary, #666)",
  },
  list: {
    display: "grid",
    gap: 10,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(300px, .55fr)",
    gap: 14,
    alignItems: "center",
    padding: 12,
    border: "1px solid var(--p-color-border-secondary, #ddd)",
    borderRadius: 12,
  },
  releaseIdentity: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    minWidth: 0,
  },
  assign: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 8,
  },
};

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);
