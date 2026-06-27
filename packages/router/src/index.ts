import { Split402AgentClient } from "@split402/agent-sdk";
import {
  Split402ReceiptV1Schema,
  verifySplit402Receipt,
  type ReferralClaimV1,
  type Split402ReceiptV1
} from "@split402/protocol";
import type { KeyPairSigner } from "@solana/kit";

export interface Split402CapabilityProvider {
  providerId: string;
  capability: string;
  merchantOrigin: string;
  path: string;
  method: "POST";
  operationId: string;
  campaignId: string;
  merchantPublicKey?: string;
  network: string;
  asset: string;
  amountAtomic: string;
  reliability?: {
    successRateBps?: number;
    medianLatencyMs?: number;
  };
}

export interface Split402RouterExecuteInput {
  capability: string;
  input: unknown;
  budget: {
    network: string;
    asset: string;
    maxAmountAtomic: string;
  };
  referralClaim?: ReferralClaimV1;
  maxAttempts?: number;
}

export interface Split402RouterExecuteResult<T = unknown> {
  providerId: string;
  capability: string;
  data: T;
  receipt: Split402ReceiptV1;
  attempts: Split402RouterAttempt[];
}

export interface Split402RouterAttempt {
  providerId: string;
  capability: string;
  status: "success" | "failed";
  retryable: boolean;
  error?: string;
  receiptId?: string;
}

export interface Split402RouterOptions {
  providers: readonly Split402CapabilityProvider[];
  signer?: KeyPairSigner;
  executor?: Split402RouterExecutor;
  verifyReceipts?: boolean;
}

export interface Split402RouterExecutor {
  execute(input: {
    provider: Split402CapabilityProvider;
    body: unknown;
    referralClaim?: ReferralClaimV1;
    signer?: KeyPairSigner;
  }): Promise<Split402RouterExecutorResult>;
}

export interface Split402RouterExecutorResult<T = unknown> {
  data: T;
  receipt?: Split402ReceiptV1;
}

export type Split402RouterErrorCode =
  | "invalid_request"
  | "unsupported_capability"
  | "budget_exceeded"
  | "execution_failed";

export class Split402RouterError extends Error {
  readonly code: Split402RouterErrorCode;
  readonly attempts: readonly Split402RouterAttempt[];

  constructor(
    code: Split402RouterErrorCode,
    message: string,
    attempts: readonly Split402RouterAttempt[] = []
  ) {
    super(message);
    this.name = "Split402RouterError";
    this.code = code;
    this.attempts = attempts;
  }
}

export class Split402RouterProviderError extends Error {
  readonly statusCode?: number;
  readonly retryable?: boolean;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      retryable?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "Split402RouterProviderError";
    if (options.statusCode !== undefined) {
      this.statusCode = options.statusCode;
    }
    if (options.retryable !== undefined) {
      this.retryable = options.retryable;
    }
  }
}

export class Split402Router {
  private readonly providers: readonly Split402CapabilityProvider[];
  private readonly executor: Split402RouterExecutor;
  private readonly signer?: KeyPairSigner;
  private readonly verifyReceipts: boolean;

  constructor(options: Split402RouterOptions) {
    this.providers = [...options.providers];
    this.executor = options.executor ?? new Split402AgentSdkExecutor();
    this.verifyReceipts = options.verifyReceipts ?? true;
    if (options.signer !== undefined) {
      this.signer = options.signer;
    }
  }

  searchCapabilities(capability?: string): Split402CapabilityProvider[] {
    return this.providers
      .filter((provider) => capability === undefined || provider.capability === capability)
      .sort(compareProviders);
  }

  rankProviders(input: Split402RouterExecuteInput): Split402CapabilityProvider[] {
    assertExecuteInput(input);
    const maxAmount = readAtomicAmount(
      input.budget.maxAmountAtomic,
      "budget.maxAmountAtomic"
    );
    return this.providers
      .filter((provider) => provider.capability === input.capability)
      .filter((provider) => provider.network === input.budget.network)
      .filter((provider) => provider.asset === input.budget.asset)
      .filter((provider) => readAtomicAmount(provider.amountAtomic, "provider.amountAtomic") <= maxAmount)
      .sort(compareProviders);
  }

