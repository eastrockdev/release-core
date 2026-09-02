import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { typeLabel, formatDate } from "../lib/releasecore";
import { statusLabel, statusTone } from "../lib/workflow";
import { EmptyState, FilterBar, PageIntro, ReleaseListItem } from "../components/releasecore-ui";

const FILTERS = ["ACTIVE", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "REJECTED", "ALL"];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const filter = FILTERS.includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "ACTIVE";
  const where = { shop: session.shop };
  if (filter === "ACTIVE") where.status = { in: ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"] };
  else if (filter !== "ALL") where.status = filter;
  else where.status = { not: "DRAFT" };

  const [releases, counts] = await Promise.all([
    db.release.findMany({
      where,
      orderBy: [{ lastSubmittedAt: "desc" }, { updatedAt: "desc" }],
      include: {
        _count: { select: { tracks: true } },
        reviewItems: { where: { status: "OPEN" }, select: { id: true } },
        files: { where: { kind: "COVER_ART", trackId: null }, select: { kind: true, url: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    Promise.all([
      db.release.count({ where: { shop: session.shop, status: { in: ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"] } } }),
      db.release.count({ where: { shop: session.shop, status: "SUBMITTED" } }),
      db.release.count({ where: { shop: session.shop, status: "IN_REVIEW" } }),
      db.release.count({ where: { shop: session.shop, status: "CHANGES_REQUESTED" } }),
      db.release.count({ where: { shop: session.shop, status: "APPROVED" } }),
      db.release.count({ where: { shop: session.shop, status: "REJECTED" } }),
    ]),
  ]);

  return { releases, filter, counts: { ACTIVE: counts[0], SUBMITTED: counts[1], IN_REVIEW: counts[2], CHANGES_REQUESTED: counts[3], APPROVED: counts[4], REJECTED: counts[5] } };
};

export default function Submissions() {
  const { releases, filter, counts } = useLoaderData();
  const navigate = useNavigate();
  return <s-page heading="Submissions">
    <s-button slot="primary-action" onClick={() => navigate("/app/releases")}>All releases</s-button>
    <s-section>
      <PageIntro eyebrow="Release review" title="Move submissions forward with a clear next action.">
        Drafts stay in Releases. Submitted work appears here until it is approved, rejected, or returned for changes.
      </PageIntro>
      <FilterBar
        active={filter}
        hrefFor={(value) => `/app/submissions?status=${value}`}
        items={FILTERS.map((value) => ({ value, label: value === "ACTIVE" ? "Active" : value === "ALL" ? "All submissions" : statusLabel(value), count: counts[value] }))}
      />
    </s-section>

    <s-section heading={`${filter === "ACTIVE" ? "Active queue" : filter === "ALL" ? "Submission history" : statusLabel(filter)} (${releases.length})`}>
      {releases.length ? <div className="rc-release-list">{releases.map((release) => <ReleaseListItem
        key={release.id}
        release={release}
        href={`/app/release/${release.id}`}
        badges={[{ label: typeLabel(release.type), tone: "neutral" }, { label: statusLabel(release.status), tone: statusTone(release.status) }]}
        meta={`${release.artistName || "Artist not set"} · ${release._count.tracks} ${release._count.tracks === 1 ? "track" : "tracks"}${release.reviewItems.length ? ` · ${release.reviewItems.length} open change request${release.reviewItems.length === 1 ? "" : "s"}` : ""}`}
        aside={release.lastSubmittedAt ? `Submitted ${new Date(release.lastSubmittedAt).toLocaleDateString()}` : `Release ${formatDate(release.releaseDate)}`}
        actionLabel="Review"
      />)}</div> : <EmptyState title="No releases in this queue">Choose another status or submit a draft release for review.</EmptyState>}
    </s-section>
  </s-page>;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
