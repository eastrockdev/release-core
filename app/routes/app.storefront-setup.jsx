import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { PageIntro } from "../components/releasecore-ui";

function addBlockUrl(shop, apiKey, handle, template = "page") {
  const url = new URL(`https://${shop}/admin/themes/current/editor`);
  url.searchParams.set("template", template);
  url.searchParams.set("addAppBlockId", `${apiKey}/${handle}`);
  url.searchParams.set("target", "newAppsSection");
  return url.toString();
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  // eslint-disable-next-line no-undef
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  return {
    blocks: [
      {
        handle: "release-portal",
        title: "Release Portal",
        description: "Artist-facing release creation, editing, files, submission status, and release history for the signed-in linked Shopify customer.",
        url: addBlockUrl(session.shop, apiKey, "release-portal"),
      },
      {
        handle: "recent-releases",
        title: "Recent Releases",
        description: "A compact recent-release view that can sit on an artist dashboard or account page alongside the main portal.",
        url: addBlockUrl(session.shop, apiKey, "recent-releases"),
      },
      {
        handle: "artist-profile",
        title: "Artist Profile",
        description: "Artist identity/profile presentation with owner-authenticated profile editing for the customer linked to that artist.",
        url: addBlockUrl(session.shop, apiKey, "artist-profile"),
      },
    ],
  };
};

export default function StorefrontSetupPage() {
  const { blocks } = useLoaderData();
  return (
    <s-page heading="Storefront setup">
      <s-section>
        <PageIntro eyebrow="Artist Portal" title="Add ReleaseCore blocks to the storefront">
          ReleaseCore uses Shopify theme app extensions. Add only the blocks you want, preview them in the Theme Editor, configure their settings, and save the theme when they look right.
        </PageIntro>
      </s-section>

      <s-section heading="Before you add blocks">
        <div className="rc-stack">
          <div className="rc-notice rc-notice--info">
            <strong>1. Prepare portal access.</strong> Create or select an Artist in ReleaseCore, then use Portal access to link that artist to the correct Shopify customer account.
          </div>
          <div className="rc-notice rc-notice--info">
            <strong>2. Choose the storefront page/template.</strong> The buttons below stage each block on the current theme&apos;s default page template. In Theme Editor, switch to the specific page/template you want before saving if necessary.
          </div>
          <div className="rc-notice rc-notice--info">
            <strong>3. Test while signed in.</strong> Portal editing is customer-authenticated. Sign in as the linked Shopify customer and confirm that only that customer&apos;s artist/release data is visible.
          </div>
        </div>
      </s-section>

      <s-section heading="Theme app blocks">
        <div className="rc-card-grid rc-card-grid--3">
          {blocks.map((block) => (
            <article className="rc-card" key={block.handle}>
              <div className="rc-card__body">
                <div className="rc-eyebrow">Theme block</div>
                <h3 className="rc-card__title">{block.title}</h3>
                <p className="rc-card__copy">{block.description}</p>
                <div className="rc-card__actions">
                  <a className="rc-button rc-button--primary" href={block.url} target="_top" rel="noreferrer">
                    Add in Theme Editor
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      </s-section>

      <s-section heading="Review before going live">
        <div className="rc-stack">
          <div>• Confirm the block renders without errors in Theme Editor and the live storefront.</div>
          <div>• Check desktop and mobile widths.</div>
          <div>• Confirm logged-out visitors do not receive private release information.</div>
          <div>• Confirm a linked customer cannot open or edit another customer&apos;s releases.</div>
          <div>• Save the theme after the final block configuration.</div>
        </div>
      </s-section>
    </s-page>
  );
}
