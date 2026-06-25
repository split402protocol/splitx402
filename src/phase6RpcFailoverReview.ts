export interface Phase6RpcFailoverReviewInput {
  reviewId: string;
  reviewDate: string;
  owners: string;
  stagingEnvironment: string;
  drillReportSchema: string;
  drillPassed: string;
  primaryRpcUrl: string;
  secondaryRpcUrl: string;
  requestedRpcUrls: string;
  finalityStatus: string;
  finalityRpcUrl: string;
  primaryRpcUnavailableEvidence: string;
  secondaryRpcStatusEvidence: string;
  reviewDecision?: string;
  reviewNotes?: string;
}

export function createPhase6RpcFailoverReviewRecord(
  input: Phase6RpcFailoverReviewInput,
): string {
  const primaryRpcUrl = assertRequired(input.primaryRpcUrl, "primaryRpcUrl");
  const secondaryRpcUrl = assertRequired(input.secondaryRpcUrl, "secondaryRpcUrl");
  if (primaryRpcUrl === secondaryRpcUrl) {
    throw new Error("secondaryRpcUrl must differ from primaryRpcUrl");
  }

  const record = {
    review_id: assertRequired(input.reviewId, "reviewId"),
    review_date: assertRequired(input.reviewDate, "reviewDate"),
    owners: assertRequired(input.owners, "owners"),
    staging_environment: assertRequired(
      input.stagingEnvironment,
      "stagingEnvironment",
    ),
    drill_report_schema: assertFailoverSchema(input.drillReportSchema),
    drill_passed: assertPassed(input.drillPassed),
    primary_rpc_url: primaryRpcUrl,
    secondary_rpc_url: secondaryRpcUrl,
    requested_rpc_urls: assertRequestedRpcUrls(
      input.requestedRpcUrls,
      primaryRpcUrl,
      secondaryRpcUrl,
    ),
    finality_status: assertFinalityStatus(input.finalityStatus),
    finality_rpc_url: assertFinalityRpcUrl(input.finalityRpcUrl, secondaryRpcUrl),
    primary_rpc_unavailable_evidence: assertRequired(
      input.primaryRpcUnavailableEvidence,
      "primaryRpcUnavailableEvidence",
    ),
    secondary_rpc_status_evidence: assertRequired(
      input.secondaryRpcStatusEvidence,
      "secondaryRpcStatusEvidence",
    ),
    review_decision: input.reviewDecision ?? "no-go",
    review_notes: input.reviewNotes ?? "",
  };

  return `${Object.entries(record)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n`;
}

export function assertFailoverSchema(value: string): string {
  const trimmed = assertRequired(value, "drillReportSchema");
  if (trimmed !== "split402.payout_finality_failover_drill.v1") {
    throw new Error(
      "drillReportSchema must be split402.payout_finality_failover_drill.v1",
    );
  }
  return trimmed;
}

export function assertPassed(value: string): "true" {
  const normalized = assertRequired(value, "drillPassed").toLowerCase();
  if (normalized !== "true") {
    throw new Error("drillPassed must be true");
  }
  return "true";
}

export function assertRequestedRpcUrls(
  value: string,
  primaryRpcUrl: string,
  secondaryRpcUrl: string,
): string {
  const trimmed = assertRequired(value, "requestedRpcUrls");
  const urls = trimmed
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (urls[0] !== primaryRpcUrl || urls[1] !== secondaryRpcUrl) {
    throw new Error(
      "requestedRpcUrls must list primaryRpcUrl followed by secondaryRpcUrl",
    );
  }
  return urls.join(",");
}

export function assertFinalityStatus(value: string): string {
  const normalized = assertRequired(value, "finalityStatus").toLowerCase();
  if (normalized !== "confirmed" && normalized !== "finalized") {
    throw new Error("finalityStatus must be confirmed or finalized");
  }
  return normalized;
}

export function assertFinalityRpcUrl(
  value: string,
  secondaryRpcUrl: string,
): string {
  const trimmed = assertRequired(value, "finalityRpcUrl");
  if (trimmed !== secondaryRpcUrl) {
    throw new Error("finalityRpcUrl must match secondaryRpcUrl");
  }
  return trimmed;
}

function assertRequired(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}
