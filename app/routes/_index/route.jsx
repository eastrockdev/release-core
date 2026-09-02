import { redirect } from "react-router";
import { PublicCard, PublicPage } from "../../components/releasecore-public";

export const meta = () => [
  { title: "ReleaseCore" },
  { name: "description", content: "ReleaseCore helps Shopify merchants manage music releases, artist portals, review workflows, and distribution operations." },
];

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return null;
};

export default function PublicHome() {
  return (
    <PublicPage
      eyebrow="Music distribution operations"
      title="Release management built for Shopify."
      intro="ReleaseCore gives music businesses one operational workspace for releases, artists, contributors, review, distribution, storefront artist portals, and Shopify catalog publishing."
    >
      <div className="rc-public__grid">
        <PublicCard title="Release operations">
          <p>Build singles, EPs, and albums with tracks, credits, files, identifiers, submission review, and distribution status in one place.</p>
        </PublicCard>
        <PublicCard title="Artist portal">
          <p>Connect Shopify customer accounts to artist identities so artists can manage release information through theme app blocks without exposing other customers&apos; data.</p>
        </PublicCard>
        <PublicCard title="Shopify-native workflow">
          <p>Keep merchant administration inside Shopify while publishing supported release data and storefront experiences through Shopify APIs and theme app extensions.</p>
        </PublicCard>
      </div>
      <PublicCard title="Already installed?">
        <p>Open ReleaseCore from <strong>Apps</strong> in your Shopify admin. Installation and authentication are initiated by Shopify; ReleaseCore does not ask merchants to enter a shop domain on this website.</p>
        <div className="rc-public__actions">
          <a className="rc-public__button" href="/privacy-policy">Privacy policy</a>
          <a className="rc-public__button" href="/support">Support</a>
        </div>
      </PublicCard>
    </PublicPage>
  );
}
