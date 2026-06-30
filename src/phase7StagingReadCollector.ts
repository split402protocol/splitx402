export interface Phase7StagingReadCollectorInput {
  controlPlaneUrl: string;
  merchantId: string;
  referrerWallet: string;
  outputDir: string;
  bearerToken?: string;
  webhookStatus?: string;
  fetch: Phase7ReadCollectorFetch;
  writeArtifact: (path: string, text: string) => void;
  joinPath?: (directory: string, fileName: string) => string;
}

export interface Phase7ReadCollectorFetch {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface Phase7ReadArtifactCapture {
  field:
    | "agent_discovery_evidence"
    | "referrer_balance_evidence"
    | "dashboard_summary_evidence"
    | "webhook_delivery_evidence"
    | "payout_obligation_evidence"
    | "funding_balance_evidence";
  fileName: string;
  path: string;
  url: string;
  status: number;
}

export interface Phase7ReadCollectorReport {
  schema: "split402.phase7_read_collector.v1";
  controlPlaneUrl: string;
  merchantId: string;
  referrerWallet: string;
  outputDir: string;
  captures: Phase7ReadArtifactCapture[];
}

interface ReadArtifactSpec {
  field: Phase7ReadArtifactCapture["field"];
  fileName: string;
  path: string;
}

interface PendingReadArtifactWrite {
  path: string;
  text: string;
  capture: Phase7ReadArtifactCapture;
}

const WEBHOOK_STATUSES = new Set([
  "pending",
  "processing",
  "delivered",
  "dead_letter",
]);

export async function collectPhase7ReadArtifacts(
  input: Phase7StagingReadCollectorInput,
): Promise<Phase7ReadCollectorReport> {
  const specs = createReadArtifactSpecs(input);
  const pendingWrites: PendingReadArtifactWrite[] = [];
  for (const spec of specs) {
    const url = createUrl(input.controlPlaneUrl, spec.path);
    const response = await input.fetch(url, {
      headers:
        input.bearerToken === undefined
          ? {}
          : { authorization: `Bearer ${input.bearerToken}` },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `${spec.field} capture failed with HTTP ${response.status}: ${text.slice(
          0,
          200,
        )}`,
      );
    }
    assertUsefulReadArtifact(spec.field, text);
    const artifactPath = joinPath(input, spec.fileName);
    pendingWrites.push({
      path: artifactPath,
      text: formatArtifact(text),
      capture: {
        field: spec.field,
        fileName: spec.fileName,
        path: artifactPath,
        url,
        status: response.status,
      },
    });
  }

  for (const pendingWrite of pendingWrites) {
    input.writeArtifact(pendingWrite.path, pendingWrite.text);
  }

  return {
    schema: "split402.phase7_read_collector.v1",
    controlPlaneUrl: normalizeBaseUrl(input.controlPlaneUrl),
    merchantId: input.merchantId,
    referrerWallet: input.referrerWallet,
    outputDir: input.outputDir,
    captures: pendingWrites.map((pendingWrite) => pendingWrite.capture),
  };
}

function createReadArtifactSpecs(
  input: Phase7StagingReadCollectorInput,
): ReadArtifactSpec[] {
  const merchantId = encodeURIComponent(assertNonEmpty(input.merchantId, "merchantId"));
  const referrerWallet = encodeURIComponent(
    assertNonEmpty(input.referrerWallet, "referrerWallet"),
  );
  const webhookStatus = normalizeWebhookStatus(input.webhookStatus);
  const webhookQuery =
    webhookStatus === undefined
      ? ""
      : `?status=${encodeURIComponent(webhookStatus)}`;
  return [
    {
      field: "agent_discovery_evidence",
      fileName: "agent-discovery.json",
      path: `/v1/referrers/${referrerWallet}/routes`,
    },
    {
      field: "referrer_balance_evidence",
      fileName: "referrer-balances.json",
      path: `/v1/referrers/${referrerWallet}/balances`,
    },
    {
      field: "dashboard_summary_evidence",
      fileName: "dashboard-summary.json",
      path: `/v1/merchants/${merchantId}/dashboard-summary`,
    },
    {
      field: "webhook_delivery_evidence",
      fileName: "webhook-events.json",
      path: `/v1/merchants/${merchantId}/webhook-events${webhookQuery}`,
    },
    {
      field: "payout_obligation_evidence",
      fileName: "payout-obligations.json",
      path: `/v1/merchants/${merchantId}/payout-obligations`,
    },
    {
      field: "funding_balance_evidence",
      fileName: "funding-balance.json",
      path: `/v1/merchants/${merchantId}/payout-obligations`,
    },
  ];
}

function createUrl(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = assertNonEmpty(value, "controlPlaneUrl").replace(/\/+$/u, "");
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("controlPlaneUrl must be an http(s) URL");
  }
  return url.toString().replace(/\/$/u, "");
}

