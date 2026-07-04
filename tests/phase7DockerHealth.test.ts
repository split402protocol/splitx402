import { describe, expect, it } from "vitest";

import {
  createDockerComposePsArgs,
  formatPhase7DockerHealthBrief,
  runPhase7DockerHealth,
} from "../src/phase7DockerHealth.js";

describe("Phase 7 Docker health checker", () => {
  it("reports the full demo and workers profile stack ready", () => {
    const commands: string[] = [];
    const report = runPhase7DockerHealth({
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
          "compose --env-file deploy/phase7-staging/phase7-staging.env -f deploy/phase7-staging/compose.yaml --profile demo --profile workers ps --format json"
        ) {
          return JSON.stringify(fullStackPs());
        }
        throw new Error(`unexpected command ${file} ${args.join(" ")}`);
      },
    });

    expect(report.ready).toBe(true);
    expect(report.services).toHaveLength(7);
    expect(report.services.every((service) => service.ok)).toBe(true);
    expect(report.command).toBe(
      "docker compose --env-file deploy/phase7-staging/phase7-staging.env -f deploy/phase7-staging/compose.yaml --profile demo --profile workers ps --format json",
    );
    expect(commands).toContain(report.command);
    expect(formatPhase7DockerHealthBrief(report)).toContain(
      "Split402 Phase 7 Docker health: ready",
    );
    expect(formatPhase7DockerHealthBrief(report)).toContain(
      "Profiles: demo, workers",
    );
  });

  it("fails when a healthchecked service is not healthy", () => {
    const report = runPhase7DockerHealth({
      skipDoctor: true,
      execFile: (_file, args) => {
        if (args.includes("ps")) {
          return JSON.stringify([
            ...baseStackPs({ dashboardHealth: "starting" }),
          ]);
        }
        throw new Error(`unexpected command ${args.join(" ")}`);
      },
      exists: () => true,
    });

    expect(report.ready).toBe(false);
    expect(report.errors).toContain(
      "dashboard is not ready (state=running, health=starting).",
    );
  });

  it("fails when a selected profile service is missing", () => {
    const report = runPhase7DockerHealth({
      profiles: ["workers"],
      skipDoctor: true,
      execFile: (_file, args) => {
        if (args.includes("ps")) {
          return JSON.stringify(baseStackPs());
        }
        throw new Error(`unexpected command ${args.join(" ")}`);
      },
      exists: () => true,
    });

    expect(report.ready).toBe(false);
    expect(report.errors).toContain(
      "chain-worker is missing from docker compose ps output.",
    );
    expect(report.errors).toContain(
      "webhook-worker is missing from docker compose ps output.",
    );
    expect(report.errors).toContain(
      "payout-finality-worker is missing from docker compose ps output.",
    );
  });

  it("accepts newline-delimited Docker compose JSON output", () => {
    const report = runPhase7DockerHealth({
      skipDoctor: true,
      execFile: (_file, args) => {
        if (args.includes("ps")) {
          return baseStackPs().map((service) => JSON.stringify(service)).join("\n");
        }
        throw new Error(`unexpected command ${args.join(" ")}`);
      },
      exists: () => true,
    });

    expect(report.ready).toBe(true);
    expect(report.services.map((service) => service.service)).toEqual([
      "postgres",
      "control-plane",
      "dashboard",
    ]);
  });

  it("builds compose ps args with selected profiles", () => {
    expect(
      createDockerComposePsArgs("compose.yaml", "runtime.env", ["demo", "workers"]),
    ).toEqual([
      "compose",
      "--env-file",
      "runtime.env",
      "-f",
      "compose.yaml",
      "--profile",
      "demo",
      "--profile",
      "workers",
      "ps",
      "--format",
      "json",
    ]);
  });
});

function filledDockerEnvWithProfiles(): string {
  return [
    "SPLIT402_DASHBOARD_VIEWER_TOKEN=viewer-token",
    "SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN=control-plane-token",
    "SPLIT402_WEBHOOK_WORKER_SECRET=webhook-secret",
    "SPLIT402_MERCHANT_PAY_TO=merchant-pay-to",
    "SPLIT402_SERVICE_SEED_HEX=abcdef1234567890",
    "SPLIT402_WEBHOOK_WORKER_URL=https://webhook.example",
  ].join("\n");
}

function baseStackPs(
  input: { dashboardHealth?: string } = {},
): Array<Record<string, string>> {
  return [
    service("postgres", "running", "healthy"),
    service("control-plane", "running", "healthy"),
    service("dashboard", "running", input.dashboardHealth ?? "healthy"),
  ];
}

function fullStackPs(): Array<Record<string, string>> {
  return [
    ...baseStackPs(),
    service("demo-merchant", "running", "healthy"),
    service("chain-worker", "running", ""),
    service("webhook-worker", "running", ""),
    service("payout-finality-worker", "running", ""),
  ];
}

function service(
  serviceName: string,
  state: string,
  health: string,
): Record<string, string> {
  return {
    Name: `split402-phase7-staging-${serviceName}-1`,
    Service: serviceName,
    State: state,
    Health: health,
  };
}
