import path from "node:path";
import { mkdir, unlink, stat } from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const ROOT = path.resolve(process.cwd(), "storage", "releasecore-uploads");
const R2_UPLOAD_TTL_SECONDS = 10 * 60;
const R2_MULTIPART_UPLOAD_TTL_SECONDS = 60 * 60;
const R2_READ_TTL_SECONDS = 5 * 60;

export const R2_MULTIPART_THRESHOLD_BYTES = 30 * 1024 * 1024;
export const R2_MULTIPART_PART_SIZE_BYTES = 10 * 1024 * 1024;

function safeSegment(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function safeFilename(value) {
  return String(value || "master.wav")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .slice(-180);
}

function configuredMasterProvider() {
  const value = String(process.env.RELEASECORE_MASTER_STORAGE || "").trim().toUpperCase();
  const production = process.env.NODE_ENV === "production";
  if (value === "R2") return "R2";
  if (!production && (!value || value === "LOCAL_DEV")) return "LOCAL_DEV";
  if (production) {
    throw new Error("ReleaseCore production master storage must be configured as R2.");
  }
  throw new Error("RELEASECORE_MASTER_STORAGE must be R2 or LOCAL_DEV.");
}

export function masterStorageProvider() {
  return configuredMasterProvider();
}

function r2Settings() {
  const accountId = String(process.env.R2_ACCOUNT_ID || "").trim();
  const endpoint =
    String(process.env.R2_ENDPOINT || "").trim() ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || "").trim();
  const bucket = String(process.env.R2_BUCKET || "").trim();

  const missing = [];
  if (!endpoint) missing.push("R2_ENDPOINT or R2_ACCOUNT_ID");
  if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!bucket) missing.push("R2_BUCKET");

  if (missing.length) {
    throw new Error(`R2 is selected but these variables are missing: ${missing.join(", ")}.`);
  }

  return { endpoint, accessKeyId, secretAccessKey, bucket };
}

let r2Client = null;
let r2ClientSignature = "";

function getR2Client() {
  const settings = r2Settings();
  const signature = `${settings.endpoint}|${settings.accessKeyId}`;

  if (!r2Client || r2ClientSignature !== signature) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: settings.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    });
    r2ClientSignature = signature;
  }

  return { client: r2Client, bucket: settings.bucket };
}

function masterPrefix({ shop, releaseId, trackId }) {
  return [
    "masters",
    safeSegment(shop),
    safeSegment(releaseId),
    safeSegment(trackId),
  ].join("/") + "/";
}

function assertR2MasterKeyScope(storageKey, scope) {
  const key = String(storageKey || "");
  const prefix = masterPrefix(scope);
  if (!key || !key.startsWith(prefix)) {
    throw new Error("The master storage key is outside this release/track scope.");
  }
}

function localMasterPrefix({ shop, releaseId, trackId }) {
  return [safeSegment(shop), safeSegment(releaseId), safeSegment(trackId)].join(path.sep) + path.sep;
}

function assertLocalMasterKeyScope(storageKey, scope) {
  const key = path.normalize(String(storageKey || ""));
  const prefix = localMasterPrefix(scope);
  if (!key || key.startsWith(`..${path.sep}`) || !key.startsWith(prefix)) {
    throw new Error("The local master storage key is outside this release/track scope.");
  }
}

export function localStoragePath(storageKey) {
  if (!storageKey) throw new Error("A local storage key is required.");
  const fullPath = path.resolve(ROOT, storageKey);
  if (!fullPath.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error("Unsafe local storage path.");
  }
  return fullPath;
}

export async function localStorageStat(storageKey) {
  return stat(localStoragePath(storageKey));
}

export function localStorageReadStream(storageKey, options = {}) {
  return createReadStream(localStoragePath(storageKey), options);
}

export async function saveMasterStream({ stream, shop, releaseId, trackId, filename }) {
  if (!stream) throw new Error("The upload did not contain a file stream.");
  const relativeDirectory = path.join(
    safeSegment(shop),
    safeSegment(releaseId),
    safeSegment(trackId),
  );
  const directory = path.join(ROOT, relativeDirectory);
  await mkdir(directory, { recursive: true });

  const storedName = `${randomUUID()}-${safeFilename(filename)}`;
  const fullPath = path.join(directory, storedName);
  await pipeline(
    Readable.fromWeb(stream),
    createWriteStream(fullPath, { flags: "wx" }),
  );

  return path.relative(ROOT, fullPath);
}

