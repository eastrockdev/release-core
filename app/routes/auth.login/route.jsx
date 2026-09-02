import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { login } from "../../shopify.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    await login(request);
  }
  return null;
};

export default function AuthLogin() {
  return (
    <AppProvider embedded={false}>
      <s-page heading="Open ReleaseCore from Shopify">
        <s-section>
          <p>ReleaseCore installation and authentication begin on Shopify. Open Apps in Shopify Admin and select ReleaseCore to continue.</p>
          <p>This page does not accept manually entered shop domains.</p>
        </s-section>
      </s-page>
    </AppProvider>
  );
}