function joinPath(input: Phase7StagingReadCollectorInput, fileName: string): string {
  return input.joinPath === undefined
    ? `${input.outputDir}/${fileName}`
    : input.joinPath(input.outputDir, fileName);
}

function formatArtifact(text: string): string {
  try {
    return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  } catch {
    return text.endsWith("\n") ? text : `${text}\n`;
  }
}

function assertNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function normalizeWebhookStatus(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const normalized = value.trim();
  if (!WEBHOOK_STATUSES.has(normalized)) {
    throw new Error(
      "webhookStatus must be pending, processing, delivered, or dead_letter",
    );
  }
  return normalized;
}

function assertUsefulReadArtifact(
  field: Phase7ReadArtifactCapture["field"],
  text: string,
): void {
  const artifact = parseJsonArtifact(field, text);
  const blockers: string[] = [];
  switch (field) {
    case "agent_discovery_evidence":
      validateAgentDiscoveryArtifact(artifact, blockers);
      break;
    case "referrer_balance_evidence":
      validateReferrerBalanceArtifact(artifact, blockers);
      break;
    case "dashboard_summary_evidence":
      validateDashboardSummaryArtifact(artifact, blockers);
      break;
    case "webhook_delivery_evidence":
      validateWebhookDeliveryArtifact(artifact, blockers);
      break;
    case "payout_obligation_evidence":
      validatePayoutObligationArtifact(artifact, blockers);
      break;
    case "funding_balance_evidence":
      validateFundingBalanceArtifact(artifact, blockers);
      break;
  }
  if (blockers.length > 0) {
    throw new Error(blockers.join("; "));
  }
}

