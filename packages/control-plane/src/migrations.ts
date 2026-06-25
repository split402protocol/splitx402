import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { QueryResultRow } from "pg";

import type {
  PostgresPool,
  PostgresQueryExecutor
} from "./postgres.js";

export interface ControlPlaneMigration {
  name: string;
  checksum: `sha256:${string}`;
  sql: string;
}

export type ControlPlaneMigrationStatus = "applied" | "skipped";

export interface ControlPlaneMigrationResult {
  name: string;
  checksum: `sha256:${string}`;
  status: ControlPlaneMigrationStatus;
}

export interface LoadControlPlaneMigrationsOptions {
  directory?: string | URL;
}

interface AppliedMigrationRow extends QueryResultRow {
  name: string;
  checksum: string;
}

const DEFAULT_MIGRATIONS_DIRECTORY = new URL("../migrations/", import.meta.url);

export async function loadControlPlaneMigrations(
  options: LoadControlPlaneMigrationsOptions = {}
): Promise<ControlPlaneMigration[]> {
  const directory = resolveMigrationsDirectory(options.directory);
  const entries = await readdir(directory);
  const migrationNames = entries
    .filter((entry) => /^[0-9]{4}_.+\.sql$/u.test(entry))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    migrationNames.map(async (name) => {
      const sql = await readFile(join(directory, name), "utf8");
      return {
        name: basename(name),
        checksum: checksumSql(sql),
        sql
      };
    })
  );
}

export async function applyControlPlaneMigrations(
  db: PostgresPool | PostgresQueryExecutor,
  migrations?: readonly ControlPlaneMigration[]
): Promise<ControlPlaneMigrationResult[]> {
  const client = await createMigrationClient(db);
  try {
    await client.query(
      `create table if not exists split402_migrations (
         name text primary key,
         checksum text not null,
         applied_at timestamptz not null default now()
       )`
    );

    const loadedMigrations = migrations ?? (await loadControlPlaneMigrations());
    const results: ControlPlaneMigrationResult[] = [];
    for (const migration of loadedMigrations) {
      results.push(await applyMigration(client, migration));
    }
    return results;
  } finally {
    client.release?.();
  }
}

async function applyMigration(
  client: PostgresQueryExecutor,
  migration: ControlPlaneMigration
): Promise<ControlPlaneMigrationResult> {
  await client.query("begin");
  try {
    const applied = await client.query<AppliedMigrationRow>(
      `select name, checksum
         from split402_migrations
        where name = $1
        for update`,
      [migration.name]
    );
    const existing = applied.rows[0];
    if (existing !== undefined) {
      if (existing.checksum !== migration.checksum) {
        throw new Error(
          `migration checksum mismatch for ${migration.name}: ` +
            `${existing.checksum} != ${migration.checksum}`
        );
      }
      await client.query("commit");
      return {
        name: migration.name,
        checksum: migration.checksum,
        status: "skipped"
      };
    }

    await client.query(migration.sql);
    await client.query(
      `insert into split402_migrations (name, checksum)
       values ($1, $2)`,
      [migration.name, migration.checksum]
    );
    await client.query("commit");
    return {
      name: migration.name,
      checksum: migration.checksum,
      status: "applied"
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
}

async function createMigrationClient(
  db: PostgresPool | PostgresQueryExecutor
): Promise<PostgresQueryExecutor & { release?: () => void }> {
  if (isPostgresPool(db)) {
    return db.connect();
  }
  return db;
}

function checksumSql(sql: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(sql).digest("hex")}`;
}

function resolveMigrationsDirectory(directory?: string | URL): string {
  return directory instanceof URL
    ? fileURLToPath(directory)
    : directory ?? fileURLToPath(DEFAULT_MIGRATIONS_DIRECTORY);
}

function isPostgresPool(value: unknown): value is PostgresPool {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { connect?: unknown }).connect === "function"
  );
}

async function rollbackQuietly(client: PostgresQueryExecutor): Promise<void> {
  try {
    await client.query("rollback");
  } catch {
    // Preserve the original migration error.
  }
}
