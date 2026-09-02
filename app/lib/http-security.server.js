import { randomUUID } from "node:crypto";

export class ReleaseCorePublicError extends Error {
  constructor(message, { status = 400, code = null } = {}) {
    super(message);
    this.name = "ReleaseCorePublicError";
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

export function publicError(message, options) {
  return new ReleaseCorePublicError(message, options);
}

export function isPublicError(error) {
  return error instanceof ReleaseCorePublicError || error?.expose === true;
}

export function safeDiagnosticText(value, maxLength = 4000) {
  return String(value ?? "")
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, "$1?[redacted]")
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(password|secret|token|access[_-]?key|refresh[_-]?token|authorization)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, maxLength);
}

function safeErrorDetails(error) {
  if (error instanceof Error) {
    return {
      name: safeDiagnosticText(error.name, 120),
      message: safeDiagnosticText(error.message),
      ...(process.env.NODE_ENV !== "production" && error.stack
        ? { stack: safeDiagnosticText(error.stack, 12000) }
        : {}),
    };
  }
  return { message: safeDiagnosticText(error) || "Unknown error" };
}

export function createRequestId() {
  return `rc_${randomUUID()}`;
}

export function logServerError({ requestId, context, error, shop = null }) {
  console.error("ReleaseCore server error", {
    requestId,
    context: safeDiagnosticText(context, 160),
    shop: shop ? safeDiagnosticText(shop, 260) : undefined,
    error: safeErrorDetails(error),
  });
}

export function apiErrorResponse(
  request,
  error,
  {
    context = "request",
    fallback = "ReleaseCore could not complete this request.",
    status = 500,
    shop = null,
  } = {},
) {
  if (error instanceof Response) return error;

  const requestId = createRequestId(request);
  const exposed = isPublicError(error);
  const responseStatus = exposed && Number.isInteger(error.status) ? error.status : status;
  const message = exposed && error?.message ? error.message : fallback;

  if (!exposed) logServerError({ requestId, context, error, shop });

  return Response.json(
    {
      ok: false,
      error: message,
      requestId,
      ...(exposed && error?.code ? { code: error.code } : {}),
      ...(exposed && Array.isArray(error?.blockers) ? { blockers: error.blockers } : {}),
    },
    {
      status: responseStatus,
      headers: {
        "Cache-Control": "no-store",
        "X-ReleaseCore-Request-ID": requestId,
      },
    },
  );
}
