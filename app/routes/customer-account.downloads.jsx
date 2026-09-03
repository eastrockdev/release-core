import { authenticate } from "../shopify.server";
import {
  buildCustomerAccountLibrary,
  customerIdFromSubject,
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
  const { cors, sessionToken } =
    await authenticate.public.customerAccount(request);

  const shop = shopFromCustomerAccountDestination(
    sessionToken?.dest,
  );
  const customerId = customerIdFromSubject(
    sessionToken?.sub,
  );

  if (!shop || !customerId) {
    return corsJson(cors, {
      ok: false,
      error:
        "Music downloads require a signed-in customer account and approved customer-data access for ReleaseCore.",
      library: {
        releases: [],
        formats: [],
        summary: {
          releases: 0,
          tracks: 0,
          downloads: 0,
        },
      },
    });
  }

  try {
    const library = await buildCustomerAccountLibrary({
      shop,
      customerId,
    });

    return corsJson(cors, {
      ok: true,
      library,
    });
  } catch (error) {
    return corsJson(
      cors,
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "ReleaseCore could not load purchased music.",
      },
      { status: 500 },
    );
  }
};
