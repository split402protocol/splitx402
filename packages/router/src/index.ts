import { Split402AgentClient } from "@split402/agent-sdk";
import {
  hashProtocolObject,
  Split402ReceiptV1Schema,
  verifySplit402Receipt,
  type ReferralClaimV1,
  type Split402ReceiptV1
} from "@split402/protocol";
import type { KeyPairSigner } from "@solana/kit";

export interface Split402CapabilityProvider {
  providerId: string;
  capability: string;
  routeId?: string;
  merchantOrigin: string;
  path: string;
  method: "POST";
  operationId: string;
  campaignId: string;
  merchantPublicKey?: string;
  network: string;
  asset: string;
  payToWallet: string;
  amountAtomic: string;
  reliability?: {
    successRateBps?: number;
    medianLatencyMs?: number;
  };
  metadata?: {
    inputSchema?: unknown;
    referrerWallet?: string;
    payoutWallet?: string;
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

export interface Split402RouterSearchInput {
  capability?: string;
  budget?: {
    network?: string;
    asset?: string;
    maxAmountAtomic?: string;
  };
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

export type Split402DiscoveryFetch = (
  url: string,
  init?: {
    headers?: Record<string, string>;
  }
) => Promise<Split402DiscoveryFetchResponse>;

export interface Split402DiscoveryFetchResponse {
  status: number;
  text(): Promise<string>;
}

export interface Split402ControlPlaneDiscoveryOptions {
  controlPlaneUrl: string;
  fetch?: Split402DiscoveryFetch;
  bearerToken?: string;
  capabilityMapper?: (resource: Split402BazaarResourceDiscoveryRecord) => string | undefined;
  requireMerchantPublicKey?: boolean;
  now?: () => Date;
}

export interface Split402ControlPlaneDiscoveryInput {
  capability?: string;
  resourceOrigin?: string;
  operationId?: string;
  limit?: number;
}

export interface Split402BazaarResourceDiscoveryRecord {
  schema: "split402.bazaar_resource.v1";
  resource: string;
  type: "http";
  x402Version: 2;
  accepts: [
    {
      scheme: "exact";
      network: string;
      amount: string;
      asset: string;
      payTo: string;
    },
  ];
  metadata: {
    method: string;
    operationId: string;
    input?: {
      schema: unknown;
    };
    split402: {
      routeId: string;
      campaignId: string;
      referrerWallet?: string;
      payoutWallet?: string;
    };
  };
}

export class Split402DiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Split402DiscoveryError";
  }
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

  searchCapabilities(
    input?: string | Split402RouterSearchInput
  ): Split402CapabilityProvider[] {
    const search = normalizeSearchInput(input);
    return this.providers
      .filter(
        (provider) =>
          search.capability === undefined ||
          provider.capability === search.capability
      )
      .filter(
        (provider) =>
          search.budget?.network === undefined ||
          provider.network === search.budget.network
      )
      .filter(
        (provider) =>
          search.budget?.asset === undefined ||
          provider.asset === search.budget.asset
      )
      .filter((provider) => readProviderAtomicAmount(provider) !== undefined)
      .filter((provider) => {
        if (search.budget?.maxAmountAtomic === undefined) {
          return true;
        }
        const providerAmount = readProviderAtomicAmount(provider);
        return (
          providerAmount !== undefined &&
          providerAmount <=
            readAtomicAmount(
              search.budget.maxAmountAtomic,
              "budget.maxAmountAtomic"
            )
        );
      })
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
      .filter((provider) => {
        const providerAmount = readProviderAtomicAmount(provider);
        return providerAmount !== undefined && providerAmount <= maxAmount;
      })
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

    const eligibleProviders = providers.filter(
      (provider) =>
        validateProviderAcceptsReferralClaim(provider, input.referralClaim)
          .length === 0
    );
    if (eligibleProviders.length === 0) {
      throw new Split402RouterError(
        "execution_failed",
        `no providers match the supplied referralClaim for ${input.capability}`,
        providers.map((provider) => ({
          providerId: provider.providerId,
          capability: provider.capability,
          status: "failed",
          retryable: false,
          error: `provider does not match referralClaim: ${validateProviderAcceptsReferralClaim(provider, input.referralClaim).join("; ")}`
        }))
      );
    }

    const maxAttempts = normalizeMaxAttempts(input.maxAttempts, eligibleProviders.length);
    const attempts: Split402RouterAttempt[] = [];
    for (const provider of eligibleProviders.slice(0, maxAttempts)) {
      try {
        const result = await this.executor.execute({
          provider,
          body: input.input,
          ...(input.referralClaim === undefined
            ? {}
            : { referralClaim: input.referralClaim }),
          ...(this.signer === undefined ? {} : { signer: this.signer })
        });
        const receipt = this.verifyProviderReceipt(
          provider,
          result.receipt,
          input.referralClaim
        );
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
    value: Split402ReceiptV1 | undefined,
    referralClaim: ReferralClaimV1 | undefined
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
    const errors = [
      ...validateReceiptMatchesProvider(receipt, provider),
      ...validateReceiptMatchesReferralClaim(receipt, referralClaim)
    ];
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

export class Split402ControlPlaneDiscoveryClient {
  private readonly controlPlaneUrl: string;
  private readonly fetchJson: Split402DiscoveryFetch;
  private readonly capabilityMapper: (
    resource: Split402BazaarResourceDiscoveryRecord
  ) => string | undefined;
  private readonly requireMerchantPublicKey: boolean;
  private readonly now: () => Date;
  private readonly bearerToken?: string;
  private readonly merchantPublicKeysByCampaignId = new Map<
    string,
    string | undefined
  >();

  constructor(options: Split402ControlPlaneDiscoveryOptions) {
    this.controlPlaneUrl = normalizeBaseUrl(options.controlPlaneUrl);
    this.fetchJson = options.fetch ?? defaultDiscoveryFetch;
    this.capabilityMapper =
      options.capabilityMapper ??
      ((resource) => resource.metadata.operationId);
    this.requireMerchantPublicKey = options.requireMerchantPublicKey ?? true;
    this.now = options.now ?? (() => new Date());
    if (options.bearerToken !== undefined) {
      this.bearerToken = options.bearerToken;
    }
  }

  async discoverProviders(
    input: Split402ControlPlaneDiscoveryInput = {}
  ): Promise<Split402CapabilityProvider[]> {
    const routesResponse = await this.getJson<{
      routes?: Array<{ id?: unknown; campaignId?: unknown }>;
    }>("/v1/routes/search", {
      status: "active",
      ...(input.resourceOrigin === undefined
        ? {}
        : { resourceOrigin: input.resourceOrigin }),
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
      ...(input.limit === undefined ? {} : { limit: String(input.limit) })
    });
    const routes = Array.isArray(routesResponse.routes)
      ? routesResponse.routes
      : [];
    const providers: Split402CapabilityProvider[] = [];
    for (const route of routes) {
      const routeId = readOptionalString(route.id);
      if (routeId === undefined) {
        continue;
      }
      const resources = await this.discoverRouteResources(routeId);
      for (const resource of resources) {
        const provider = await this.providerFromResource(resource);
        if (provider === undefined) {
          continue;
        }
        if (input.capability !== undefined && provider.capability !== input.capability) {
          continue;
        }
        providers.push(provider);
      }
    }
    return providers.sort(compareProviders);
  }

  private async discoverRouteResources(
    routeId: string
  ): Promise<Split402BazaarResourceDiscoveryRecord[]> {
    const response = await this.getJson<{ resources?: unknown[] }>(
      `/v1/routes/${encodeURIComponent(routeId)}/bazaar-resources`
    );
    const resources = Array.isArray(response.resources) ? response.resources : [];
    return resources
      .map(parseBazaarResource)
      .filter((resource): resource is Split402BazaarResourceDiscoveryRecord =>
        resource !== undefined
      );
  }

  private async providerFromResource(
    resource: Split402BazaarResourceDiscoveryRecord
  ): Promise<Split402CapabilityProvider | undefined> {
    const capability = this.capabilityMapper(resource);
    if (capability === undefined || capability.trim().length === 0) {
      return undefined;
    }
    const accept = resource.accepts[0];
    const method = resource.metadata.method.toUpperCase();
    if (method !== "POST") {
      return undefined;
    }
    const resourceUrl = parseUrl(resource.resource);
    if (resourceUrl === undefined) {
      return undefined;
    }
    const merchantPublicKey = await this.resolveMerchantPublicKey(
      resource.metadata.split402.campaignId
    );
    if (merchantPublicKey === undefined && this.requireMerchantPublicKey) {
      return undefined;
    }
    return {
      providerId: [
        resource.metadata.split402.routeId,
        resource.metadata.operationId
      ].join(":"),
      capability,
      routeId: resource.metadata.split402.routeId,
      merchantOrigin: resourceUrl.origin,
      path: `${resourceUrl.pathname}${resourceUrl.search}`,
      method: "POST",
      operationId: resource.metadata.operationId,
      campaignId: resource.metadata.split402.campaignId,
      ...(merchantPublicKey === undefined ? {} : { merchantPublicKey }),
      network: accept.network,
      asset: accept.asset,
      payToWallet: accept.payTo,
      amountAtomic: accept.amount,
      metadata: {
        ...(resource.metadata.input === undefined
          ? {}
          : { inputSchema: resource.metadata.input.schema }),
        ...(resource.metadata.split402.referrerWallet === undefined
          ? {}
          : { referrerWallet: resource.metadata.split402.referrerWallet }),
        ...(resource.metadata.split402.payoutWallet === undefined
          ? {}
          : { payoutWallet: resource.metadata.split402.payoutWallet })
      }
    };
  }

  private async resolveMerchantPublicKey(
    campaignId: string
  ): Promise<string | undefined> {
    if (this.merchantPublicKeysByCampaignId.has(campaignId)) {
      return this.merchantPublicKeysByCampaignId.get(campaignId);
    }
    const campaignResponse = await this.getJson<{ campaign?: unknown }>(
      `/v1/campaigns/${encodeURIComponent(campaignId)}`
    );
    const campaign = readRecord(campaignResponse.campaign);
    const merchantId = readOptionalString(campaign?.merchantId);
    const current = readRecord(campaign?.current);
    const merchantKid = readOptionalString(current?.merchantKid);
    if (merchantId === undefined || merchantKid === undefined) {
      this.merchantPublicKeysByCampaignId.set(campaignId, undefined);
      return undefined;
    }
    const merchantResponse = await this.getJson<{ merchant?: unknown }>(
      `/v1/merchants/${encodeURIComponent(merchantId)}`
    );
    const merchant = readRecord(merchantResponse.merchant);
    const keys = Array.isArray(merchant?.keys) ? merchant.keys : [];
    const now = this.now().getTime();
    const publicKey = keys
      .map(readRecord)
      .find((key) => isActiveOfferReceiptKey(key, merchantKid, now))?.publicKey;
    const value = readOptionalString(publicKey);
    this.merchantPublicKeysByCampaignId.set(campaignId, value);
    return value;
  }

  private async getJson<T>(
    path: string,
    query: Record<string, string> = {}
  ): Promise<T> {
    const url = new URL(path, this.controlPlaneUrl);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.bearerToken !== undefined) {
      headers.authorization = `Bearer ${this.bearerToken}`;
    }
    const response = await this.fetchJson(url.toString(), { headers });
    const text = await response.text();
    if (response.status < 200 || response.status >= 300) {
      throw new Split402DiscoveryError(
        `control plane request failed: ${response.status} ${url.pathname}`
      );
    }
    try {
      return (text.length === 0 ? {} : JSON.parse(text)) as T;
    } catch (error) {
      throw new Split402DiscoveryError(
        `control plane returned invalid JSON for ${url.pathname}: ${errorMessage(error)}`
      );
    }
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

function normalizeSearchInput(
  input: string | Split402RouterSearchInput | undefined
): Split402RouterSearchInput {
  if (typeof input === "string") {
    return input.length === 0 ? {} : { capability: input };
  }
  if (input === undefined) {
    return {};
  }
  if (input.capability !== undefined && input.capability.trim().length === 0) {
    throw new Split402RouterError("invalid_request", "capability must not be empty");
  }
  if (
    input.budget?.maxAmountAtomic !== undefined
  ) {
    readAtomicAmount(input.budget.maxAmountAtomic, "budget.maxAmountAtomic");
  }
  return input;
}

function validateOfferMatchesProvider(
  offer: {
    merchantId: string;
    resourceOrigin: string;
    operationId: string;
    campaignId: string;
    network: string;
    asset: string;
    payToWallet: string;
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
  if (offer.payToWallet !== provider.payToWallet) {
    errors.push("offer payToWallet does not match provider payToWallet");
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
      payToWallet: receipt.payToWallet,
      requiredAmountAtomic: receipt.requiredAmountAtomic
    },
    provider
  ).map((error) => error.replace(/^offer/u, "receipt"));
}

function validateProviderAcceptsReferralClaim(
  provider: Split402CapabilityProvider,
  referralClaim: ReferralClaimV1 | undefined
): string[] {
  if (referralClaim === undefined) {
    return [];
  }
  const errors: string[] = [];
  if (provider.routeId !== undefined && provider.routeId !== referralClaim.routeId) {
    errors.push("provider routeId does not match referralClaim routeId");
  }
  if (
    provider.metadata?.referrerWallet !== undefined &&
    provider.metadata.referrerWallet !== referralClaim.referrerWallet
  ) {
    errors.push("provider referrerWallet does not match referralClaim referrerWallet");
  }
  if (
    provider.metadata?.payoutWallet !== undefined &&
    provider.metadata.payoutWallet !== referralClaim.payoutWallet
  ) {
    errors.push("provider payoutWallet does not match referralClaim payoutWallet");
  }
  return errors;
}

function validateReceiptMatchesReferralClaim(
  receipt: Split402ReceiptV1,
  referralClaim: ReferralClaimV1 | undefined
): string[] {
  if (referralClaim === undefined) {
    return [];
  }
  const errors: string[] = [];
  const expectedHash = hashProtocolObject(referralClaim);
  if (receipt.routeId !== referralClaim.routeId) {
    errors.push("receipt routeId does not match referralClaim routeId");
  }
  if (receipt.referralClaimHash !== expectedHash) {
    errors.push("receipt referralClaimHash does not match referralClaim");
  }
  if (receipt.referrerWallet !== referralClaim.referrerWallet) {
    errors.push("receipt referrerWallet does not match referralClaim referrerWallet");
  }
  if (receipt.payoutWallet !== referralClaim.payoutWallet) {
    errors.push("receipt payoutWallet does not match referralClaim payoutWallet");
  }
  return errors;
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
  const leftAmount = readOptionalAtomicAmount(left);
  const rightAmount = readOptionalAtomicAmount(right);
  if (leftAmount === undefined && rightAmount === undefined) {
    return left.localeCompare(right);
  }
  if (leftAmount === undefined) {
    return 1;
  }
  if (rightAmount === undefined) {
    return -1;
  }
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

function readProviderAtomicAmount(
  provider: Split402CapabilityProvider
): bigint | undefined {
  return readOptionalAtomicAmount(provider.amountAtomic);
}

function readOptionalAtomicAmount(value: string): bigint | undefined {
  return /^(0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : undefined;
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

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Split402DiscoveryError("controlPlaneUrl must be an http(s) URL");
  }
  return url.toString();
}

async function defaultDiscoveryFetch(
  url: string,
  init?: {
    headers?: Record<string, string>;
  }
): Promise<Split402DiscoveryFetchResponse> {
  return fetch(url, init);
}

function parseBazaarResource(
  value: unknown
): Split402BazaarResourceDiscoveryRecord | undefined {
  const resource = readRecord(value);
  if (
    resource?.schema !== "split402.bazaar_resource.v1" ||
    resource.type !== "http" ||
    resource.x402Version !== 2
  ) {
    return undefined;
  }
  const resourceUrl = readOptionalString(resource.resource);
  const accepts = Array.isArray(resource.accepts) ? resource.accepts : [];
  const accept = readRecord(accepts[0]);
  const metadata = readRecord(resource.metadata);
  const split402 = readRecord(metadata?.split402);
  const input = readRecord(metadata?.input);
  const method = readOptionalString(metadata?.method);
  const operationId = readOptionalString(metadata?.operationId);
  const routeId = readOptionalString(split402?.routeId);
  const campaignId = readOptionalString(split402?.campaignId);
  const referrerWallet = readOptionalString(split402?.referrerWallet);
  const payoutWallet = readOptionalString(split402?.payoutWallet);
  if (
    resourceUrl === undefined ||
    accept?.scheme !== "exact" ||
    readOptionalString(accept.network) === undefined ||
    readOptionalString(accept.amount) === undefined ||
    readOptionalString(accept.asset) === undefined ||
    readOptionalString(accept.payTo) === undefined ||
    method === undefined ||
    operationId === undefined ||
    routeId === undefined ||
    campaignId === undefined
  ) {
    return undefined;
  }
  return {
    schema: "split402.bazaar_resource.v1",
    resource: resourceUrl,
    type: "http",
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: accept.network as string,
        amount: accept.amount as string,
        asset: accept.asset as string,
        payTo: accept.payTo as string
      }
    ],
    metadata: {
      method,
      operationId,
      ...(input === undefined || input.schema === undefined
        ? {}
        : { input: { schema: input.schema } }),
      split402: {
        routeId,
        campaignId,
        ...(referrerWallet === undefined ? {} : { referrerWallet }),
        ...(payoutWallet === undefined ? {} : { payoutWallet })
      }
    }
  };
}

function isActiveOfferReceiptKey(
  key: Record<string, unknown> | undefined,
  kid: string,
  nowMs: number
): key is Record<string, unknown> & { publicKey: string } {
  if (
    key === undefined ||
    key.kid !== kid ||
    key.purpose !== "offer_receipt" ||
    typeof key.publicKey !== "string" ||
    key.revokedAt !== undefined
  ) {
    return false;
  }
  const validFrom = readOptionalString(key.validFrom);
  if (validFrom !== undefined && Date.parse(validFrom) > nowMs) {
    return false;
  }
  const validUntil = readOptionalString(key.validUntil);
  return validUntil === undefined || Date.parse(validUntil) > nowMs;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
