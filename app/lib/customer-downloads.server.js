import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import db from "../db.server";
import { creditRoleLabel } from "./releasecore";
import { publicError } from "./http-security.server";
import {
  deleteCustomerDerivativeFile,
  downloadR2StorageKeyToFile,
  localStoragePath,
  saveCustomerDerivativeFile,
} from "./storage.server";

export const CUSTOMER_DOWNLOAD_KINDS = Object.freeze({
  MP3: "CUSTOMER_MP3",
  FLAC: "CUSTOMER_FLAC",
});

const MP3_BITRATES = Object.freeze([128, 160, 192, 256, 320]);
const FLAC_LEVELS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8]);

function clean(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeMp3Bitrate(value) {
  const number = Number(value);
  return MP3_BITRATES.includes(number) ? number : 320;
}

function normalizeFlacLevel(value) {
  const number = Number(value);
  return FLAC_LEVELS.includes(number) ? number : 5;
}

export function normalizedCustomerDownloadSettings(settings = {}) {
  return {
    enabled: settings.customerDownloadsEnabled ?? true,
    autoGenerate: settings.customerDownloadAutoGenerate ?? true,
    mp3Enabled: settings.customerDownloadMp3Enabled ?? true,
    mp3BitrateKbps: normalizeMp3Bitrate(
      settings.customerDownloadMp3BitrateKbps ?? 320,
    ),
    flacEnabled: settings.customerDownloadFlacEnabled ?? true,
    flacCompressionLevel: normalizeFlacLevel(
      settings.customerDownloadFlacCompressionLevel ?? 5,
    ),
    embedArtwork: settings.customerDownloadEmbedArtwork ?? true,
    embedLyrics: settings.customerDownloadEmbedLyrics ?? true,
    embedCredits: settings.customerDownloadEmbedCredits ?? true,
    embedArtistLinks: settings.customerDownloadEmbedArtistLinks ?? true,
  };
}

export function enabledCustomerDownloadFormats(settings = {}) {
  const normalized = normalizedCustomerDownloadSettings(settings);
  if (!normalized.enabled) return [];

  const formats = [];
  if (normalized.mp3Enabled) formats.push("mp3");
  if (normalized.flacEnabled) formats.push("flac");
  return formats;
}

function derivativeKind(format) {
  if (format === "mp3") return CUSTOMER_DOWNLOAD_KINDS.MP3;
  if (format === "flac") return CUSTOMER_DOWNLOAD_KINDS.FLAC;
  return null;
}

function derivativeMime(format) {
  return format === "flac" ? "audio/flac" : "audio/mpeg";
}

function assignmentArtists(assignments, role = null) {
  return (assignments || [])
    .filter((assignment) => !role || assignment.role === role)
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
    .map((assignment) => assignment.artist)
    .filter(Boolean);
}

function assignmentNames(assignments, role = null) {
  return assignmentArtists(assignments, role)
    .map((artist) => clean(artist.name))
    .filter(Boolean);
}

function contributorName(credit) {
  return (
    clean(credit?.contributor?.stageName) ||
    clean(credit?.contributor?.legalName)
  );
}

function creditNames(track, role) {
  return unique(
    (track.credits || [])
      .filter((credit) => credit.role === role)
      .map(contributorName),
  );
}

function trackArtistDisplay(track) {
  const primary = assignmentNames(track.artists, "PRIMARY");
  const featured = assignmentNames(track.artists, "FEATURED");
  const fallback = assignmentNames(track.artists);
  const base = (primary.length ? primary : fallback).join(" & ");

  if (!featured.length) return base;
  return `${base} feat. ${featured.join(", ")}`;
}

function albumArtistDisplay(track) {
  const primary = assignmentNames(track.release?.artists, "PRIMARY");
  const fallback = assignmentNames(track.release?.artists);
  return (primary.length ? primary : fallback).join(" & ");
}

function releaseDateText(release) {
  if (!release?.releaseDate) return null;
  const value = new Date(release.releaseDate);
  return Number.isNaN(value.getTime())
    ? null
    : value.toISOString().slice(0, 10);
}

function publicCreditSummary(track) {
  return (track.credits || [])
    .map((credit) => {
      const name = contributorName(credit);
      if (!name) return null;
      return `${name} — ${creditRoleLabel(credit.role)}`;
    })
    .filter(Boolean)
    .join("; ");
}

function artistLinkSummary(track) {
  const entries = [];
  for (const artist of assignmentArtists(track.artists)) {
    const links = [
      ["website", artist.websiteUrl],
      ["spotify", artist.spotifyUrl],
      ["apple_music", artist.appleMusicUrl],
      ["instagram", artist.instagramUrl],
      ["facebook", artist.facebookUrl],
      ["tiktok", artist.tiktokUrl],
      ["youtube", artist.youtubeUrl],
      ["x", artist.xUrl],
    ];

    for (const [service, url] of links) {
      if (url) entries.push(`${artist.name}|${service}|${url}`);
    }
  }
  return entries.join("; ");
}

function metadataForTrack(track, settings, normalized) {
  const release = track.release;
  const date = releaseDateText(release);
  const year = date ? date.slice(0, 4) : null;
  const trackNumber = Number(track.position || 1);
  const trackTotal = Math.max(1, Number(release?.tracks?.length || 1));
  const discNumber = 1;
  const discTotal = 1;

  const primaryArtist =
    trackArtistDisplay(track) || albumArtistDisplay(track) || "Unknown Artist";
  const albumArtist = albumArtistDisplay(track) || primaryArtist;
  const title = `${track.title || "Untitled Track"}${
    track.version ? ` (${track.version})` : ""
  }`;

  const label = clean(settings?.defaultLabelName);
  const catalogNumber = clean(release?.catalogNumber);
  const upc = clean(release?.upc);
  const advisory = track.explicit ? "Explicit" : "Clean";
  const comment = [
    "Distributed by ReleaseCore",
    label ? `Label: ${label}` : null,
    catalogNumber ? `Catalog: ${catalogNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const metadata = {
    title,
    artist: primaryArtist,
    album: release?.title || title,
    album_artist: albumArtist,
    track: `${trackNumber}/${trackTotal}`,
    track_number: String(trackNumber),
    track_total: String(trackTotal),
    disc: `${discNumber}/${discTotal}`,
    disc_number: String(discNumber),
    disc_total: String(discTotal),
    date,
    release_date: date,
    year,
    genre: release?.primaryGenre || null,
    language: track.language || null,
    release_type: release?.type || null,
    media_type: "Digital Media",
    isrc: track.isrc || null,
    upc,
    barcode: upc,
    catalog_number: catalogNumber,
    label,
    publisher: label,
    organization: label,
    copyright: settings?.defaultCopyrightHolder || null,
    explicit: track.explicit ? "1" : "0",
    content_advisory: advisory,
    itunes_advisory: track.explicit ? "1" : "2",
    composer: creditNames(track, "COMPOSER").join("; ") || null,
    songwriter: creditNames(track, "SONGWRITER").join("; ") || null,
    producer: creditNames(track, "PRODUCER").join("; ") || null,
    recording_engineer:
      creditNames(track, "RECORDING_ENGINEER").join("; ") || null,
    mixing_engineer:
      creditNames(track, "MIXING_ENGINEER").join("; ") || null,
    mastering_engineer:
      creditNames(track, "MASTERING_ENGINEER").join("; ") || null,
    cover_art_photographer:
      creditNames(track, "COVER_ART_PHOTOGRAPHER").join("; ") || null,
    cover_art_designer:
      creditNames(track, "COVER_ART_DESIGNER").join("; ") || null,
    comment,
    distribution_service: "ReleaseCore",
    encoded_by: "ReleaseCore",
  };

  if (normalized.embedLyrics && track.lyrics) metadata.lyrics = track.lyrics;
  if (normalized.embedCredits) metadata.credits = publicCreditSummary(track) || null;

  if (normalized.embedArtistLinks) {
    metadata.artist_links = artistLinkSummary(track) || null;
    const firstArtist = assignmentArtists(track.artists)[0];
    if (firstArtist?.websiteUrl) metadata.url = firstArtist.websiteUrl;
    if (firstArtist?.spotifyUrl) metadata.spotify_artist = firstArtist.spotifyUrl;
    if (firstArtist?.appleMusicUrl) metadata.apple_music_artist = firstArtist.appleMusicUrl;
  }

  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([, value]) => value !== null && value !== undefined && value !== "",
    ),
  );
}

function newestFile(files, kind) {
  return (
    (files || [])
      .filter((file) => file.kind === kind)
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || 0).getTime() -
          new Date(a.updatedAt || a.createdAt || 0).getTime(),
      )[0] || null
  );
}

function masterFile(track) {
  return (
    (track.files || [])
      .filter(
        (file) =>
          file.kind === "MASTER_WAV" &&
          file.storageKey &&
          ["R2", "LOCAL_DEV"].includes(file.storageProvider),
      )
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || 0).getTime() -
          new Date(a.updatedAt || a.createdAt || 0).getTime(),
      )[0] || null
  );
}

function derivativeFingerprint({
  format,
  master,
  cover,
  metadata,
  normalized,
}) {
  const formatSettings =
    format === "mp3"
      ? { bitrateKbps: normalized.mp3BitrateKbps }
      : { compressionLevel: normalized.flacCompressionLevel };

  return createHash("sha256")
    .update(
      JSON.stringify({
        generatorVersion: 2,
        format,
        formatSettings,
        embedArtwork: normalized.embedArtwork,
        master: {
          provider: master.storageProvider,
          key: master.storageKey,
          sizeBytes: master.sizeBytes,
          updatedAt: master.updatedAt,
        },
        cover: normalized.embedArtwork
          ? {
              provider: cover?.storageProvider || null,
              url: cover?.url || null,
              key: cover?.storageKey || null,
              mimeType: cover?.mimeType || null,
              updatedAt: cover?.updatedAt || null,
            }
          : null,
        metadata,
      }),
    )
    .digest("hex");
}

function safeFilenameBase(track, metadata) {
  return `${String(track.position || 1).padStart(2, "0")} - ${
    metadata.artist
  } - ${metadata.title}`
    .replace(/[\\/:*?"<>|]/g, "_")
    .split("")
    .map((character) =>
      character.charCodeAt(0) < 32 ? "_" : character,
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

function metadataArgs(metadata) {
  const tagNames = {
    title: "title",
    artist: "artist",
    album: "album",
    album_artist: "album_artist",
    track: "track",
    track_number: "TRACKNUMBER",
    track_total: "TRACKTOTAL",
    disc: "disc",
    disc_number: "DISCNUMBER",
    disc_total: "DISCTOTAL",
    date: "date",
    release_date: "RELEASEDATE",
    year: "year",
    genre: "genre",
    language: "language",
    release_type: "RELEASETYPE",
    media_type: "MEDIA",
    isrc: "ISRC",
    upc: "UPC",
    barcode: "BARCODE",
    catalog_number: "CATALOGNUMBER",
    label: "LABEL",
    publisher: "publisher",
    organization: "ORGANIZATION",
    copyright: "copyright",
    explicit: "EXPLICIT",
    content_advisory: "CONTENTADVISORY",
    itunes_advisory: "ITUNESADVISORY",
    composer: "composer",
    songwriter: "lyricist",
    producer: "PRODUCER",
    recording_engineer: "RECORDING_ENGINEER",
    mixing_engineer: "MIXING_ENGINEER",
    mastering_engineer: "MASTERING_ENGINEER",
    cover_art_photographer: "COVER_ART_PHOTOGRAPHER",
    cover_art_designer: "COVER_ART_DESIGNER",
    credits: "CREDITS",
    artist_links: "ARTIST_LINKS",
    url: "URL",
    spotify_artist: "SPOTIFY_ARTIST",
    apple_music_artist: "APPLE_MUSIC_ARTIST",
    lyrics: "lyrics",
    comment: "comment",
    distribution_service: "DISTRIBUTEDBY",
    encoded_by: "encoded_by",
  };

  const args = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined || value === "") continue;
    args.push("-metadata", `${tagNames[key] || key.toUpperCase()}=${value}`);
  }
  return args;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let diagnostic = "";
    child.stderr.on("data", (chunk) => {
      diagnostic += String(chunk);
      if (diagnostic.length > 12000) diagnostic = diagnostic.slice(-12000);
    });

    child.once("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(
          new Error(
            "FFmpeg is not installed. Install FFmpeg on the ReleaseCore server or set FFMPEG_PATH.",
          ),
        );
        return;
      }
      reject(error);
    });

    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          diagnostic.trim() || `FFmpeg exited with status ${String(code)}.`,
        ),
      );
    });
  });
}

async function downloadArtworkUrl(url, destination) {
  const response = await fetch(url, { headers: { Accept: "image/*" } });
  if (!response.ok) {
    throw new Error(
      `ReleaseCore could not retrieve the release artwork for tagging (${response.status}).`,
    );
  }

  const length = Number(response.headers.get("content-length") || 0);
  if (length > 25 * 1024 * 1024) {
    throw new Error("Release artwork is too large to embed.");
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (!body.length || body.length > 25 * 1024 * 1024) {
    throw new Error("Release artwork could not be embedded.");
  }

  await writeFile(destination, body);
  return destination;
}

async function stageArtwork(cover, destination) {
  if (!cover) return null;

  if (cover.storageProvider === "R2" && cover.storageKey) {
    try {
      await downloadR2StorageKeyToFile(cover.storageKey, destination);
      return destination;
    } catch (error) {
      if (!cover.url) throw error;
    }
  }

  if (cover.storageProvider === "LOCAL_DEV" && cover.storageKey) {
    try {
      await copyFile(localStoragePath(cover.storageKey), destination);
      return destination;
    } catch (error) {
      if (!cover.url) throw error;
    }
  }

  if (cover.url) return downloadArtworkUrl(cover.url, destination);
  return null;
}

function ffmpegArgs({
  format,
  masterPath,
  coverPath,
  outputPath,
  metadata,
  normalized,
}) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    masterPath,
  ];

  if (coverPath) args.push("-i", coverPath);

  args.push("-map", "0:a:0");
  if (coverPath) args.push("-map", "1:v:0");

  if (format === "mp3") {
    args.push(
      "-c:a",
      "libmp3lame",
      "-b:a",
      `${normalized.mp3BitrateKbps}k`,
      "-id3v2_version",
      "4",
      "-write_id3v1",
      "1",
    );
  } else {
    args.push(
      "-c:a",
      "flac",
      "-compression_level",
      String(normalized.flacCompressionLevel),
    );
  }

  if (coverPath) {
    args.push(
      "-c:v",
      "mjpeg",
      "-q:v",
      "2",
      "-disposition:v:0",
      "attached_pic",
      "-metadata:s:v",
      "title=Cover (front)",
      "-metadata:s:v",
      "comment=Cover (front)",
    );
  }

  args.push(
    "-metadata",
    `file_format=${format.toUpperCase()}`,
    "-metadata",
    `encoding_settings=${
      format === "mp3"
        ? `MP3 ${normalized.mp3BitrateKbps} kbps`
        : `FLAC compression level ${normalized.flacCompressionLevel}`
    }`,
  );

  args.push(...metadataArgs(metadata), outputPath);
  return args;
}

async function getTrack(shop, trackId) {
  return db.track.findFirst({
    where: { id: trackId, release: { shop } },
    include: {
      artists: {
        include: { artist: true },
        orderBy: { position: "asc" },
      },
      credits: {
        include: { contributor: true },
      },
      files: true,
      release: {
        include: {
          artists: {
            include: { artist: true },
            orderBy: { position: "asc" },
          },
          files: true,
          tracks: {
            select: { id: true },
            orderBy: { position: "asc" },
          },
        },
      },
    },
  });
}

async function removeStaleDerivatives({
  shop,
  track,
  kind,
  keepId,
}) {
  const stale = await db.releaseFile.findMany({
    where: {
      releaseId: track.releaseId,
      trackId: track.id,
      kind,
      id: { not: keepId },
    },
  });

  if (!stale.length) return;

  await db.releaseFile.deleteMany({
    where: { id: { in: stale.map((file) => file.id) } },
  });

  for (const file of stale) {
    if (!file.storageKey) continue;
    await deleteCustomerDerivativeFile({
      storageProvider: file.storageProvider,
      storageKey: file.storageKey,
      shop,
      releaseId: track.releaseId,
      trackId: track.id,
    }).catch((error) => {
      console.warn("ReleaseCore derivative cleanup warning", {
        fileId: file.id,
        trackId: track.id,
        message:
          error instanceof Error ? error.message : "Derivative cleanup failed.",
      });
    });
  }
}

export async function ensureCustomerDownloadFile({
  shop,
  trackId,
  format,
  force = false,
}) {
  const settings = await db.appSettings.findUnique({ where: { shop } });
  const normalized = normalizedCustomerDownloadSettings(settings || {});
  const requested = String(format || "").trim().toLowerCase();

  if (!normalized.enabled) {
    throw publicError("Customer music downloads are disabled.", { status: 403 });
  }

  if (
    !derivativeKind(requested) ||
    (requested === "mp3" && !normalized.mp3Enabled) ||
    (requested === "flac" && !normalized.flacEnabled)
  ) {
    throw publicError("That download format is not enabled.", { status: 404 });
  }

  const track = await getTrack(shop, trackId);
  if (!track) throw publicError("Purchased track not found.", { status: 404 });

  const master = masterFile(track);
  if (!master) {
    throw publicError(
      "This purchased track does not have a private WAV master available for derivative generation.",
      { status: 409 },
    );
  }

  const cover = newestFile(track.release?.files, "COVER_ART");
  const metadata = metadataForTrack(track, settings || {}, normalized);
  const kind = derivativeKind(requested);
  const fingerprint = derivativeFingerprint({
    format: requested,
    master,
    cover,
    metadata,
    normalized,
  });

  if (!force) {
    const ready = (track.files || []).find(
      (file) =>
        file.kind === kind &&
        file.status === "READY" &&
        file.storageKey &&
        file.derivativeFingerprint === fingerprint,
    );
    if (ready) return ready;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "releasecore-download-"));
  let stagedStorage = null;

  try {
    const masterPath =
      master.storageProvider === "LOCAL_DEV"
        ? localStoragePath(master.storageKey)
        : path.join(tempDir, "master.wav");

    if (master.storageProvider === "R2") {
      await downloadR2StorageKeyToFile(master.storageKey, masterPath);
    }

    let coverPath = null;
    if (
      normalized.embedArtwork &&
      cover &&
      (cover.url || cover.storageKey)
    ) {
      const stagedCoverPath = path.join(tempDir, "cover-art");
      coverPath = await stageArtwork(cover, stagedCoverPath);
    }

    const filename = `${safeFilenameBase(track, metadata)}.${requested}`;
    const outputPath = path.join(tempDir, filename);

    await runFfmpeg(
      ffmpegArgs({
        format: requested,
        masterPath,
        coverPath,
        outputPath,
        metadata,
        normalized,
      }),
    );

    const output = await stat(outputPath);
    if (!output.size) throw new Error("FFmpeg created an empty download file.");

    stagedStorage = await saveCustomerDerivativeFile({
      sourcePath: outputPath,
      shop,
      releaseId: track.releaseId,
      trackId: track.id,
      filename,
      mimeType: derivativeMime(requested),
    });

    const created = await db.releaseFile.create({
      data: {
        releaseId: track.releaseId,
        trackId: track.id,
        kind,
        filename,
        storageProvider: stagedStorage.storageProvider,
        storageKey: stagedStorage.storageKey,
        url: null,
        mimeType: derivativeMime(requested),
        sizeBytes: output.size,
        status: "READY",
        derivativeFingerprint: fingerprint,
      },
    });

    stagedStorage = null;

    await removeStaleDerivatives({
      shop,
      track,
      kind,
      keepId: created.id,
    });

    return created;
  } catch (error) {
    if (stagedStorage?.storageKey) {
      await deleteCustomerDerivativeFile({
        storageProvider: stagedStorage.storageProvider,
        storageKey: stagedStorage.storageKey,
        shop,
        releaseId: track.releaseId,
        trackId: track.id,
      }).catch(() => {});
    }
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function prepareCustomerDownloadFilesForTracks({
  shop,
  trackIds,
}) {
  const settings = await db.appSettings.findUnique({ where: { shop } });
  const normalized = normalizedCustomerDownloadSettings(settings || {});
  if (!normalized.enabled || !normalized.autoGenerate) {
    return { prepared: 0, errors: [] };
  }

  const formats = enabledCustomerDownloadFormats(settings || {});
  const ids = unique(trackIds);
  let prepared = 0;
  const errors = [];

  for (const trackId of ids) {
    for (const format of formats) {
      try {
        await ensureCustomerDownloadFile({ shop, trackId, format });
        prepared += 1;
      } catch (error) {
        errors.push({
          trackId,
          format,
          message:
            error instanceof Error
              ? error.message
              : "Customer derivative generation failed.",
        });
      }
    }
  }

  return { prepared, errors };
}

export async function customerDownloadFormatStates({
  shop,
  trackIds,
}) {
  const settings = await db.appSettings.findUnique({ where: { shop } });
  const formats = enabledCustomerDownloadFormats(settings || {});
  const ids = unique(trackIds);
  if (!ids.length || !formats.length) return new Map();

  const files = await db.releaseFile.findMany({
    where: {
      release: { shop },
      trackId: { in: ids },
      kind: { in: formats.map(derivativeKind) },
      status: "READY",
      storageKey: { not: null },
    },
    orderBy: { updatedAt: "desc" },
  });

  const states = new Map();
  for (const trackId of ids) {
    const state = {};
    for (const format of formats) {
      const file = files.find(
        (candidate) =>
          candidate.trackId === trackId &&
          candidate.kind === derivativeKind(format),
      );
      state[format] = {
        ready: Boolean(file),
        filename: file?.filename || null,
        sizeBytes: file?.sizeBytes || null,
      };
    }
    states.set(trackId, state);
  }

  return states;
}

// ReleaseCore M13.1 — precise purchaser derivative readiness.
export async function inspectCustomerDownloadFiles({
  shop,
  trackIds,
}) {
  const settings = await db.appSettings.findUnique({ where: { shop } });
  const normalized = normalizedCustomerDownloadSettings(settings || {});
  const formats = enabledCustomerDownloadFormats(settings || {});
  const ids = unique(trackIds);
  const result = new Map();

  if (!ids.length || !formats.length) return result;

  for (const trackId of ids) {
    const track = await getTrack(shop, trackId);
    const state = {};

    if (!track) {
      for (const format of formats) {
        state[format] = {
          state: "MISSING",
          ready: false,
          filename: null,
          sizeBytes: null,
          releaseFileId: null,
        };
      }
      result.set(trackId, state);
      continue;
    }

    const master = masterFile(track);
    if (!master) {
      for (const format of formats) {
        state[format] = {
          state: "NO_MASTER",
          ready: false,
          filename: null,
          sizeBytes: null,
          releaseFileId: null,
        };
      }
      result.set(trackId, state);
      continue;
    }

    const cover = newestFile(track.release?.files, "COVER_ART");
    const metadata = metadataForTrack(track, settings || {}, normalized);

    for (const format of formats) {
      const kind = derivativeKind(format);
      const fingerprint = derivativeFingerprint({
        format,
        master,
        cover,
        metadata,
        normalized,
      });

      const candidates = (track.files || [])
        .filter(
          (file) =>
            file.kind === kind &&
            file.status === "READY" &&
            file.storageKey,
        )
        .sort(
          (left, right) =>
            new Date(right.updatedAt || right.createdAt || 0).getTime() -
            new Date(left.updatedAt || left.createdAt || 0).getTime(),
        );

      const current =
        candidates.find(
          (file) => file.derivativeFingerprint === fingerprint,
        ) || null;

      const newest = candidates[0] || null;
      const status = current
        ? "READY"
        : newest
          ? "STALE"
          : "MISSING";

      state[format] = {
        state: status,
        ready: status === "READY",
        filename: (current || newest)?.filename || null,
        sizeBytes: (current || newest)?.sizeBytes || null,
        releaseFileId: (current || newest)?.id || null,
      };
    }

    result.set(trackId, state);
  }

  return result;
}

export async function rebuildCustomerDownloadFiles({
  shop,
  trackIds,
  formats = null,
}) {
  const settings = await db.appSettings.findUnique({ where: { shop } });
  const enabled = enabledCustomerDownloadFormats(settings || {});
  const requested = Array.isArray(formats) && formats.length
    ? unique(
        formats
          .map((value) => String(value || "").trim().toLowerCase())
          .filter((value) => enabled.includes(value)),
      )
    : enabled;

  const ids = unique(trackIds);
  let prepared = 0;
  const errors = [];

  for (const trackId of ids) {
    for (const format of requested) {
      try {
        await ensureCustomerDownloadFile({
          shop,
          trackId,
          format,
          force: true,
        });
        prepared += 1;
      } catch (error) {
        errors.push({
          trackId,
          format,
          message:
            error instanceof Error
              ? error.message
              : "Customer derivative regeneration failed.",
        });
      }
    }
  }

  return {
    prepared,
    requested: ids.length * requested.length,
    errors,
  };
}
