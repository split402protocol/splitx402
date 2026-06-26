import { fileURLToPath } from "node:url";

import { Pool, type PoolConfig } from "pg";

import {
  applyControlPlaneMigrations,
  type ControlPlaneMigrationResult
} from "./migrations.js";

export function readControlPlaneMigrationPoolConfig(
  env: NodeJS.ProcessEnv = process.env
): PoolConfig {
  const connectionString = env.SPLIT402_DATABASE_URL ?? env.DATABASE_URL;
  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error("SPLIT402_DATABASE_URL or DATABASE_URL is required");
  }

  const poolConfig: PoolConfig = { connectionString };
  const max = readOptionalPositiveInteger(
    env.SPLIT402_DATABASE_POOL_MAX,
    "SPLIT402_DATABASE_POOL_MAX"
  );
  if (max !== undefined) {
    poolConfig.max = max;
  }

  if (readOptionalBoolean(env.SPLIT402_DATABASE_SSL, "SPLIT402_DATABASE_SSL") === true) {
    poolConfig.ssl = {
      rejectUnauthorized: env.SPLIT402_DATABASE_SSL_REJECT_UNAUTHORIZED !== "false"
    };
  }
  return poolConfig;
}

export async function runControlPlaneMigrationsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Promise<ControlPlaneMigrationResult[]> {
  const pool = new Pool(readControlPlaneMigrationPoolConfig(env));
  try {
    return await applyControlPlaneMigrations(pool);
  } finally {
    await pool.end();
  }
}

if (isMainModule()) {
  runControlPlaneMigrationsFromEnv()
    .then((results) => {
      console.log(
        JSON.stringify(
          {
            schema: "split402.control_plane_migration_run.v1",
            applied: results.filter((result) => result.status === "applied")
              .length,
            skipped: results.filter((result) => result.status === "skipped")
              .length,
            migrations: results
          },
          null,
          2
        )
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}

function readOptionalPositiveInteger(
  value: string | undefined,
  label: string
): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number.parseInt(value, 10);
}

function readOptionalBoolean(
  value: string | undefined,
  label: string
): boolean | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${label} must be true or false`);
}

function isMainModule(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}
