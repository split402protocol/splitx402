import { join } from "node:path";

import type { Split402ProductEvidenceWorkspace } from "./productEvidenceWorkspace.js";

export interface ProductEvidenceInitArgs {
  directory: string;
  force: boolean;
  help: boolean;
  missing: boolean;
  refreshSource: boolean;
}

export interface ProductEvidenceInitWrite {
  path: string;
  contents: string;
}

export const PRODUCT_EVIDENCE_INIT_USAGE =
  "Usage: corepack pnpm product:evidence:init [--force|--missing|--refresh-source] [directory]";

export function parseProductEvidenceInitArgs(
  args: readonly string[],
): ProductEvidenceInitArgs {
  const help = args.includes("--help") || args.includes("-h");
  const force = args.includes("--force");
  const missing = args.includes("--missing");
  const refreshSource = args.includes("--refresh-source");
  const unknownOptions = args.filter(
    (arg) =>
      arg.startsWith("-") &&
      arg !== "--help" &&
      arg !== "-h" &&
      arg !== "--force" &&
      arg !== "--missing" &&
      arg !== "--refresh-source",
  );
  if (unknownOptions.length > 0) {
    throw new Error(
      `${PRODUCT_EVIDENCE_INIT_USAGE}\nUnknown option: ${unknownOptions[0]}`,
    );
  }

  const directoryArgs = args.filter(
    (arg) =>
      arg !== "--help" &&
      arg !== "-h" &&
      arg !== "--force" &&
      arg !== "--missing" &&
      arg !== "--refresh-source",
  );

  if ([force, missing, refreshSource].filter(Boolean).length > 1) {
    throw new Error(PRODUCT_EVIDENCE_INIT_USAGE);
  }

  if (directoryArgs.length > 1) {
    throw new Error(PRODUCT_EVIDENCE_INIT_USAGE);
  }

  return {
    directory: directoryArgs[0] ?? "split402-launch-evidence",
    force,
    help,
    missing,
    refreshSource,
  };
}

export function createProductEvidenceInitWrites(
  workspace: Split402ProductEvidenceWorkspace,
): ProductEvidenceInitWrite[] {
  return [
    {
      path: join(workspace.directory, workspace.readmeFileName),
      contents: workspace.readmeText,
    },
    {
      path: join(workspace.directory, workspace.phase6EvidenceFileName),
      contents: workspace.phase6EvidenceText,
    },
    {
      path: join(workspace.directory, workspace.phase6EnvFileName),
      contents: workspace.phase6EnvText,
    },
    {
      path: join(workspace.directory, workspace.phase7ProofFileName),
      contents: workspace.phase7ProofText,
    },
    {
      path: join(workspace.directory, workspace.phase7EnvFileName),
      contents: workspace.phase7.envText,
    },
    {
      path: join(workspace.phase7.directory, workspace.phase7.readmeFileName),
      contents: workspace.phase7.readmeText,
    },
  ];
}

export function findExistingProductEvidenceInitWrites(
  writes: readonly ProductEvidenceInitWrite[],
  exists: (path: string) => boolean,
): string[] {
  return writes.filter((write) => exists(write.path)).map((write) => write.path);
}

const PHASE6_REFRESH_ALLOWED_NON_EMPTY_FIELDS = new Set([
  "review_date",
  "source_commit",
  "approval_decision",
  "approval_notes",
]);

const PHASE7_REFRESH_ALLOWED_NON_EMPTY_FIELDS = new Set([
  "proof_date",
  "source_commit",
  "approval_decision",
  "approval_notes",
  "hosted_preflight_evidence",
  "agent_discovery_evidence",
  "paid_request_evidence",
  "receipt_verification_evidence",
  "referrer_balance_evidence",
  "dashboard_summary_evidence",
  "webhook_delivery_evidence",
  "payout_obligation_evidence",
  "funding_balance_evidence",
  "mcp_bundle_evidence",
  "mcp_gateway_evidence",
  "artifact_manifest_evidence",
  "commands_run",
]);

export function createProductEvidenceSourceRefreshWrites(input: {
  workspace: Split402ProductEvidenceWorkspace;
  readText: (path: string) => string;
}): ProductEvidenceInitWrite[] {
  const phase6Path = join(
    input.workspace.directory,
    input.workspace.phase6EvidenceFileName,
  );
  const phase7Path = join(
    input.workspace.directory,
    input.workspace.phase7ProofFileName,
  );
  return [
    {
      path: phase6Path,
      contents: refreshSourceCommitField({
        allowedNonEmptyFields: PHASE6_REFRESH_ALLOWED_NON_EMPTY_FIELDS,
        nextText: input.workspace.phase6EvidenceText,
        path: phase6Path,
        previousText: input.readText(phase6Path),
      }),
    },
    {
      path: phase7Path,
      contents: refreshSourceCommitField({
        allowedNonEmptyFields: PHASE7_REFRESH_ALLOWED_NON_EMPTY_FIELDS,
        nextText: input.workspace.phase7ProofText,
        path: phase7Path,
        previousText: input.readText(phase7Path),
      }),
    },
  ];
}

function refreshSourceCommitField(input: {
  allowedNonEmptyFields: ReadonlySet<string>;
  nextText: string;
  path: string;
  previousText: string;
}): string {
  const nonRefreshableFields = findNonRefreshableFields({
    allowedNonEmptyFields: input.allowedNonEmptyFields,
    text: input.previousText,
  });
  if (nonRefreshableFields.length > 0) {
    throw new Error(
      [
        `Refusing to refresh source_commit in ${input.path} because it already contains non-scaffold evidence fields.`,
        `Non-refreshable fields: ${nonRefreshableFields.join(", ")}`,
        "Recollect evidence from the current checkout instead of rewriting source_commit.",
      ].join("\n"),
    );
  }

  const nextSourceCommit = readRecordField(input.nextText, "source_commit");
  if (nextSourceCommit === undefined || nextSourceCommit.length === 0) {
    throw new Error("Generated workspace source_commit is missing");
  }

  return replaceRecordField(input.previousText, "source_commit", nextSourceCommit);
}

function findNonRefreshableFields(input: {
  allowedNonEmptyFields: ReadonlySet<string>;
  text: string;
}): string[] {
  return parseRecordFields(input.text)
    .filter(
      (entry) =>
        entry.value.length > 0 && !input.allowedNonEmptyFields.has(entry.field),
    )
    .map((entry) => entry.field);
}

function replaceRecordField(text: string, fieldName: string, value: string): string {
  const lines = text.split(/\r?\n/u);
  let replaced = false;
  const nextLines = lines.map((line) => {
    const match = /^([a-z][a-z0-9_]*):\s*(.*)$/u.exec(line);
    if (match?.[1] !== fieldName) {
      return line;
    }
    replaced = true;
    return `${fieldName}: ${value}`;
  });
  if (!replaced) {
    nextLines.push(`${fieldName}: ${value}`);
  }
  return nextLines.join("\n");
}

function readRecordField(text: string, fieldName: string): string | undefined {
  return parseRecordFields(text).find((entry) => entry.field === fieldName)?.value;
}

function parseRecordFields(text: string): Array<{ field: string; value: string }> {
  return text
    .split(/\r?\n/u)
    .flatMap((line) => {
      const match = /^([a-z][a-z0-9_]*):\s*(.*)$/u.exec(line);
      if (match?.[1] === undefined || match[2] === undefined) {
        return [];
      }
      return [{ field: match[1], value: match[2].trim() }];
    });
}
