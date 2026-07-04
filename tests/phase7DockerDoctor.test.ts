import { describe, expect, it } from "vitest";

import {
  formatPhase7DockerDoctorBrief,
  runPhase7DockerDoctor,
} from "../src/phase7DockerDoctor.js";

describe("Phase 7 Docker doctor", () => {
  it("reports ready when Docker, Compose, the env file, and compose config pass", () => {
    const commands: string[] = [];
    const report = runPhase7DockerDoctor({
      exists: (path) =>
        path === "deploy/phase7-staging/compose.yaml" ||
        path === "deploy/phase7-staging/phase7-staging.env",
      readText: () => filledDockerEnv(),
      execFile: (file, args) => {
        commands.push([file, ...args].join(" "));
        if (args.join(" ") === "--version") {
          return "Docker version 27.0.0";
        }
        if (args.join(" ") === "compose version") {
          return "Docker Compose version v2.29.1";
        }
        if (
          args.join(" ") ===
          "compose --env-file deploy/phase7-staging/phase7-staging.env -f deploy/phase7-staging/compose.yaml config --quiet"
        ) {
          return "";
        }
        throw new Error(`unexpected command ${file} ${args.join(" ")}`);
      },
    });

    expect(report.ready).toBe(true);
    expect(report.checks.every((check) => check.ok)).toBe(true);
    expect(commands).toEqual([
      "docker --version",
      "docker compose version",
      "docker compose --env-file deploy/phase7-staging/phase7-staging.env -f deploy/phase7-staging/compose.yaml config --quiet",
    ]);
    expect(formatPhase7DockerDoctorBrief(report)).toContain(
      "Split402 Phase 7 Docker doctor: ready",
    );
  });

  it("passes custom env file paths into compose config validation", () => {
    const commands: string[] = [];
    const report = runPhase7DockerDoctor({
      composeFile: "deploy/phase7-staging/compose.yaml",
      envFile: "split402-launch-evidence/phase7-staging.env",
      exists: (path) =>
        path === "deploy/phase7-staging/compose.yaml" ||
        path === "split402-launch-evidence/phase7-staging.env",
      readText: () => filledDockerEnv(),
      execFile: (file, args) => {
        commands.push([file, ...args].join(" "));
        if (args.join(" ") === "--version") {
          return "Docker version 27.0.0";
        }
        if (args.join(" ") === "compose version") {
          return "Docker Compose version v2.29.1";
        }
        if (
          args.join(" ") ===
          "compose --env-file split402-launch-evidence/phase7-staging.env -f deploy/phase7-staging/compose.yaml config --quiet"
        ) {
          return "";
        }
        throw new Error(`unexpected command ${file} ${args.join(" ")}`);
      },
    });

    expect(report.ready).toBe(true);
    expect(report.envFile).toBe("split402-launch-evidence/phase7-staging.env");
    expect(commands).toContain(
      "docker compose --env-file split402-launch-evidence/phase7-staging.env -f deploy/phase7-staging/compose.yaml config --quiet",
    );
  });

  it("passes selected profiles into compose config validation", () => {
    const commands: string[] = [];
    const report = runPhase7DockerDoctor({
      profiles: ["demo", "workers"],
      exists: (path) =>
        path === "deploy/phase7-staging/compose.yaml" ||
        path === "deploy/phase7-staging/phase7-staging.env",
      readText: () => filledDockerEnvWithProfiles(),
      execFile: (file, args) => {
        commands.push([file, ...args].join(" "));
        if (args.join(" ") === "--version") {
          return "Docker version 27.0.0";
        }
        if (args.join(" ") === "compose version") {
          return "Docker Compose version v2.29.1";
        }
        if (
          args.join(" ") ===
          "compose --env-file deploy/phase7-staging/phase7-staging.env -f deploy/phase7-staging/compose.yaml --profile demo --profile workers config --quiet"
        ) {
          return "";
        }
        throw new Error(`unexpected command ${file} ${args.join(" ")}`);
      },
    });

    expect(report.ready).toBe(true);
    expect(report.profiles).toEqual(["demo", "workers"]);
    expect(commands).toContain(
      "docker compose --env-file deploy/phase7-staging/phase7-staging.env -f deploy/phase7-staging/compose.yaml --profile demo --profile workers config --quiet",
    );
    expect(formatPhase7DockerDoctorBrief(report)).toContain(
      "Profiles: demo, workers",
    );
    expect(report.nextActions).toContain(
      "Run `docker compose -f deploy/phase7-staging/compose.yaml --profile demo --profile workers up -d postgres control-plane dashboard demo-merchant chain-worker webhook-worker payout-finality-worker`, then wait for healthy services.",
    );
  });

  it("fails closed when selected profile values are missing", () => {
    const commands: string[] = [];
    const report = runPhase7DockerDoctor({
      profiles: ["demo", "workers"],
      exists: (path) =>
        path === "deploy/phase7-staging/compose.yaml" ||
        path === "deploy/phase7-staging/phase7-staging.env",
      readText: () => filledDockerEnv(),
      execFile: (file, args) => {
        commands.push([file, ...args].join(" "));
        if (args.join(" ") === "--version") {
          return "Docker version 27.0.0";
        }
        if (args.join(" ") === "compose version") {
          return "Docker Compose version v2.29.1";
        }
        if (
          args.join(" ") ===
          "compose --env-file deploy/phase7-staging/phase7-staging.env -f deploy/phase7-staging/compose.yaml --profile demo --profile workers config --quiet"
        ) {
          return "";
        }
        throw new Error(`unexpected command ${file} ${args.join(" ")}`);
      },
    });

    expect(report.ready).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "compose_env_values",
        ok: false,
        detail:
          "deploy/phase7-staging/phase7-staging.env is not ready (missing required values: SPLIT402_MERCHANT_PAY_TO, SPLIT402_SERVICE_SEED_HEX, SPLIT402_WEBHOOK_WORKER_URL).",
      }),
    );
    expect(commands).toEqual(["docker --version", "docker compose version"]);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "compose_config",
        ok: false,
        detail:
          "Compose configuration could not be validated: Skipped until Docker, Compose, compose.yaml, phase7-staging.env, and required env values are ready.",
      }),
    );
  });

  it("fails closed and gives setup actions when Docker is missing", () => {
    const report = runPhase7DockerDoctor({
      exists: (path) => path === "deploy/phase7-staging/compose.yaml",
      execFile: () => {
        throw new Error("docker: command not found");
      },
    });

    expect(report.ready).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "docker_cli",
        ok: false,
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "compose_env_file",
        ok: false,
      }),
    );
    expect(report.nextActions).toContain(
      "Install Docker Engine or Docker Desktop on the host that will run Phase 7 staging.",
    );
    expect(report.nextActions).toContain(
      "Run corepack pnpm phase7:docker:env:init --generate-secrets, then fill remaining deploy/phase7-staging/phase7-staging.env values on the host.",
    );
  });

  it("fails closed when the private env file still has template placeholders", () => {
    const commands: string[] = [];
    const report = runPhase7DockerDoctor({
      exists: (path) =>
        path === "deploy/phase7-staging/compose.yaml" ||
        path === "deploy/phase7-staging/phase7-staging.env",
      readText: () => [
        "SPLIT402_DASHBOARD_VIEWER_TOKEN=replace-with-staging-viewer-token",
        "SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN=",
        "SPLIT402_WEBHOOK_WORKER_SECRET=replace-with-staging-webhook-secret",
      ].join("\n"),
      execFile: (file, args) => {
        commands.push([file, ...args].join(" "));
        if (args.join(" ") === "--version") {
          return "Docker version 27.0.0";
        }
        if (args.join(" ") === "compose version") {
          return "Docker Compose version v2.29.1";
        }
        if (
          args.join(" ") ===
          "compose --env-file deploy/phase7-staging/phase7-staging.env -f deploy/phase7-staging/compose.yaml config --quiet"
        ) {
          return "";
        }
        throw new Error(`unexpected command ${file} ${args.join(" ")}`);
      },
    });

    expect(report.ready).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "compose_env_values",
        ok: false,
        detail:
          "deploy/phase7-staging/phase7-staging.env is not ready (missing required values: SPLIT402_DASHBOARD_VIEWER_TOKEN, SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN; replace template placeholders: SPLIT402_DASHBOARD_VIEWER_TOKEN, SPLIT402_WEBHOOK_WORKER_SECRET).",
      }),
    );
    expect(report.nextActions).toContain(
      "Regenerate local Docker runtime secrets with `corepack pnpm phase7:docker:env:init --generate-secrets`; this replaces generated placeholders for SPLIT402_DASHBOARD_VIEWER_TOKEN, SPLIT402_WEBHOOK_WORKER_SECRET while preserving existing filled values, but still requires hosted URLs, wallets, control-plane tokens, and keys to be filled privately.",
    );
    expect(report.nextActions).toContain(
      "Fill missing private runtime values and replace template placeholders in deploy/phase7-staging/phase7-staging.env; do not commit this file.",
    );
    expect(commands).toEqual(["docker --version", "docker compose version"]);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "compose_config",
        ok: false,
        detail:
          "Compose configuration could not be validated: Skipped until Docker, Compose, compose.yaml, phase7-staging.env, and required env values are ready.",
      }),
    );
  });

  it("does not validate compose config until the private env file exists", () => {
    const commands: string[] = [];
    const report = runPhase7DockerDoctor({
      exists: (path) => path === "deploy/phase7-staging/compose.yaml",
      execFile: (file, args) => {
        commands.push([file, ...args].join(" "));
        if (args.join(" ") === "--version") {
          return "Docker version 27.0.0";
        }
        if (args.join(" ") === "compose version") {
          return "Docker Compose version v2.29.1";
        }
        throw new Error("compose config should be skipped");
      },
    });

    expect(report.ready).toBe(false);
    expect(commands).toEqual(["docker --version", "docker compose version"]);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "compose_config",
        ok: false,
        detail:
          "Compose configuration could not be validated: Skipped until Docker, Compose, compose.yaml, phase7-staging.env, and required env values are ready.",
      }),
    );
  });

  it("points custom env files at forced generated-secret repair only for generated placeholders", () => {
    const report = runPhase7DockerDoctor({
      envFile: "split402-launch-evidence/docker.env",
      exists: (path) =>
        path === "deploy/phase7-staging/compose.yaml" ||
        path === "split402-launch-evidence/docker.env",
      readText: () =>
        [
          "SPLIT402_DASHBOARD_VIEWER_TOKEN=replace-with-staging-viewer-token",
          "SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN=control-plane-token",
          "SPLIT402_WEBHOOK_WORKER_SECRET=webhook-secret",
        ].join("\n"),
      execFile: (file, args) => {
        if (args.join(" ") === "--version") {
          return "Docker version 27.0.0";
        }
        if (args.join(" ") === "compose version") {
          return "Docker Compose version v2.29.1";
        }
        throw new Error(`unexpected command ${file} ${args.join(" ")}`);
      },
    });

    expect(report.ready).toBe(false);
    expect(report.nextActions).toContain(
      "Regenerate local Docker runtime secrets with `corepack pnpm phase7:docker:env:init --generate-secrets --target split402-launch-evidence/docker.env`; this replaces generated placeholders for SPLIT402_DASHBOARD_VIEWER_TOKEN while preserving existing filled values, but still requires hosted URLs, wallets, control-plane tokens, and keys to be filled privately.",
    );
  });
});

function filledDockerEnv(): string {
  return [
    "SPLIT402_DASHBOARD_VIEWER_TOKEN=viewer-token",
    "SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN=control-plane-token",
    "SPLIT402_WEBHOOK_WORKER_SECRET=webhook-secret",
  ].join("\n");
}

function filledDockerEnvWithProfiles(): string {
  return [
    filledDockerEnv(),
    "SPLIT402_MERCHANT_PAY_TO=merchant-pay-to",
    "SPLIT402_SERVICE_SEED_HEX=abcdef1234567890",
    "SPLIT402_WEBHOOK_WORKER_URL=https://webhook.example",
  ].join("\n");
}
