import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { formatDate, typeLabel } from "../lib/releasecore";
import {
  distributionStatusLabel,
  distributionStatusTone,
} from "../lib/workflow";
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
  "QUEUED",
  "PROCESSING",
  "SUBMITTED_TO_STORES",
  "RETURNED_FOR_CORRECTIONS",
  "DELIVERED",
  "ALL",
];
const PAGE_SIZE = 50;

function distributionCounts(rows) {
  const statusCount = (distributionStatus) =>
    rows
      .filter(
        (row) =>
          row.distributionStatus === distributionStatus,
      )
      .reduce(
        (sum, row) => sum + row._count._all,
        0,
      );
  const approvedNotQueued = rows
    .filter(
      (row) =>
        row.distributionStatus === "NOT_QUEUED" &&
        row.status === "APPROVED",
    )
    .reduce(
      (sum, row) => sum + row._count._all,
      0,
    );

  return {
    ACTIVE:
      statusCount("QUEUED") +
      statusCount("PROCESSING") +
      statusCount("SUBMITTED_TO_STORES") +
      statusCount("RETURNED_FOR_CORRECTIONS") +
      approvedNotQueued,
    QUEUED:
      statusCount("QUEUED") +
      approvedNotQueued,
    PROCESSING: statusCount("PROCESSING"),
    SUBMITTED_TO_STORES: statusCount(
      "SUBMITTED_TO_STORES",
    ),
    RETURNED_FOR_CORRECTIONS: statusCount(
      "RETURNED_FOR_CORRECTIONS",
    ),
    DELIVERED: statusCount("DELIVERED"),
    ALL:
      rows
        .filter(
          (row) =>
            row.distributionStatus !== "NOT_QUEUED",
        )
        .reduce(
          (sum, row) => sum + row._count._all,
          0,
        ) + approvedNotQueued,
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

  const baseQueued = {
    shop: session.shop,
    OR: [
      {
        distributionStatus: {
          not: "NOT_QUEUED",
        },
      },
      {
        status: "APPROVED",
        distributionStatus: "NOT_QUEUED",
      },
    ],
  };
  const where = { ...baseQueued };

  if (filter === "ACTIVE") {
    where.OR = [
      {
        distributionStatus: {
          in: [
            "QUEUED",
            "PROCESSING",
            "SUBMITTED_TO_STORES",
            "RETURNED_FOR_CORRECTIONS",
          ],
        },
      },
      {
        status: "APPROVED",
        distributionStatus: "NOT_QUEUED",
      },
    ];
  } else if (filter === "QUEUED") {
    where.OR = [
      { distributionStatus: "QUEUED" },
      {
        status: "APPROVED",
        distributionStatus: "NOT_QUEUED",
      },
    ];
  } else if (filter !== "ALL") {
    delete where.OR;
    where.distributionStatus = filter;
  }

  const pagination = paginationFromRequest(request, {
    pageSize: PAGE_SIZE,
  });

  const [releases, groupedCounts] = await Promise.all([
    db.release.findMany({
      where,
      orderBy: [
        { distributionUpdatedAt: "desc" },
        { decisionAt: "desc" },
        { updatedAt: "desc" },
      ],
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        distributionStatus: true,
        artistName: true,
        upc: true,
        releaseDate: true,
        _count: { select: { tracks: true } },
        tracks: {
          where: {
            shopifyProductId: { not: null },
          },
          select: { id: true },
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
      by: ["distributionStatus", "status"],
      where: { shop: session.shop },
      _count: { _all: true },
    }),
  ]);

  const counts = distributionCounts(groupedCounts);

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

export default function DistributionQueue() {
  const {
    releases,
    filter,
    counts,
    pagination,
  } = useLoaderData();

  return (
    <s-page heading="Distribution">
      <s-section>
        <PageIntro
          eyebrow="Delivery operations"
          title="Prepare, deliver, and track approved releases."
        >
          Open a release to confirm identifiers, products,
          previews, and delivery status before it moves
          downstream.
        </PageIntro>
        <FilterBar
          active={filter}
          hrefFor={(value) =>
            `/app/distribution?status=${value}`
          }
          items={FILTERS.map((value) => ({
            value,
            label:
              value === "ACTIVE"
                ? "Active"
                : value === "ALL"
                  ? "All"
                  : distributionStatusLabel(value),
            count: counts[value],
          }))}
        />
      </s-section>

      <s-section
        heading={`${
          filter === "ACTIVE"
            ? "Active distribution"
            : filter === "ALL"
              ? "Distribution history"
              : distributionStatusLabel(filter)
        } (${pagination.total})`}
      >
        {releases.length ? (
          <>
            <div className="rc-release-list">
              {releases.map((release) => {
                const productCount = release.tracks.length;
                const displayStatus =
                  release.distributionStatus ===
                    "NOT_QUEUED" &&
                  release.status === "APPROVED"
                    ? "QUEUED"
                    : release.distributionStatus;
                return (
                  <ReleaseListItem
                    key={release.id}
                    release={release}
                    href={`/app/distribution/${release.id}`}
                    badges={[
                      {
                        label: typeLabel(release.type),
                        tone: "neutral",
                      },
                      {
                        label:
                          distributionStatusLabel(
                            displayStatus,
                          ),
                        tone:
                          distributionStatusTone(
                            displayStatus,
                          ),
                      },
                    ]}
                    meta={`${release.artistName || "Artist not set"} · ${release._count.tracks} ${
                      release._count.tracks === 1
                        ? "track"
                        : "tracks"
                    } · UPC ${release.upc || "pending"} · Products ${productCount}/${release._count.tracks}`}
                    aside={`Release ${formatDate(
                      release.releaseDate,
                    )}`}
                    actionLabel="Open workspace"
                  />
                );
              })}
            </div>
            <PaginationBar
              {...pagination}
              label="distribution releases"
              hrefFor={(page) =>
                `/app/distribution?status=${filter}&page=${page}`
              }
            />
          </>
        ) : (
          <EmptyState title="No releases in this queue">
            Choose another status or approve a release to
            begin distribution.
          </EmptyState>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);