  async execute<T = unknown>(
    input: Split402RouterExecuteInput
  ): Promise<Split402RouterExecuteResult<T>> {
    assertExecuteInput(input);
    const availableForCapability = this.providers.filter(
      (provider) =>
        provider.capability === input.capability &&
        provider.network === input.budget.network &&
        provider.asset === input.budget.asset
    );
    if (availableForCapability.length === 0) {
      throw new Split402RouterError(
        "unsupported_capability",
        `no providers support ${input.capability} on ${input.budget.network}/${input.budget.asset}`
      );
    }

    const providers = this.rankProviders(input);
    if (providers.length === 0) {
      throw new Split402RouterError(
        "budget_exceeded",
        `all providers for ${input.capability} exceed the requested budget`
      );
    }

    const maxAttempts = normalizeMaxAttempts(input.maxAttempts, providers.length);
    const attempts: Split402RouterAttempt[] = [];
    for (const provider of providers.slice(0, maxAttempts)) {
      try {
        const result = await this.executor.execute({
          provider,
          body: input.input,
          ...(input.referralClaim === undefined
            ? {}
            : { referralClaim: input.referralClaim }),
          ...(this.signer === undefined ? {} : { signer: this.signer })
        });
        const receipt = this.verifyProviderReceipt(provider, result.receipt);
        attempts.push({
          providerId: provider.providerId,
          capability: provider.capability,
          status: "success",
          retryable: false,
          receiptId: receipt.receiptId
        });
        return {
          providerId: provider.providerId,
          capability: provider.capability,
          data: result.data as T,
          receipt,
          attempts
        };
      } catch (error) {
        const retryable = isRetryableProviderError(error);
        attempts.push({
          providerId: provider.providerId,
          capability: provider.capability,
          status: "failed",
          retryable,
          error: errorMessage(error)
        });
        if (!retryable) {
          throw new Split402RouterError(
            "execution_failed",
            `provider ${provider.providerId} failed with a non-retryable error: ${errorMessage(error)}`,
            attempts
          );
        }
      }
    }

    throw new Split402RouterError(
      "execution_failed",
      `all attempted providers failed for ${input.capability}`,
      attempts
    );
  }

  private verifyProviderReceipt(
    provider: Split402CapabilityProvider,
    value: Split402ReceiptV1 | undefined
  ): Split402ReceiptV1 {
    if (value === undefined) {
      throw new Split402RouterProviderError("missing Split402 receipt", {
        retryable: true
      });
    }
    const parsed = Split402ReceiptV1Schema.safeParse(value);
    if (!parsed.success) {
      throw new Split402RouterProviderError(
        `invalid Split402 receipt schema: ${parsed.error.issues
          .map((issue) => issue.message)
          .join("; ")}`,
        { retryable: true }
      );
    }
    const receipt = parsed.data;
    const errors = validateReceiptMatchesProvider(receipt, provider);
    if (this.verifyReceipts) {
      if (provider.merchantPublicKey === undefined) {
        errors.push("provider merchantPublicKey is required for receipt verification");
      } else {
        const verification = verifySplit402Receipt(
          receipt,
          provider.merchantPublicKey
        );
        errors.push(...verification.errors);
      }
    }
    if (errors.length > 0) {
      throw new Split402RouterProviderError(
        `invalid Split402 receipt: ${errors.join("; ")}`,
        { retryable: true }
      );
    }
    return receipt;
  }
}

export class Split402AgentSdkExecutor implements Split402RouterExecutor {
  async execute(input: {
    provider: Split402CapabilityProvider;
    body: unknown;
    referralClaim?: ReferralClaimV1;
    signer?: KeyPairSigner;
  }): Promise<Split402RouterExecutorResult> {
    const client = new Split402AgentClient({
      merchantOrigin: input.provider.merchantOrigin,
      network: input.provider.network as `${string}:${string}`,
      ...(input.provider.merchantPublicKey === undefined
        ? {}
        : { merchantPublicKey: input.provider.merchantPublicKey }),
      ...(input.signer === undefined ? {} : { signer: input.signer })
    });
    const offer = await client.inspectOffer({
      path: input.provider.path,
      method: input.provider.method,
      body: input.body
    });
    if (offer.verification.checked && !offer.verification.ok) {
      throw new Split402RouterProviderError(
        `invalid Split402 offer: ${offer.verification.errors.join("; ")}`,
        { retryable: true }
      );
    }
    const offerErrors = validateOfferMatchesProvider(offer.offer, input.provider);
    if (offerErrors.length > 0) {
      throw new Split402RouterProviderError(
        `Split402 offer does not match provider: ${offerErrors.join("; ")}`,
        { retryable: true }
      );
    }
    return client.postJson({
      path: input.provider.path,
      body: input.body,
      ...(input.referralClaim === undefined
        ? {}
        : { referralClaim: input.referralClaim })
    });
  }
}

