import { describe, expect, it } from "vitest";

import {
  DEFAULT_PHASE7_DOCKER_ENV_SOURCE,
  DEFAULT_PHASE7_DOCKER_ENV_TARGET,
  createPhase7DockerEnvInitPlan,
  parsePhase7DockerEnvInitArgs,
  populatePhase7DockerGeneratedSecrets,
} from "../src/phase7DockerEnvInit.js";

describe("Phase 7 Docker env init", () => {
  it("parses default, force, custom path, and help args", () => {
    expect(parsePhase7DockerEnvInitArgs([])).toEqual({
      force: false,
      generateSecrets: false,
      help: false,
      source: DEFAULT_PHASE7_DOCKER_ENV_SOURCE,
      target: DEFAULT_PHASE7_DOCKER_ENV_TARGET,
    });
    expect(parsePhase7DockerEnvInitArgs(["--force"])).toMatchObject({
      force: true,
    });
    expect(
      parsePhase7DockerEnvInitArgs(["--generate-secrets"]),
    ).toMatchObject({
      generateSecrets: true,
    });
    expect(
      parsePhase7DockerEnvInitArgs([
        "--source",
        "example.env",
        "--target",
        "runtime.env",
        "--help",
      ]),
    ).toEqual({
      force: false,
      generateSecrets: false,
      help: true,
      source: "example.env",
      target: "runtime.env",
    });
    expect(() =>
      parsePhase7DockerEnvInitArgs(["--target"]),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Usage: corepack pnpm phase7:docker:env:init [--force] [--generate-secrets] [--source <path>] [--target <path>]
      --target requires a value]
    `);
    expect(() =>
      parsePhase7DockerEnvInitArgs(["--unknown"]),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Usage: corepack pnpm phase7:docker:env:init [--force] [--generate-secrets] [--source <path>] [--target <path>]
      Unknown option: --unknown]
    `);
  });

  it("creates a write plan when the example exists and the target is missing", () => {
    const plan = createPhase7DockerEnvInitPlan({
      args: parsePhase7DockerEnvInitArgs([]),
      exists: (path) => path === DEFAULT_PHASE7_DOCKER_ENV_SOURCE,
    });

    expect(plan).toMatchObject({
      source: DEFAULT_PHASE7_DOCKER_ENV_SOURCE,
      target: DEFAULT_PHASE7_DOCKER_ENV_TARGET,
      shouldWrite: true,
      refused: false,
      message: `${DEFAULT_PHASE7_DOCKER_ENV_TARGET} will be created from ${DEFAULT_PHASE7_DOCKER_ENV_SOURCE}.`,
      nextActions: [
        `Fill private Docker runtime values in ${DEFAULT_PHASE7_DOCKER_ENV_TARGET}, or rerun with --generate-secrets to create local runtime secrets automatically.`,
        "Run corepack pnpm phase7:docker:doctor --brief.",
      ],
    });
  });

  it("plans generated-secret scaffolds without claiming runtime readiness", () => {
    const plan = createPhase7DockerEnvInitPlan({
      args: parsePhase7DockerEnvInitArgs(["--generate-secrets"]),
      exists: (path) => path === DEFAULT_PHASE7_DOCKER_ENV_SOURCE,
    });

    expect(plan).toMatchObject({
      shouldWrite: true,
      refused: false,
      nextActions: [
        `Generated private runtime secrets in ${DEFAULT_PHASE7_DOCKER_ENV_TARGET}; fill the remaining URLs, wallets, control-plane tokens, and keys manually.`,
        "Run corepack pnpm phase7:docker:doctor --brief.",
      ],
    });
  });

  it("refuses to overwrite an existing private env file without force", () => {
    const plan = createPhase7DockerEnvInitPlan({
      args: parsePhase7DockerEnvInitArgs([]),
      exists: (path) =>
        path === DEFAULT_PHASE7_DOCKER_ENV_SOURCE ||
        path === DEFAULT_PHASE7_DOCKER_ENV_TARGET,
    });

    expect(plan).toMatchObject({
      shouldWrite: false,
      refused: true,
      message: `${DEFAULT_PHASE7_DOCKER_ENV_TARGET} already exists; refusing to overwrite private runtime values.`,
      nextActions: [
        `Review ${DEFAULT_PHASE7_DOCKER_ENV_TARGET}, or rerun with --force only if intentionally replacing the private Docker runtime env scaffold.`,
      ],
    });
  });

  it("repairs generated secret placeholders in an existing private env without force", () => {
    const plan = createPhase7DockerEnvInitPlan({
      args: parsePhase7DockerEnvInitArgs(["--generate-secrets"]),
      exists: (path) =>
        path === DEFAULT_PHASE7_DOCKER_ENV_SOURCE ||
        path === DEFAULT_PHASE7_DOCKER_ENV_TARGET,
    });

    expect(plan).toMatchObject({
      source: DEFAULT_PHASE7_DOCKER_ENV_SOURCE,
      target: DEFAULT_PHASE7_DOCKER_ENV_TARGET,
      writeSource: "target",
      shouldWrite: true,
      refused: false,
      message: `${DEFAULT_PHASE7_DOCKER_ENV_TARGET} will be updated in place with generated local runtime secrets where placeholders are still present.`,
      nextActions: [
        `Generated private runtime secrets in ${DEFAULT_PHASE7_DOCKER_ENV_TARGET} while preserving existing filled values; fill the remaining URLs, wallets, control-plane tokens, and keys manually.`,
        "Run corepack pnpm phase7:docker:doctor --brief.",
      ],
    });
  });

  it("allows intentional replacement with force", () => {
    const plan = createPhase7DockerEnvInitPlan({
      args: parsePhase7DockerEnvInitArgs(["--force"]),
      exists: (path) =>
        path === DEFAULT_PHASE7_DOCKER_ENV_SOURCE ||
        path === DEFAULT_PHASE7_DOCKER_ENV_TARGET,
    });

    expect(plan).toMatchObject({
      shouldWrite: true,
      refused: false,
      writeSource: "source",
      message: `${DEFAULT_PHASE7_DOCKER_ENV_TARGET} will be replaced from ${DEFAULT_PHASE7_DOCKER_ENV_SOURCE}.`,
    });
  });

  it("refuses when the checked-in example is missing", () => {
    const plan = createPhase7DockerEnvInitPlan({
      args: parsePhase7DockerEnvInitArgs([]),
      exists: () => false,
    });

    expect(plan).toMatchObject({
      shouldWrite: false,
      refused: true,
      message: `${DEFAULT_PHASE7_DOCKER_ENV_SOURCE} is missing.`,
      nextActions: [
        "Restore the Phase 7 Docker env example before creating the private runtime env file.",
      ],
    });
  });

  it("generates only supported placeholder runtime secrets", () => {
    let sequence = 0;
    const text = [
      "SPLIT402_DASHBOARD_VIEWER_TOKEN=replace-with-staging-viewer-token",
      "SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN=",
      "SPLIT402_WEBHOOK_WORKER_SECRET=replace-with-staging-webhook-secret",
      "SPLIT402_SERVICE_SEED_HEX=",
      "SPLIT402_MERCHANT_PAY_TO=",
    ].join("\n");

    expect(
      populatePhase7DockerGeneratedSecrets(text, () => {
        sequence += 1;
        return `generated-secret-${sequence}`;
      }),
    ).toBe(
      [
        "SPLIT402_DASHBOARD_VIEWER_TOKEN=generated-secret-1",
        "SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN=",
        "SPLIT402_WEBHOOK_WORKER_SECRET=generated-secret-2",
        "SPLIT402_SERVICE_SEED_HEX=",
        "SPLIT402_MERCHANT_PAY_TO=",
      ].join("\n"),
    );
  });

  it("preserves manually filled values while repairing generated placeholders", () => {
    let sequence = 0;
    const text = [
      "SPLIT402_DASHBOARD_VIEWER_TOKEN=replace-with-staging-viewer-token",
      "SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN=already-filled-token",
      "SPLIT402_WEBHOOK_WORKER_SECRET=replace-with-staging-webhook-secret",
      "SPLIT402_SERVICE_SEED_HEX=already-filled-service-seed",
      "SPLIT402_MERCHANT_PAY_TO=already-filled-wallet",
    ].join("\n");

    expect(
      populatePhase7DockerGeneratedSecrets(text, () => {
        sequence += 1;
        return `generated-secret-${sequence}`;
      }),
    ).toBe(
      [
        "SPLIT402_DASHBOARD_VIEWER_TOKEN=generated-secret-1",
        "SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN=already-filled-token",
        "SPLIT402_WEBHOOK_WORKER_SECRET=generated-secret-2",
        "SPLIT402_SERVICE_SEED_HEX=already-filled-service-seed",
        "SPLIT402_MERCHANT_PAY_TO=already-filled-wallet",
      ].join("\n"),
    );
  });

  it("does not replace already-filled generated secret values", () => {
    expect(
      populatePhase7DockerGeneratedSecrets(
        [
          "SPLIT402_DASHBOARD_VIEWER_TOKEN=existing-viewer-token",
          "SPLIT402_WEBHOOK_WORKER_SECRET=existing-webhook-secret",
        ].join("\n"),
        () => "new-secret",
      ),
    ).toBe(
      [
        "SPLIT402_DASHBOARD_VIEWER_TOKEN=existing-viewer-token",
        "SPLIT402_WEBHOOK_WORKER_SECRET=existing-webhook-secret",
      ].join("\n"),
    );
  });
});
