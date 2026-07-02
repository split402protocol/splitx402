import { describe, expect, it } from "vitest";

import {
  PHASE7_COMMAND_EVIDENCE_ALTERNATIVES,
  PHASE7_REQUIRED_COMMAND_EVIDENCE,
  createPhase7CommandEvidenceTemplate,
  validatePhase7CommandEvidence,
} from "../src/phase7CommandEvidence.js";

describe("Phase 7 command evidence", () => {
  it("lists every required command as a commented transcript checklist", () => {
    const template = createPhase7CommandEvidenceTemplate();

    expect(template).toContain("# Split402 Phase 7 command evidence transcript");
    expect(template).toContain("Do not paste secrets");
    expect(template).toContain("git status --short --branch");
    expect(template).toContain("no changed-file rows");
    for (const command of PHASE7_REQUIRED_COMMAND_EVIDENCE) {
      expect(template).toContain(`# $ ${command}`);
      expect(template).not.toContain(`\n$ ${command}`);
    }
    for (const alternative of PHASE7_COMMAND_EVIDENCE_ALTERNATIVES) {
      expect(template).toContain(`# $ ${alternative.required}`);
      for (const command of alternative.alternatives) {
        expect(template).toContain(`# $ ${command}`);
      }
    }
  });

  it("accepts a complete command transcript", () => {
    const validation = validatePhase7CommandEvidence(createCompleteCommandsLog());

    expect(validation).toEqual({ ok: true, errors: [] });
  });

  it("accepts the combined launch workspace init alternative", () => {
    const validation = validatePhase7CommandEvidence(
      createCompleteCommandsLog().replace(
        "$ corepack pnpm phase7:staging:init",
        "$ corepack pnpm product:evidence:init",
      ),
    );

    expect(validation).toEqual({ ok: true, errors: [] });
  });

  it("rejects prose-only command evidence", () => {
    const validation = validatePhase7CommandEvidence(
      "The operator says they ran corepack pnpm lint and git status --short --branch.",
    );

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain(
      "commands_run artifact must include shell command lines, not only prose",
    );
    expect(validation.errors).toContain(
      "commands_run missing required command: corepack pnpm lint",
    );
  });

  it("rejects dirty git status output", () => {
    const validation = validatePhase7CommandEvidence(
      createCompleteCommandsLog().replace(
        "## main...origin/main\n",
        "## main...origin/main\n M README.md\n",
      ),
    );

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain(
      "commands_run git status output must show a clean source worktree",
    );
  });

  it("rejects non-ready launch preflight output", () => {
    const validation = validatePhase7CommandEvidence(
      createCompleteCommandsLog().replace(
        "Split402 launch preflight: ready",
        "Split402 launch preflight: not ready",
      ),
    );

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain(
      "commands_run launch preflight output must be ready",
    );
  });
});

function createCompleteCommandsLog(): string {
  return `${PHASE7_REQUIRED_COMMAND_EVIDENCE.map((command) => {
    const output = readCommandOutput(command);
    return `$ ${command}${output}`;
  }).join("\n")}\n`;
}

function readCommandOutput(command: string): string {
  if (command === "git status --short --branch") {
    return "\n## main...origin/main";
  }
  if (
    command ===
    "corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence"
  ) {
    return "\nSplit402 launch preflight: ready";
  }
  if (command === "corepack pnpm product:public-surface-check --brief") {
    return "\nSplit402 public surface check: passed";
  }
  return "";
}
