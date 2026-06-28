export const PHASE7_REQUIRED_COMMAND_EVIDENCE = [
  "git rev-parse HEAD",
  "git status --short --branch",
  "corepack pnpm phase7:staging:init",
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
  "corepack pnpm typecheck",
  "corepack pnpm test",
  "corepack pnpm build",
  "corepack pnpm vectors:check",
  "corepack pnpm audit --audit-level high",
] as const;

export function createPhase7CommandEvidenceTemplate(): string {
  return [
    "# Split402 Phase 7 command evidence transcript",
    "#",
    "# Paste the real terminal transcript for this hosted staging run under each",
    "# command. Keep executed command lines uncommented, for example",
    "# `$ corepack pnpm lint`, so the status checker can verify them.",
    "# Do not paste secrets, private keys, private URLs, or private transaction bytes.",
    "#",
    "# Required commands:",
    "",
    ...PHASE7_REQUIRED_COMMAND_EVIDENCE.flatMap((command) => [
      `# $ ${command}`,
      "# paste real output here",
      "",
    ]),
  ].join("\n");
}
