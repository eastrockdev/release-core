import { useLoaderData } from "react-router";
import { PublicCard, PublicPage } from "../components/releasecore-public";

export const meta = () => [
  { title: "Support · ReleaseCore" },
  { name: "description", content: "Get help with ReleaseCore for Shopify." },
];

export const loader = async () => ({
  // eslint-disable-next-line no-undef
  supportEmail: String(process.env.RELEASECORE_SUPPORT_EMAIL || "").trim(),
});

export default function SupportPage() {
  const { supportEmail } = useLoaderData();
  return (
    <PublicPage
      eyebrow="Support"
      title="Get help with ReleaseCore"
      intro="ReleaseCore merchants can reach support directly from Shopify, where the request is automatically tied to the app and store context."
    >
      <PublicCard title="Recommended support channel">
        <p>In Shopify Admin, open ReleaseCore and use Shopify&apos;s <strong>Get support</strong> action. You can also use the support action on the ReleaseCore Shopify App Store listing. Shopify forwards those requests to the support contact maintained for the app.</p>
        {supportEmail ? (
          <div className="rc-public__actions">
            <a className="rc-public__button rc-public__button--primary" href={`mailto:${supportEmail}`}>Email {supportEmail}</a>
          </div>
        ) : null}
      </PublicCard>
      <PublicCard title="Include these details">
        <ul>
          <li>What you were trying to do and what happened instead.</li>
          <li>The ReleaseCore page or workflow involved.</li>
          <li>Any visible ReleaseCore request ID or error message.</li>
          <li>A screenshot when it helps explain a visual or browser-specific problem.</li>
        </ul>
        <p>Never send Shopify passwords, API secrets, session tokens, or private credentials in a support request.</p>
      </PublicCard>
      <PublicCard title="Privacy requests">
        <p>For information about ReleaseCore data handling, retention, and Shopify privacy requests, review the privacy policy.</p>
        <div className="rc-public__actions">
          <a className="rc-public__button" href="/privacy-policy">Privacy policy</a>
        </div>
      </PublicCard>
    </PublicPage>
  );
}
