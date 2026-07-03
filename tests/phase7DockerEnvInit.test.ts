import { describe, expect, it } from "vitest";

import {
  DEFAULT_PHASE7_DOCKER_ENV_SOURCE,
  DEFAULT_PHASE7_DOCKER_ENV_TARGET,
  createPhase7DockerEnvInitPlan,
  parsePhase7DockerEnvInitArgs,
} from "../src/phase7DockerEnvInit.js";

describe("Phase 7 Docker env init", () => {
  it("parses default, force, custom path, and help args", () => {
    expect(parsePhase7DockerEnvInitArgs([])).toEqual({
      force: false,
      help: false,
      source: DEFAULT_PHASE7_DOCKER_ENV_SOURCE,
      target: DEFAULT_PHASE7_DOCKER_ENV_TARGET,
    });
    expect(parsePhase7DockerEnvInitArgs(["--force"])).toMatchObject({
      force: true,
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
      help: true,
      source: "example.env",
      target: "runtime.env",
    });
    expect(() =>
      parsePhase7DockerEnvInitArgs(["--target"]),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Usage: corepack pnpm phase7:docker:env:init [--force] [--source <path>] [--target <path>]
      --target requires a value]
    `);
    expect(() =>
      parsePhase7DockerEnvInitArgs(["--unknown"]),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Usage: corepack pnpm phase7:docker:env:init [--force] [--source <path>] [--target <path>]
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
        `Fill private Docker runtime values in ${DEFAULT_PHASE7_DOCKER_ENV_TARGET}.`,
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
});
