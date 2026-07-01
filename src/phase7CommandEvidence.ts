export const PHASE7_REQUIRED_COMMAND_EVIDENCE = [
  "git rev-parse HEAD",
  "git status --short --branch",
  "corepack pnpm phase7:staging:init",
  "corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence",
  "corepack pnpm phase7:staging:seed",
  "corepack pnpm phase7:staging-proof",
  "corepack pnpm phase7:hosted:preflight",
  "corepack pnpm phase7:staging:collect-reads",
  "corepack pnpm phase7:staging:collect-mcp-gateway",
  "corepack pnpm demo:mcp-gateway:smoke",
  "corepack pnpm demo:mcp-bundle",
  "corepack pnpm demo:paid-suite",
  "corepack pnpm phase7:staging:derive-receipt-verification",
  "corepack pnpm phase7:staging:manifest",
  "corepack pnpm phase7:staging:assemble",
  "corepack pnpm phase7:staging:status",
  "corepack pnpm lint",
  "corepack pnpm product:public-surface-check --brief",
  "corepack pnpm typecheck",
  "corepack pnpm test",
  "corepack pnpm build",
  "corepack pnpm vectors:check",
  "corepack pnpm audit --audit-level high",
] as const;

export const PHASE7_COMMAND_EVIDENCE_ALTERNATIVES = [
  {
    required: "corepack pnpm phase7:staging:init",
    alternatives: ["corepack pnpm product:evidence:init"],
  },
] as const;

export interface Phase7CommandEvidenceValidation {
  ok: boolean;
  errors: string[];
}

export function createPhase7CommandEvidenceTemplate(): string {
  const alternativesByRequired: ReadonlyMap<string, readonly string[]> = new Map(
    PHASE7_COMMAND_EVIDENCE_ALTERNATIVES.map((entry) => [
      entry.required,
      entry.alternatives,
    ]),
  );
  return [
    "# Split402 Phase 7 command evidence transcript",
    "#",
    "# Paste the real terminal transcript for this hosted staging run under each",
    "# command. Keep executed command lines uncommented, for example",
    "# `$ corepack pnpm lint`, so the status checker can verify them.",
    "# PowerShell command lines are accepted too, for example",
    "# `PS C:\\split402> $env:SPLIT402_PHASE7_SEED_CONFIRM='seed-hosted-staging'; corepack pnpm phase7:staging:seed`.",
    "# Do not paste secrets, private keys, private URLs, or private transaction bytes.",
    "# For `git status --short --branch`, paste the real output. It must show",
    "# only the branch/status header, for example `## main...origin/main`, with",
    "# no changed-file rows.",
    "#",
    "# Required commands:",
    "",
    ...PHASE7_REQUIRED_COMMAND_EVIDENCE.flatMap((command) => {
      const alternatives = alternativesByRequired.get(command) ?? [];
      return [
        `# $ ${command}`,
        ...alternatives.flatMap((alternative) => [
          "# or, for the combined launch evidence workspace:",
          `# $ ${alternative}`,
        ]),
        "# paste real output here",
        "",
      ];
    }),
  ].join("\n");
}

export function validatePhase7CommandEvidence(
  text: string,
): Phase7CommandEvidenceValidation {
  const errors: string[] = [];
  if (text.trim().length === 0) {
    errors.push("commands_run artifact is empty");
    return { ok: false, errors };
  }
  const commandLines = extractCommandEvidenceLines(text);
  if (commandLines.length === 0) {
    errors.push(
      "commands_run artifact must include shell command lines, not only prose",
    );
  }
  for (const command of PHASE7_REQUIRED_COMMAND_EVIDENCE) {
    if (!isRequiredCommandPresent(commandLines, command)) {
      errors.push(`commands_run missing required command: ${command}`);
    }
  }
  validateGitStatusCommandOutput(text, errors);
  validateLaunchPreflightCommandOutput(text, errors);
  validatePublicSurfaceCommandOutput(text, errors);
  return { ok: errors.length === 0, errors };
}

