import { authenticatedPost } from "./authenticated-post";
import { FILE_KINDS } from "./releasecore-files";

function uploadMultipartTarget(target, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const body = new FormData();
    for (const parameter of target.parameters || []) body.append(parameter.name, parameter.value);
    body.append("file", file);
    xhr.open("POST", target.url, true);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error("The file upload could not reach Shopify storage."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Shopify storage rejected the upload (${xhr.status}).`));
    };
    xhr.send(body);
  });
}

function uploadDirectPutTarget(target, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method || "PUT", target.uploadUrl, true);

    for (const [name, value] of Object.entries(target.headers || {})) {
      xhr.setRequestHeader(name, value);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    const networkError = () => {
      const error = new Error("The master upload connection to private R2 storage was interrupted.");
      error.code = "R2_NETWORK_INTERRUPTED";
      reject(error);
    };

    xhr.onerror = networkError;
    xhr.onabort = networkError;
    xhr.ontimeout = networkError;

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 rejected the master upload (${xhr.status}).`));
    };

    xhr.send(file);
  });
}

const R2_MULTIPART_CONCURRENCY = 3;
const R2_PART_MAX_ATTEMPTS = 3;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function uploadR2PartTarget(target, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method || "PUT", target.uploadUrl, true);
    for (const [name, value] of Object.entries(target.headers || {})) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded);
    };
    const networkError = () => {
      const error = new Error(`Multipart upload part ${target.partNumber} was interrupted.`);
      error.code = "R2_PART_INTERRUPTED";
      reject(error);
    };
    xhr.onerror = networkError;
    xhr.onabort = networkError;
    xhr.ontimeout = networkError;
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`R2 rejected upload part ${target.partNumber} (${xhr.status}).`));
        return;
      }
      const etag = xhr.getResponseHeader("ETag");
      if (!etag) {
        reject(new Error("R2 uploaded a part but did not expose its ETag. Add ETag to the bucket CORS exposeHeaders list."));
        return;
      }
      onProgress?.(blob.size);
      resolve({ partNumber: target.partNumber, etag });
    };
    xhr.send(blob);
  });
}

async function uploadR2PartWithRetries({ target, blob, onProgress }) {
  let lastError;
  for (let attempt = 1; attempt <= R2_PART_MAX_ATTEMPTS; attempt += 1) {
    try {
      onProgress?.(0);
      return await uploadR2PartTarget(target, blob, onProgress);
    } catch (error) {
      lastError = error;
      if (attempt < R2_PART_MAX_ATTEMPTS) await delay(400 * 2 ** (attempt - 1));
    }
  }
  throw lastError || new Error(`Upload part ${target.partNumber} failed.`);
}

async function uploadMultipartR2Target(target, file, onProgress) {
  const partSize = Number(target.partSize || 0);
  const targets = Array.isArray(target.parts)
    ? [...target.parts].sort((a, b) => a.partNumber - b.partNumber)
    : [];
  const expectedCount = Math.ceil(file.size / partSize);
  if (!partSize || !targets.length || targets.length !== expectedCount) {
    throw new Error("ReleaseCore returned an invalid multipart upload target.");
  }

  const loadedByPart = new Map();
  const completed = new Array(targets.length);
  let nextIndex = 0;
  let firstError = null;

  const reportProgress = () => {
    const loaded = [...loadedByPart.values()].reduce((total, value) => total + value, 0);
    onProgress?.(Math.min(99, Math.round((loaded / file.size) * 100)));
  };

  const worker = async () => {
    while (!firstError) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= targets.length) return;
      const part = targets[index];
      const start = (part.partNumber - 1) * partSize;
      const blob = file.slice(start, Math.min(start + partSize, file.size));
      try {
        completed[index] = await uploadR2PartWithRetries({
          target: part,
          blob,
          onProgress: (loaded) => {
            loadedByPart.set(part.partNumber, loaded);
            reportProgress();
          },
        });
      } catch (error) {
        firstError = error;
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(R2_MULTIPART_CONCURRENCY, targets.length) },
      () => worker(),
    ),
  );
  if (firstError) throw firstError;
  onProgress?.(100);
  return completed.sort((a, b) => a.partNumber - b.partNumber);
}

