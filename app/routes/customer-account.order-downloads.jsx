import { authenticate } from "../shopify.server";
import {
  buildCustomerOrderDownloads,
  customerIdFromSubject,
  orderStatusHasReleaseCoreProducts,
  shopFromCustomerAccountDestination,
} from "../lib/commerce-library.server";

export const loader = async ({ request }) => {
  await authenticate.public.customerAccount(request);
  return null;
};

function corsJson(cors, body, init) {
  return cors(Response.json(body, init));
}

export const action = async ({ request }) => {
  const { cors, sessionToken } = await authenticate.public.customerAccount(request);
  const shop = shopFromCustomerAccountDestination(sessionToken?.dest);
  if (!shop) return corsJson(cors, { ok: false, error: "ReleaseCore could not identify this store." }, { status: 401 });

  let payload = {};
  try { payload = await request.json(); } catch { /* validated below */ }
  const intent = String(payload?.intent || "");

  if (intent === "probe") {
    const hasMusic = await orderStatusHasReleaseCoreProducts({ shop, productIds: payload?.productIds });
    return corsJson(cors, { ok: true, hasMusic });
  }

  if (intent === "library") {
    const customerId = customerIdFromSubject(sessionToken?.sub);
    if (!customerId) return corsJson(cors, { ok: false, requiresLogin: true, error: "Sign in to securely access your purchased music." }, { status: 401 });
    const orderId = String(payload?.orderId || "").trim();
    if (!orderId) return corsJson(cors, { ok: false, error: "ReleaseCore could not identify this order." }, { status: 400 });
    try {
      const library = await buildCustomerOrderDownloads({ shop, customerId, orderId });
      return corsJson(cors, { ok: true, library });
    } catch (error) {
      return corsJson(cors, { ok: false, error: error instanceof Error ? error.message : "ReleaseCore could not load music for this order." }, { status: 500 });
    }
  }

  return corsJson(cors, { ok: false, error: "Unknown ReleaseCore order-status request." }, { status: 400 });
};
