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