export async function deleteLocalStorageKey(storageKey) {
  if (!storageKey) return;
  try {
    await unlink(localStoragePath(storageKey));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function createR2MasterUploadTarget({
  shop,
  releaseId,
  trackId,
  filename,
  mimeType,
  sizeBytes,
}) {
  if (masterStorageProvider() !== "R2") {
    return { provider: "LOCAL_DEV" };
  }

  const { client, bucket } = getR2Client();
  const storageKey =
    `${masterPrefix({ shop, releaseId, trackId })}${randomUUID()}-${safeFilename(filename)}`;

  const contentType = String(mimeType || "audio/wav");
  const uploadSize = Number(sizeBytes || 0);

  if (uploadSize > R2_MULTIPART_THRESHOLD_BYTES) {
    const created = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: storageKey,
        ContentType: contentType,
      }),
    );

    if (!created.UploadId) {
      throw new Error("R2 did not return a multipart upload ID.");
    }

    const partCount = Math.ceil(uploadSize / R2_MULTIPART_PART_SIZE_BYTES);
    const parts = await Promise.all(
      Array.from({ length: partCount }, async (_, index) => {
        const partNumber = index + 1;
        const uploadUrl = await getSignedUrl(
          client,
          new UploadPartCommand({
            Bucket: bucket,
            Key: storageKey,
            UploadId: created.UploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: R2_MULTIPART_UPLOAD_TTL_SECONDS },
        );

        return { partNumber, uploadUrl, method: "PUT", headers: {} };
      }),
    );

    return {
      provider: "R2",
      mode: "MULTIPART",
      storageKey,
      uploadId: created.UploadId,
      partSize: R2_MULTIPART_PART_SIZE_BYTES,
      parts,
      expiresIn: R2_MULTIPART_UPLOAD_TTL_SECONDS,
    };
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: R2_UPLOAD_TTL_SECONDS,
  });

  return {
    provider: "R2",
    mode: "SINGLE_PUT",
    storageKey,
    uploadUrl,
    method: "PUT",
    headers: { "Content-Type": contentType },
    expiresIn: R2_UPLOAD_TTL_SECONDS,
  };
}

function normalizeCompletedMultipartParts(parts, expectedSize) {
  const expectedCount = Math.ceil(
    Number(expectedSize || 0) / R2_MULTIPART_PART_SIZE_BYTES,
  );
  const submitted = Array.isArray(parts) ? parts : [];

  if (!expectedCount || submitted.length !== expectedCount) {
    throw new Error(
      `Multipart completion expected ${expectedCount} parts and received ${submitted.length}.`,
    );
  }

  const normalized = submitted
    .map((part) => ({
      PartNumber: Number(part?.partNumber),
      ETag: String(part?.etag || "").trim(),
    }))
    .sort((a, b) => a.PartNumber - b.PartNumber);

  for (let index = 0; index < normalized.length; index += 1) {
    const part = normalized[index];
    if (part.PartNumber !== index + 1 || !part.ETag) {
      throw new Error("Multipart completion contained an invalid part list.");
    }
  }

  return normalized;
}

export async function completeR2MultipartMasterUpload({
  shop,
  releaseId,
  trackId,
  storageKey,
  uploadId,
  parts,
  expectedSize,
}) {
  assertR2MasterKeyScope(storageKey, { shop, releaseId, trackId });
  if (!uploadId) throw new Error("The multipart upload ID is missing.");

  const { client, bucket } = getR2Client();
  const completedParts = normalizeCompletedMultipartParts(parts, expectedSize);
  return client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: storageKey,
      UploadId: uploadId,
      MultipartUpload: { Parts: completedParts },
    }),
  );
}

export async function abortR2MultipartMasterUpload({
  shop,
  releaseId,
  trackId,
  storageKey,
  uploadId,
}) {
  assertR2MasterKeyScope(storageKey, { shop, releaseId, trackId });
  if (!uploadId) throw new Error("The multipart upload ID is missing.");

  const { client, bucket } = getR2Client();
  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: storageKey,
      UploadId: uploadId,
    }),
  );
}

export async function verifyR2MasterObject({
  shop,
  releaseId,
  trackId,
  storageKey,
  expectedSize,
  expectedMimeType,
}) {
  assertR2MasterKeyScope(storageKey, { shop, releaseId, trackId });
  const { client, bucket } = getR2Client();

  const result = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: storageKey }),
  );

  const actualSize = Number(result.ContentLength || 0);
  const wantedSize = Number(expectedSize || 0);
  if (!actualSize || !wantedSize || actualSize !== wantedSize) {
    throw new Error(
      `R2 master size verification failed (expected ${wantedSize}, received ${actualSize}).`,
    );
  }

  const actualType = String(result.ContentType || "").toLowerCase();
  const wantedType = String(expectedMimeType || "").toLowerCase();
  if (wantedType && actualType && actualType !== wantedType) {
    throw new Error(
      `R2 master content type verification failed (expected ${wantedType}, received ${actualType}).`,
    );
  }

  return {
    sizeBytes: actualSize,
    mimeType: result.ContentType || expectedMimeType || "audio/wav",
    etag: result.ETag || null,
  };
}

