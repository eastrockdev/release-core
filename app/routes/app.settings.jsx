import { Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { PageIntro } from "../components/releasecore-ui";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

const SETTINGS_GROUPS = [
  {
    title: "Catalog & releases",
    description: "Control how new releases are prepared, identified, and turned into storefront products.",
    items: [
      {
        title: "Catalog & release defaults",
        description: "Submission requirements, credit types, identifiers, metadata defaults, pricing, previews, downloads, and Shopify product behavior.",
        href: "/app/settings/preferences",
        icon: "⚙",
        primary: true,
      },
      {
        title: "Release templates",
        description: "Manage reusable starting points for common release structures and metadata.",
        href: "/app/release-templates",
        icon: "▤",
      },
      {
        title: "Import back catalog",
        description: "Bring existing Shopify music products into ReleaseCore without creating duplicate catalog records.",
        href: "/app/import",
        icon: "↥",
      },
    ],
  },
  {
    title: "Artists & access",
    description: "Manage people, customer access, and the artist-facing ReleaseCore experience.",
    items: [
      {
        title: "Artist access",
        description: "Assign Shopify customers and label/team accounts to the artists they can manage.",
        href: "/app/portal-access",
        icon: "◉",
      },
      {
        title: "Contributors",
        description: "Manage reusable contributor identities used for credits and publishing information.",
        href: "/app/contributors",
        icon: "◎",
      },
      {
        title: "Artist portal",
        description: "Configure storefront blocks, artist profiles, and the customer-facing dashboard experience.",
        href: "/app/storefront-setup",
        icon: "▣",
      },
      {
        title: "Release access rules",
        description: "Choose which customer tags can create Singles, EPs, and Albums and configure Shopify Flow events.",
        href: "/app/automation",
        icon: "↻",
      },
    ],
  },
  {
    title: "Notifications",
    description: "Configure communication separately from catalog and access settings.",
    items: [
      {
        title: "Email delivery",
        description: "Configure Resend or SMTP, sender identity, reply-to details, and send a test email.",
        href: "/app/settings/email",
        icon: "◇",
        primary: true,
      },
      {
        title: "Delivery history",
        description: "Review artist email, staff email, and Shopify Flow delivery attempts and retry failures.",
        href: "/app/notifications",
        icon: "↺",
      },
    ],
  },
  {
    title: "Maintenance & support",
    description: "Lower-frequency tools for cleanup, troubleshooting, compliance, and support.",
    items: [
      {
        title: "Data maintenance",
        description: "Find duplicate identities, merge records, and repair catalog drift.",
        href: "/app/data-hygiene",
        icon: "⌁",
      },
      {
        title: "System issues",
        description: "Review current failures, request references, retryability, and recommended resolutions.",
        href: "/app/system-issues",
        icon: "!",
      },
      {
        title: "Advanced safety",
        description: "Review deployment guards and protected administrative writes when troubleshooting a production issue.",
        href: "/app/production-safety",
        icon: "⊙",
      },
      {
        title: "Purchases & downloads",
        description: "Review digital purchases and customer download delivery.",
        href: "/app/purchases",
        icon: "↓",
      },
      {
        title: "Privacy",
        description: "Review privacy and compliance requests handled by ReleaseCore.",
        href: "/app/privacy",
        icon: "◌",
      },
      {
        title: "Send feedback",
        description: "Report a problem or suggest an improvement without exposing private diagnostic data.",
        href: "/app/feedback?from=%2Fapp%2Fsettings",
        icon: "✎",
      },
    ],
  },
];

function SettingsCard({ title, description, href, icon, primary = false }) {
  return (
    <Link
      to={href}
      className={`rc-settings-hub-card${primary ? " rc-settings-hub-card--primary" : ""}`}
    >
      <span className="rc-settings-hub-card__icon" aria-hidden="true">{icon}</span>
      <span className="rc-settings-hub-card__content">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span className="rc-settings-hub-card__arrow" aria-hidden="true">→</span>
    </Link>
  );
}

export default function SettingsHub() {
  return (
    <s-page heading="Settings">
      <s-section>
        <PageIntro title="Choose what you want to configure.">
          Settings are grouped by purpose so catalog rules, artist access, communication, and maintenance do not compete on one page.
        </PageIntro>
      </s-section>

      <div className="rc-settings-hub">
        {SETTINGS_GROUPS.map((group) => (
          <s-section key={group.title} heading={group.title}>
            <div className="rc-settings-hub-group-intro">{group.description}</div>
            <div className="rc-settings-hub-grid">
              {group.items.map((item) => <SettingsCard key={item.href} {...item} />)}
            </div>
          </s-section>
        ))}
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
