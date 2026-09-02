import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { formatDate, typeLabel } from "../lib/releasecore";
import { distributionStatusLabel, distributionStatusTone } from "../lib/workflow";
import { EmptyState, FilterBar, PageIntro, ReleaseListItem } from "../components/releasecore-ui";

const FILTERS = ["ACTIVE", "QUEUED", "PROCESSING", "SUBMITTED_TO_STORES", "RETURNED_FOR_CORRECTIONS", "DELIVERED", "ALL"];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const filter = FILTERS.includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "ACTIVE";
  const baseQueued = { shop: session.shop, OR: [{ distributionStatus: { not: "NOT_QUEUED" } }, { status: "APPROVED" }] };
  const where = { ...baseQueued };
  if (filter === "ACTIVE") where.OR = [
    { distributionStatus: { in: ["QUEUED", "PROCESSING", "SUBMITTED_TO_STORES", "RETURNED_FOR_CORRECTIONS"] } },
    { status: "APPROVED", distributionStatus: "NOT_QUEUED" },
  ];
  else if (filter === "QUEUED") where.OR = [
    { distributionStatus: "QUEUED" },
    { status: "APPROVED", distributionStatus: "NOT_QUEUED" },
  ];
  else if (filter !== "ALL") { delete where.OR; where.distributionStatus = filter; }
  const [releases, countRows] = await Promise.all([
    db.release.findMany({
      where,
      orderBy: [{ distributionUpdatedAt: "desc" }, { decisionAt: "desc" }, { updatedAt: "desc" }],
      include: {
        _count: { select: { tracks: true } },
        tracks: { select: { id: true, shopifyProductId: true } },
        files: { where: { kind: "COVER_ART", trackId: null }, select: { kind: true, url: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    Promise.all([
      db.release.count({ where: { shop: session.shop, OR: [{ distributionStatus: { in: ["QUEUED", "PROCESSING", "SUBMITTED_TO_STORES", "RETURNED_FOR_CORRECTIONS"] } }, { status: "APPROVED", distributionStatus: "NOT_QUEUED" }] } }),
      db.release.count({ where: { shop: session.shop, OR: [{ distributionStatus: "QUEUED" }, { status: "APPROVED", distributionStatus: "NOT_QUEUED" }] } }),
      db.release.count({ where: { shop: session.shop, distributionStatus: "PROCESSING" } }),
      db.release.count({ where: { shop: session.shop, distributionStatus: "SUBMITTED_TO_STORES" } }),
      db.release.count({ where: { shop: session.shop, distributionStatus: "RETURNED_FOR_CORRECTIONS" } }),
      db.release.count({ where: { shop: session.shop, distributionStatus: "DELIVERED" } }),
    ]),
  ]);
  return { releases, filter, counts: { ACTIVE: countRows[0], QUEUED: countRows[1], PROCESSING: countRows[2], SUBMITTED_TO_STORES: countRows[3], RETURNED_FOR_CORRECTIONS: countRows[4], DELIVERED: countRows[5] } };
};

export default function DistributionQueue() {
  const { releases, filter, counts } = useLoaderData();
  return <s-page heading="Distribution">
    <s-section>
      <PageIntro eyebrow="Delivery operations" title="Prepare, deliver, and track approved releases.">
        Open a release to confirm identifiers, products, previews, and delivery status before it moves downstream.
      </PageIntro>
      <FilterBar
        active={filter}
        hrefFor={(value) => `/app/distribution?status=${value}`}
        items={FILTERS.map((value) => ({ value, label: value === "ACTIVE" ? "Active" : value === "ALL" ? "All" : distributionStatusLabel(value), count: counts[value] }))}
      />
    </s-section>
    <s-section heading={`${filter === "ACTIVE" ? "Active distribution" : filter === "ALL" ? "Distribution history" : distributionStatusLabel(filter)} (${releases.length})`}>
      {releases.length ? <div className="rc-release-list">{releases.map((release) => {
        const productCount = release.tracks.filter((track) => track.shopifyProductId).length;
        const displayStatus = release.distributionStatus === "NOT_QUEUED" && release.status === "APPROVED" ? "QUEUED" : release.distributionStatus;
        return <ReleaseListItem
          key={release.id}
          release={release}
          href={`/app/distribution/${release.id}`}
          badges={[{ label: typeLabel(release.type), tone: "neutral" }, { label: distributionStatusLabel(displayStatus), tone: distributionStatusTone(displayStatus) }]}
          meta={`${release.artistName || "Artist not set"} · ${release._count.tracks} ${release._count.tracks === 1 ? "track" : "tracks"} · UPC ${release.upc || "pending"} · Products ${productCount}/${release._count.tracks}`}
          aside={`Release ${formatDate(release.releaseDate)}`}
          actionLabel="Open workspace"
        />;
      })}</div> : <EmptyState title="No releases in this queue">Choose another status or approve a release to begin distribution.</EmptyState>}
    </s-section>
  </s-page>;
}
export const headers=(headersArgs)=>boundary.headers(headersArgs);
