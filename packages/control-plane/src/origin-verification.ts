const WELL_KNOWN_PATH = "/.well-known/split402.json";
const MAX_WELL_KNOWN_BYTES = 65_536;
const DEFAULT_TIMEOUT_MS = 5_000;

export interface MerchantOriginWellKnownCheckInput {
  origin: string;
  merchantId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface MerchantOriginWellKnownCheck {
  ok: boolean;
  origin: string;
  checkedUrl: string;
  status?: number;
  errors: string[];
  discovered?: {
    protocol?: string;
    merchantId?: string;
    servicePublicKey?: string;
  };
}

export async function checkMerchantOriginWellKnown(
  input: MerchantOriginWellKnownCheckInput
): Promise<MerchantOriginWellKnownCheck> {
  const checkedUrl = `${input.origin}${WELL_KNOWN_PATH}`;
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  try {
    const response = await fetchImpl(checkedUrl, {
      signal: controller.signal,
      redirect: "error",
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      return {
        ok: false,
        origin: input.origin,
        checkedUrl,
        status: response.status,
        errors: [`well-known request returned HTTP ${response.status}`]
      };
    }

    const text = await response.text();
    if (text.length > MAX_WELL_KNOWN_BYTES) {
      return {
        ok: false,
        origin: input.origin,
        checkedUrl,
        status: response.status,
        errors: [
          `well-known document exceeds ${MAX_WELL_KNOWN_BYTES} bytes`
        ]
      };
    }

    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch {
      return {
        ok: false,
        origin: input.origin,
        checkedUrl,
        status: response.status,
        errors: ["well-known document is not valid JSON"]
      };
    }

    const record = asOptionalRecord(document);
    const discovered = {
      ...(typeof record?.protocol === "string"
        ? { protocol: record.protocol }
        : {}),
      ...(typeof record?.merchantId === "string"
        ? { merchantId: record.merchantId }
        : {}),
      ...(typeof record?.servicePublicKey === "string"
        ? { servicePublicKey: record.servicePublicKey }
        : {})
    };

    const errors: string[] = [];
    if (discovered.protocol !== "split402") {
      errors.push('well-known document protocol must be "split402"');
    }
    if (discovered.merchantId === undefined) {
      errors.push("well-known document is missing merchantId");
    } else if (discovered.merchantId !== input.merchantId) {
      errors.push(
        `well-known merchantId ${discovered.merchantId} does not match ${input.merchantId}`
      );
    }
    if (
      discovered.servicePublicKey === undefined ||
      discovered.servicePublicKey.trim().length === 0
    ) {
      errors.push("well-known document is missing servicePublicKey");
    }

    return {
      ok: errors.length === 0,
      origin: input.origin,
      checkedUrl,
      status: response.status,
      errors,
      discovered
    };
  } catch (error) {
    return {
      ok: false,
      origin: input.origin,
      checkedUrl,
      errors: [
        controller.signal.aborted
          ? `well-known request timed out after ${input.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`
          : error instanceof Error
            ? `well-known request failed: ${error.message}`
            : "well-known request failed"
      ]
    };
  } finally {
    clearTimeout(timeout);
  }
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
