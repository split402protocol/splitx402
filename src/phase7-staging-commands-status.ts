import { readFileSync } from "node:fs";

import {
  PHASE7_REQUIRED_COMMAND_EVIDENCE,
  type Phase7CommandEvidenceValidation,
  validatePhase7CommandEvidence,
} from "./phase7CommandEvidence.js";

const { brief, commandsPath, help } = parseCliArgs(process.argv.slice(2));

if (help) {
  console.log(
    "Usage: corepack pnpm phase7:staging:commands-status [--brief] <commands.log>",
  );
  process.exit(0);
}

if (commandsPath === undefined) {
  console.error(
    "Usage: corepack pnpm phase7:staging:commands-status [--brief] <commands.log>",
  );
  process.exit(2);
}

const validation = validatePhase7CommandEvidence(readFileSync(commandsPath, "utf8"));
console.log(
  brief
    ? formatPhase7CommandEvidenceStatusBrief(validation)
    : JSON.stringify(
        {
          schema: "split402.phase7_command_evidence_status.v1",
          status: validation.ok ? "valid" : "invalid",
          requiredCommandCount: PHASE7_REQUIRED_COMMAND_EVIDENCE.length,
          errors: validation.errors,
        },
        null,
        2,
      ),
);

if (!validation.ok) {
  process.exitCode = 1;
}

export function formatPhase7CommandEvidenceStatusBrief(
  validation: Phase7CommandEvidenceValidation,
): string {
  if (validation.ok) {
    return [
      "Phase 7 command evidence: valid",
      `Required commands: ${PHASE7_REQUIRED_COMMAND_EVIDENCE.length}/${PHASE7_REQUIRED_COMMAND_EVIDENCE.length}`,
    ].join("\n");
  }

  return [
    "Phase 7 command evidence: checked, blocked",
    `Required commands: ${PHASE7_REQUIRED_COMMAND_EVIDENCE.length}`,
    `Errors: ${validation.errors.length}`,
    "",
    "Next actions:",
    "- Replace the command template comments with the real command transcript.",
    "- Keep command lines uncommented and include the actual output below each command.",
    "- Rerun corepack pnpm phase7:staging:commands-status --brief <commands.log> before assembling the Phase 7 proof.",
    ...validation.errors.slice(0, 10).map((error) => `- ${error}`),
  ].join("\n");
}

function parseCliArgs(args: readonly string[]): {
  brief: boolean;
  commandsPath?: string;
  help: boolean;
} {
  let brief = false;
  let help = false;
  let commandsPath: string | undefined;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--brief") {
      brief = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (commandsPath === undefined) {
      commandsPath = arg;
    } else {
      throw new Error(
        "Usage: corepack pnpm phase7:staging:commands-status [--brief] <commands.log>",
      );
    }
  }

  return { brief, commandsPath, help };
}
