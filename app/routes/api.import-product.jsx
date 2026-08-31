import { authenticate } from "../shopify.server";
import { importShopifyProductAsRelease } from "../lib/import-product.server";

export const action = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const form = await request.formData();
    const result = await importShopifyProductAsRelease({
      admin,
      shop: session.shop,
      productId: String(form.get("productId") || ""),
      requestedType: String(form.get("type") || "AUTO"),
      importState: String(form.get("importState") || "CATALOG"),
      titleOverride: String(form.get("titleOverride") || ""),
      artistOverride: String(form.get("artistOverride") || ""),
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("ReleaseCore import product error", error);
    return Response.json({ ok: false, error: error.message || "Could not import Shopify product." }, { status: 400 });
  }
};
