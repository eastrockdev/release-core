import { PublicCard, PublicPage } from "../components/releasecore-public";

export const meta = () => [
  { title: "Privacy Policy · ReleaseCore" },
  { name: "description", content: "ReleaseCore privacy policy and data handling information." },
];

export default function PrivacyPolicyPage() {
  return (
    <PublicPage
      eyebrow="Legal"
      title="Privacy policy"
      intro="This policy explains how ReleaseCore processes merchant, artist, contributor, and Shopify customer data when a merchant installs and uses the app."
    >
      <PublicCard title="Information ReleaseCore processes">
        <p>ReleaseCore processes information necessary to operate the app, including:</p>
        <ul>
          <li>Shop and installation identifiers supplied by Shopify.</li>
          <li>Release, track, artist, contributor, rights, identifier, review, distribution, notification, and configuration data entered through ReleaseCore.</li>
          <li>Artwork, audio masters, split sheets, and supporting files submitted through ReleaseCore.</li>
          <li>Shopify customer identifiers, names, email addresses, and tags when required to assign Artist Portal access, distinguish customer records, apply merchant-configured eligibility or automation rules, or deliver transactional release notifications.</li>
          <li>Operational security and diagnostic information necessary to protect the service and investigate failures.</li>
        </ul>
      </PublicCard>

      <PublicCard title="How the information is used">
        <p>ReleaseCore uses this information only to provide and secure its music distribution operations, Artist Portal, release review, publishing, notification, and compliance functionality for the installing merchant.</p>
        <p>ReleaseCore does not sell Shopify customer personal data and does not use Shopify customer data for independent advertising or unrelated profiling.</p>
      </PublicCard>

      <PublicCard title="Service providers and storage">
        <p>ReleaseCore uses cloud hosting, database, object-storage, Shopify, and merchant-configured email infrastructure to provide the service. Access to production systems is limited to operational purposes. Data is transmitted over encrypted HTTPS connections, and private master audio is kept in private object storage rather than exposed as a public storefront asset.</p>
      </PublicCard>

      <PublicCard title="Retention, deletion, and privacy requests">
        <p>ReleaseCore retains app data while it is needed to provide the service and to satisfy valid operational or legal obligations. Shopify privacy requests are recorded so the merchant can review their status.</p>
        <ul>
          <li>Customer data requests are prepared for the merchant on demand through the ReleaseCore Privacy workspace.</li>
          <li>Customer redaction requests remove ReleaseCore data associated with the affected Shopify customer unless retention is legally required.</li>
          <li>After an uninstall, Shopify normally sends a <code>shop/redact</code> request 48 hours later. ReleaseCore uses that request to delete the shop&apos;s tenant records and private master-storage objects.</li>
          <li>Shopify compliance requests are handled within the required 30-day period unless applicable law requires specific information to be retained.</li>
        </ul>
      </PublicCard>

      <PublicCard title="Security and access">
        <p>ReleaseCore uses Shopify authentication for embedded-app access, tenant-scoped data access, restricted private master storage, request validation, and automated security/compliance checks. Merchant and customer data is not intentionally exposed across Shopify shops.</p>
      </PublicCard>

      <PublicCard title="Your choices and contact">
        <p>Store owners can use Shopify&apos;s privacy-request mechanisms for customer requests and can uninstall ReleaseCore from Shopify at any time. Merchants who need help with privacy or data handling can contact ReleaseCore through the support channel listed in the Shopify App Store or the public support page.</p>
        <div className="rc-public__actions">
          <a className="rc-public__button" href="/support">ReleaseCore support</a>
        </div>
        <p><small>Last updated: September 2, 2026.</small></p>
      </PublicCard>
    </PublicPage>
  );
}