function masterCompleteData({ releaseId, trackId, file, target, parts = [] }) {
  const completeData = new FormData();
  completeData.set("releaseId", releaseId);
  completeData.set("trackId", trackId);
  completeData.set("filename", file.name);
  completeData.set("mimeType", file.type || "audio/wav");
  completeData.set("sizeBytes", String(file.size));
  completeData.set("storageKey", target.storageKey);
  completeData.set("uploadMode", target.mode || "SINGLE_PUT");
  if (target.uploadId) completeData.set("uploadId", target.uploadId);
  if (parts.length) completeData.set("parts", JSON.stringify(parts));
  return completeData;
}

async function stageMasterR2({ shopify, releaseId, trackId, file }) {
  const stageData = new FormData();
  stageData.set("releaseId", releaseId);
  stageData.set("trackId", trackId);
  stageData.set("filename", file.name);
  stageData.set("mimeType", file.type || "audio/wav");
  stageData.set("sizeBytes", String(file.size));

  return authenticatedPost(
    shopify,
    "/api/uploads/master/stage",
    stageData,
  );
}

async function finalizeMasterR2({ shopify, releaseId, trackId, file, target, parts }) {
  return authenticatedPost(
    shopify,
    "/api/uploads/master/complete",
    masterCompleteData({ releaseId, trackId, file, target, parts }),
  );
}

async function abortMasterR2({ shopify, releaseId, trackId, file, target }) {
  if (!target?.uploadId || !target?.storageKey) return;
  const data = masterCompleteData({ releaseId, trackId, file, target });
  data.set("intent", "abort");
  await authenticatedPost(shopify, "/api/uploads/master/complete", data);
}

async function uploadMasterToR2({ shopify, releaseId, trackId, file, onStage }) {
  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      onStage?.({
        phase: "uploading",
        percent: 0,
        message: `Connection interrupted. Retrying upload (${attempt}/${maxAttempts})…`,
      });
    }

    const staged = await stageMasterR2({
      shopify,
      releaseId,
      trackId,
      file,
    });

    if (staged?.target?.provider === "LOCAL_DEV") {
      return uploadMasterToDevelopmentStorage({
        shopify,
        releaseId,
        trackId,
        file,
        onStage,
      });
    }

    const target = staged?.target;
    const isMultipart = target?.mode === "MULTIPART";
    const validTarget = target?.storageKey && (
      isMultipart
        ? target.uploadId && Array.isArray(target.parts) && target.parts.length
        : target.uploadUrl
    );
    if (!validTarget) {
      throw new Error("ReleaseCore did not return a valid R2 upload target.");
    }

    let completedParts = [];
    try {
      onStage?.({ phase: "uploading", percent: 1 });
      if (isMultipart) {
        completedParts = await uploadMultipartR2Target(
          target,
          file,
          (percent) => onStage?.({
            phase: "uploading",
            percent,
            message: `Uploading master in ${target.parts.length} parts…`,
          }),
        );
      } else {
        await uploadDirectPutTarget(
          target,
          file,
          (percent) => onStage?.({ phase: "uploading", percent }),
        );
      }
    } catch (uploadError) {
      lastError = uploadError;
      if (isMultipart) {
        try {
          await abortMasterR2({ shopify, releaseId, trackId, file, target });
        } catch { /* Intentionally ignored: best-effort cleanup or fallback. */ }
      } else if (uploadError?.code === "R2_NETWORK_INTERRUPTED") {
        try {
          onStage?.({
            phase: "finalizing",
            percent: 100,
            message: "Connection ended unexpectedly. Verifying the uploaded master…",
          });
          return await finalizeMasterR2({
            shopify,
            releaseId,
            trackId,
            file,
            target,
          });
        } catch {
          // Object was not committed (or was incomplete). Retry with a fresh target.
        }
      }

      if (attempt < maxAttempts) continue;
      break;
    }

    onStage?.({ phase: "finalizing", percent: 100 });
    return finalizeMasterR2({
      shopify,
      releaseId,
      trackId,
      file,
      target,
      parts: completedParts,
    });
  }

  throw new Error(
    lastError?.message ||
      "The master upload could not reach private R2 storage after multiple attempts.",
  );
}

