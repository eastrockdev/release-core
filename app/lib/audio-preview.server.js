import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import db from "../db.server";
import { FILE_KINDS } from "./releasecore-files";
import { downloadR2StorageKeyToFile, localStoragePath } from "./storage.server";
import { deleteShopifyFilesBestEffort } from "./shopify-files.server";

const MAX_SHOPIFY_FILE_BYTES = 20 * 1024 * 1024;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      if (error?.code === "ENOENT") reject(new Error("FFmpeg is not installed. Install it on the ReleaseCore server or set FFMPEG_PATH."));
      else reject(error);
    });
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}.`)));
  });
}

async function stagedTarget(admin, { filename, sizeBytes }) {
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreStagePreview($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`, { variables: { input: [{ resource: "FILE", filename, mimeType: "audio/mpeg", httpMethod: "POST", fileSize: String(sizeBytes) }] } });
  const json = await response.json();
  const payload = json?.data?.stagedUploadsCreate;
  if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((item) => item.message).join(" "));
  const target = payload?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) throw new Error("Shopify did not provide an audio upload target.");
  return target;
}

async function uploadTarget(target, filename, bytes) {
  const body = new FormData();
  for (const parameter of target.parameters || []) body.append(parameter.name, parameter.value);
  body.append("file", new Blob([bytes], { type: "audio/mpeg" }), filename);
  const response = await fetch(target.url, { method: "POST", body });
  if (!response.ok) throw new Error(`Shopify storage rejected the MP3 preview (${response.status}).`);
}

async function createShopifyFile(admin, resourceUrl) {
  const response = await admin.graphql(`#graphql
    mutation ReleaseCoreCreatePreviewFile($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id fileStatus ... on GenericFile { url } }
        userErrors { field message code }
      }
    }`, { variables: { files: [{ originalSource: resourceUrl, contentType: "FILE" }] } });
  const json = await response.json();
  const payload = json?.data?.fileCreate;
  if (payload?.userErrors?.length) throw new Error(payload.userErrors.map((item) => item.message).join(" "));
  const file = payload?.files?.[0];
  if (!file?.id) throw new Error("Shopify did not create the MP3 preview file.");
  return file;
}

async function waitForGenericFile(admin, fileId) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await admin.graphql(`#graphql
      query ReleaseCorePreviewFile($id: ID!) {
        node(id: $id) { ... on GenericFile { id fileStatus url } }
      }`, { variables: { id: fileId } });
    const json = await response.json();
    const file = json?.data?.node;
    if (file?.fileStatus === "READY" && file.url) return file;
    if (file?.fileStatus === "FAILED") throw new Error("Shopify could not process the MP3 preview.");
    await sleep(650);
  }
  return { id: fileId, fileStatus: "PROCESSING", url: null };
}

export async function generateTrackMp3Preview({ admin, shop, trackId, settings = {} }) {
  const track = await db.track.findFirst({
    where: { id: trackId, release: { shop } },
    include: { release: true, files: true },
  });
  if (!track) throw new Error("Track not found.");
  const master = track.files.find((file) => file.kind === FILE_KINDS.MASTER_WAV);
  if (!master?.storageKey || !["LOCAL_DEV", "R2"].includes(master.storageProvider)) {
    throw new Error(`Track ${track.position} needs a stored WAV master before ReleaseCore can generate a preview.`);
  }

  const duration = Math.max(0, Math.min(3600, Number(settings.audioPreviewDurationSeconds ?? 60) || 0));
  const bitrate = [128, 160, 192, 256, 320].includes(Number(settings.audioPreviewBitrateKbps)) ? Number(settings.audioPreviewBitrateKbps) : 192;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "releasecore-preview-"));
  const safeBase = `${String(track.release.title || "release").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 50)}-track-${String(track.position).padStart(2, "0")}` || `track-${track.position}`;
  const filename = `${safeBase}-preview.mp3`;
  const outputPath = path.join(tempDir, filename);
  let newShopifyFileId = null;
  let committed = false;

  try {
    const masterInputPath =
      master.storageProvider === "LOCAL_DEV"
        ? localStoragePath(master.storageKey)
        : path.join(tempDir, "master-input.wav");

    if (master.storageProvider === "R2") {
      await downloadR2StorageKeyToFile(master.storageKey, masterInputPath);
    }

    const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", masterInputPath, "-vn"];
    if (duration > 0) args.push("-t", String(duration));
    args.push("-codec:a", "libmp3lame", "-b:a", `${bitrate}k`, outputPath);
    await runFfmpeg(args);
    const info = await stat(outputPath);
    if (info.size > MAX_SHOPIFY_FILE_BYTES) throw new Error("The generated MP3 exceeds Shopify Files' 20 MB limit. Choose a shorter preview duration or lower bitrate.");
    const bytes = await readFile(outputPath);
    const target = await stagedTarget(admin, { filename, sizeBytes: info.size });
    await uploadTarget(target, filename, bytes);
    const created = await createShopifyFile(admin, target.resourceUrl);
    newShopifyFileId = created.id;
    const ready = await waitForGenericFile(admin, created.id);

    const old = track.files.filter((file) => file.kind === FILE_KINDS.PREVIEW_MP3);
    const preview = await db.$transaction(async (tx) => {
      if (old.length) {
        await tx.releaseFile.deleteMany({
          where: { id: { in: old.map((file) => file.id) } },
        });
      }
      return tx.releaseFile.create({
        data: {
          releaseId: track.releaseId,
          trackId: track.id,
          kind: FILE_KINDS.PREVIEW_MP3,
          filename,
          storageProvider: "SHOPIFY_FILES",
          storageKey: created.id,
          url: ready.url || created.url || null,
          mimeType: "audio/mpeg",
          sizeBytes: info.size,
          status: ready.fileStatus || created.fileStatus || "UPLOADED",
        },
      });
    });
    committed = true;

    await deleteShopifyFilesBestEffort(
      admin,
      old
        .filter(
          (file) =>
            file.storageProvider === "SHOPIFY_FILES" &&
            file.storageKey &&
            file.storageKey !== created.id,
        )
        .map((file) => file.storageKey),
      { context: "old audio preview cleanup" },
    );
    return preview;
  } catch (error) {
    if (newShopifyFileId && !committed) {
      await deleteShopifyFilesBestEffort(admin, newShopifyFileId, {
        context: "failed audio preview rollback",
      });
    }
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function generateReleaseMp3Previews({ admin, shop, releaseId, settings = {} }) {
  const tracks = await db.track.findMany({ where: { releaseId, release: { shop } }, orderBy: { position: "asc" } });
  let generated = 0;
  const errors = [];
  for (const track of tracks) {
    try { await generateTrackMp3Preview({ admin, shop, trackId: track.id, settings }); generated += 1; }
    catch (error) { errors.push(`Track ${track.position}: ${error instanceof Error ? error.message : "preview failed"}`); }
  }
  return { generated, errors };
}
