function safeText(value, maxLength = 1600) {
  return String(value ?? "")
    .replace(
      /(https?:\/\/[^\s?]+)\?[^\s]+/gi,
      "$1?[redacted]",
    )
    .replace(
      /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi,
      "$1 [redacted]",
    )
    .replace(
      /\b(password|secret|token|access[_-]?key|refresh[_-]?token|authorization)\b\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .slice(0, maxLength);
}

function normalizedStatus(error, fallbackStatus = 500) {
  const candidate = Number(
    error?.status ||
      error?.statusCode ||
      error?.response?.status ||
      fallbackStatus,
  );
  return Number.isInteger(candidate)
    ? candidate
    : fallbackStatus;
}

function normalizedField(field) {
  if (Array.isArray(field)) {
    return field
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(".");
  }
  const value = String(field || "").trim();
  return value || null;
}

function normalizeUserError(item) {
  if (!item) return null;
  if (typeof item === "string") {
    const message = safeText(item, 700);
    return message
      ? { field: null, message, code: null }
      : null;
  }

  const message = safeText(
    item.message || item.error || "",
    700,
  );
  if (!message) return null;

  return {
    field: normalizedField(item.field),
    message,
    code: item.code
      ? safeText(item.code, 120)
      : null,
  };
}

function addUserErrors(target, value) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    const normalized = normalizeUserError(item);
    if (!normalized) continue;
    const key = `${normalized.field || ""}|${normalized.code || ""}|${normalized.message}`;
    if (!target.has(key)) target.set(key, normalized);
  }
}

export function extractShopifyUserErrors(error) {
  const result = new Map();

  addUserErrors(result, error?.shopifyUserErrors);
  addUserErrors(result, error?.userErrors);
  addUserErrors(result, error?.body?.userErrors);
  addUserErrors(result, error?.cause?.userErrors);
  addUserErrors(
    result,
    error?.response?.data?.userErrors,
  );
  addUserErrors(
    result,
    error?.response?.body?.userErrors,
  );

  if (
    Array.isArray(error?.errors) &&
    error.errors.some(
      (item) =>
        item &&
        typeof item === "object" &&
        (item.field || item.code),
    )
  ) {
    addUserErrors(result, error.errors);
  }

  return [...result.values()].slice(0, 20);
}

export function shopifyMutationError(
  message,
  userErrors = [],
  {
    status = 422,
    code = "SHOPIFY_USER_ERROR",
    name = "ReleaseCoreShopifyError",
  } = {},
) {
  const normalized = (userErrors || [])
    .map(normalizeUserError)
    .filter(Boolean);

  const fallback = normalized
    .map((item) => item.message)
    .join(" ");

  const error = new Error(
    safeText(
      message || fallback || "Shopify rejected the operation.",
      1600,
    ),
  );
  error.name = name;
  error.status = status;
  error.code = code;
  error.expose = true;
  error.shopifyUserErrors = normalized;
  return error;
}

function looksLikeNetworkError(message, name) {
  return (
    /network|fetch failed|socket|econnreset|econnrefused|etimedout|timeout|dns|enotfound|connection/i.test(
      `${name} ${message}`,
    )
  );
}

function looksLikeStorageError(message, code) {
  return /r2|s3|object storage|upload|multipart|bucket|nosuchkey|signaturedoesnotmatch/i.test(
    `${code || ""} ${message}`,
  );
}

function looksLikeShopifyError(message, name, code) {
  return /shopify|graphql|productbundle|metafield|publication/i.test(
    `${name} ${code || ""} ${message}`,
  );
}

function resolutionFor(errorClass) {
  return (
    {
      RATE_LIMIT:
        "Retry after Shopify’s rate limit clears. ReleaseCore background jobs will retry transient throttling automatically.",
      AUTHORIZATION:
        "Verify the app is still installed with the required scopes. Reauthorize the Shopify app if access changed.",
      SHOPIFY_USER_ERROR:
        "Review Shopify’s field-level errors below, correct the affected Shopify/catalog value, then retry the operation.",
      SHOPIFY:
        "Retry the operation once. If it repeats, review the linked Shopify product, publication, metafield, or bundle state shown by ReleaseCore.",
      NETWORK:
        "Retry the operation. If the failure repeats, check Shopify/R2 connectivity and the production service status.",
      STORAGE:
        "Retry the file operation. If it repeats, verify R2 credentials, bucket access, and the referenced ReleaseCore file.",
      DATABASE:
        "Retry once. If it repeats, use the request reference to inspect the database constraint or record state before changing data manually.",
      CONFLICT:
        "Reload the latest ReleaseCore state, review the newer values, then repeat the action if it is still required.",
      VALIDATION:
        "Correct the reported data and try again.",
      INTERNAL:
        "Retry once. If the problem repeats, use the request reference in Recent System Issues or Railway logs.",
    }[errorClass] ||
    "Retry once. If the problem repeats, use the request reference in Recent System Issues."
  );
}