async function uploadMasterToDevelopmentStorage({ shopify, releaseId, trackId, file, onStage }) {
  const token = await shopify.idToken();
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ releaseId, trackId, filename: encodeURIComponent(file.name) });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/uploads/master?${query.toString()}`, true);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", file.type || "audio/wav");
    xhr.setRequestHeader("X-ReleaseCore-Size", String(file.size));
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onStage?.({ phase: "uploading", percent: Math.round((event.loaded / event.total) * 100) });
    };
    xhr.onerror = () => reject(new Error("The master upload could not reach ReleaseCore storage."));
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText || "{}"); } catch { data = { error: xhr.responseText }; }
      if (xhr.status >= 200 && xhr.status < 300 && data?.ok !== false) resolve(data);
      else reject(new Error(data?.error || `Master upload failed with status ${xhr.status}.`));
    };
    onStage?.({ phase: "uploading", percent: 0 });
    xhr.send(file);
  });
}

export async function uploadReleaseCoreFile({ shopify, releaseId, trackId = "", kind, file, onStage }) {
  if (kind === FILE_KINDS.MASTER_WAV) {
    if (!trackId) throw new Error("A master WAV must belong to a track.");
    onStage?.({ phase: "preparing", percent: 0 });
    const result = await uploadMasterToR2({ shopify, releaseId, trackId, file, onStage });
    onStage?.({ phase: "done", percent: 100 });
    return result;
  }

  const stageData = new FormData();
  stageData.set("releaseId", releaseId);
  stageData.set("trackId", trackId || "");
  stageData.set("kind", kind);
  stageData.set("filename", file.name);
  stageData.set("mimeType", file.type || "application/octet-stream");
  stageData.set("sizeBytes", String(file.size));

  onStage?.({ phase: "preparing", percent: 0 });
  const staged = await authenticatedPost(shopify, "/api/uploads/stage", stageData);
  onStage?.({ phase: "uploading", percent: 1 });
  await uploadMultipartTarget(staged.target, file, (percent) => onStage?.({ phase: "uploading", percent }));

  onStage?.({ phase: "finalizing", percent: 100 });
  const completeData = new FormData();
  completeData.set("releaseId", releaseId);
  completeData.set("trackId", trackId || "");
  completeData.set("kind", kind);
  completeData.set("filename", file.name);
  completeData.set("mimeType", file.type || "application/octet-stream");
  completeData.set("sizeBytes", String(file.size));
  completeData.set("resourceUrl", staged.target.resourceUrl);
  const result = await authenticatedPost(shopify, "/api/uploads/complete", completeData);
  onStage?.({ phase: "done", percent: 100 });
  return result;
}

export function validateCoverArtworkDimensions(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      URL.revokeObjectURL(url);
      if (width !== height) return reject(new Error(`Cover artwork must be square. This file is ${width}×${height}px.`));
      if (width < 3000 || height < 3000) return reject(new Error(`Cover artwork must be at least 3000×3000px. This file is ${width}×${height}px.`));
      if (width * height > 25_000_000) return reject(new Error(`Cover artwork exceeds Shopify's 25-megapixel development upload limit. This file is ${width}×${height}px.`));
      resolve({ width, height });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("ReleaseCore could not read the cover artwork dimensions."));
    };
    image.src = url;
  });
}
