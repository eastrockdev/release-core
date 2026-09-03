import { authenticate } from "../shopify.server";
import { processPaidOrder } from "../lib/commerce-entitlements.server";
import { prepareCustomerDownloadFilesForTracks } from "../lib/customer-downloads.server";

export const action = async ({ request }) => {
  const { payload, shop } = await authenticate.webhook(request);
  const result = await processPaidOrder({ shop, payload });

  if (result.trackIds?.length) {
    void prepareCustomerDownloadFilesForTracks({
      shop,
      trackIds: result.trackIds,
    })
      .then((prepared) => {
        if (prepared.errors.length) {
          console.warn(
            "ReleaseCore customer derivative preparation completed with warnings",
            {
              shop,
              errors: prepared.errors,
            },
          );
        }
      })
      .catch((error) => {
        console.warn("ReleaseCore customer derivative preparation failed", {
          shop,
          message:
            error instanceof Error
              ? error.message
              : "Customer derivative preparation failed.",
        });
      });
  }

  return new Response(null, { status: 200 });
};
