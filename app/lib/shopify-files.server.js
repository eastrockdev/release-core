import { safeDiagnosticText } from "./http-security.server";

/**
 * Best-effort Shopify Files cleanup for replaced/generated assets.
 *
 * Database state must already be committed before calling this helper. Cleanup
 * failures are logged and returned to the caller but never roll back the user
 * action that replaced the file.
 */
export async function deleteShopifyFilesBestEffort(
  admin,
  fileIds,
  { context = "Shopify file cleanup" } = {},
) {
  const ids = [...new Set((Array.isArray(fileIds) ? fileIds : [fileIds]).filter(Boolean))];
  if (!admin || !ids.length) return { deletedFileIds: [], errors: [] };

  try {
    const response = await admin.graphql(
      `#graphql
        mutation ReleaseCoreDeleteFiles($fileIds: [ID!]!) {
          fileDelete(fileIds: $fileIds) {
            deletedFileIds
            userErrors { field message code }
          }
        }
      `,
      { variables: { fileIds: ids } },
    );
    const json = await response.json();
    const payload = json?.data?.fileDelete;
    const errors = payload?.userErrors || [];
    if (errors.length) {
      console.warn("ReleaseCore Shopify Files cleanup warning", {
        context: safeDiagnosticText(context, 160),
        errors: errors.map((item) => ({
          code: item?.code || null,
          field: item?.field || null,
          message: safeDiagnosticText(item?.message || "Unknown Shopify Files error", 500),
        })),
      });
    }
    return { deletedFileIds: payload?.deletedFileIds || [], errors };
  } catch (error) {
    console.warn("ReleaseCore Shopify Files cleanup failed", {
      context: safeDiagnosticText(context, 160),
      error: safeDiagnosticText(error instanceof Error ? error.message : error),
    });
    return { deletedFileIds: [], errors: [{ message: "Cleanup request failed." }] };
  }
}
