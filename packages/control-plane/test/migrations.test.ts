import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import {
  applyControlPlaneMigrations,
  loadControlPlaneMigrations,
  type ControlPlaneMigration
} from "../src/index.js";

describe("control-plane migrations", () => {
  it("loads packaged SQL migrations in filename order with checksums", async () => {
    const migrations = await loadControlPlaneMigrations();

    expect(migrations.map((migration) => migration.name)).toEqual([
      "0001_receipt_ingestion.sql",
      "0002_merchants_keys_origins.sql",
      "0003_wallet_auth.sql",
      "0004_campaigns.sql",
      "0005_routes.sql",
      "0006_outbox_events.sql",
      "0007_wallet_auth_refresh_tokens.sql",
      "0008_route_versions.sql",
      "0009_merchant_payout_wallets.sql",
      "0010_payout_batches.sql",
      "0011_payout_transactions.sql",
      "0012_terminal_accrual_states.sql"
    ]);
    expect(
      migrations.every((migration) =>
        /^sha256:[0-9a-f]{64}$/u.test(migration.checksum)
      )
    ).toBe(true);
    expect(migrations[0]?.sql).toContain("create table if not exists payment_receipts");
  });

  it("applies migrations once and skips matching checksums later", async () => {
    const db = new FakeMigrationExecutor();
    const migrations = createMigrations();

    const firstRun = await applyControlPlaneMigrations(db, migrations);
    const secondRun = await applyControlPlaneMigrations(db, migrations);

    expect(firstRun.map((result) => result.status)).toEqual(["applied", "applied"]);
    expect(secondRun.map((result) => result.status)).toEqual(["skipped", "skipped"]);
    expect(db.executedSql).toEqual(["select 1", "select 2"]);
    expect(db.commands.filter((command) => command === "commit")).toHaveLength(4);
    expect(db.commands).not.toContain("rollback");
  });

  it("rolls back when an applied migration checksum changes", async () => {
    const db = new FakeMigrationExecutor();
    await applyControlPlaneMigrations(db, [createMigrations()[0] as ControlPlaneMigration]);

    await expect(
      applyControlPlaneMigrations(db, [
        {
          name: "0001_test.sql",
          checksum: `sha256:${"f".repeat(64)}`,
          sql: "select changed"
        }
      ])
    ).rejects.toThrow("migration checksum mismatch");
    expect(db.commands.at(-1)).toBe("rollback");
  });
});

function createMigrations(): ControlPlaneMigration[] {
  return [
    {
      name: "0001_test.sql",
      checksum: `sha256:${"0".repeat(64)}`,
      sql: "select 1"
    },
    {
      name: "0002_test.sql",
      checksum: `sha256:${"1".repeat(64)}`,
      sql: "select 2"
    }
  ];
}

class FakeMigrationExecutor {
  readonly commands: string[] = [];
  readonly executedSql: string[] = [];
  private readonly applied = new Map<string, string>();

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult<Row>> {
    const normalized = text.replace(/\s+/gu, " ").trim().toLowerCase();

    if (
      normalized === "begin" ||
      normalized === "commit" ||
      normalized === "rollback"
    ) {
      this.commands.push(normalized);
      return result([]);
    }
    if (normalized.startsWith("create table if not exists split402_migrations")) {
      this.commands.push("ensure_migrations_table");
      return result([]);
    }
    if (normalized.startsWith("select name, checksum from split402_migrations")) {
      const name = readString(values[0]);
      const checksum = this.applied.get(name);
      return result(
        checksum === undefined
          ? []
          : ([{ name, checksum }] as unknown as Row[])
      );
    }
    if (normalized.startsWith("insert into split402_migrations")) {
      this.applied.set(readString(values[0]), readString(values[1]));
      return result([]);
    }

    this.executedSql.push(text);
    return result([]);
  }
}

function result<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: rows.length === 0 ? "SELECT" : "INSERT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
  };
}

function readString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("expected string query value");
  }
  return value;
}
