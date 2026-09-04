import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { typeLabel, formatDate } from "../lib/releasecore";
import { statusLabel, statusTone } from "../lib/workflow";
import {
  EmptyState,
  FilterBar,
  PageIntro,
  PaginationBar,
  ReleaseListItem,
} from "../components/releasecore-ui";
import {
  paginationFromRequest,
  paginationMeta,
} from "../lib/list-pagination.server";

const FILTERS = [
  "ACTIVE",
  "SUBMITTED",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
  "ALL",
];
const PAGE_SIZE = 50;

function submissionCounts(rows) {
  const byStatus = Object.fromEntries(
    rows.map((row) => [
      row.status,
      row._count._all,
    ]),
  );
  const count = (status) => byStatus[status] || 0;

  return {
    ACTIVE:
      count("SUBMITTED") +
      count("IN_REVIEW") +
      count("CHANGES_REQUESTED"),
    SUBMITTED: count("SUBMITTED"),
    IN_REVIEW: count("IN_REVIEW"),
    CHANGES_REQUESTED: count("CHANGES_REQUESTED"),
    APPROVED: count("APPROVED"),
    REJECTED: count("REJECTED"),
    ALL: rows
      .filter((row) => row.status !== "DRAFT")
      .reduce(
        (sum, row) => sum + row._count._all,
        0,
      ),
  };
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const filter = FILTERS.includes(
    url.searchParams.get("status"),
  )
    ? url.searchParams.get("status")
    : "ACTIVE";
  const where = { shop: session.shop };

  if (filter === "ACTIVE") {
    where.status = {
      in: [
        "SUBMITTED",
        "IN_REVIEW",
        "CHANGES_REQUESTED",
      ],
    };
  } else if (filter !== "ALL") {
    where.status = filter;
  } else {
    where.status = { not: "DRAFT" };
  }

  const pagination = paginationFromRequest(request, {
    pageSize: PAGE_SIZE,
  });

  const [releases, groupedCounts] = await Promise.all([
    db.release.findMany({
      where,
      orderBy: [
        { lastSubmittedAt: "desc" },
        { updatedAt: "desc" },
      ],
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        artistName: true,
        lastSubmittedAt: true,
        releaseDate: true,
        _count: {
          select: {
            tracks: true,
            reviewItems: {
              where: { status: "OPEN" },
            },
          },
        },
        files: {
          where: { kind: "COVER_ART", trackId: null },
          select: { kind: true, url: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    db.release.groupBy({
      by: ["status"],
      where: { shop: session.shop },
      _count: { _all: true },
    }),
  ]);

  const counts = submissionCounts(groupedCounts);

  return {
    releases,
    filter,
    counts,
    pagination: paginationMeta({
      ...pagination,
      total: counts[filter] || 0,
    }),
  };
};

export default function Submissions() {
  const {
    releases,
    filter,
    counts,
    pagination,
  } = useLoaderData();
  const navigate = useNavigate();

  return (
    <s-page heading="Submissions">
      <s-button
        slot="primary-action"
        onClick={() => navigate("/app/releases")}
      >
        All releases
      </s-button>

      <s-section>
        <PageIntro
          eyebrow="Release review"
          title="Move submissions forward with a clear next action."
        >
          Drafts stay in Releases. Submitted work appears here
          until it is approved, rejected, or returned for
          changes.
        </PageIntro>
        <FilterBar
          active={filter}
          hrefFor={(value) =>
            `/app/submissions?status=${value}`
          }
          items={FILTERS.map((value) => ({
            value,
            label:
              value === "ACTIVE"
                ? "Active"
                : value === "ALL"
                  ? "All submissions"
                  : statusLabel(value),
            count: counts[value],
          }))}
        />
      </s-section>

      <s-section
        heading={`${
          filter === "ACTIVE"
            ? "Active queue"
            : filter === "ALL"
              ? "Submission history"
              : statusLabel(filter)
        } (${pagination.total})`}
      >
        {releases.length ? (
          <>
            <div className="rc-release-list">
              {releases.map((release) => (
                <ReleaseListItem
                  key={release.id}
                  release={release}
                  href={`/app/release/${release.id}`}
                  badges={[
                    {
                      label: typeLabel(release.type),
                      tone: "neutral",
                    },
                    {
                      label: statusLabel(release.status),
                      tone: statusTone(release.status),
                    },
                  ]}
                  meta={`${release.artistName || "Artist not set"} · ${release._count.tracks} ${
                    release._count.tracks === 1
                      ? "track"
                      : "tracks"
                  }${
                    release._count.reviewItems
                      ? ` · ${release._count.reviewItems} open change request${
                          release._count.reviewItems === 1
                            ? ""
                            : "s"
                        }`
                      : ""
                  }`}
                  aside={
                    release.lastSubmittedAt
                      ? `Submitted ${new Date(
                          release.lastSubmittedAt,
                        ).toLocaleDateString()}`
                      : `Release ${formatDate(
                          release.releaseDate,
                        )}`
                  }
                  actionLabel="Review"
                />
              ))}
            </div>
            <PaginationBar
              {...pagination}
              label="submissions"
              hrefFor={(page) =>
                `/app/submissions?status=${filter}&page=${page}`
              }
            />
          </>
        ) : (
          <EmptyState title="No releases in this queue">
            Choose another status or submit a draft release
            for review.
          </EmptyState>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);
