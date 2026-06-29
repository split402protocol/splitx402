import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadEvidenceEnvFiles } from "../src/evidenceEnvFile.js";

describe("loadEvidenceEnvFiles", () => {
  it("loads explicit env files and strips evidence-env-file args", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-env-"));
    const envFile = join(directory, "phase7-staging.env");
    writeFileSync(
      envFile,
      [
        "SPLIT402_PHASE7_CONTROL_PLANE_URL=https://control.example",
        "SPLIT402_PHASE7_EVIDENCE_DIR=evidence/phase7",
      ].join("\n"),
    );
    const env: NodeJS.ProcessEnv = {};

    const result = loadEvidenceEnvFiles({
      argv: ["--evidence-env-file", envFile, "paid-suite.log", "receipt.json"],
      env,
    });

    expect(result.args).toEqual(["paid-suite.log", "receipt.json"]);
    expect(result.loadedFiles).toEqual([envFile]);
    expect(env.SPLIT402_PHASE7_CONTROL_PLANE_URL).toBe(
      "https://control.example",
    );
    expect(env.SPLIT402_PHASE7_EVIDENCE_DIR).toBe("evidence/phase7");
  });

  it("does not override variables already set by the operator", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-env-"));
    const envFile = join(directory, "phase7-staging.env");
    writeFileSync(
      envFile,
      "SPLIT402_PHASE7_CONTROL_PLANE_URL=https://from-file.example\n",
    );
    const env: NodeJS.ProcessEnv = {
      SPLIT402_PHASE7_CONTROL_PLANE_URL: "https://operator.example",
    };

    loadEvidenceEnvFiles({ argv: [`--evidence-env-file=${envFile}`], env });

    expect(env.SPLIT402_PHASE7_CONTROL_PLANE_URL).toBe(
      "https://operator.example",
    );
  });

  it("loads default env files only when they exist", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-env-"));
    const existingEnvFile = join(directory, "phase6-evidence.env");
    const missingEnvFile = join(directory, "missing.env");
    writeFileSync(existingEnvFile, "SPLIT402_PHASE6_EVIDENCE_REVIEW_ID=review-1\n");
    const env: NodeJS.ProcessEnv = {};

    const result = loadEvidenceEnvFiles({
      defaultEnvFiles: [missingEnvFile, existingEnvFile],
      env,
    });

    expect(result.loadedFiles).toEqual([existingEnvFile]);
    expect(env.SPLIT402_PHASE6_EVIDENCE_REVIEW_ID).toBe("review-1");
  });

  it("loads env files named by SPLIT402_ENV_FILE", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-env-"));
    const firstEnvFile = join(directory, "first.env");
    const secondEnvFile = join(directory, "second.env");
    writeFileSync(firstEnvFile, "FIRST_VALUE=first\n");
    writeFileSync(secondEnvFile, "SECOND_VALUE=second\n");
    const env: NodeJS.ProcessEnv = {
      SPLIT402_ENV_FILE: [firstEnvFile, secondEnvFile].join(delimiter),
    };

    const result = loadEvidenceEnvFiles({ env });

    expect(result.loadedFiles).toEqual([firstEnvFile, secondEnvFile]);
    expect(env.FIRST_VALUE).toBe("first");
    expect(env.SECOND_VALUE).toBe("second");
  });

  it("keeps backwards parser support for env-file args if they reach the script", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-env-"));
    const envFile = join(directory, "phase7-staging.env");
    writeFileSync(envFile, "ALIAS_VALUE=loaded\n");
    const env: NodeJS.ProcessEnv = {};

    loadEvidenceEnvFiles({ argv: [`--env-file=${envFile}`], env });

    expect(env.ALIAS_VALUE).toBe("loaded");
  });

  it("rejects an evidence-env-file flag without a path", () => {
    expect(() => loadEvidenceEnvFiles({ argv: ["--evidence-env-file"] })).toThrow(
      "--evidence-env-file requires a path",
    );
  });
});
