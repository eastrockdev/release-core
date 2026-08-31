#!/usr/bin/env node

import path from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function safeEnvLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function maskDatabaseUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname;
    const database = url.pathname.replace(/^\//, "") || "(default)";
    return `${host}/${database}`;
  } catch {
    return "(database URL could not be summarized)";
  }
}

function localStoragePath(storageKey) {
  const root = path.resolve(process.cwd(), "storage", "releasecore-uploads");
  const fullPath = path.resolve(root, storageKey);
  if (!fullPath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Unsafe LOCAL_DEV storage key: ${storageKey}`);
  }
  return fullPath;
}

function migratedR2Key(environment, storageKey) {
  const normalized = String(storageKey || "").replace(/^\/+/, "");
  return `masters/migrations/${safeEnvLabel(environment)}/${normalized}`;
}

function createR2Client() {
  return new S3Client({
    region: "auto",
    endpoint: requiredEnv("R2_ENDPOINT"),
    credentials: {
      accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: true,
  });
}

async function verifyObject({ client, bucket, key, expectedSize }) {
  const response = await client.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  const actualSize = Number(response.ContentLength || 0);
  if (actualSize !== Number(expectedSize)) {
    throw new Error(
      `R2 verification failed for ${key}: expected ${expectedSize} bytes, got ${actualSize}.`,
    );
  }

  return response;
}

async function main() {
  const environment = argValue("--environment");
  const commit = hasFlag("--commit");

  if (!environment || !["production", "development"].includes(environment)) {
    throw new Error(
      'Use --environment production or --environment development.',
    );
  }

  const databaseUrl = requiredEnv("DATABASE_URL");
  const bucket = requiredEnv("R2_BUCKET");

  console.log("");
  console.log("ReleaseCore LOCAL_DEV → R2 migration");
  console.log("------------------------------------");
  console.log(`Environment label: ${environment}`);
  console.log(`Database:          ${maskDatabaseUrl(databaseUrl)}`);
  console.log(`R2 bucket:         ${bucket}`);
  console.log(`Mode:              ${commit ? "COMMIT" : "DRY RUN"}`);
  console.log("");

  const prisma = new PrismaClient();
  const r2 = createR2Client();

  try {
    const rows = await prisma.releaseFile.findMany({
      where: {
        storageProvider: "LOCAL_DEV",
        kind: "MASTER_WAV",
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        filename: true,
        storageKey: true,
        mimeType: true,
        sizeBytes: true,
        releaseId: true,
        trackId: true,
        status: true,
      },
    });

    console.log(`Found ${rows.length} LOCAL_DEV master${rows.length === 1 ? "" : "s"}.`);

    if (!rows.length) {
      console.log("Nothing to migrate.");
      return;
    }

    for (const row of rows) {
      const sourcePath = localStoragePath(row.storageKey);
      const info = await stat(sourcePath);
      const targetKey = migratedR2Key(environment, row.storageKey);

      console.log("");
      console.log(`File ID:       ${row.id}`);
      console.log(`Filename:      ${row.filename}`);
      console.log(`Local path:    ${sourcePath}`);
      console.log(`Local size:    ${info.size} bytes`);
      console.log(`R2 target key: ${targetKey}`);

      if (!commit) {
        console.log("DRY RUN: no upload or database change performed.");
        continue;
      }

      let uploaded = false;

      try {
        await r2.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: targetKey,
            Body: createReadStream(sourcePath),
            ContentLength: info.size,
            ContentType: row.mimeType || "audio/wav",
          }),
        );
        uploaded = true;

        await verifyObject({
          client: r2,
          bucket,
          key: targetKey,
          expectedSize: info.size,
        });

        const updated = await prisma.releaseFile.updateMany({
          where: {
            id: row.id,
            storageProvider: "LOCAL_DEV",
            storageKey: row.storageKey,
          },
          data: {
            storageProvider: "R2",
            storageKey: targetKey,
            sizeBytes: info.size,
            status: "READY",
          },
        });

        if (updated.count !== 1) {
          throw new Error(
            `Database safety check failed for ${row.id}: expected to update exactly 1 row, updated ${updated.count}.`,
          );
        }

        console.log("✓ Uploaded to R2");
        console.log("✓ Verified object size");
        console.log("✓ Updated existing ReleaseFile row");
        console.log("✓ Local source file retained as a safety copy");
      } catch (error) {
        if (uploaded) {
          try {
            await r2.send(
              new DeleteObjectCommand({
                Bucket: bucket,
                Key: targetKey,
              }),
            );
            console.error("Rolled back newly uploaded R2 object after migration failure.");
          } catch (cleanupError) {
            console.error(
              "WARNING: Could not remove the newly uploaded R2 object after failure:",
              cleanupError instanceof Error ? cleanupError.message : cleanupError,
            );
          }
        }
        throw error;
      }
    }

    if (commit) {
      const remaining = await prisma.releaseFile.count({
        where: {
          storageProvider: "LOCAL_DEV",
          kind: "MASTER_WAV",
        },
      });

      console.log("");
      console.log(`Remaining LOCAL_DEV masters in this database: ${remaining}`);

      if (remaining !== 0) {
        throw new Error(
          `Migration finished with ${remaining} LOCAL_DEV master(s) still present.`,
        );
      }

      console.log("Migration complete.");
    } else {
      console.log("");
      console.log("Dry run complete. Re-run with --commit after reviewing the output.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("");
  console.error("Migration failed:");
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
