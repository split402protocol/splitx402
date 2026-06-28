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

export async function collectPhase7ReadArtifacts(
  input: Phase7StagingReadCollectorInput,
): Promise<Phase7ReadCollectorReport> {
  const specs = createReadArtifactSpecs(input);
  const captures: Phase7ReadArtifactCapture[] = [];
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
    if (spec.field === "funding_balance_evidence") {
      assertResolvedFundingBalanceArtifact(text);
    }
    const artifactPath = joinPath(input, spec.fileName);
    input.writeArtifact(artifactPath, formatArtifact(text));
    captures.push({
      field: spec.field,
      fileName: spec.fileName,
      path: artifactPath,
      url,
      status: response.status,
    });
  }

  return {
    schema: "split402.phase7_read_collector.v1",
    controlPlaneUrl: normalizeBaseUrl(input.controlPlaneUrl),
    merchantId: input.merchantId,
    referrerWallet: input.referrerWallet,
    outputDir: input.outputDir,
    captures,
  };
}

function createReadArtifactSpecs(
  input: Phase7StagingReadCollectorInput,
): ReadArtifactSpec[] {
  const merchantId = encodeURIComponent(assertNonEmpty(input.merchantId, "merchantId"));
  const referrerWallet = encodeURIComponent(
    assertNonEmpty(input.referrerWallet, "referrerWallet"),
  );
  const webhookQuery =
    input.webhookStatus === undefined || input.webhookStatus.trim().length === 0
      ? ""
      : `?status=${encodeURIComponent(input.webhookStatus.trim())}`;
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

function assertResolvedFundingBalanceArtifact(text: string): void {
  let artifact: unknown;
  try {
    artifact = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `funding_balance_evidence artifact is not valid JSON: ${formatError(error)}`,
    );
  }

  const summary = readRecord(artifact)?.summary ?? artifact;
  const summaryRecord = readRecord(summary);
  if (summaryRecord?.schema !== "split402.merchant_obligation_summary.v1") {
    throw new Error(
      "funding_balance_evidence must contain a merchant obligation summary",
    );
  }
  const assets = summaryRecord.assets;
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error(
      "funding_balance_evidence summary must include at least one asset",
    );
  }

  let hasCoveredOrDeficit = false;
  for (const [index, asset] of assets.entries()) {
    const record = readRecord(asset);
    if (record === undefined) {
      throw new Error(`funding_balance_evidence assets[${index}] is invalid`);
    }
    const assetName = readNonEmptyString(record.asset) ?? `assets[${index}]`;
    const fundingStatus = record.fundingStatus;
    if (fundingStatus === "unknown") {
      throw new Error(
        `funding_balance_evidence ${assetName} fundingStatus is unknown`,
      );
    }
    if (fundingStatus !== "covered" && fundingStatus !== "deficit") {
      throw new Error(
        `funding_balance_evidence ${assetName} fundingStatus must be covered or deficit`,
      );
    }
    hasCoveredOrDeficit = true;

    const fundingAmount = readNonNegativeAtomicString(record.fundingAmountAtomic);
    if (fundingAmount === undefined) {
      throw new Error(
        `funding_balance_evidence ${assetName} fundingAmountAtomic must be a non-negative atomic amount`,
      );
    }
    const fundingDeficit = readNonNegativeAtomicString(
      record.fundingDeficitAtomic,
    );
    if (fundingDeficit === undefined) {
      throw new Error(
        `funding_balance_evidence ${assetName} fundingDeficitAtomic must be a non-negative atomic amount`,
      );
    }
    if (fundingStatus === "covered" && fundingDeficit !== 0n) {
      throw new Error(
        `funding_balance_evidence ${assetName} covered status must have zero deficit`,
      );
    }
    if (fundingStatus === "deficit" && fundingDeficit <= 0n) {
      throw new Error(
        `funding_balance_evidence ${assetName} deficit status must report a positive deficit`,
      );
    }
  }

  if (!hasCoveredOrDeficit) {
    throw new Error(
      "funding_balance_evidence must include at least one asset with covered or deficit funding status",
    );
  }
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
