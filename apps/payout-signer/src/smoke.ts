import { pathToFileURL } from "node:url";

export interface PayoutSignerSmokeCheckResult {
  signerReference: string;
  network: string;
  metrics: {
    requestsTotal: number;
    signedTotal: number;
    rejectedTotal: number;
  };
}

export interface PayoutSignerSmokeCheckInput {
  baseUrl: string;
  fetch?: typeof fetch;
  forbiddenSubstrings?: readonly string[];
}

interface SmokeHttpResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

const SERVICE = "split402-payout-signer";

export async function runPayoutSignerSmokeCheck(
  input: PayoutSignerSmokeCheckInput
): Promise<PayoutSignerSmokeCheckResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const httpFetch = input.fetch ?? fetch;
  const forbiddenSubstrings = input.forbiddenSubstrings ?? [];

  const health = await getJson(httpFetch, `${baseUrl}/v1/health`, "health");
  assertNoForbiddenSubstrings(health.raw, forbiddenSubstrings, "health");
  const healthBody = readRecord(health.body, "health response");
  assertEqual(healthBody.status, "ok", "health status");
  assertEqual(healthBody.service, SERVICE, "health service");
  const signerReference = readNonEmptyString(
    healthBody.signerReference,
    "health signerReference"
  );
  const network = readNonEmptyString(healthBody.network, "health network");

  const ready = await getJson(httpFetch, `${baseUrl}/v1/ready`, "readiness");
  assertNoForbiddenSubstrings(ready.raw, forbiddenSubstrings, "readiness");
  const readyBody = readRecord(ready.body, "readiness response");
  assertEqual(readyBody.status, "ready", "readiness status");
  assertEqual(readyBody.service, SERVICE, "readiness service");
  assertEqual(readyBody.signerReference, signerReference, "readiness signerReference");
  assertEqual(readyBody.network, network, "readiness network");

  const metricsResponse = await getJson(httpFetch, `${baseUrl}/v1/metrics`, "metrics");
  assertNoForbiddenSubstrings(
    metricsResponse.raw,
    forbiddenSubstrings,
    "metrics"
  );
  const metricsBody = readRecord(metricsResponse.body, "metrics response");
  const metrics = readRecord(metricsBody.metrics, "metrics");
  assertEqual(metrics.service, SERVICE, "metrics service");
  assertEqual(metrics.signerReference, signerReference, "metrics signerReference");
  assertEqual(metrics.network, network, "metrics network");

  return {
    signerReference,
    network,
    metrics: {
      requestsTotal: readNonNegativeInteger(
        metrics.requestsTotal,
        "metrics requestsTotal"
      ),
      signedTotal: readNonNegativeInteger(metrics.signedTotal, "metrics signedTotal"),
      rejectedTotal: readNonNegativeInteger(
        metrics.rejectedTotal,
        "metrics rejectedTotal"
      )
    }
  };
}

export function readPayoutSignerSmokeCheckFromEnv(
  env: NodeJS.ProcessEnv = process.env
): PayoutSignerSmokeCheckInput {
  const baseUrl =
    env.SPLIT402_PAYOUT_SIGNER_SMOKE_URL ?? env.SPLIT402_PAYOUT_SIGNER_URL;
  if (baseUrl === undefined || baseUrl.trim().length === 0) {
    throw new Error(
      "SPLIT402_PAYOUT_SIGNER_SMOKE_URL or SPLIT402_PAYOUT_SIGNER_URL is required"
    );
  }
  return {
    baseUrl,
    forbiddenSubstrings: [
      env.SPLIT402_PAYOUT_SIGNER_SERVICE_SHARED_SECRET,
      env.SPLIT402_REMOTE_PAYOUT_SIGNER_SHARED_SECRET,
      env.SPLIT402_PAYOUT_SIGNER_SERVICE_PRIVATE_KEY_BASE64,
      env.SPLIT402_PAYOUT_SIGNER_SERVICE_SECRET_KEY_BASE64,
      env.SPLIT402_PAYOUT_SIGNER_SERVICE_SECRET_KEY_JSON
    ].filter(
      (value): value is string => value !== undefined && value.trim().length > 0
    )
  };
}

async function main(): Promise<void> {
  const result = await runPayoutSignerSmokeCheck(readPayoutSignerSmokeCheckFromEnv());
  console.log(
    JSON.stringify({
      status: "ok",
      service: SERVICE,
      signerReference: result.signerReference,
      network: result.network,
      metrics: result.metrics
    })
  );
}

async function getJson(
  httpFetch: typeof fetch,
  url: string,
  label: string
): Promise<{ body: unknown; raw: string }> {
  const response = (await httpFetch(url, {
    method: "GET",
    headers: {
      accept: "application/json"
    }
  })) as SmokeHttpResponse;
  const raw = await readResponseText(response);
  if (!response.ok) {
    throw new Error(`${label} check returned HTTP ${response.status}: ${raw}`);
  }
  try {
    return { body: JSON.parse(raw) as unknown, raw };
  } catch {
    throw new Error(`${label} check did not return JSON`);
  }
}

async function readResponseText(response: SmokeHttpResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return JSON.stringify(await response.json());
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("baseUrl must be non-empty");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("baseUrl must be an HTTP URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("baseUrl must be an HTTP URL");
  }
  return parsed.toString().replace(/\/$/u, "");
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function readNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value as number;
}

function assertEqual(left: unknown, right: unknown, label: string): void {
  if (left !== right) {
    throw new Error(`${label} mismatch`);
  }
}

function assertNoForbiddenSubstrings(
  body: string,
  forbiddenSubstrings: readonly string[],
  label: string
): void {
  for (const forbidden of forbiddenSubstrings) {
    if (body.includes(forbidden)) {
      throw new Error(`${label} response exposed a configured secret`);
    }
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