function compareProviders(
  left: Split402CapabilityProvider,
  right: Split402CapabilityProvider
): number {
  return (
    readReliabilityBps(right) - readReliabilityBps(left) ||
    compareAtomicAmount(left.amountAtomic, right.amountAtomic) ||
    readMedianLatency(left) - readMedianLatency(right) ||
    left.providerId.localeCompare(right.providerId)
  );
}

function validateOfferMatchesProvider(
  offer: {
    merchantId: string;
    resourceOrigin: string;
    operationId: string;
    campaignId: string;
    network: string;
    asset: string;
    requiredAmountAtomic: string;
  },
  provider: Split402CapabilityProvider
): string[] {
  const errors: string[] = [];
  if (offer.resourceOrigin.replace(/\/+$/u, "") !== provider.merchantOrigin.replace(/\/+$/u, "")) {
    errors.push("offer resourceOrigin does not match provider merchantOrigin");
  }
  if (offer.operationId !== provider.operationId) {
    errors.push("offer operationId does not match provider operationId");
  }
  if (offer.campaignId !== provider.campaignId) {
    errors.push("offer campaignId does not match provider campaignId");
  }
  if (offer.network !== provider.network) {
    errors.push("offer network does not match provider network");
  }
  if (offer.asset !== provider.asset) {
    errors.push("offer asset does not match provider asset");
  }
  if (offer.requiredAmountAtomic !== provider.amountAtomic) {
    errors.push("offer requiredAmountAtomic does not match provider amountAtomic");
  }
  return errors;
}

function validateReceiptMatchesProvider(
  receipt: Split402ReceiptV1,
  provider: Split402CapabilityProvider
): string[] {
  return validateOfferMatchesProvider(
    {
      merchantId: receipt.merchantId,
      resourceOrigin: receipt.merchantOrigin,
      operationId: receipt.operationId,
      campaignId: receipt.campaignId,
      network: receipt.network,
      asset: receipt.asset,
      requiredAmountAtomic: receipt.requiredAmountAtomic
    },
    provider
  ).map((error) => error.replace(/^offer/u, "receipt"));
}

function readReliabilityBps(provider: Split402CapabilityProvider): number {
  return normalizeBps(provider.reliability?.successRateBps ?? 0);
}

function readMedianLatency(provider: Split402CapabilityProvider): number {
  const latency = provider.reliability?.medianLatencyMs;
  if (latency === undefined) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number.isFinite(latency) && latency >= 0
    ? latency
    : Number.MAX_SAFE_INTEGER;
}

function normalizeBps(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : 0;
}

function compareAtomicAmount(left: string, right: string): number {
  const leftAmount = readAtomicAmount(left, "amountAtomic");
  const rightAmount = readAtomicAmount(right, "amountAtomic");
  if (leftAmount === rightAmount) {
    return 0;
  }
  return leftAmount < rightAmount ? -1 : 1;
}

function assertExecuteInput(input: Split402RouterExecuteInput): void {
  if (input.capability.trim().length === 0) {
    throw new Split402RouterError("invalid_request", "capability is required");
  }
  if (typeof input.budget.network !== "string" || input.budget.network.length === 0) {
    throw new Split402RouterError("invalid_request", "budget.network is required");
  }
  if (typeof input.budget.asset !== "string" || input.budget.asset.length === 0) {
    throw new Split402RouterError("invalid_request", "budget.asset is required");
  }
  readAtomicAmount(input.budget.maxAmountAtomic, "budget.maxAmountAtomic");
}

function normalizeMaxAttempts(
  value: number | undefined,
  providerCount: number
): number {
  if (value === undefined) {
    return providerCount;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Split402RouterError(
      "invalid_request",
      "maxAttempts must be a positive integer"
    );
  }
  return Math.min(value, providerCount);
}

function readAtomicAmount(value: string, label: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Split402RouterError(
      "invalid_request",
      `${label} must be a non-negative atomic amount string`
    );
  }
  return BigInt(value);
}

function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof Split402RouterProviderError) {
    if (error.retryable !== undefined) {
      return error.retryable;
    }
    if (error.statusCode !== undefined) {
      return isRetryableStatus(error.statusCode);
    }
  }
  const status = readErrorStatus(error);
  if (status !== undefined) {
    return isRetryableStatus(status);
  }
  return true;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

function readErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const record = error as Record<string, unknown>;
  const status = record.status ?? record.statusCode;
  if (typeof status === "number") {
    return status;
  }
  const response = record.response;
  if (typeof response === "object" && response !== null) {
    const responseStatus = (response as Record<string, unknown>).status;
    if (typeof responseStatus === "number") {
      return responseStatus;
    }
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