export async function deleteR2StorageKey(storageKey) {
  if (!storageKey) return;
  const { client, bucket } = getR2Client();
  await client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }),
  );
}

export async function deleteMasterStorageObject({
  storageProvider,
  storageKey,
  shop,
  releaseId,
  trackId,
}) {
  if (!storageKey) return;
  const scope = { shop, releaseId, trackId };
  if (storageProvider === "R2") {
    assertR2MasterKeyScope(storageKey, scope);
    await deleteR2StorageKey(storageKey);
    return;
  }
  if (storageProvider === "LOCAL_DEV") {
    assertLocalMasterKeyScope(storageKey, scope);
    await deleteLocalStorageKey(storageKey);
    return;
  }
  throw new Error(`Unsupported master storage provider: ${storageProvider || "unknown"}.`);
}

function customerDerivativePrefix({ shop, releaseId, trackId }) {
  return [
    "customer-downloads",
    safeSegment(shop),
    safeSegment(releaseId),
    safeSegment(trackId),
  ].join("/") + "/";
}

function localCustomerDerivativePrefix({ shop, releaseId, trackId }) {
  return (
    path.join(
      "customer-downloads",
      safeSegment(shop),
      safeSegment(releaseId),
      safeSegment(trackId),
    ) + path.sep
  );
}

export async function saveCustomerDerivativeFile({
  sourcePath,
  shop,
  releaseId,
  trackId,
  filename,
  mimeType,
}) {
  if (!sourcePath) throw new Error("A derivative source path is required.");

  if (masterStorageProvider() === "R2") {
    const { client, bucket } = getR2Client();
    const storageKey =
      `${customerDerivativePrefix({ shop, releaseId, trackId })}` +
      `${randomUUID()}-${safeFilename(filename)}`;

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        Body: createReadStream(sourcePath),
        ContentType: mimeType || "application/octet-stream",
        CacheControl: "private, no-store",
      }),
    );

    return { storageProvider: "R2", storageKey };
  }

  const relativeDirectory = localCustomerDerivativePrefix({
    shop,
    releaseId,
    trackId,
  });
  await mkdir(path.join(ROOT, relativeDirectory), { recursive: true });

  const storageKey = path.join(
    relativeDirectory,
    `${randomUUID()}-${safeFilename(filename)}`,
  );

  await pipeline(
    createReadStream(sourcePath),
    createWriteStream(localStoragePath(storageKey), { flags: "wx" }),
  );

  return { storageProvider: "LOCAL_DEV", storageKey };
}

export async function deleteCustomerDerivativeFile({
  storageProvider,
  storageKey,
  shop,
  releaseId,
  trackId,
}) {
  if (!storageKey) return;

  if (storageProvider === "R2") {
    const prefix = customerDerivativePrefix({ shop, releaseId, trackId });
    if (!String(storageKey).startsWith(prefix)) {
      throw new Error(
        "The derivative storage key is outside this release/track scope.",
      );
    }
    await deleteR2StorageKey(storageKey);
    return;
  }

  if (storageProvider === "LOCAL_DEV") {
    const normalized = path.normalize(String(storageKey));
    const prefix = localCustomerDerivativePrefix({
      shop,
      releaseId,
      trackId,
    });

    if (
      normalized.startsWith(`..${path.sep}`) ||
      !normalized.startsWith(prefix)
    ) {
      throw new Error(
        "The local derivative storage key is outside this release/track scope.",
      );
    }

    await deleteLocalStorageKey(storageKey);
    return;
  }

  throw new Error(
    `Unsupported customer derivative storage provider: ${
      storageProvider || "unknown"
    }.`,
  );
}

export async function getR2SignedReadUrl(
  storageKey,
  { filename = "master.wav", mimeType = "audio/wav", expiresIn = R2_READ_TTL_SECONDS, disposition = "inline" } = {},
) {
  if (!storageKey) throw new Error("An R2 storage key is required.");
  const { client, bucket } = getR2Client();

  const safeDownloadName = safeFilename(filename).replace(/["\r\n]/g, "_");
  const safeDisposition = disposition === "attachment" ? "attachment" : "inline";
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    ResponseContentDisposition: `${safeDisposition}; filename="${safeDownloadName}"`,
    ResponseContentType: mimeType || "audio/wav",
  });

  return getSignedUrl(client, command, {
    expiresIn: Math.max(60, Math.min(3600, Number(expiresIn) || R2_READ_TTL_SECONDS)),
  });
}

export async function downloadR2StorageKeyToFile(storageKey, destinationPath) {
  if (!storageKey) throw new Error("An R2 storage key is required.");
  if (!destinationPath) throw new Error("A destination path is required.");

  const { client, bucket } = getR2Client();
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
  );

  if (!result.Body) throw new Error("R2 returned an empty master object.");
  await pipeline(result.Body, createWriteStream(destinationPath, { flags: "wx" }));
  return destinationPath;
}
