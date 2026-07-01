import { join } from "node:path";

import { toDisplayPath } from "./displayPath.js";
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
      path: join(workspace.directory, workspace.githubSettingsReviewFileName),
      contents: workspace.githubSettingsReviewText,
    },
    {
      path: join(workspace.directory, workspace.mainnetCanaryEnvFileName),
      contents: workspace.mainnetCanaryEnvText,
    },
    {
      path: join(workspace.directory, workspace.mainnetCanaryDryRunFileName),
      contents: workspace.mainnetCanaryDryRunText,
    },
    {
      path: join(
        workspace.directory,
        workspace.mainnetCanaryRollbackPlanFileName,
      ),
      contents: workspace.mainnetCanaryRollbackPlanText,
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

const GITHUB_SETTINGS_REFRESH_ALLOWED_NON_EMPTY_FIELDS = new Set([
  "schema",
  "review_id",
  "review_date",
  "repository",
  "source_commit",
  "branch",
  "required_checks",
]);

export interface ProductEvidenceSourceRefreshSkip {
  path: string;
  nonRefreshableFields: string[];
  nextAction: string;
}

export interface ProductEvidenceSourceRefreshPlan {
  writes: ProductEvidenceInitWrite[];
  skipped: ProductEvidenceSourceRefreshSkip[];
}

export function createProductEvidenceSourceRefreshPlan(input: {
  workspace: Split402ProductEvidenceWorkspace;
  exists: (path: string) => boolean;
  readText: (path: string) => string;
}): ProductEvidenceSourceRefreshPlan {
  const directory = input.workspace.directory;
  const phase6Path = join(directory, input.workspace.phase6EvidenceFileName);
  const phase6EnvFile = join(directory, input.workspace.phase6EnvFileName);
  const phase7Path = join(directory, input.workspace.phase7ProofFileName);
  const phase7EnvFile = join(directory, input.workspace.phase7EnvFileName);
  const githubSettingsReviewPath = join(
    directory,
    input.workspace.githubSettingsReviewFileName,
  );
  const candidates: ProductEvidenceSourceRefreshCandidate[] = [
    {
      allowedNonEmptyFields: GITHUB_SETTINGS_REFRESH_ALLOWED_NON_EMPTY_FIELDS,
      nextText: input.workspace.githubSettingsReviewText,
      path: githubSettingsReviewPath,
      recollectCommand:
        "corepack pnpm product:github-settings-review from the current checkout",
      scaffoldPlaceholderValues: new Set([
        "<reviewer handles>",
        "pending",
        "no",
        "no-go",
        "scaffold only; replace with live GitHub UI/API evidence before approval",
        "template only; replace with live GitHub UI/API evidence before approval",
      ]),
      toContents: (refreshedText) =>
        addMissingRecordFields({
          fields: ["review_method", "evidence_source"],
          nextText: input.workspace.githubSettingsReviewText,
          text: refreshedText,
        }),
    },
    {
      allowedNonEmptyFields: PHASE6_REFRESH_ALLOWED_NON_EMPTY_FIELDS,
      nextText: input.workspace.phase6EvidenceText,
      path: phase6Path,
      recollectCommand: `corepack pnpm phase6:evidence:assemble --evidence-env-file ${toDisplayPath(phase6EnvFile)} ${toDisplayPath(phase6Path)}`,
    },
    {
      allowedNonEmptyFields: PHASE7_REFRESH_ALLOWED_NON_EMPTY_FIELDS,
      nextText: input.workspace.phase7ProofText,
      path: phase7Path,
      recollectCommand: `corepack pnpm phase7:staging:assemble --evidence-env-file ${toDisplayPath(phase7EnvFile)} ${toDisplayPath(phase7Path)}`,
    },
  ];

  const writes: ProductEvidenceInitWrite[] = [];
  const skipped: ProductEvidenceSourceRefreshSkip[] = [];
  for (const candidate of candidates) {
    if (!input.exists(candidate.path)) {
      skipped.push({
        path: toDisplayPath(candidate.path),
        nonRefreshableFields: [],
        nextAction: `Missing scaffold file; create absent scaffold files first with corepack pnpm product:evidence:init --missing ${directory}.`,
      });
      continue;
    }
    const previousText = input.readText(candidate.path);
    const nonRefreshableFields = findNonRefreshableFields({
      allowedNonEmptyFields: candidate.allowedNonEmptyFields,
      scaffoldPlaceholderValues: candidate.scaffoldPlaceholderValues,
      text: previousText,
    });
    if (nonRefreshableFields.length > 0) {
      skipped.push({
        path: toDisplayPath(candidate.path),
        nonRefreshableFields,
        nextAction: `Contains non-scaffold evidence fields; recollect it with ${candidate.recollectCommand} instead of rewriting source_commit.`,
      });
      continue;
    }
    const refreshedText = refreshSourceCommitField({
      nextText: candidate.nextText,
      previousText,
    });
    writes.push({
      path: candidate.path,
      contents:
        candidate.toContents === undefined
          ? refreshedText
          : candidate.toContents(refreshedText),
    });
  }
  return { skipped, writes };
}

interface ProductEvidenceSourceRefreshCandidate {
  allowedNonEmptyFields: ReadonlySet<string>;
  nextText: string;
  path: string;
  recollectCommand: string;
  scaffoldPlaceholderValues?: ReadonlySet<string>;
  toContents?: (refreshedText: string) => string;
}

function refreshSourceCommitField(input: {
  nextText: string;
  previousText: string;
}): string {
  const nextSourceCommit = readRecordField(input.nextText, "source_commit");
  if (nextSourceCommit === undefined || nextSourceCommit.length === 0) {
    throw new Error("Generated workspace source_commit is missing");
  }

  return replaceRecordField(input.previousText, "source_commit", nextSourceCommit);
}

function findNonRefreshableFields(input: {
  allowedNonEmptyFields: ReadonlySet<string>;
  scaffoldPlaceholderValues?: ReadonlySet<string>;
  text: string;
}): string[] {
  return parseRecordFields(input.text)
    .filter(
      (entry) =>
        entry.value.length > 0 &&
        !input.allowedNonEmptyFields.has(entry.field) &&
        input.scaffoldPlaceholderValues?.has(entry.value) !== true,
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

function addMissingRecordFields(input: {
  fields: readonly string[];
  nextText: string;
  text: string;
}): string {
  const currentFields = parseRecordFields(input.text);
  const nextFields = parseRecordFields(input.nextText);
  const lines = input.text.split(/\r?\n/u);
  for (const field of input.fields) {
    if (currentFields.some((entry) => entry.field === field)) {
      continue;
    }
    const nextValue = nextFields.find((entry) => entry.field === field)?.value;
    if (nextValue !== undefined) {
      lines.push(`${field}: ${nextValue}`);
    }
  }
  return lines.join("\n");
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
