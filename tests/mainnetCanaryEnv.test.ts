import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { createMainnetCanaryEnv } from "../src/mainnetCanaryEnv.js";

describe("mainnet canary environment loading", () => {
  it("returns process env values when no workspace is configured", () => {
    const env = createMainnetCanaryEnv({
      processEnv: {
        SPLIT402_MAINNET_CANARY_NETWORK: "solana:mainnet",
      },
    });

    expect(env.SPLIT402_MAINNET_CANARY_NETWORK).toBe("solana:mainnet");
  });

  it("loads mainnet-canary.env from the launch evidence workspace", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-canary-env-"));
    try {
      writeFileSync(
        join(directory, "mainnet-canary.env"),
        [
          "SPLIT402_MAINNET_CANARY_CONFIRM=split402-mainnet-canary",
          "SPLIT402_MAINNET_CANARY_NETWORK=solana:mainnet",
          "SPLIT402_MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC=100000",
          "",
        ].join("\n"),
      );

      const env = createMainnetCanaryEnv({
        processEnv: {},
        workspaceDirectory: directory,
      });

      expect(env.SPLIT402_MAINNET_CANARY_CONFIRM).toBe(
        "split402-mainnet-canary",
      );
      expect(env.SPLIT402_MAINNET_CANARY_NETWORK).toBe("solana:mainnet");
      expect(env.SPLIT402_MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC).toBe("100000");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("lets process env override workspace values", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-canary-env-"));
    try {
      writeFileSync(
        join(directory, "mainnet-canary.env"),
        "SPLIT402_MAINNET_CANARY_REVIEW_DECISION=no-go\n",
      );

      const env = createMainnetCanaryEnv({
        processEnv: {
          SPLIT402_MAINNET_CANARY_REVIEW_DECISION: "approved",
        },
        workspaceDirectory: directory,
      });

      expect(env.SPLIT402_MAINNET_CANARY_REVIEW_DECISION).toBe("approved");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("treats a missing workspace env file as empty", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-canary-env-"));
    try {
      mkdirSync(join(directory, "nested"));

      const env = createMainnetCanaryEnv({
        processEnv: {},
        workspaceDirectory: join(directory, "nested"),
      });

      expect(env.SPLIT402_MAINNET_CANARY_CONFIRM).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
