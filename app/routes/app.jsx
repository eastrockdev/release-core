import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/releases">Releases</s-link>
        <s-link href="/app/import">Import</s-link>
        <s-link href="/app/submissions">Submissions</s-link>
        <s-link href="/app/distribution">Distribution</s-link>
        <s-link href="/app/artists">Artists</s-link>
        <s-link href="/app/contributors">Contributors</s-link>
        <s-link href="/app/portal-access">Portal access</s-link>
        <s-link href="/app/automation">Automation</s-link>
        <s-link href="/app/notifications">Notifications</s-link>
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
