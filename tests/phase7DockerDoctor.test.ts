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
          "compose -f deploy/phase7-staging/compose.yaml config --quiet"
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
      "docker compose -f deploy/phase7-staging/compose.yaml config --quiet",
    ]);
    expect(formatPhase7DockerDoctorBrief(report)).toContain(
      "Split402 Phase 7 Docker doctor: ready",
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
      "Copy deploy/phase7-staging/phase7-staging.env.example to deploy/phase7-staging/phase7-staging.env and fill the private staging values on the host.",
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
          "Compose configuration could not be validated: Skipped until Docker, Compose, compose.yaml, and phase7-staging.env are available.",
      }),
    );
  });
});