function parseJsonArtifact(
  field: Phase7ReadArtifactCapture["field"],
  text: string,
): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${field} artifact is not valid JSON: ${formatError(error)}`);
  }
}

function validateAgentDiscoveryArtifact(
  artifact: unknown,
  blockers: string[],
): void {
  const record = readRecord(artifact);
  const routes = Array.isArray(record?.routes) ? record.routes : undefined;
  if (routes === undefined) {
    blockers.push("agent_discovery_evidence routes must be an array");
    return;
  }
  if (routes.length === 0) {
    blockers.push("agent_discovery_evidence must include at least one route");
    return;
  }
  let hasActiveRoute = false;
  for (const [index, route] of routes.entries()) {
    const routeRecord = readRecord(route);
    if (routeRecord === undefined) {
      blockers.push(`agent_discovery_evidence routes[${index}] is invalid`);
      continue;
    }
    if (routeRecord.status === "active") {
      hasActiveRoute = true;
    }
    for (const field of ["campaignId", "referrerWallet", "payoutWallet"]) {
      if (readNonEmptyString(routeRecord[field]) === undefined) {
        blockers.push(`agent_discovery_evidence routes[${index}].${field} is missing`);
      }
    }
    if (
      readNonEmptyString(routeRecord.id) === undefined &&
      readNonEmptyString(routeRecord.routeId) === undefined
    ) {
      blockers.push(`agent_discovery_evidence routes[${index}].id is missing`);
    }
  }
  if (!hasActiveRoute) {
    blockers.push("agent_discovery_evidence must include at least one active route");
  }
}

function validateReferrerBalanceArtifact(
  artifact: unknown,
  blockers: string[],
): void {
  const summary = readRecord(readRecord(artifact)?.summary);
  if (summary === undefined) {
    blockers.push("referrer_balance_evidence summary is missing");
    return;
  }
  if (readNonEmptyString(summary.referrerWallet) === undefined) {
    blockers.push("referrer_balance_evidence summary.referrerWallet is missing");
  }
  const assets = Array.isArray(summary.assets) ? summary.assets : undefined;
  if (assets === undefined) {
    blockers.push("referrer_balance_evidence summary.assets must be an array");
    return;
  }
  if (assets.length === 0) {
    blockers.push("referrer_balance_evidence must include at least one asset");
    return;
  }

  let hasPositiveEarning = false;
  for (const [index, asset] of assets.entries()) {
    const record = readRecord(asset);
    if (record === undefined) {
      blockers.push(`referrer_balance_evidence assets[${index}] is invalid`);
      continue;
    }
    if (readNonEmptyString(record.asset) === undefined) {
      blockers.push(`referrer_balance_evidence assets[${index}].asset is missing`);
    }
    for (const field of [
      "pendingAmountAtomic",
      "availableAmountAtomic",
      "heldAmountAtomic",
      "inFlightAmountAtomic",
      "paidAmountAtomic",
      "totalEarnedAmountAtomic",
    ]) {
      const amount = readNonNegativeAtomicString(record[field]);
      if (amount === undefined) {
        blockers.push(
          `referrer_balance_evidence assets[${index}].${field} must be a non-negative atomic amount`,
        );
      } else if (field === "totalEarnedAmountAtomic" && amount > 0n) {
        hasPositiveEarning = true;
      }
    }
  }
  if (!hasPositiveEarning) {
    blockers.push("referrer_balance_evidence must show positive referrer earnings");
  }
}

function validateDashboardSummaryArtifact(
  artifact: unknown,
  blockers: string[],
): void {
  const summary = readRecord(readRecord(artifact)?.summary);
  if (summary === undefined) {
    blockers.push("dashboard_summary_evidence summary is missing");
    return;
  }
  if (summary.schema !== "split402.merchant_dashboard_summary.v1") {
    blockers.push("dashboard_summary_evidence summary schema is invalid");
  }
  if (readRecord(summary.merchant) === undefined) {
    blockers.push("dashboard_summary_evidence summary.merchant is missing");
  }
  const campaigns = readRecord(summary.campaigns);
  const routes = readRecord(summary.routes);
  const campaignTotal = readNonNegativeInteger(campaigns?.total);
  const routeTotal = readNonNegativeInteger(routes?.total);
  if (campaignTotal === undefined) {
    blockers.push("dashboard_summary_evidence campaigns.total must be a non-negative integer");
  } else if (campaignTotal === 0) {
    blockers.push("dashboard_summary_evidence must include at least one campaign");
  }
  if (routeTotal === undefined) {
    blockers.push("dashboard_summary_evidence routes.total must be a non-negative integer");
  } else if (routeTotal === 0) {
    blockers.push("dashboard_summary_evidence must include at least one route");
  }
  const activeCampaignIds = Array.isArray(campaigns?.activeCampaignIds)
    ? campaigns?.activeCampaignIds
    : undefined;
  if (activeCampaignIds === undefined || activeCampaignIds.length === 0) {
    blockers.push("dashboard_summary_evidence must include an active campaign id");
  }
  const activeRouteIds = Array.isArray(routes?.activeRouteIds)
    ? routes?.activeRouteIds
    : undefined;
  if (activeRouteIds === undefined || activeRouteIds.length === 0) {
    blockers.push("dashboard_summary_evidence must include an active route id");
  }
}

function validateWebhookDeliveryArtifact(
  artifact: unknown,
  blockers: string[],
): void {
  const record = readRecord(artifact);
  const events = Array.isArray(record?.events) ? record.events : undefined;
  if (events === undefined) {
    blockers.push("webhook_delivery_evidence events must be an array");
    return;
  }
  if (events.length === 0) {
    blockers.push("webhook_delivery_evidence must include at least one event");
    return;
  }
  let hasDeliveredEvent = false;
  for (const [index, event] of events.entries()) {
    const eventRecord = readRecord(event);
    if (eventRecord === undefined) {
      blockers.push(`webhook_delivery_evidence events[${index}] is invalid`);
      continue;
    }
    if (eventRecord.status === "delivered") {
      hasDeliveredEvent = true;
    }
    if (readNonEmptyString(eventRecord.eventType) === undefined) {
      blockers.push(`webhook_delivery_evidence events[${index}].eventType is missing`);
    }
    if (readNonEmptyString(eventRecord.status) === undefined) {
      blockers.push(`webhook_delivery_evidence events[${index}].status is missing`);
    }
  }
  if (!hasDeliveredEvent) {
    blockers.push("webhook_delivery_evidence must include a delivered event");
  }
}

function validatePayoutObligationArtifact(
  artifact: unknown,
  blockers: string[],
): void {
  const summaryRecord = readMerchantObligationSummary(artifact);
  if (summaryRecord === undefined) {
    blockers.push("payout_obligation_evidence summary is missing");
    return;
  }
  if (summaryRecord.schema !== "split402.merchant_obligation_summary.v1") {
    blockers.push("payout_obligation_evidence summary schema is invalid");
  }
  if (!Array.isArray(summaryRecord.assets)) {
    blockers.push("payout_obligation_evidence summary.assets must be an array");
    return;
  }
  if (summaryRecord.assets.length === 0) {
    blockers.push("payout_obligation_evidence must include at least one asset");
    return;
  }
  let hasObligation = false;
  for (const [index, asset] of summaryRecord.assets.entries()) {
    const record = readRecord(asset);
    if (record === undefined) {
      blockers.push(`payout_obligation_evidence assets[${index}] is invalid`);
      continue;
    }
    for (const field of [
      "outstandingAmountAtomic",
      "totalAccruedAmountAtomic",
      "pendingAmountAtomic",
      "availableAmountAtomic",
      "heldAmountAtomic",
      "inFlightAmountAtomic",
      "paidAmountAtomic",
    ]) {
      const amount = readNonNegativeAtomicString(record[field]);
      if (amount === undefined) {
        blockers.push(
          `payout_obligation_evidence assets[${index}].${field} must be a non-negative atomic amount`,
        );
      } else if (
        (field === "outstandingAmountAtomic" || field === "totalAccruedAmountAtomic") &&
        amount > 0n
      ) {
        hasObligation = true;
      }
    }
  }
  if (!hasObligation) {
    blockers.push("payout_obligation_evidence must show a payout obligation");
  }
}

function validateFundingBalanceArtifact(
  artifact: unknown,
  blockers: string[],
): void {
  const summaryRecord = readMerchantObligationSummary(artifact);
  if (summaryRecord?.schema !== "split402.merchant_obligation_summary.v1") {
    blockers.push("funding_balance_evidence must contain a merchant obligation summary");
    return;
  }
  if (!Array.isArray(summaryRecord.assets)) {
    blockers.push("funding_balance_evidence summary assets must be an array");
    return;
  }
  if (summaryRecord.assets.length === 0) {
    blockers.push("funding_balance_evidence summary must include at least one asset");
  }

  let hasCoveredOrDeficit = false;
  for (const [index, asset] of summaryRecord.assets.entries()) {
    const record = readRecord(asset);
    if (record === undefined) {
      blockers.push(`funding_balance_evidence assets[${index}] is invalid`);
      continue;
    }
    const assetName = readNonEmptyString(record.asset) ?? `assets[${index}]`;
    const fundingStatus = record.fundingStatus;
    if (fundingStatus === "unknown") {
      blockers.push(
        `funding_balance_evidence ${assetName} fundingStatus is unknown`,
      );
      continue;
    }
    if (fundingStatus !== "covered" && fundingStatus !== "deficit") {
      blockers.push(
        `funding_balance_evidence ${assetName} fundingStatus must be covered or deficit`,
      );
      continue;
    }
    hasCoveredOrDeficit = true;

    const fundingAmount = readNonNegativeAtomicString(record.fundingAmountAtomic);
    if (fundingAmount === undefined) {
      blockers.push(
        `funding_balance_evidence ${assetName} fundingAmountAtomic must be a non-negative atomic amount`,
      );
    }
    const fundingDeficit = readNonNegativeAtomicString(
      record.fundingDeficitAtomic,
    );
    if (fundingDeficit === undefined) {
      blockers.push(
        `funding_balance_evidence ${assetName} fundingDeficitAtomic must be a non-negative atomic amount`,
      );
      continue;
    }
    if (fundingStatus === "covered" && fundingDeficit !== 0n) {
      blockers.push(
        `funding_balance_evidence ${assetName} covered status must have zero deficit`,
      );
    }
    if (fundingStatus === "deficit" && fundingDeficit <= 0n) {
      blockers.push(
        `funding_balance_evidence ${assetName} deficit status must report a positive deficit`,
      );
    }
  }

  if (!hasCoveredOrDeficit) {
    blockers.push(
      "funding_balance_evidence must include at least one asset with covered or deficit funding status",
    );
  }
}

function readMerchantObligationSummary(
  artifact: unknown,
): Record<string, unknown> | undefined {
  const record = readRecord(artifact);
  const summary = readRecord(record?.summary) ?? record;
  return readRecord(summary);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readNonNegativeAtomicString(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/u.test(value)) {
    return undefined;
  }
  return BigInt(value);
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && typeof value === "number" && value >= 0
    ? value
    : undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
