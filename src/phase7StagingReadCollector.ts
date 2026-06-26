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