export function classifyOperationalError(
  error,
  {
    fallback =
      "ReleaseCore could not complete this request.",
    status = 500,
  } = {},
) {
  const responseStatus = normalizedStatus(error, status);
  const name = safeText(
    error?.name || "Error",
    120,
  );
  const code = error?.code
    ? safeText(error.code, 120)
    : null;
  const rawMessage = safeText(
    error?.message ||
      error ||
      fallback,
    2200,
  );
  const shopifyUserErrors =
    extractShopifyUserErrors(error);

  let errorClass = "INTERNAL";

  if (
    shopifyUserErrors.length ||
    code === "SHOPIFY_USER_ERROR"
  ) {
    errorClass = "SHOPIFY_USER_ERROR";
  } else if (
    responseStatus === 429 ||
    /throttl|rate.?limit/i.test(rawMessage)
  ) {
    errorClass = "RATE_LIMIT";
  } else if (
    [401, 403].includes(responseStatus) ||
    /unauthori[sz]ed|forbidden|access denied|invalid session|scope/i.test(
      rawMessage,
    )
  ) {
    errorClass = "AUTHORIZATION";
  } else if (
    /^P\d{4}$/.test(String(code || "")) ||
    /prisma|database|unique constraint|foreign key/i.test(
      `${name} ${rawMessage}`,
    )
  ) {
    errorClass = "DATABASE";
  } else if (
    looksLikeStorageError(rawMessage, code)
  ) {
    errorClass = "STORAGE";
  } else if (
    looksLikeNetworkError(rawMessage, name)
  ) {
    errorClass = "NETWORK";
  } else if (
    looksLikeShopifyError(
      rawMessage,
      name,
      code,
    )
  ) {
    errorClass = "SHOPIFY";
  } else if (responseStatus === 409) {
    errorClass = "CONFLICT";
  } else if (
    responseStatus === 400 ||
    responseStatus === 404 ||
    responseStatus === 422
  ) {
    errorClass = "VALIDATION";
  }

  const retryable =
    errorClass === "RATE_LIMIT" ||
    errorClass === "NETWORK" ||
    errorClass === "STORAGE" ||
    errorClass === "SHOPIFY" ||
    errorClass === "INTERNAL" ||
    responseStatus === 408 ||
    responseStatus >= 500;

  const exposed =
    error?.expose === true ||
    responseStatus < 500;

  const safeMessage = safeText(
    exposed && error?.message
      ? error.message
      : fallback,
    1600,
  );

  const severity =
    ["AUTHORIZATION", "DATABASE", "INTERNAL"].includes(
      errorClass,
    )
      ? "CRITICAL"
      : retryable ||
          errorClass === "SHOPIFY_USER_ERROR" ||
          errorClass === "SHOPIFY" ||
          errorClass === "STORAGE"
        ? "ERROR"
        : "WARNING";

  return {
    status: responseStatus,
    errorClass,
    errorCode: code,
    retryable,
    severity,
    safeMessage,
    technicalMessage: rawMessage,
    resolution: resolutionFor(errorClass),
    shopifyUserErrors,
  };
}

export function shouldRecordOperationalIssue(
  classification,
) {
  if (!classification) return false;

  if (
    classification.status >= 500 ||
    classification.status === 408 ||
    classification.status === 429
  ) {
    return true;
  }

  return [
    "AUTHORIZATION",
    "DATABASE",
    "INTERNAL",
    "NETWORK",
    "STORAGE",
    "SHOPIFY",
    "SHOPIFY_USER_ERROR",
    "RATE_LIMIT",
  ].includes(classification.errorClass);
}
