import {
  Outlet,
  useLoaderData,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { StalledOperationRecovery } from "../components/stalled-operation-recovery";
import "../styles/releasecore-admin.css";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [submissions, distribution] = await Promise.all([
    db.release.count({ where: { shop: session.shop, status: { in: ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"] } } }),
    db.release.count({ where: { shop: session.shop, distributionStatus: { in: ["NOT_QUEUED", "READY", "PROCESSING", "RETURNED"] }, status: "APPROVED" } }),
  ]);

  return {
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    navCounts: {
      submissions,
      distribution,
    },
  };
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
        <s-link href="/app/operations">Operations</s-link>
        <s-link href="/app/releases">Releases</s-link>
        <s-link href="/app/submissions"><NavLabel count={navCounts.submissions}>Submissions</NavLabel></s-link>
        <s-link href="/app/distribution"><NavLabel count={navCounts.distribution}>Distribution</NavLabel></s-link>
        <s-link href="/app/artists">Artists</s-link>
        <s-link href="/app/moderation">Moderation</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
      <StalledOperationRecovery />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};