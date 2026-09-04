import { useState } from "react";
import { Link, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { authenticatedPost } from "../lib/authenticated-post";
import {
  ArtistAvatar,
  CollapsibleSection,
  EmptyState,
  PageIntro,
  PaginationBar,
} from "../components/releasecore-ui";
import {
  paginationFromRequest,
  paginationMeta,
} from "../lib/list-pagination.server";

const PAGE_SIZE = 75;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const pagination = paginationFromRequest(request, {
    pageSize: PAGE_SIZE,
  });
  const where = { shop: session.shop };

  const [artists, total] = await Promise.all([
    db.artist.findMany({
      where,
      orderBy: { name: "asc" },
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        name: true,
        legalName: true,
        biography: true,
        imageUrl: true,
        _count: {
          select: {
            releases: true,
            tracks: true,
            contributors: true,
          },
        },
      },
    }),
    db.artist.count({ where }),
  ]);

  return {
    artists,
    pagination: paginationMeta({
      ...pagination,
      total,
    }),
  };
};

export default function ArtistsPage() {
  const { artists, pagination } = useLoaderData();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const create = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const data = new FormData(event.currentTarget);
      data.set("intent", "create");
      const result = await authenticatedPost(
        shopify,
        "/api/artists",
        data,
      );
      shopify.toast.show("Artist created");
      navigate(`/app/artist/${result.artistId}`);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not create artist.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <s-page heading="Artists">
      <s-section>
        <PageIntro
          eyebrow="Artist directory"
          title="One artist identity, reused everywhere."
        >
          Artist profiles, images, platform links,
          biographies, and regular contributors stay connected
          across every release.
        </PageIntro>
      </s-section>

      {notice ? (
        <s-section>
          <div className="rc-notice rc-notice--bad">
            {notice}
          </div>
        </s-section>
      ) : null}

      <CollapsibleSection
        icon="add"
        title="Add artist"
        description="Create the identity first, then complete their focused profile page."
      >
        <form className="rc-form" onSubmit={create}>
          <div className="rc-form-grid">
            <label className="rc-field">
              <span className="rc-field__label">
                Artist / stage name
              </span>
              <input
                name="name"
                required
                placeholder="Artist name"
              />
            </label>
            <label className="rc-field">
              <span className="rc-field__label">
                Email
              </span>
              <input
                name="email"
                type="email"
                placeholder="artist@example.com"
              />
            </label>
          </div>
          <div className="rc-form-actions">
            <button
              className="rc-button rc-button--primary"
              disabled={busy}
            >
              {busy
                ? "Creating…"
                : "Create and open profile"}
            </button>
          </div>
        </form>
      </CollapsibleSection>

      <s-section heading={`All artists (${pagination.total})`}>
        {artists.length ? (
          <>
            <div className="rc-directory-list">
              {artists.map((artist) => (
                <Link
                  className="rc-directory-row"
                  key={artist.id}
                  to={`/app/artist/${artist.id}`}
                >
                  <ArtistAvatar artist={artist} />
                  <div>
                    <strong>{artist.name}</strong>
                    <div className="rc-directory-row__meta">
                      {artist.legalName ||
                        artist.biography ||
                        "Profile ready to complete"}
                    </div>
                  </div>
                  <div className="rc-directory-row__aside">
                    {artist._count.releases} releases ·{" "}
                    {artist._count.tracks} tracks
                    <br />
                    {artist._count.contributors} linked
                    contributors · Edit →
                  </div>
                </Link>
              ))}
            </div>
            <PaginationBar
              {...pagination}
              label="artists"
              hrefFor={(page) => `/app/artists?page=${page}`}
            />
          </>
        ) : (
          <EmptyState title="No artists yet">
            Create your first artist profile to assign it to
            releases and tracks.
          </EmptyState>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);
