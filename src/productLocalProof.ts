import { spawnSync } from "node:child_process";

export interface Split402LocalProofCheck {
  id: string;
  label: string;
  command: readonly string[];
}

export interface Split402LocalProofCheckResult extends Split402LocalProofCheck {
  durationMs: number;
  exitCode: number | null;
  output: string;
  status: "passed" | "failed";
}

export interface Split402LocalProofReport {
  schema: "split402.local_public_alpha_proof.v1";
  status: "passed" | "failed";
  launchApproval: "not_approved";
  generatedAt: string;
  sourceCommit?: string;
  checks: Split402LocalProofCheckResult[];
  notes: string[];
}

export interface Split402LocalProofOptions {
  now?: () => number;
  runCommand?: (
    check: Split402LocalProofCheck,
  ) => Split402LocalProofCheckResult;
  sourceCommit?: string;
}

export const LOCAL_PROOF_USAGE =
  "Usage: corepack pnpm product:local-proof [--brief|--json] [--output file]";

export const LOCAL_PUBLIC_ALPHA_PROOF_CHECKS: readonly Split402LocalProofCheck[] =
  [
    {
      id: "repo_hygiene",
      label: "Repo hygiene and public/private boundary guard",
      command: ["corepack", "pnpm", "repo:guard"],
    },
    {
      id: "public_surface",
      label: "Public/private license surface check",
      command: ["corepack", "pnpm", "product:public-surface-check", "--brief"],
    },
    {
      id: "protocol_vectors",
      label: "Protocol test vectors",
      command: ["corepack", "pnpm", "vectors:check"],
    },
    {
      id: "router_alpha",
      label: "Router alpha package tests",
      command: ["corepack", "pnpm", "--filter", "@split402/router", "test"],
    },
    {
      id: "mcp_gateway_smoke",
      label: "Runnable MCP gateway smoke proof",
      command: ["corepack", "pnpm", "demo:mcp-gateway:smoke"],
    },
  ];

export function createSplit402LocalProofReport(
  options: Split402LocalProofOptions = {},
): Split402LocalProofReport {
  const now = options.now ?? Date.now;
  const generatedAt = new Date(now()).toISOString();
  const runCommand = options.runCommand ?? createDefaultCommandRunner(options);
  const checks = LOCAL_PUBLIC_ALPHA_PROOF_CHECKS.map((check) =>
    runCommand(check),
  );
  const status = checks.every((check) => check.status === "passed")
    ? "passed"
    : "failed";

  return {
    schema: "split402.local_public_alpha_proof.v1",
    status,
    launchApproval: "not_approved",
    generatedAt,
    ...(options.sourceCommit === undefined
      ? {}
      : { sourceCommit: options.sourceCommit }),
    checks,
    notes: [
      "This proves the local public-alpha protocol, router, and MCP gateway path only.",
      "It does not approve hosted Phase 7 staging, production custody, mainnet, or commercial operations.",
      "Run product:status with real Phase 6 and Phase 7 evidence before any launch claim.",
    ],
  };
}

export function serializeSplit402LocalProofReport(
  report: Split402LocalProofReport,
): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatSplit402LocalProofBrief(
  report: Split402LocalProofReport,
): string {
  const lines = [
    `Split402 local public-alpha proof: ${report.status}`,
    "Launch approval: not approved",
    ...(report.sourceCommit === undefined
      ? []
      : [`Source commit: ${report.sourceCommit}`]),
    "",
    "Checks:",
    ...report.checks.map((check) => {
      const marker = check.status === "passed" ? "pass" : "fail";
      return `- ${marker}: ${check.label} (${formatCommand(check.command)})`;
    }),
    "",
    "Notes:",
    ...report.notes.map((note) => `- ${note}`),
  ];

  return `${lines.join("\n")}\n`;
}

export function formatCommand(command: readonly string[]): string {
  return command
    .map((part) => (/\s/u.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function createDefaultCommandRunner(
  options: Split402LocalProofOptions,
): (check: Split402LocalProofCheck) => Split402LocalProofCheckResult {
  const now = options.now ?? Date.now;
  return (check) => {
    const startedAt = now();
    const [command, ...args] = check.command;
    if (command === undefined) {
      throw new Error(`local proof check ${check.id} has no command`);
    }

    const result = spawnSync(command, args, {
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    const output = normalizeOutput(
      `${result.stdout ?? ""}${result.stderr ?? ""}${
        result.error === undefined ? "" : result.error.message
      }`,
    );
    const exitCode = result.status;

    return {
      ...check,
      durationMs: Math.max(0, now() - startedAt),
      exitCode,
      output,
      status: exitCode === 0 ? "passed" : "failed",
    };
  };
}

function normalizeOutput(output: string): string {
  return output.trim().slice(0, 12_000);
}
