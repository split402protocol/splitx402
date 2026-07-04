import { describe, expect, it } from "vitest";

import {
  DEFAULT_PHASE7_SEED_ENV_APPLY_DOCKER_TARGET,
  DEFAULT_PHASE7_SEED_ENV_APPLY_PHASE7_TARGET,
  PHASE7_SEED_ENV_APPLY_DOCKER_KEYS,
  PHASE7_SEED_ENV_APPLY_PHASE7_KEYS,
  applyPhase7SeedProofEnvToText,
  createPhase7SeedEnvApplyResult,
  extractPhase7SeedProofEnv,
  parsePhase7SeedEnvApplyArgs,
} from "../src/phase7SeedEnvApply.js";

describe("Phase 7 seed env apply", () => {
  it("parses default args and explicit target overrides", () => {
    expect(parsePhase7SeedEnvApplyArgs(["--seed-output", "seed.json"])).toEqual({
      seedOutput: "seed.json",
      phase7Env: DEFAULT_PHASE7_SEED_ENV_APPLY_PHASE7_TARGET,
      dockerEnv: DEFAULT_PHASE7_SEED_ENV_APPLY_DOCKER_TARGET,
      dryRun: false,
      help: false,
    });
    expect(
      parsePhase7SeedEnvApplyArgs([
        "--seed-output",
        "seed.json",
        "--phase7-env",
        "phase7.env",
        "--docker-env",
        "docker.env",
        "--dry-run",
        "--help",
      ]),
    ).toEqual({
      seedOutput: "seed.json",
      phase7Env: "phase7.env",
      dockerEnv: "docker.env",
      dryRun: true,
      help: true,
    });
    expect(() =>
      parsePhase7SeedEnvApplyArgs(["--seed-output"]),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Usage: corepack pnpm phase7:staging:apply-seed-env --seed-output <path> [--phase7-env <path>] [--docker-env <path>] [--dry-run]
      --seed-output requires a value]
    `);
    expect(() =>
      parsePhase7SeedEnvApplyArgs(["--unknown"]),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Usage: corepack pnpm phase7:staging:apply-seed-env --seed-output <path> [--phase7-env <path>] [--docker-env <path>] [--dry-run]
      Unknown option: --unknown]
    `);
  });

  it("extracts proofEnv from the seed JSON output", () => {
    expect(
      extractPhase7SeedProofEnv(
        JSON.stringify({
          schema: "split402.phase7_staging_seed.v1",
          proofEnv: {
            SPLIT402_PHASE7_MERCHANT_ID: "merchant-id",
            SPLIT402_PHASE7_CONTROL_PLANE_TOKEN: "merchant-token",
          },
        }),
      ),
    ).toEqual({
      SPLIT402_PHASE7_MERCHANT_ID: "merchant-id",
      SPLIT402_PHASE7_CONTROL_PLANE_TOKEN: "merchant-token",
    });
    expect(() => extractPhase7SeedProofEnv("{}")).toThrow(
      "seed output must contain a proofEnv object",
    );
    expect(() =>
      extractPhase7SeedProofEnv(JSON.stringify({ proofEnv: { BAD: 1 } })),
    ).toThrow("proofEnv.BAD must be a string");
  });

  it("uncomments and updates only allow-listed Phase 7 env keys", () => {
    const text = [
      "# SPLIT402_PHASE7_CONTROL_PLANE_TOKEN=<merchant-session-token>",
      "# SPLIT402_PHASE7_MERCHANT_ID=<seed-output-merchant-id>",
      "SPLIT402_MCP_CAPABILITY=solana.wallet-risk",
      "UNRELATED=value",
      "",
    ].join("\n");

    expect(
      applyPhase7SeedProofEnvToText({
        text,
        allowedKeys: PHASE7_SEED_ENV_APPLY_PHASE7_KEYS,
        proofEnv: {
          SPLIT402_PHASE7_CONTROL_PLANE_TOKEN: "merchant-token",
          SPLIT402_PHASE7_MERCHANT_ID: "merchant-id",
          SPLIT402_MCP_CAPABILITY: "solana.wallet-risk",
          SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN: "ignored-for-phase7",
          UNKNOWN: "ignored",
        },
      }),
    ).toEqual({
      text: [
        "SPLIT402_PHASE7_CONTROL_PLANE_TOKEN=merchant-token",
        "SPLIT402_PHASE7_MERCHANT_ID=merchant-id",
        "SPLIT402_MCP_CAPABILITY=solana.wallet-risk",
        "UNRELATED=value",
        "",
      ].join("\n"),
      updatedKeys: [
        "SPLIT402_PHASE7_CONTROL_PLANE_TOKEN",
        "SPLIT402_PHASE7_MERCHANT_ID",
        "SPLIT402_MCP_CAPABILITY",
      ],
      skippedKeys: [
        "SPLIT402_PHASE7_REFERRER_WALLET",
        "SPLIT402_DASHBOARD_MERCHANT_ID",
        "SPLIT402_DASHBOARD_REFERRER_WALLET",
        "SPLIT402_MERCHANT_ORIGIN",
        "SPLIT402_MERCHANT_PUBLIC_KEY",
        "SPLIT402_MCP_CONTROL_PLANE_TOKEN",
        "SPLIT402_MCP_WALLET",
        "SPLIT402_MCP_MAX_AMOUNT_ATOMIC",
      ],
    });
  });

  it("updates Docker env keys without copying hosted-only proof values", () => {
    const text = [
      "SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN=",
      "SPLIT402_MERCHANT_PAY_TO=",
      "",
    ].join("\n");

    expect(
      applyPhase7SeedProofEnvToText({
        text,
        allowedKeys: PHASE7_SEED_ENV_APPLY_DOCKER_KEYS,
        proofEnv: {
          SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN: "merchant-token",
          SPLIT402_MERCHANT_PAY_TO: "merchant-wallet",
          SPLIT402_PHASE7_CONTROL_PLANE_TOKEN: "hosted-token",
        },
      }),
    ).toEqual({
      text: [
        "SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN=merchant-token",
        "SPLIT402_MERCHANT_PAY_TO=merchant-wallet",
        "",
      ].join("\n"),
      updatedKeys: [
        "SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN",
        "SPLIT402_MERCHANT_PAY_TO",
      ],
      skippedKeys: [
        "SPLIT402_DASHBOARD_MERCHANT_ID",
        "SPLIT402_DASHBOARD_REFERRER_WALLET",
      ],
    });
  });

  it("appends missing supported keys and quotes unsafe env values", () => {
    expect(
      applyPhase7SeedProofEnvToText({
        text: "EXISTING=value\n",
        allowedKeys: ["SPLIT402_MERCHANT_ORIGIN"],
        proofEnv: {
          SPLIT402_MERCHANT_ORIGIN: "https://merchant.example/path#demo",
        },
      }).text,
    ).toBe(
      [
        "EXISTING=value",
        "# Values copied from phase7:staging:seed proofEnv.",
        'SPLIT402_MERCHANT_ORIGIN="https://merchant.example/path#demo"',
        "",
      ].join("\n"),
    );
  });

  it("summarizes ignored proofEnv keys separately from target updates", () => {
    expect(
      createPhase7SeedEnvApplyResult({
        seedOutput: "seed.json",
        dryRun: true,
        proofEnv: {
          SPLIT402_PHASE7_MERCHANT_ID: "merchant-id",
          SPLIT402_MERCHANT_PAY_TO: "merchant-wallet",
          SPLIT402_MERCHANT_PUBLIC_KEY: "public-key",
          SOME_OTHER_KEY: "ignored",
        },
        phase7Target: {
          target: "phase7.env",
          written: false,
          updatedKeys: ["SPLIT402_PHASE7_MERCHANT_ID"],
          skippedKeys: [],
        },
        dockerTarget: {
          target: "docker.env",
          written: false,
          updatedKeys: ["SPLIT402_MERCHANT_PAY_TO"],
          skippedKeys: [],
        },
      }),
    ).toMatchObject({
      schema: "split402.phase7_seed_env_apply.v1",
      dryRun: true,
      ignoredProofEnvKeys: ["SOME_OTHER_KEY"],
      targets: [
        {
          target: "phase7.env",
          written: false,
          updatedKeys: ["SPLIT402_PHASE7_MERCHANT_ID"],
        },
        {
          target: "docker.env",
          written: false,
          updatedKeys: ["SPLIT402_MERCHANT_PAY_TO"],
        },
      ],
    });
  });
});
