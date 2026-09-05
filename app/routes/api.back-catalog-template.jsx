import { authenticate } from "../shopify.server";
import { buildBackCatalogTemplateCsv } from "../lib/back-catalog-import.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return new Response(buildBackCatalogTemplateCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="releasecore-back-catalog-template.csv"',
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
