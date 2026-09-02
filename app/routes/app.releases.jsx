import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { typeLabel, formatDate } from "../lib/releasecore";
import { statusLabel, statusTone } from "../lib/workflow";
import { EmptyState, PageIntro, ReleaseListItem } from "../components/releasecore-ui";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const releases = await db.release.findMany({
    where: { shop: session.shop },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { tracks: true } },
      files: { where: { kind: "COVER_ART", trackId: null }, select: { kind: true, url: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return { releases };
};

export default function ReleasesIndex() {
  const { releases } = useLoaderData();
  const navigate = useNavigate();

  return (
    <s-page heading="Releases">
      <s-button slot="primary-action" variant="primary" onClick={() => navigate("/app/release/new")}>Create release</s-button>

      <s-section>
        <PageIntro
          eyebrow="Catalog"
          title="Every release, organized from the start."
          actions={<s-button onClick={() => navigate("/app/import")}>Import Shopify product</s-button>}
        >
          Create or import singles, EPs, and albums. Artwork, status, artist, format, and release timing stay visible at a glance.
        </PageIntro>
      </s-section>

      <s-section heading={`All releases (${releases.length})`}>
        {releases.length === 0 ? (
          <EmptyState title="Your catalog is empty" action={<s-button variant="primary" onClick={() => navigate("/app/release/new")}>Create release</s-button>}>
            Start a release and choose its format on the next screen.
          </EmptyState>
        ) : (
          <div className="rc-release-list">
            {releases.map((release) => <ReleaseListItem
              key={release.id}
              release={release}
              href={`/app/release/${release.id}`}
              badges={[{ label: typeLabel(release.type), tone: "info" }, { label: statusLabel(release.status), tone: statusTone(release.status) }]}
              meta={`${release.artistName || "Artist not set"} · ${release._count.tracks} ${release._count.tracks === 1 ? "track" : "tracks"}`}
              aside={<><div>Release {formatDate(release.releaseDate)}</div><div>Updated {new Date(release.updatedAt).toLocaleDateString()}</div></>}
            />)}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
