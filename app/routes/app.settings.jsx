import {
  Link,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  PageIntro,
} from "../components/releasecore-ui";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

const SETTINGS_GROUPS = [
  {
    title: "Release workflow",
    description:
      "The core rules ReleaseCore uses when artists submit and products are prepared.",
    items: [
      {
        title: "Release preferences",
        description:
          "Submission requirements, ISRC/UPC/catalog assignment, pricing, downloads, audio previews, and Shopify product defaults.",
        href: "/app/settings/preferences",
        icon: "⚙",
        primary: true,
      },
      {
        title: "Import catalog",
        description:
          "Bring existing Shopify music products into ReleaseCore without duplicating records already imported.",
        href: "/app/import",
        icon: "↥",
      },
      {
        title: "Contributors",
        description:
          "Manage reusable contributor identities used for track credits and publishing information.",
        href: "/app/contributors",
        icon: "◎",
      },
    ],
  },
  {
    title: "Artists & customer access",
    description:
      "Configure who can see artist-facing tools and how customer experiences connect to ReleaseCore.",
    items: [
      {
        title: "Portal access",
        description:
          "Assign Shopify customers to artists and control which artist catalog they can access.",
        href: "/app/portal-access",
        icon: "◉",
      },
      {
        title: "Storefront setup",
        description:
          "Configure ReleaseCore storefront blocks, artist profiles, and customer-facing integration.",
        href: "/app/storefront-setup",
        icon: "▣",
      },
      {
        title: "Purchases & downloads",
        description:
          "Review digital purchases and customer download delivery from the ReleaseCore catalog.",
        href: "/app/purchases",
        icon: "↓",
      },
    ],
  },
  {
    title: "Automation & communication",
    description:
      "Tools that run in the background or communicate workflow changes.",
    items: [
      {
        title: "Automation",
        description:
          "Configure automatic workflow behavior and recurring ReleaseCore actions.",
        href: "/app/automation",
        icon: "↻",
      },
      {
        title: "Notifications",
        description:
          "Review notification delivery and communication activity.",
        href: "/app/notifications",
        icon: "◇",
      },
    ],
  },
  {
    title: "System & support",
    description:
      "Diagnostics, compliance, and tools you normally only need when something requires attention.",
    items: [
      {
        title: "Data maintenance",
        description:
          "Find duplicate identities, merge artist or contributor records, repair catalog drift, and review safe cleanup opportunities.",
        href: "/app/data-hygiene",
        icon: "⌁",
      },
      {
        title: "Production safety",
        description:
          "Verify deployment-profile guards, mutation replay protection, and recent protected administrative writes.",
        href: "/app/production-safety",
        icon: "⊙",
      },
      {
        title: "System issues",
        description:
          "Inspect recent production errors, request references, retryability, and recommended resolutions.",
        href: "/app/system-issues",
        icon: "!",
      },
      {
        title: "Feedback",
        description:
          "Report a problem, suggest an improvement, or attach feedback to a recent System Issue.",
        href: "/app/feedback?from=%2Fapp%2Fsettings",
        icon: "✎",
      },
      {
        title: "Privacy",
        description:
          "Review privacy and compliance requests handled by ReleaseCore.",
        href: "/app/privacy",
        icon: "◌",
      },
    ],
  },
];

function SettingsCard({
  title,
  description,
  href,
  icon,
  primary = false,
}) {
  return (
    <Link
      to={href}
      className={`rc-settings-hub-card${
        primary
          ? " rc-settings-hub-card--primary"
          : ""
      }`}
    >
      <span
        className="rc-settings-hub-card__icon"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="rc-settings-hub-card__content">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span
        className="rc-settings-hub-card__arrow"
        aria-hidden="true"
      >
        →
      </span>
    </Link>
  );
}

export default function SettingsHub() {
  return (
    <s-page heading="Settings">
      <s-section>
        <PageIntro
          eyebrow="ReleaseCore"
          title="Settings & tools"
        >
          Keep the main navigation focused on daily
          release work. Configuration, storefront,
          automation, diagnostics, and other
          lower-traffic tools live here.
        </PageIntro>
      </s-section>

      <div className="rc-settings-hub">
        {SETTINGS_GROUPS.map((group) => (
          <s-section
            key={group.title}
            heading={group.title}
          >
            <div className="rc-settings-hub-group-intro">
              {group.description}
            </div>
            <div className="rc-settings-hub-grid">
              {group.items.map((item) => (
                <SettingsCard
                  key={item.href}
                  {...item}
                />
              ))}
            </div>
          </s-section>
        ))}
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) =>
  boundary.headers(headersArgs);
