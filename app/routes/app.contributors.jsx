import { useState } from "react";
import { Link, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { authenticatedPost } from "../lib/authenticated-post";
import { contributorDisplayName } from "../lib/releasecore";
import {
  CollapsibleSection,
  EmptyState,
  PageIntro,
  PaginationBar,
  SectionIcon,
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

  const [contributors, total] = await Promise.all([
    db.contributor.findMany({
      where,
      orderBy: { legalName: "asc" },
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        legalName: true,
        stageName: true,
        pro: true,
        ipi: true,
        _count: {
          select: {
            credits: true,
            artists: true,
          },
        },
      },
    }),
    db.contributor.count({ where }),
  ]);

  return {
    contributors,
    pagination: paginationMeta({
      ...pagination,
      total,
    }),
  };
};

export default function ContributorsPage() {
  const { contributors, pagination } = useLoaderData();
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
        "/api/contributors",
        data,
      );
      shopify.toast.show("Contributor created");
      navigate(`/app/contributor/${result.contributorId}`);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not create contributor.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <s-page heading="Contributors">
      <s-section>
        <PageIntro
          eyebrow="Credits directory"
          title="Enter a contributor once. Credit them everywhere."
        >
          Writers, composers, producers, and engineers get a
          focused profile and can be linked to the artists they
          regularly work with.
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
        title="Add contributor"
        description="Create the contributor, then complete credits and artist relationships on their profile."
      >
        <form className="rc-form" onSubmit={create}>
          <div className="rc-form-grid">
            <label className="rc-field">
              <span className="rc-field__label">
                Legal name
              </span>
              <input name="legalName" required />
            </label>
            <label className="rc-field">
              <span className="rc-field__label">
                Stage / display name
              </span>
              <input name="stageName" />
            </label>
            <label className="rc-field">
              <span className="rc-field__label">
                Email
              </span>
              <input name="email" type="email" />
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

      <s-section
        heading={`All contributors (${pagination.total})`}
      >
        {contributors.length ? (
          <>
            <div className="rc-directory-list">
              {contributors.map((contributor) => (
                <Link
                  className="rc-directory-row"
                  key={contributor.id}
                  to={`/app/contributor/${contributor.id}`}
                >
                  <SectionIcon name="contributor" />
                  <div>
                    <strong>
                      {contributorDisplayName(contributor)}
                    </strong>
                    <div className="rc-directory-row__meta">
                      {contributor.legalName}
                      {contributor.pro
                        ? ` · ${contributor.pro}`
                        : ""}
                      {contributor.ipi
                        ? ` · IPI ${contributor.ipi}`
                        : ""}
                    </div>
                  </div>
                  <div className="rc-directory-row__aside">
                    {contributor._count.credits} track credits
                    <br />
                    {contributor._count.artists} linked artists ·
                    Edit →
                  </div>
                </Link>
              ))}
            </div>
            <PaginationBar
              {...pagination}
              label="contributors"
              hrefFor={(page) =>
                `/app/contributors?page=${page}`
              }
            />
          </>
        ) : (
          <EmptyState title="No contributors yet">
            Add your first writer, producer, or engineer.
          </EmptyState>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);
