import { randomUUID } from "node:crypto";
import {
  classifyOperationalError,
  shouldRecordOperationalIssue,
} from "./operational-errors";
import { recordSystemIssue } from "./system-issues.server";

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
    operation = null,
    releaseId = null,
    trackId = null,
  } = {},
) {
  if (error instanceof Response) return error;

  const requestId = createRequestId(request);
  const exposed = isPublicError(error);
  const responseStatus = exposed && Number.isInteger(error.status) ? error.status : status;
  const message = exposed && error?.message ? error.message : fallback;
  const classification = classifyOperationalError(
    error,
    {
      fallback: message,
      status: responseStatus,
    },
  );

  if (!exposed) {
    logServerError({
      requestId,
      context,
      error,
      shop,
    });
  }

  if (
    shop &&
    shouldRecordOperationalIssue(classification)
  ) {
    void recordSystemIssue({
      shop,
      source: "API",
      operation: operation || context,
      releaseId,
      trackId,
      requestId,
      error,
      classification,
    }).catch((issueError) => {
      console.warn(
        "ReleaseCore system issue could not be persisted",
        {
          requestId,
          message: safeDiagnosticText(
            issueError instanceof Error
              ? issueError.message
              : issueError,
            700,
          ),
        },
      );
    });
  }

  return Response.json(
    {
      ok: false,
      error: message,
      requestId,
      errorClass: classification.errorClass,
      retryable: classification.retryable,
      resolution: classification.resolution,
      ...(classification.shopifyUserErrors.length
        ? {
            shopifyUserErrors:
              classification.shopifyUserErrors,
          }
        : {}),
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
