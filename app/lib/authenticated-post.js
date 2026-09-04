export async function authenticatedPost(shopify, url, formData) {
  // Shopify App Bridge ID tokens are intentionally short lived. Fetch a fresh
  // token for every mutation and send it explicitly to our own backend.
  const idToken = await shopify.idToken();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      Accept: "application/json",
    },
    body: formData,
  });

  const contentType = response.headers.get("content-type") || "";
  let data = null;

  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    const text = await response.text();
    data = { error: text || `Request failed with status ${response.status}.` };
  }

  if (!response.ok || data?.ok === false) {
    const message =
      data?.error ||
      `Request failed with status ${response.status}.`;
    const resolution = data?.resolution
      ? ` ${data.resolution}`
      : "";
    const reference = data?.requestId
      ? ` Reference: ${data.requestId}.`
      : "";
    const error = new Error(
      `${message}${resolution}${reference}`,
    );
    error.name = "ReleaseCoreRequestError";
    error.status = response.status;
    error.requestId = data?.requestId || null;
    error.code = data?.code || null;
    error.errorClass =
      data?.errorClass || null;
    error.retryable =
      Boolean(data?.retryable);
    error.resolution =
      data?.resolution || null;
    error.shopifyUserErrors =
      data?.shopifyUserErrors || [];
    throw error;
  }

  return data;
}