interface CommandEvidenceBlock {
  command: string;
  outputLines: string[];
}

function validateGitStatusCommandOutput(text: string, errors: string[]): void {
  const gitStatusBlock = extractCommandEvidenceBlocks(text).find((block) =>
    block.command.includes("git status --short --branch"),
  );
  if (gitStatusBlock === undefined) {
    return;
  }

  const outputLines = gitStatusBlock.outputLines
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (outputLines.length === 0) {
    errors.push("commands_run git status output is missing");
    return;
  }
  const changedFileLines = outputLines.filter((line) => !line.startsWith("## "));
  if (changedFileLines.length > 0) {
    errors.push("commands_run git status output must show a clean source worktree");
  }
}

function validateLaunchPreflightCommandOutput(
  text: string,
  errors: string[],
): void {
  const launchPreflightBlock = extractCommandEvidenceBlocks(text).find((block) =>
    block.command.includes("corepack pnpm product:launch-preflight"),
  );
  if (launchPreflightBlock === undefined) {
    return;
  }

  const outputLines = launchPreflightBlock.outputLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (outputLines.length === 0) {
    errors.push("commands_run launch preflight output is missing");
    return;
  }
  if (!outputLines.some((line) => line === "Split402 launch preflight: ready")) {
    errors.push("commands_run launch preflight output must be ready");
  }
}

function validatePublicSurfaceCommandOutput(
  text: string,
  errors: string[],
): void {
  const publicSurfaceBlock = extractCommandEvidenceBlocks(text).find((block) =>
    block.command.includes("corepack pnpm product:public-surface-check"),
  );
  if (publicSurfaceBlock === undefined) {
    return;
  }

  const outputLines = publicSurfaceBlock.outputLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (outputLines.length === 0) {
    errors.push("commands_run public surface check output is missing");
    return;
  }
  if (
    !outputLines.some((line) => line === "Split402 public surface check: passed")
  ) {
    errors.push("commands_run public surface check output must pass");
  }
}

function extractCommandEvidenceBlocks(text: string): CommandEvidenceBlock[] {
  const blocks: CommandEvidenceBlock[] = [];
  let currentBlock: CommandEvidenceBlock | undefined;
  for (const rawLine of text.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    const command = normalizeCommandText(stripCommandPrompt(trimmed));
    if (command.length > 0 && isCommandEvidenceLine(command)) {
      currentBlock = { command, outputLines: [] };
      blocks.push(currentBlock);
      continue;
    }
    if (currentBlock !== undefined && trimmed.length > 0) {
      currentBlock.outputLines.push(rawLine);
    }
  }
  return blocks;
}

function isRequiredCommandPresent(
  commandLines: readonly string[],
  requiredCommand: string,
): boolean {
  const acceptedCommands = [
    requiredCommand,
    ...PHASE7_COMMAND_EVIDENCE_ALTERNATIVES.flatMap((entry) =>
      entry.required === requiredCommand ? entry.alternatives : [],
    ),
  ].map((command) => normalizeCommandText(command));
  return acceptedCommands.some((command) =>
    commandLines.some((line) => line.includes(command)),
  );
}

function extractCommandEvidenceLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => normalizeCommandText(stripCommandPrompt(line.trim())))
    .filter((line) => line.length > 0 && isCommandEvidenceLine(line));
}

function stripCommandPrompt(line: string): string {
  if (line.startsWith("$ ")) {
    return line.slice(2);
  }
  const powershellPrompt = line.match(/^PS\s+[^>]+>\s*(?<command>.+)$/u);
  return powershellPrompt?.groups?.command ?? line;
}

function isCommandEvidenceLine(line: string): boolean {
  return (
    line.startsWith("corepack ") ||
    line.startsWith("git ") ||
    line.startsWith("pnpm ") ||
    line.startsWith("npm ") ||
    line.startsWith("node ") ||
    line.startsWith("SPLIT402_") ||
    line.startsWith("$env:SPLIT402_")
  );
}

function normalizeCommandText(command: string): string {
  return command.replace(/\s+/gu, " ").trim();
}
