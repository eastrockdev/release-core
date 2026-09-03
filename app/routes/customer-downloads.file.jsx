import { Readable } from "node:stream";

import {
  getR2SignedReadUrl,
  localStorageReadStream,
  localStorageStat,
} from "../lib/storage.server";
import {
  resolveCustomerAccountDownload,
} from "../lib/commerce-library.server";

function safeFilename(value, fallback) {
  return String(value || fallback)
    .replace(/["\r\n]/g, "_");
}

function statusOf(error) {
  const value = Number(error?.status || error?.statusCode);
  return Number.isInteger(value) &&
    value >= 400 &&
    value <= 599
    ? value
    : 500;
}

export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);

    const {
      file,
      format,
    } = await resolveCustomerAccountDownload({
      entitlementId: url.searchParams.get("entitlement"),
      format: url.searchParams.get("format"),
      expires: url.searchParams.get("expires"),
      token: url.searchParams.get("token"),
    });

    const mimeType =
      file.mimeType ||
      (format === "flac" ? "audio/flac" : "audio/mpeg");
    const filename = safeFilename(
      file.filename,
      `download.${format}`,
    );

    if (file.storageProvider === "R2") {
      const signedUrl = await getR2SignedReadUrl(
        file.storageKey,
        {
          filename,
          mimeType,
          disposition: "attachment",
        },
      );

      return new Response(null, {
        status: 302,
        headers: {
          Location: signedUrl,
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }

    if (file.storageProvider !== "LOCAL_DEV") {
      return new Response("Download not available.", {
        status: 404,
      });
    }

    const info = await localStorageStat(file.storageKey);
    const stream = localStorageReadStream(file.storageKey);

    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(info.size),
        "Content-Disposition":
          `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    const status = statusOf(error);
    return new Response(
      status >= 500
        ? "ReleaseCore could not prepare this download."
        : error instanceof Error
          ? error.message
          : "Download unavailable.",
      {
        status,
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
};
