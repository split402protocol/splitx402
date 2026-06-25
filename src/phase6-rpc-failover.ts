import { createPhase6RpcFailoverReviewRecord } from "./phase6RpcFailoverReview.js";

interface FailoverDrillReport {
  schema?: unknown;
  passed?: unknown;
  primaryRpcUrl?: unknown;
  secondaryRpcUrl?: unknown;
  requestedRpcUrls?: unknown;
  result?: {
    status?: unknown;
    rpcUrl?: unknown;
  };
}

const env = process.env;

try {
  const drillReport = parseDrillReport(
    env.SPLIT402_PHASE6_RPC_FAILOVER_DRILL_REPORT_JSON,
  );

  console.log(
    createPhase6RpcFailoverReviewRecord({
      reviewId: readRequiredEnv("SPLIT402_PHASE6_RPC_FAILOVER_REVIEW_ID"),
      reviewDate: env.SPLIT402_PHASE6_RPC_FAILOVER_REVIEW_DATE ?? isoDate(),
      owners: readRequiredEnv("SPLIT402_PHASE6_RPC_FAILOVER_OWNERS"),
      stagingEnvironment: readRequiredEnv(
        "SPLIT402_PHASE6_RPC_FAILOVER_STAGING_ENVIRONMENT",
      ),
      drillReportSchema: readReportString(
        drillReport?.schema,
        "SPLIT402_PHASE6_RPC_FAILOVER_DRILL_REPORT_SCHEMA",
      ),
      drillPassed: readReportString(
        drillReport?.passed,
        "SPLIT402_PHASE6_RPC_FAILOVER_DRILL_PASSED",
      ),
      primaryRpcUrl: readReportString(
        drillReport?.primaryRpcUrl,
        "SPLIT402_PHASE6_RPC_FAILOVER_PRIMARY_RPC_URL",
      ),
      secondaryRpcUrl: readReportString(
        drillReport?.secondaryRpcUrl,
        "SPLIT402_PHASE6_RPC_FAILOVER_SECONDARY_RPC_URL",
      ),
      requestedRpcUrls: readRequestedRpcUrls(drillReport?.requestedRpcUrls),
      finalityStatus: readReportString(
        drillReport?.result?.status,
        "SPLIT402_PHASE6_RPC_FAILOVER_FINALITY_STATUS",
      ),
      finalityRpcUrl: readReportString(
        drillReport?.result?.rpcUrl,
        "SPLIT402_PHASE6_RPC_FAILOVER_FINALITY_RPC_URL",
      ),
      primaryRpcUnavailableEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_RPC_FAILOVER_PRIMARY_UNAVAILABLE_EVIDENCE",
      ),
      secondaryRpcStatusEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_RPC_FAILOVER_SECONDARY_STATUS_EVIDENCE",
      ),
      reviewDecision:
        env.SPLIT402_PHASE6_RPC_FAILOVER_REVIEW_DECISION ?? "no-go",
      reviewNotes: env.SPLIT402_PHASE6_RPC_FAILOVER_REVIEW_NOTES ?? "",
    }),
  );
} catch (error) {
  console.error(readErrorMessage(error));
  console.error(
    [
      "Required environment:",
      "  SPLIT402_PHASE6_RPC_FAILOVER_REVIEW_ID",
      "  SPLIT402_PHASE6_RPC_FAILOVER_OWNERS",
      "  SPLIT402_PHASE6_RPC_FAILOVER_STAGING_ENVIRONMENT",
      "  SPLIT402_PHASE6_RPC_FAILOVER_PRIMARY_UNAVAILABLE_EVIDENCE",
      "  SPLIT402_PHASE6_RPC_FAILOVER_SECONDARY_STATUS_EVIDENCE",
      "  SPLIT402_PHASE6_RPC_FAILOVER_DRILL_REPORT_JSON",
      "Or, instead of SPLIT402_PHASE6_RPC_FAILOVER_DRILL_REPORT_JSON:",
      "  SPLIT402_PHASE6_RPC_FAILOVER_DRILL_REPORT_SCHEMA",
      "  SPLIT402_PHASE6_RPC_FAILOVER_DRILL_PASSED",
      "  SPLIT402_PHASE6_RPC_FAILOVER_PRIMARY_RPC_URL",
      "  SPLIT402_PHASE6_RPC_FAILOVER_SECONDARY_RPC_URL",
      "  SPLIT402_PHASE6_RPC_FAILOVER_REQUESTED_RPC_URLS",
      "  SPLIT402_PHASE6_RPC_FAILOVER_FINALITY_STATUS",
      "  SPLIT402_PHASE6_RPC_FAILOVER_FINALITY_RPC_URL",
      "Optional environment:",
      "  SPLIT402_PHASE6_RPC_FAILOVER_REVIEW_DATE",
      "  SPLIT402_PHASE6_RPC_FAILOVER_REVIEW_DECISION",
      "  SPLIT402_PHASE6_RPC_FAILOVER_REVIEW_NOTES",
    ].join("\n"),
  );
  process.exitCode = 1;
}

function parseDrillReport(value: string | undefined): FailoverDrillReport | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = JSON.parse(value) as unknown;
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("SPLIT402_PHASE6_RPC_FAILOVER_DRILL_REPORT_JSON must be an object");
  }
  return parsed as FailoverDrillReport;
}

function readReportString(reportValue: unknown, envName: string): string {
  if (reportValue !== undefined) {
    return String(reportValue);
  }
  return readRequiredEnv(envName);
}

function readRequestedRpcUrls(reportValue: unknown): string {
  if (Array.isArray(reportValue)) {
    return reportValue.map((item) => String(item)).join(",");
  }
  return readRequiredEnv("SPLIT402_PHASE6_RPC_FAILOVER_REQUESTED_RPC_URLS");
}

function readRequiredEnv(name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
