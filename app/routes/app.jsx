import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import "../styles/releasecore-admin.css";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [submissions, distribution] = await Promise.all([
    db.release.count({ where: { shop: session.shop, status: { in: ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"] } } }),
    db.release.count({ where: { shop: session.shop, distributionStatus: { in: ["NOT_QUEUED", "READY", "PROCESSING", "RETURNED"] }, status: "APPROVED" } }),
  ]);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", navCounts: { submissions, distribution } };
};

function NavLabel({ children, count }) {
  return <span className="rc-nav-label"><span>{children}</span>{count > 0 ? <span className="rc-nav-count" aria-label={`${count} items requiring attention`}>{count > 99 ? "99+" : count}</span> : null}</span>;
}

export default function App() {
  const { apiKey, navCounts } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/releases">Releases</s-link>
        <s-link href="/app/import">Import</s-link>
        <s-link href="/app/submissions"><NavLabel count={navCounts.submissions}>Submissions</NavLabel></s-link>
        <s-link href="/app/distribution"><NavLabel count={navCounts.distribution}>Distribution</NavLabel></s-link>
        <s-link href="/app/purchases">Purchases</s-link>
        <s-link href="/app/artists">Artists</s-link>
        <s-link href="/app/contributors">Contributors</s-link>
        <s-link href="/app/portal-access">Portal access</s-link>
        <s-link href="/app/storefront-setup">Storefront setup</s-link>
        <s-link href="/app/automation">Automation</s-link>
        <s-link href="/app/notifications">Notifications</s-link>
        <s-link href="/app/privacy">Privacy</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
