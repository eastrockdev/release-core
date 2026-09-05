import db from "../db.server";
import { publicError } from "./http-security.server";
import { normalizeIsrc, validateIsrc } from "./isrc";
import { isValidUpc } from "./upc";

const VALID_RELEASE_TYPES = new Set(["SINGLE", "EP", "ALBUM"]);
const VALID_IMPORT_STATES = new Set(["CATALOG", "DRAFT"]);
const MAX_CSV_BYTES = 2_000_000;

export const BACK_CATALOG_COLUMNS = [
  "release_title",
  "release_type",
  "release_date",
  "upc",
  "catalog_number",
  "label_name",
  "p_line_holder",
  "primary_genre",
  "pre_save_url",
  "streaming_url",
  "track_number",
  "track_title",
  "track_version",
  "track_language",
  "explicit",
  "isrc",
  "lyrics",
];

const REQUIRED_COLUMNS = new Set([
  "release_title",
  "release_type",
  "release_date",
  "track_number",
  "track_title",
  "isrc",
]);

const RELEASE_COLUMNS = [
  "release_title",
  "release_type",
  "release_date",
  "upc",
  "catalog_number",
  "label_name",
  "p_line_holder",
  "primary_genre",
  "pre_save_url",
  "streaming_url",
];

function clean(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildBackCatalogTemplateCsv() {
  const rows = [
    BACK_CATALOG_COLUMNS,
    [
      "Your Project Title",
      "ALBUM",
      "2024-01-19",
      "012345678905",
      "CAT240001",
      "Your Label",
      "Your Label",
      "Hip-Hop/Rap",
      "",
      "https://example.com/project",
      "1",
      "Track One",
      "",
      "en",
      "false",
      "USABC2400001",
      "",
    ],
    [
      "Your Project Title",
      "ALBUM",
      "2024-01-19",
      "012345678905",
      "CAT240001",
      "Your Label",
      "Your Label",
      "Hip-Hop/Rap",
      "",
      "https://example.com/project",
      "2",
      "Track Two",
      "",
      "en",
      "true",
      "USABC2400002",
      "",
    ],
    [
      "Your Project Title",
      "ALBUM",
      "2024-01-19",
      "012345678905",
      "CAT240001",
      "Your Label",
      "Your Label",
      "Hip-Hop/Rap",
      "",
      "https://example.com/project",
      "3",
      "Track Three",
      "Remastered",
      "en",
      "false",
      "USABC2400003",
      "",
    ],
  ];

  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function parseCsvMatrix(csvText) {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  if (!text.trim()) throw publicError("Choose a CSV file to import.", { status: 400 });
  if (Buffer.byteLength(text, "utf8") > MAX_CSV_BYTES) {
    throw publicError("The CSV is too large. Keep back catalog imports under 2 MB per project.", { status: 413 });
  }

  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      if (cell.length) {
        throw publicError("CSV contains an unexpected quote. Download a fresh template and try again.", { status: 400 });
      }
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) {
    throw publicError("CSV contains an unterminated quoted value.", { status: 400 });
  }

  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter((item) => item.some((value) => clean(value)));
}

function normalizedHeaders(row) {
  const headers = row.map((value) =>
    clean(value)
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .replace(/[^a-z0-9_]/g, ""),
  );
  const duplicates = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (duplicates.length) {
    throw publicError(`CSV contains duplicate column ${duplicates[0]}.`, { status: 400 });
  }
  return headers;
}

function parseDate(value, rowNumber, errors) {
  const raw = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    errors.push(`Row ${rowNumber}: release_date must use YYYY-MM-DD.`);
    return null;
  }
  const parsed = new Date(`${raw}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    errors.push(`Row ${rowNumber}: release_date is not a valid calendar date.`);
    return null;
  }
  return parsed;
}

function parseExplicit(value, rowNumber, errors) {
  const raw = clean(value).toLowerCase();
  if (!raw) return false;
  if (["true", "1", "yes", "explicit"].includes(raw)) return true;
  if (["false", "0", "no", "clean"].includes(raw)) return false;
  errors.push(`Row ${rowNumber}: explicit must be true/false, yes/no, 1/0, explicit/clean.`);
  return false;
}

function sameText(left, right) {
  return clean(left).localeCompare(clean(right), undefined, { sensitivity: "base" }) === 0;
}

function serializeDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

export function parseBackCatalogCsv(csvText) {
  const matrix = parseCsvMatrix(csvText);
  if (matrix.length < 2) {
    throw publicError("The CSV must contain a header row and at least one track.", { status: 400 });
  }

  const headers = normalizedHeaders(matrix[0]);
  const missing = [...REQUIRED_COLUMNS].filter((column) => !headers.includes(column));
  if (missing.length) {
    throw publicError(`CSV is missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`, { status: 400 });
  }

  const unknownColumns = headers.filter((header) => header && !BACK_CATALOG_COLUMNS.includes(header));
  const warnings = unknownColumns.length
    ? [`Ignored unknown CSV column${unknownColumns.length === 1 ? "" : "s"}: ${unknownColumns.join(", ")}.`]
    : [];
  const errors = [];
  const rows = [];
  const releaseValues = {};
  const seenPositions = new Map();
  const seenIsrcs = new Map();

  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const rowNumber = rowIndex + 1;
    const source = matrix[rowIndex];
    const values = {};
    headers.forEach((header, columnIndex) => {
      if (!header || !BACK_CATALOG_COLUMNS.includes(header)) return;
      values[header] = source[columnIndex] ?? "";
    });

    if (!Object.values(values).some((value) => clean(value))) continue;

    for (const column of RELEASE_COLUMNS) {
      const value = clean(values[column]);
      if (!releaseValues[column] && value) {
        releaseValues[column] = value;
      } else if (value && releaseValues[column] && !sameText(value, releaseValues[column])) {
        errors.push(`Row ${rowNumber}: ${column} must match the other rows in this project.`);
      }
    }

    const position = Number(clean(values.track_number));
    if (!Number.isInteger(position) || position < 1 || position > 999) {
      errors.push(`Row ${rowNumber}: track_number must be a whole number between 1 and 999.`);
    } else if (seenPositions.has(position)) {
      errors.push(`Row ${rowNumber}: track_number ${position} is already used on row ${seenPositions.get(position)}.`);
    } else {
      seenPositions.set(position, rowNumber);
    }

    const trackTitle = clean(values.track_title);
    if (!trackTitle) errors.push(`Row ${rowNumber}: track_title is required.`);

    let isrc = "";
    try {
      isrc = validateIsrc(values.isrc);
    } catch {
      const normalized = normalizeIsrc(values.isrc);
      errors.push(`Row ${rowNumber}: ${normalized || "ISRC"} is not a valid 12-character ISRC.`);
    }
    if (isrc) {
      if (seenIsrcs.has(isrc)) {
        errors.push(`Row ${rowNumber}: ISRC ${isrc} is already used on row ${seenIsrcs.get(isrc)}.`);
      } else {
        seenIsrcs.set(isrc, rowNumber);
      }
    }

    rows.push({
      rowNumber,
      position: Number.isInteger(position) ? position : 0,
      title: trackTitle,
      version: clean(values.track_version) || null,
      language: clean(values.track_language) || null,
      explicit: parseExplicit(values.explicit, rowNumber, errors),
      isrc: isrc || null,
      lyrics: clean(values.lyrics) || null,
    });
  }

  if (!rows.length) errors.push("The CSV does not contain any track rows.");

  const title = clean(releaseValues.release_title);
  const type = clean(releaseValues.release_type).toUpperCase();
  const releaseDate = parseDate(releaseValues.release_date, 2, errors);
  const upc = clean(releaseValues.upc).replace(/\D/g, "") || null;
  const catalogNumber = clean(releaseValues.catalog_number) || null;

  if (!title) errors.push("release_title is required on every project.");
  if (!VALID_RELEASE_TYPES.has(type)) errors.push("release_type must be SINGLE, EP or ALBUM.");
  if (type === "SINGLE" && rows.length !== 1) errors.push("A SINGLE back catalog import must contain exactly one track row.");
  if (upc && !isValidUpc(upc)) errors.push(`UPC ${upc} is not a valid 12-digit UPC/GTIN-12.`);

  const sortedRows = [...rows].sort((left, right) => left.position - right.position);
  if (sortedRows.length) {
    sortedRows.forEach((track, index) => {
      if (track.position !== index + 1) {
        warnings.push("Track numbers are not consecutive. ReleaseCore will preserve the supplied positions.");
      }
    });
  }

  return {
    errors,
    warnings: [...new Set(warnings)],
    release: {
      title,
      type,
      releaseDate,
      upc,
      catalogNumber,
      labelName: clean(releaseValues.label_name) || null,
      pLineHolder: clean(releaseValues.p_line_holder) || null,
      primaryGenre: clean(releaseValues.primary_genre) || null,
      preSaveUrl: clean(releaseValues.pre_save_url) || null,
      streamingUrl: clean(releaseValues.streaming_url) || null,
    },
    tracks: sortedRows,
  };
}

async function inspectBackCatalogImport({ shop, artistId, csvText }) {
  const parsed = parseBackCatalogCsv(csvText);
  const artist = artistId
    ? await db.artist.findFirst({ where: { id: artistId, shop }, select: { id: true, name: true } })
    : null;

  if (!artist) parsed.errors.push("Choose an existing ReleaseCore artist for this project.");

  const checks = [];
  if (parsed.release.upc) {
    checks.push(
      db.release.findFirst({
        where: { upc: parsed.release.upc },
        select: { id: true, title: true },
      }).then((release) => ({ kind: "upc", release })),
    );
  }
  if (parsed.release.catalogNumber) {
    checks.push(
      db.release.findFirst({
        where: { shop, catalogNumber: parsed.release.catalogNumber },
        select: { id: true, title: true },
      }).then((release) => ({ kind: "catalog", release })),
    );
  }
  if (parsed.tracks.length) {
    checks.push(
      db.track.findMany({
        where: { isrc: { in: parsed.tracks.map((track) => track.isrc).filter(Boolean) } },
        select: { isrc: true, title: true, release: { select: { id: true, title: true } } },
      }).then((tracks) => ({ kind: "isrc", tracks })),
    );
  }
  if (parsed.release.title && parsed.release.releaseDate) {
    checks.push(
      db.release.findFirst({
        where: {
          shop,
          title: parsed.release.title,
          releaseDate: parsed.release.releaseDate,
        },
        select: { id: true, title: true },
      }).then((release) => ({ kind: "similar", release })),
    );
  }

  for (const result of await Promise.all(checks)) {
    if (result.kind === "upc" && result.release) {
      parsed.errors.push(`UPC ${parsed.release.upc} already belongs to “${result.release.title}” in ReleaseCore.`);
    } else if (result.kind === "catalog" && result.release) {
      parsed.errors.push(`Catalog number ${parsed.release.catalogNumber} already belongs to “${result.release.title}” in this store.`);
    } else if (result.kind === "isrc") {
      for (const track of result.tracks) {
        parsed.errors.push(`ISRC ${track.isrc} already belongs to “${track.title}” on “${track.release.title}”.`);
      }
    } else if (result.kind === "similar" && result.release) {
      parsed.warnings.push(`A ReleaseCore release named “${result.release.title}” already exists with the same release date. Confirm this is not a duplicate.`);
    }
  }

  return {
    ...parsed,
    artist,
    errors: [...new Set(parsed.errors)],
    warnings: [...new Set(parsed.warnings)],
  };
}

export async function previewBackCatalogCsv({ shop, artistId, csvText }) {
  const result = await inspectBackCatalogImport({ shop, artistId, csvText });
  return {
    valid: result.errors.length === 0,
    errors: result.errors,
    warnings: result.warnings,
    artist: result.artist,
    release: {
      ...result.release,
      releaseDate: serializeDate(result.release.releaseDate),
    },
    tracks: result.tracks.map((track) => ({ ...track })),
  };
}

export async function importBackCatalogCsv({ shop, artistId, csvText, importState = "CATALOG" }) {
  const state = clean(importState).toUpperCase();
  if (!VALID_IMPORT_STATES.has(state)) {
    throw publicError("Choose Existing catalog or Draft for the imported release state.", { status: 400 });
  }

  const result = await inspectBackCatalogImport({ shop, artistId, csvText });
  if (result.errors.length) {
    throw publicError(`Back catalog CSV cannot be imported: ${result.errors[0]}`, { status: 409 });
  }

  const isCatalog = state === "CATALOG";
  const now = new Date();

  try {
    const release = await db.$transaction(async (tx) => {
      const created = await tx.release.create({
        data: {
          shop,
          type: result.release.type,
          title: result.release.title,
          artistName: result.artist.name,
          status: isCatalog ? "APPROVED" : "DRAFT",
          distributionStatus: isCatalog ? "DELIVERED" : "NOT_QUEUED",
          distributionUpdatedAt: isCatalog ? now : null,
          decisionAt: isCatalog ? now : null,
          releaseDate: result.release.releaseDate,
          upc: result.release.upc,
          upcAssignedAt: result.release.upc ? now : null,
          catalogNumber: result.release.catalogNumber,
          catalogNumberAssignedAt: result.release.catalogNumber ? now : null,
          labelName: result.release.labelName,
          pLineHolder: result.release.pLineHolder,
          primaryGenre: result.release.primaryGenre,
          preSaveUrl: result.release.preSaveUrl,
          streamingUrl: result.release.streamingUrl,
          artists: {
            create: {
              artistId: result.artist.id,
              role: "PRIMARY",
              position: 1,
            },
          },
          tracks: {
            create: result.tracks.map((track) => ({
              position: track.position,
              title: track.title,
              version: track.version,
              language: track.language,
              explicit: track.explicit,
              isrc: track.isrc,
              isrcAssignedAt: track.isrc ? now : null,
              lyrics: track.lyrics,
              artists: {
                create: {
                  artistId: result.artist.id,
                  role: "PRIMARY",
                  position: 1,
                },
              },
            })),
          },
        },
        select: { id: true, title: true, type: true, status: true },
      });

      await tx.submissionEvent.create({
        data: {
          releaseId: created.id,
          type: "BACK_CATALOG_CSV_IMPORTED",
          actorLabel: "ReleaseCore Admin",
          fromStatus: null,
          toStatus: created.status,
          message: `Imported ${result.tracks.length} track${result.tracks.length === 1 ? "" : "s"} from a back catalog CSV. Artist identities and contributor credits were not created or modified.`,
        },
      });

      return created;
    });

    return {
      imported: true,
      releaseId: release.id,
      title: release.title,
      type: release.type,
      status: release.status,
      trackCount: result.tracks.length,
      warnings: result.warnings,
    };
  } catch (error) {
    if (error?.code === "P2002") {
      throw publicError("A UPC, catalog number, ISRC, or track position in this CSV was assigned by another operation before the import completed. Preview the CSV again and retry.", { status: 409 });
    }
    throw error;
  }
}
