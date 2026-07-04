import { describe, expect, it } from "vitest";

import {
  createDockerComposeArgs,
  runPhase7DockerCompose,
} from "../src/phase7DockerCompose.js";

describe("Phase 7 Docker compose runner", () => {
  it("runs the base staging services after the Docker doctor passes", () => {
    const commands: string[] = [];
    const report = runPhase7DockerCompose({
      action: "up",
      exists: (path) =>
        path === "deploy/phase7-staging/compose.yaml" ||
        path === "deploy/phase7-staging/phase7-staging.env",
      readText: () => filledDockerEnv(),
      execFile: (file, args) => {
        commands.push([file, ...args].join(" "));
        if (args.join(" ") === "--version") {
          return "Docker version 27.0.0";
        }
        if (args.join(" ") === "info --format {{.ServerVersion}}") {
          return "27.0.0";
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
        if (
          args.join(" ") ===
          "compose --env-file deploy/phase7-staging/phase7-staging.env -f deploy/phase7-staging/compose.yaml up -d postgres control-plane dashboard"
        ) {
          return "started";
        }
        throw new Error(`unexpected command ${file} ${args.join(" ")}`);
      },
    });

    expect(report.ok).toBe(true);
    expect(report.command).toBe(
      "docker compose --env-file deploy/phase7-staging/phase7-staging.env -f deploy/phase7-staging/compose.yaml up -d postgres control-plane dashboard",
    );
    expect(report.output).toBe("started");
    expect(commands).toEqual([
      "docker --version",
      "docker info --format {{.ServerVersion}}",
      "docker compose version",
      "docker compose --env-file deploy/phase7-staging/phase7-staging.env -f deploy/phase7-staging/compose.yaml config --quiet",
      "docker compose --env-file deploy/phase7-staging/phase7-staging.env -f deploy/phase7-staging/compose.yaml up -d postgres control-plane dashboard",
    ]);
  });

  it("includes selected profile services for the full hosted proof stack", () => {
    const report = runPhase7DockerCompose({
      action: "up",
      profiles: ["demo", "workers"],
      exists: (path) =>
        path === "deploy/phase7-staging/compose.yaml" ||
        path === "deploy/phase7-staging/phase7-staging.env",
      readText: () => filledDockerEnvWithProfiles(),
      execFile: (_file, args) => {
        if (args.join(" ") === "--version") {
          return "Docker version 27.0.0";
        }
        if (args.join(" ") === "info --format {{.ServerVersion}}") {
          return "27.0.0";
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
        if (
          args.join(" ") ===
          "compose --env-file deploy/phase7-staging/phase7-staging.env -f deploy/phase7-staging/compose.yaml --profile demo --profile workers up -d postgres control-plane dashboard demo-merchant chain-worker webhook-worker payout-finality-worker"
        ) {
          return "started";
        }
        throw new Error(`unexpected command ${args.join(" ")}`);
      },
    });

    expect(report.ok).toBe(true);
    expect(report.command).toContain("--profile demo --profile workers");
    expect(report.command).toContain(
      "demo-merchant chain-worker webhook-worker payout-finality-worker",
    );
  });

  it("refuses to run compose when the Docker doctor is not ready", () => {
    const commands: string[] = [];
    const report = runPhase7DockerCompose({
      action: "up",
      exists: (path) => path === "deploy/phase7-staging/compose.yaml",
      execFile: (file, args) => {
        commands.push([file, ...args].join(" "));
        if (args.join(" ") === "--version") {
          return "Docker version 27.0.0";
        }
        if (args.join(" ") === "info --format {{.ServerVersion}}") {
          return "27.0.0";
        }
        if (args.join(" ") === "compose version") {
          return "Docker Compose version v2.29.1";
        }
        throw new Error("compose up should not run");
      },
    });

    expect(report.ok).toBe(false);
    expect(report.error).toBe(
      "Phase 7 Docker doctor is not ready; refusing to run compose command.",
    );
    expect(commands).toEqual([
      "docker --version",
      "docker info --format {{.ServerVersion}}",
      "docker compose version",
    ]);
    expect(report.nextActions).toContain(
      "Run corepack pnpm phase7:docker:env:init --generate-secrets, then fill remaining deploy/phase7-staging/phase7-staging.env values on the host.",
    );
  });

  it("supports explicit service selection for focused logs", () => {
    expect(
      createDockerComposeArgs({
        action: "logs",
        composeFile: "deploy/phase7-staging/compose.yaml",
        envFile: "deploy/phase7-staging/phase7-staging.env",
        profiles: ["workers"],
        services: ["chain-worker"],
        follow: true,
        volumes: false,
      }),
    ).toEqual([
      "compose",
      "--env-file",
      "deploy/phase7-staging/phase7-staging.env",
      "-f",
      "deploy/phase7-staging/compose.yaml",
      "--profile",
      "workers",
      "logs",
      "--follow",
      "chain-worker",
    ]);
  });

  it("keeps volume deletion opt-in for compose down", () => {
    expect(
      createDockerComposeArgs({
        action: "down",
        composeFile: "deploy/phase7-staging/compose.yaml",
        envFile: "deploy/phase7-staging/phase7-staging.env",
        profiles: [],
        services: [],
        follow: false,
        volumes: true,
      }),
    ).toEqual([
      "compose",
      "--env-file",
      "deploy/phase7-staging/phase7-staging.env",
      "-f",
      "deploy/phase7-staging/compose.yaml",
      "down",
      "--volumes",
    ]);
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
