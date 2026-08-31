#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

const SQLITE_PATH = path.resolve("prisma/dev.sqlite");
const REPORT_PATH = path.resolve(
  "backups/milestone10/neon-row-counts-after-migration.txt",
);

const NEON_DIRECT_URL = process.env.NEON_DIRECT_URL;

if (!NEON_DIRECT_URL) {
  console.error("NEON_DIRECT_URL is not set.");
  process.exit(1);
}

if (!fs.existsSync(SQLITE_PATH)) {
  console.error(`SQLite database not found: ${SQLITE_PATH}`);
  process.exit(1);
}

function sqliteRaw(sql) {
  return execFileSync("sqlite3", [SQLITE_PATH, sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function sqliteJson(sql) {
  const output = execFileSync("sqlite3", ["-json", SQLITE_PATH, sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  return output ? JSON.parse(output) : [];
}

function quoteSqliteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quotePgIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function getSqliteTables() {
  return sqliteJson(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name != '_prisma_migrations'
    ORDER BY name;
  `).map((row) => row.name);
}

function getDependencies(table) {
  const safe = String(table).replaceAll("'", "''");
  return sqliteJson(`PRAGMA foreign_key_list('${safe}');`)
    .map((row) => row.table)
    .filter((dependency) => dependency && dependency !== table);
}

function dependencyOrder(tables) {
  const tableSet = new Set(tables);
  const dependencies = new Map(
    tables.map((table) => [
      table,
      new Set(getDependencies(table).filter((dep) => tableSet.has(dep))),
    ]),
  );

  const ordered = [];
  const remaining = new Set(tables);

  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((table) =>
        [...dependencies.get(table)].every((dep) => ordered.includes(dep)),
      )
      .sort();

    if (ready.length === 0) {
      throw new Error(
        `Could not determine dependency-safe table order. Remaining: ${
          [...remaining].join(", ")
        }`,
      );
    }

    for (const table of ready) {
      ordered.push(table);
      remaining.delete(table);
    }
  }

  return ordered;
}

async function getPgColumns(client, table) {
  const result = await client.query(
    `
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position;
    `,
    [table],
  );

  return result.rows;
}

function convertValue(value, column) {
  if (value === null || value === undefined) return null;

  const dataType = column.data_type;
  const udtName = column.udt_name;

  if (dataType === "boolean") {
    if (value === true || value === false) return value;
    if (value === 1 || value === "1" || value === "true") return true;
    if (value === 0 || value === "0" || value === "false") return false;
  }

  // Prisma + SQLite commonly stores DateTime values as Unix epoch
  // milliseconds (for example 1788106744207). PostgreSQL timestamp
  // columns require an actual timestamp/date value.
  if (
    dataType === "timestamp without time zone" ||
    dataType === "timestamp with time zone"
  ) {
    if (value instanceof Date) return value;

    if (
      typeof value === "number" ||
      (typeof value === "string" && /^-?\\d+(?:\\.\\d+)?$/.test(value))
    ) {
      const numeric = Number(value);

      if (!Number.isFinite(numeric)) {
        throw new Error(
          `Invalid numeric timestamp for ${column.column_name}: ${value}`,
        );
      }

      // Values below 1e11 are almost certainly epoch seconds;
      // Prisma SQLite DateTime values are normally epoch milliseconds.
      const epochMs = Math.abs(numeric) < 1e11 ? numeric * 1000 : numeric;
      const date = new Date(epochMs);

      if (Number.isNaN(date.getTime())) {
        throw new Error(
          `Invalid timestamp for ${column.column_name}: ${value}`,
        );
      }

      return date;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error(
        `Invalid timestamp for ${column.column_name}: ${value}`,
      );
    }

    return date;
  }

  if (dataType === "date") {
    if (
      typeof value === "number" ||
      (typeof value === "string" && /^-?\\d+(?:\\.\\d+)?$/.test(value))
    ) {
      const numeric = Number(value);
      const epochMs = Math.abs(numeric) < 1e11 ? numeric * 1000 : numeric;
      const date = new Date(epochMs);

      if (Number.isNaN(date.getTime())) {
        throw new Error(
          `Invalid date for ${column.column_name}: ${value}`,
        );
      }

      return date.toISOString().slice(0, 10);
    }

    return value;
  }

  if (dataType === "bigint") {
    return String(value);
  }

  if (dataType === "json" || dataType === "jsonb") {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }

  if (udtName === "bytea" && typeof value === "string") {
    return Buffer.from(value, "base64");
  }

  return value;
}

async function ensureNeonIsEmpty(client, tables) {
  const nonEmpty = [];

  for (const table of tables) {
    const result = await client.query(
      `SELECT COUNT(*)::bigint AS count FROM ${quotePgIdent(table)};`,
    );
    const count = Number(result.rows[0].count);
    if (count > 0) nonEmpty.push(`${table} (${count})`);
  }

  if (nonEmpty.length > 0) {
    throw new Error(
      "Neon is not empty. Migration was stopped to prevent duplicate data.\n" +
        nonEmpty.join("\n"),
    );
  }
}

async function main() {
  console.log("ReleaseCore SQLite -> Neon migration");
  console.log("-------------------------------------");

  const integrity = sqliteRaw("PRAGMA integrity_check;");
  if (integrity !== "ok") {
    throw new Error(`SQLite integrity check failed: ${integrity}`);
  }
  console.log("✓ SQLite integrity check passed");

  const foreignKeyProblems = sqliteRaw("PRAGMA foreign_key_check;");
  if (foreignKeyProblems) {
    throw new Error(
      `SQLite foreign key check failed:\n${foreignKeyProblems}`,
    );
  }
  console.log("✓ SQLite foreign key check passed");

  const tables = getSqliteTables();
  const orderedTables = dependencyOrder(tables);

  console.log(`✓ Found ${tables.length} application tables`);
  console.log(`Copy order: ${orderedTables.join(" -> ")}`);

  const client = new Client({
    connectionString: NEON_DIRECT_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await ensureNeonIsEmpty(client, tables);
    console.log("✓ Neon target tables are empty");

    const sqliteCounts = new Map();
    const neonCounts = new Map();

    await client.query("BEGIN");

    try {
      for (const table of orderedTables) {
        const rows = sqliteJson(
          `SELECT * FROM ${quoteSqliteIdent(table)};`,
        );

        sqliteCounts.set(table, rows.length);
        console.log(`${table}: preparing ${rows.length} row(s)`);

        if (rows.length === 0) {
          console.log(`${table}: 0 rows`);
          continue;
        }

        const pgColumns = await getPgColumns(client, table);
        if (pgColumns.length === 0) {
          throw new Error(`Target table not found in Neon: ${table}`);
        }

        const pgColumnMap = new Map(
          pgColumns.map((column) => [column.column_name, column]),
        );

        for (const row of rows) {
          const columns = Object.keys(row).filter((name) =>
            pgColumnMap.has(name)
          );

          if (columns.length === 0) {
            throw new Error(`No compatible columns found for ${table}`);
          }

          const values = columns.map((name) =>
            convertValue(row[name], pgColumnMap.get(name))
          );

          const placeholders = values.map((_, index) => `$${index + 1}`);

          const sql = `
            INSERT INTO ${quotePgIdent(table)}
              (${columns.map(quotePgIdent).join(", ")})
            VALUES
              (${placeholders.join(", ")});
          `;

          try {
            await client.query(sql, values);
          } catch (error) {
            throw new Error(
              `Insert failed in ${table} for columns [${columns.join(", ")}]: ${error.message}`,
              { cause: error },
            );
          }
        }

        console.log(`${table}: copied ${rows.length} row(s)`);
      }

      console.log("\nVerifying row counts before commit...");

      let mismatch = false;
      const reportLines = [];

      for (const table of [...tables].sort()) {
        const sourceCount =
          sqliteCounts.get(table) ??
          Number(
            sqliteRaw(
              `SELECT COUNT(*) FROM ${quoteSqliteIdent(table)};`,
            ),
          );

        const result = await client.query(
          `SELECT COUNT(*)::bigint AS count FROM ${quotePgIdent(table)};`,
        );
        const targetCount = Number(result.rows[0].count);
        neonCounts.set(table, targetCount);

        const ok = sourceCount === targetCount;
        if (!ok) mismatch = true;

        const line =
          `${table.padEnd(35)} ${String(sourceCount).padStart(5)} -> ${
            String(targetCount).padStart(5)
          }  ${ok ? "OK" : "MISMATCH"}`;

        reportLines.push(line);
        console.log(line);
      }

      if (mismatch) {
        throw new Error(
          "One or more table counts did not match. Transaction will be rolled back.",
        );
      }

      await client.query("COMMIT");

      fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
      fs.writeFileSync(
        REPORT_PATH,
        reportLines.join("\n") + "\n",
        "utf8",
      );

      console.log("\n✓ Migration committed successfully");
      console.log(`✓ Verification report: ${REPORT_PATH}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\nMigration failed:");
  console.error(error?.stack || error);
  process.exit(1);
});
