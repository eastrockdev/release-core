import { authenticate } from "../shopify.server";
import {
  importBackCatalogCsv,
  previewBackCatalogCsv,
} from "../lib/back-catalog-import.server";
import { apiErrorResponse } from "../lib/http-security.server";

export const action = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    const form = await request.formData();
    const intent = String(form.get("intent") || "preview");
    const artistId = String(form.get("artistId") || "").trim();
    const csvText = String(form.get("csvText") || "");
    const importState = String(form.get("importState") || "CATALOG");

    if (intent === "import") {
      const result = await importBackCatalogCsv({
        shop: session.shop,
        artistId,
        csvText,
        importState,
      });
      return Response.json({ ok: true, ...result });
    }

    const preview = await previewBackCatalogCsv({
      shop: session.shop,
      artistId,
      csvText,
    });

    return Response.json({ ok: true, preview });
  } catch (error) {
    return apiErrorResponse(request, error, {
      context: "back catalog CSV import",
      fallback: "ReleaseCore could not process this back catalog CSV.",
    });
  }
};
