import {
  Split402AgentClient,
  type Split402EvmSchemeOptions,
  type Split402EvmSigner
} from "@split402/agent-sdk";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import {
  hashProtocolObject,
  ReferralClaimV1Schema,
  Split402OfferV1Schema,
  Split402ReceiptV1Schema,
  verifySplit402Offer,
  verifySplit402Receipt,
  type ReferralClaimV1,
  type Split402OfferV1,
  type Split402ReceiptV1
} from "@split402/protocol";
import type { KeyPairSigner } from "@solana/kit";

export interface Split402CapabilityProvider {
  providerId: string;
  capability: string;
  routeId?: string;
  merchantOrigin: string;
  path: string;
  method: Split402ProviderHttpMethod;
  operationId: string;
  campaignId: string;
  referralClaim?: ReferralClaimV1;
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
    discoverySource?: "static" | "control_plane" | "external_x402";
    inputSchema?: unknown;
    outputSchema?: unknown;
    referrerWallet?: string;
    payoutWallet?: string;
    mcpTools?: Split402ExternalX402McpTool[];
  };
}

export type Split402ProviderHttpMethod = "GET" | "POST";

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

export interface Split402RouterQuoteInput {
  capability: string;
  input?: unknown;
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
  provider: Split402CapabilityProvider;
  capability: string;
  data: T;
  receipt: Split402ReceiptV1;
  receiptRecording?: Split402ReceiptRecordingResult;
  attempts: Split402RouterAttempt[];
}

export interface Split402RouterQuoteProvider {
  rank: number;
  providerId: string;
  provider: Split402CapabilityProvider;
  amountAtomic: string;
  reliability: Split402CapabilityProvider["reliability"] | null;
}

export interface Split402RouterQuoteResult {
  capability: string;
  budget: Split402RouterQuoteInput["budget"];
  selectedProviderId: string;
  selectedProvider: Split402CapabilityProvider;
  quotedAmountAtomic: string;
  maxAttempts: number;
  rankedProviders: Split402RouterQuoteProvider[];
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
  evmSigner?: Split402EvmSigner;
  evmNetworks?: `${string}:${string}`[];
  evmSchemeOptions?: Split402EvmSchemeOptions;
  executor?: Split402RouterExecutor;
  svmRpcUrl?: string;
  verifyReceipts?: boolean;
  receiptRecorder?: Split402ReceiptRecorder;
}

export type Split402ReceiptIngestSource =
  | "buyer"
  | "merchant"
  | "relay"
  | "unknown";

export interface Split402ReceiptRecorderInput {
  provider: Split402CapabilityProvider;
  receipt: Split402ReceiptV1;
  referralClaim?: ReferralClaimV1;
}

export type Split402ReceiptRecordingStatus = "created" | "duplicate";

export interface Split402ReceiptRecordingResult {
  status: Split402ReceiptRecordingStatus;
  source: Split402ReceiptIngestSource;
}

export interface Split402ReceiptRecorder {
  record(
    input: Split402ReceiptRecorderInput
  ): Promise<Split402ReceiptRecordingResult | void> | Split402ReceiptRecordingResult | void;
}

export type Split402ReceiptRecorderFetch = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<Split402DiscoveryFetchResponse>;

export interface Split402ControlPlaneReceiptRecorderOptions {
  controlPlaneUrl: string;
  fetch?: Split402ReceiptRecorderFetch;
  bearerToken?: string;
  source?: Split402ReceiptIngestSource;
}

export type Split402DiscoveryFetch = (
  url: string,
  init?: {
    headers?: Record<string, string>;
  }
) => Promise<Split402DiscoveryFetchResponse>;

export interface Split402DiscoveryFetchResponse {
  status: number;
  headers?: {
    get?(name: string): string | null;
  } | Record<string, string>;
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

export type Split402ExternalX402DiscoveryFetch = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<Split402DiscoveryFetchResponse>;

export interface Split402ExternalX402DiscoveryOptions {
  merchantOrigin: string;
  fetch?: Split402ExternalX402DiscoveryFetch;
  providerIdPrefix?: string;
  merchantPublicKey?: string;
  capabilityMapper?: (
    candidate: Split402ExternalX402RouteDescriptor
  ) => string | undefined;
}

export interface Split402ExternalX402DiscoveryInput {
  capability?: string;
  includeFreeRoutes?: boolean;
}

export interface Split402ExternalX402RouteDescriptor {
  method: Split402ProviderHttpMethod;
  path: string;
  probePath: string;
  operationId: string;
  description?: string;
  price?: string;
  inputSchema?: unknown;
  mcpTools?: Split402ExternalX402McpTool[];
  source: {
    manifest: boolean;
    openapi: boolean;
  };
}

export interface Split402ExternalX402McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface Split402ExternalX402ProviderCandidate {
  providerId: string;
  capability: string;
  merchantOrigin: string;
  path: string;
  method: Split402ProviderHttpMethod;
  operationId: string;
  description?: string;
  price?: string;
  network?: string;
  asset?: string;
  payToWallet?: string;
  amountAtomic?: string;
  facilitator?: string;
  inputSchema?: unknown;
  mcpTools?: Split402ExternalX402McpTool[];
  split402Offer?: Split402OfferV1;
  split402OfferErrors?: string[];
  readiness:
    | "router_ready"
    | "requires_split402_campaign"
    | "incomplete_payment_metadata";
  blockers: string[];
  source: {
    manifest: boolean;
    openapi: boolean;
    paymentRequiredHeader: boolean;
  };
  provider?: Split402CapabilityProvider;
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
    output?: {
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
    evmSigner?: Split402EvmSigner;
    evmNetworks?: `${string}:${string}`[];
    evmSchemeOptions?: Split402EvmSchemeOptions;
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
  readonly receiptId?: string;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      retryable?: boolean;
      receiptId?: string;
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
    if (options.receiptId !== undefined) {
      this.receiptId = options.receiptId;
    }
  }
}

export class Split402Router {
  private readonly providers: readonly Split402CapabilityProvider[];
  private readonly executor: Split402RouterExecutor;
  private readonly signer?: KeyPairSigner;
  private readonly evmSigner?: Split402EvmSigner;
  private readonly evmNetworks?: `${string}:${string}`[];
  private readonly evmSchemeOptions?: Split402EvmSchemeOptions;
  private readonly verifyReceipts: boolean;
  private readonly receiptRecorder?: Split402ReceiptRecorder;

  constructor(options: Split402RouterOptions) {
    this.providers = [...options.providers];
    this.executor =
      options.executor ??
      new Split402AgentSdkExecutor(
        options.svmRpcUrl === undefined ? {} : { svmRpcUrl: options.svmRpcUrl }
      );
    this.verifyReceipts = options.verifyReceipts ?? true;
    if (options.receiptRecorder !== undefined) {
      this.receiptRecorder = options.receiptRecorder;
    }
    if (options.signer !== undefined) {
      this.signer = options.signer;
    }
    if (options.evmSigner !== undefined) {
      this.evmSigner = options.evmSigner;
    }
    if (options.evmNetworks !== undefined) {
      this.evmNetworks = [...options.evmNetworks];
    }
    if (options.evmSchemeOptions !== undefined) {
      this.evmSchemeOptions = options.evmSchemeOptions;
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

  rankProviders(input: Split402RouterQuoteInput): Split402CapabilityProvider[] {
    assertQuoteInput(input);
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

  quoteExecution(input: Split402RouterQuoteInput): Split402RouterQuoteResult {
    assertQuoteInput(input);
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

    const inputEligibleProviders =
      input.input === undefined
        ? eligibleProviders
        : eligibleProviders.filter(
            (provider) =>
              validateInputAgainstProviderSchema(provider, input.input).length === 0
          );
    if (inputEligibleProviders.length === 0) {
      throw new Split402RouterError(
        "invalid_request",
        `input does not match any provider inputSchema for ${input.capability}`,
        eligibleProviders.map((provider) => ({
          providerId: provider.providerId,
          capability: provider.capability,
          status: "failed",
          retryable: false,
          error: validateInputAgainstProviderSchema(provider, input.input).join("; ")
        }))
      );
    }

    const maxAttempts = normalizeMaxAttempts(
      input.maxAttempts,
      inputEligibleProviders.length
    );
    const rankedProviders = inputEligibleProviders
      .slice(0, maxAttempts)
      .map((provider, index) => ({
        rank: index + 1,
        providerId: provider.providerId,
        provider,
        amountAtomic: provider.amountAtomic,
        reliability: provider.reliability ?? null
      }));
    const selectedProvider = rankedProviders[0]!.provider;

    return {
      capability: input.capability,
      budget: input.budget,
      selectedProviderId: selectedProvider.providerId,
      selectedProvider,
      quotedAmountAtomic: selectedProvider.amountAtomic,
      maxAttempts,
      rankedProviders
    };
  }

  async execute<T = unknown>(
    input: Split402RouterExecuteInput
  ): Promise<Split402RouterExecuteResult<T>> {
    assertExecuteInput(input);
    const quote = this.quoteExecution(input);
    const attempts: Split402RouterAttempt[] = [];
    for (const { provider } of quote.rankedProviders) {
      try {
        const referralClaim = input.referralClaim ?? provider.referralClaim;
        const result = await this.executor.execute({
          provider,
          body: input.input,
          ...(referralClaim === undefined
            ? {}
            : { referralClaim }),
          ...(this.signer === undefined ? {} : { signer: this.signer }),
          ...(this.evmSigner === undefined ? {} : { evmSigner: this.evmSigner }),
          ...(this.evmNetworks === undefined
            ? {}
            : { evmNetworks: this.evmNetworks }),
          ...(this.evmSchemeOptions === undefined
            ? {}
            : { evmSchemeOptions: this.evmSchemeOptions })
        });
        const receipt = this.verifyProviderReceipt(
          provider,
          result.receipt,
          referralClaim
        );
        const receiptRecording = await this.recordProviderReceipt(
          provider,
          receipt,
          referralClaim
        );
        validateOutputAgainstProviderSchema(provider, result.data, receipt);
        attempts.push({
          providerId: provider.providerId,
          capability: provider.capability,
          status: "success",
          retryable: false,
          receiptId: receipt.receiptId
        });
        return {
          providerId: provider.providerId,
          provider,
          capability: provider.capability,
          data: result.data as T,
          receipt,
          ...(receiptRecording === undefined ? {} : { receiptRecording }),
          attempts
        };
      } catch (error) {
        const retryable = isRetryableProviderError(error);
        attempts.push({
          providerId: provider.providerId,
          capability: provider.capability,
          status: "failed",
          retryable,
          error: errorMessage(error),
          ...(error instanceof Split402RouterProviderError &&
          error.receiptId !== undefined
            ? { receiptId: error.receiptId }
            : {})
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
      ...validateReceiptMatchesProviderRouteMetadata(receipt, provider),
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

  private async recordProviderReceipt(
    provider: Split402CapabilityProvider,
    receipt: Split402ReceiptV1,
    referralClaim: ReferralClaimV1 | undefined
  ): Promise<Split402ReceiptRecordingResult | undefined> {
    if (this.receiptRecorder === undefined) {
      return undefined;
    }
    try {
      const result = await this.receiptRecorder.record({
        provider,
        receipt,
        ...(referralClaim === undefined ? {} : { referralClaim })
      });
      return result === undefined ? undefined : result;
    } catch (error) {
      throw new Split402RouterProviderError(
        `failed to record Split402 receipt: ${errorMessage(error)}`,
        {
          retryable: false,
          receiptId: receipt.receiptId
        }
      );
    }
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
  private readonly routeReferralClaimsByRouteId = new Map<
    string,
    ReferralClaimV1 | undefined
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
    const method = parseProviderHttpMethod(resource.metadata.method);
    if (method === undefined) {
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
    const routeId = resource.metadata.split402.routeId;
    const referralClaim = await this.resolveRouteReferralClaim(routeId);
    return {
      providerId: [
        routeId,
        resource.metadata.operationId
      ].join(":"),
      capability,
      routeId,
      merchantOrigin: resourceUrl.origin,
      path: `${resourceUrl.pathname}${resourceUrl.search}`,
      method,
      operationId: resource.metadata.operationId,
      campaignId: resource.metadata.split402.campaignId,
      ...(referralClaim === undefined ? {} : { referralClaim }),
      ...(merchantPublicKey === undefined ? {} : { merchantPublicKey }),
      network: accept.network,
      asset: accept.asset,
      payToWallet: accept.payTo,
      amountAtomic: accept.amount,
      metadata: {
        discoverySource: "control_plane",
        ...(resource.metadata.input === undefined
          ? {}
          : { inputSchema: resource.metadata.input.schema }),
        ...(resource.metadata.output === undefined
          ? {}
          : { outputSchema: resource.metadata.output.schema }),
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

  private async resolveRouteReferralClaim(
    routeId: string
  ): Promise<ReferralClaimV1 | undefined> {
    if (this.routeReferralClaimsByRouteId.has(routeId)) {
      return this.routeReferralClaimsByRouteId.get(routeId);
    }
    const routeResponse = await this.getJson<{ route?: unknown }>(
      `/v1/routes/${encodeURIComponent(routeId)}`
    );
    const route = readRecord(routeResponse.route);
    const parsed = ReferralClaimV1Schema.safeParse(route?.claim);
    const value = parsed.success ? parsed.data : undefined;
    this.routeReferralClaimsByRouteId.set(routeId, value);
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

export class Split402ControlPlaneReceiptRecorder
  implements Split402ReceiptRecorder
{
  private readonly controlPlaneUrl: string;
  private readonly fetchJson: Split402ReceiptRecorderFetch;
  private readonly source: Split402ReceiptIngestSource;
  private readonly bearerToken?: string;

  constructor(options: Split402ControlPlaneReceiptRecorderOptions) {
    this.controlPlaneUrl = normalizeBaseUrl(options.controlPlaneUrl);
    this.fetchJson = options.fetch ?? defaultDiscoveryFetch;
    this.source = options.source ?? "buyer";
    if (options.bearerToken !== undefined) {
      this.bearerToken = options.bearerToken;
    }
  }

  async record(
    input: Split402ReceiptRecorderInput
  ): Promise<Split402ReceiptRecordingResult> {
    const url = new URL("/v1/receipts", this.controlPlaneUrl);
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (this.bearerToken !== undefined) {
      headers.authorization = `Bearer ${this.bearerToken}`;
    }
    const response = await this.fetchJson(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        receipt: input.receipt,
        source: this.source
      })
    });
    const body = await response.text();
    if (response.status < 200 || response.status >= 300) {
      if (
        response.status === 409 &&
        isDuplicateReceiptIdConflict(body, input.receipt.receiptId)
      ) {
        return { status: "duplicate", source: this.source };
      }
      throw new Error(
        `control-plane receipt ingestion failed with HTTP ${response.status}${formatReceiptRecorderErrorBody(body)}`
      );
    }
    const status = readReceiptRecorderResponseStatus(body);
    if (status !== "created" && status !== "duplicate") {
      throw new Error(
        `control-plane receipt ingestion returned unexpected status${formatReceiptRecorderErrorBody(body)}`
      );
    }
    return { status, source: this.source };
  }
}

export class Split402ExternalX402DiscoveryClient {
  private readonly merchantOrigin: string;
  private readonly fetchJson: Split402ExternalX402DiscoveryFetch;
  private readonly providerIdPrefix: string;
  private readonly merchantPublicKey?: string;
  private readonly capabilityMapper: (
    candidate: Split402ExternalX402RouteDescriptor
  ) => string | undefined;

  constructor(options: Split402ExternalX402DiscoveryOptions) {
    this.merchantOrigin = normalizeExternalMerchantOrigin(options.merchantOrigin);
    this.fetchJson = options.fetch ?? defaultDiscoveryFetch;
    this.providerIdPrefix =
      options.providerIdPrefix ?? new URL(this.merchantOrigin).hostname;
    this.capabilityMapper =
      options.capabilityMapper ??
      ((candidate) => `x402.${candidate.operationId}`);
    if (options.merchantPublicKey !== undefined) {
      this.merchantPublicKey = options.merchantPublicKey;
    }
  }

  async discoverCandidates(
    input: Split402ExternalX402DiscoveryInput = {}
  ): Promise<Split402ExternalX402ProviderCandidate[]> {
    const manifest = await this.getOptionalJson("/.well-known/x402");
    const openapi = await this.getOptionalJson("/openapi.json");
    const mcpToolCatalog = await this.getOptionalJson("/mcp/tools");
    const routes = collectExternalX402Routes({
      manifest,
      openapi,
      mcpToolCatalog,
      includeFreeRoutes: input.includeFreeRoutes === true
    });
    const candidates: Split402ExternalX402ProviderCandidate[] = [];
    for (const route of routes) {
      const capability = this.capabilityMapper(route);
      if (capability === undefined || capability.trim().length === 0) {
        continue;
      }
      if (input.capability !== undefined && capability !== input.capability) {
        continue;
      }
      candidates.push(await this.candidateFromRoute(route, capability));
    }
    return candidates.sort((left, right) =>
      left.providerId.localeCompare(right.providerId)
    );
  }

  private async candidateFromRoute(
    route: Split402ExternalX402RouteDescriptor,
    capability: string
  ): Promise<Split402ExternalX402ProviderCandidate> {
    const probe = await this.probePaymentRequired(route);
    const paymentRequired = probe.paymentRequired;
    const accept = selectExactPaymentRequirement(paymentRequired);
    const split402OfferResult = parseSplit402OfferFromPaymentRequired(paymentRequired);
    const split402Offer = split402OfferResult.offer;
    const network = accept?.network;
    const asset = accept?.asset;
    const payToWallet = accept?.payTo;
    const amountAtomic = accept?.amount;
    const facilitator = readOptionalString(readRecord(accept)?.facilitator);
    const blockers: string[] = [];
    if (
      network === undefined ||
      asset === undefined ||
      payToWallet === undefined ||
      amountAtomic === undefined ||
      readOptionalAtomicAmount(amountAtomic) === undefined
    ) {
      blockers.push("missing complete x402 exact payment metadata");
    }
    if (!split402OfferResult.present) {
      blockers.push("missing Split402 offer extension");
    } else if (split402Offer === undefined) {
      blockers.push("invalid Split402 offer extension");
    }
    if (split402Offer !== undefined) {
      split402OfferResult.errors.push(
        ...verifySplit402OfferMatchesExternalX402Payment({
          offer: split402Offer,
          merchantOrigin: this.merchantOrigin,
          network,
          asset,
          payToWallet,
          amountAtomic
        })
      );
      if (split402OfferResult.errors.length > 0) {
        blockers.push("Split402 offer does not match x402 payment metadata");
      }
      if (this.merchantPublicKey === undefined) {
        split402OfferResult.errors.push(
          "merchantPublicKey: required to verify Split402 offer signature"
        );
        blockers.push("missing merchant public key for Split402 offer verification");
      } else {
        const offerVerification = verifySplit402Offer(
          split402Offer,
          this.merchantPublicKey
        );
        if (!offerVerification.ok) {
          split402OfferResult.errors.push(...offerVerification.errors);
          blockers.push("invalid Split402 offer signature");
        }
      }
    }
    const provider =
      blockers.length === 0 && split402Offer !== undefined
        ? this.providerFromSplit402Offer({
            route,
            capability,
            split402Offer,
            paymentPath: readPaymentResourcePath(paymentRequired) ?? route.probePath
          })
        : undefined;
    const readiness =
      provider !== undefined
        ? "router_ready"
        : blockers.some((blocker) => blocker.startsWith("missing complete"))
          ? "incomplete_payment_metadata"
          : "requires_split402_campaign";
    return {
      providerId: createExternalProviderId(this.providerIdPrefix, route),
      capability,
      merchantOrigin: this.merchantOrigin,
      path: readPaymentResourcePath(paymentRequired) ?? route.probePath,
      method: route.method,
      operationId: route.operationId,
      ...(route.description === undefined ? {} : { description: route.description }),
      ...(route.price === undefined ? {} : { price: route.price }),
      ...(network === undefined ? {} : { network }),
      ...(asset === undefined ? {} : { asset }),
      ...(payToWallet === undefined ? {} : { payToWallet }),
      ...(amountAtomic === undefined ? {} : { amountAtomic }),
      ...(facilitator === undefined ? {} : { facilitator }),
      ...(route.inputSchema === undefined ? {} : { inputSchema: route.inputSchema }),
      ...(route.mcpTools === undefined || route.mcpTools.length === 0
        ? {}
        : { mcpTools: route.mcpTools }),
      ...(split402Offer === undefined ? {} : { split402Offer }),
      ...(split402OfferResult.errors.length === 0
        ? {}
        : { split402OfferErrors: split402OfferResult.errors }),
      readiness,
      blockers,
      source: {
        manifest: route.source.manifest,
        openapi: route.source.openapi,
        paymentRequiredHeader: probe.paymentRequiredHeader
      },
      ...(provider === undefined ? {} : { provider })
    };
  }

  private providerFromSplit402Offer(input: {
    route: Split402ExternalX402RouteDescriptor;
    capability: string;
    split402Offer: Split402OfferV1;
    paymentPath: string;
  }): Split402CapabilityProvider {
    return {
      providerId: createExternalProviderId(this.providerIdPrefix, input.route),
      capability: input.capability,
      merchantOrigin: this.merchantOrigin,
      path: input.paymentPath,
      method: input.route.method,
      operationId: input.split402Offer.operationId,
      campaignId: input.split402Offer.campaignId,
      ...(this.merchantPublicKey === undefined
        ? {}
        : { merchantPublicKey: this.merchantPublicKey }),
      network: input.split402Offer.network,
      asset: input.split402Offer.asset,
      payToWallet: input.split402Offer.payToWallet,
      amountAtomic: input.split402Offer.requiredAmountAtomic,
      metadata: {
        discoverySource: "external_x402",
        ...(input.route.inputSchema === undefined
          ? {}
          : { inputSchema: input.route.inputSchema }),
        ...(input.route.mcpTools === undefined || input.route.mcpTools.length === 0
          ? {}
          : { mcpTools: input.route.mcpTools })
      }
    };
  }

  private async probePaymentRequired(
    route: Split402ExternalX402RouteDescriptor
  ): Promise<{
    paymentRequired?: PaymentRequired;
    paymentRequiredHeader: boolean;
  }> {
    const response = await this.fetchJson(
      new URL(route.probePath, this.merchantOrigin).toString(),
      {
        method: route.method,
        headers: {
          accept: "application/json",
          ...(route.method === "POST" ? { "content-type": "application/json" } : {})
        },
        ...(route.method === "POST" ? { body: "{}" } : {})
      }
    );
    const paymentRequiredHeader = readResponseHeader(
      response,
      "payment-required"
    );
    if (paymentRequiredHeader !== undefined) {
      return {
        paymentRequired: decodePaymentRequiredHeader(paymentRequiredHeader),
        paymentRequiredHeader: true
      };
    }
    const text = await response.text();
    const paymentRequired = parsePaymentRequiredBody(text);
    return {
      ...(paymentRequired === undefined ? {} : { paymentRequired }),
      paymentRequiredHeader: false
    };
  }

  private async getOptionalJson(path: string): Promise<unknown> {
    const response = await this.fetchJson(new URL(path, this.merchantOrigin).toString(), {
      headers: { accept: "application/json" }
    });
    if (response.status < 200 || response.status >= 300) {
      return undefined;
    }
    const text = await response.text();
    if (text.trim().length === 0) {
      return undefined;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }
}

export interface Split402AgentSdkExecutorOptions {
  svmRpcUrl?: string;
}

export class Split402AgentSdkExecutor implements Split402RouterExecutor {
  constructor(readonly options: Split402AgentSdkExecutorOptions = {}) {}

  async execute(input: {
    provider: Split402CapabilityProvider;
    body: unknown;
    referralClaim?: ReferralClaimV1;
    signer?: KeyPairSigner;
    evmSigner?: Split402EvmSigner;
    evmNetworks?: `${string}:${string}`[];
    evmSchemeOptions?: Split402EvmSchemeOptions;
  }): Promise<Split402RouterExecutorResult> {
    const client = new Split402AgentClient({
      merchantOrigin: input.provider.merchantOrigin,
      network: input.provider.network as `${string}:${string}`,
      ...(this.options.svmRpcUrl === undefined
        ? {}
        : { svmRpcUrl: this.options.svmRpcUrl }),
      ...(input.provider.merchantPublicKey === undefined
        ? {}
        : { merchantPublicKey: input.provider.merchantPublicKey }),
      ...(input.signer === undefined ? {} : { signer: input.signer }),
      ...(input.evmSigner === undefined ? {} : { evmSigner: input.evmSigner }),
      ...(input.evmNetworks === undefined
        ? {}
        : { evmNetworks: input.evmNetworks }),
      ...(input.evmSchemeOptions === undefined
        ? {}
        : { evmSchemeOptions: input.evmSchemeOptions })
    });
    const getQuery = inputToQuery(input.body);
    const offer = await client.inspectOffer({
      path: input.provider.path,
      method: input.provider.method,
      ...(input.provider.method === "GET"
        ? getQuery === undefined
          ? {}
          : { query: getQuery }
        : { body: input.body })
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
    if (input.provider.method === "GET") {
      return client.getJson({
        path: input.provider.path,
        ...(getQuery === undefined ? {} : { query: getQuery }),
        ...(input.referralClaim === undefined
          ? {}
          : { referralClaim: input.referralClaim })
      });
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

function collectExternalX402Routes(input: {
  manifest: unknown;
  openapi: unknown;
  mcpToolCatalog: unknown;
  includeFreeRoutes: boolean;
}): Split402ExternalX402RouteDescriptor[] {
  const byKey = new Map<string, Split402ExternalX402RouteDescriptor>();
  for (const route of readManifestPaidRoutes(
    input.manifest,
    input.includeFreeRoutes
  )) {
    byKey.set(routeKey(route.method, route.path), route);
  }
  for (const route of readOpenApiPaidRoutes(input.openapi)) {
    const key = routeKey(route.method, route.path);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, route);
      continue;
    }
    byKey.set(key, {
      ...existing,
      probePath: existing.probePath ?? route.probePath,
      operationId: route.operationId,
      ...(existing.description === undefined && route.description !== undefined
        ? { description: route.description }
        : {}),
      ...(existing.inputSchema === undefined && route.inputSchema !== undefined
        ? { inputSchema: route.inputSchema }
        : {}),
      source: {
        manifest: existing.source.manifest || route.source.manifest,
        openapi: existing.source.openapi || route.source.openapi
      }
    });
  }
  const mcpGateway = readExternalMcpToolCatalog(input.mcpToolCatalog);
  if (mcpGateway !== undefined) {
    for (const [key, route] of byKey.entries()) {
      if (!routeMatchesMcpPaidCall(route, mcpGateway.paidCallPath)) {
        continue;
      }
      byKey.set(key, {
        ...route,
        ...(route.description === undefined
          ? { description: `Paid MCP gateway with ${mcpGateway.tools.length} tools.` }
          : {}),
        inputSchema: route.inputSchema ?? createMcpToolCallInputSchema(mcpGateway.tools),
        mcpTools: mcpGateway.tools
      });
    }
  }
  return [...byKey.values()];
}

function routeMatchesMcpPaidCall(
  route: Split402ExternalX402RouteDescriptor,
  paidCallPath: string | undefined
): boolean {
  if (paidCallPath !== undefined && route.path === paidCallPath) {
    return true;
  }
  return route.method === "POST" && route.path.toLowerCase() === "/mcp/call";
}

function readExternalMcpToolCatalog(
  value: unknown
): { paidCallPath?: string; tools: Split402ExternalX402McpTool[] } | undefined {
  const catalog = readRecord(value);
  const tools = Array.isArray(catalog?.tools)
    ? catalog.tools.map(readExternalMcpTool).filter(isDefined)
    : [];
  if (tools.length === 0) {
    return undefined;
  }
  const payment = readRecord(catalog?.payment);
  const paidCallRoute = readOptionalString(payment?.paid_call_route);
  const paidCallPath =
    paidCallRoute === undefined
      ? undefined
      : normalizeExternalPathname(paidCallRoute);
  return {
    ...(paidCallPath === undefined ? {} : { paidCallPath }),
    tools
  };
}

function readExternalMcpTool(value: unknown): Split402ExternalX402McpTool | undefined {
  const tool = readRecord(value);
  const name = readOptionalString(tool?.name);
  if (name === undefined) {
    return undefined;
  }
  const description = readOptionalString(tool?.description);
  const inputSchema = tool?.input_schema ?? tool?.inputSchema;
  return {
    name,
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { inputSchema })
  };
}

function createMcpToolCallInputSchema(
  tools: readonly Split402ExternalX402McpTool[]
): unknown {
  return {
    type: "object",
    properties: {
      tool: {
        type: "string",
        enum: tools.map((tool) => tool.name)
      },
      arguments: {
        type: "object",
        additionalProperties: true
      }
    },
    required: ["tool"],
    additionalProperties: true
  };
}

function normalizeExternalPathname(value: string): string | undefined {
  try {
    return new URL(value).pathname;
  } catch {
    return normalizeOpenApiPath(value);
  }
}

function readManifestPaidRoutes(
  value: unknown,
  includeFreeRoutes: boolean
): Split402ExternalX402RouteDescriptor[] {
  const manifest = readRecord(value);
  const paidRoutes = Array.isArray(manifest?.paid_routes)
    ? manifest.paid_routes
    : [];
  return paidRoutes
    .map(readRecord)
    .flatMap((route) => {
      const method = parseProviderHttpMethod(readOptionalString(route?.method));
      const path = normalizeOpenApiPath(readOptionalString(route?.path));
      const price = readOptionalString(route?.price);
      const description = readOptionalString(route?.description);
      if (
        method === undefined ||
        path === undefined ||
        (price?.toLowerCase() === "free" && !includeFreeRoutes)
      ) {
        return [];
      }
      return [
        {
          method,
          path,
          probePath: readExampleCurlPath(route?.example_unpaid_curl) ?? path,
          operationId: operationIdFromPath(method, path),
          ...(description === undefined ? {} : { description }),
          ...(price === undefined ? {} : { price }),
          source: {
            manifest: true,
            openapi: false
          }
        } satisfies Split402ExternalX402RouteDescriptor
      ];
    });
}

function readOpenApiPaidRoutes(
  value: unknown
): Split402ExternalX402RouteDescriptor[] {
  const openapi = readRecord(value);
  const paths = readRecord(openapi?.paths);
  if (paths === undefined) {
    return [];
  }
  const routes: Split402ExternalX402RouteDescriptor[] = [];
  for (const [path, pathItemValue] of Object.entries(paths)) {
    const normalizedPath = normalizeOpenApiPath(path);
    const pathItem = readRecord(pathItemValue);
    if (normalizedPath === undefined || pathItem === undefined) {
      continue;
    }
    for (const methodName of ["get", "post"] as const) {
      const method = parseProviderHttpMethod(methodName);
      const operation = readRecord(pathItem[methodName]);
      if (method === undefined || operation === undefined) {
        continue;
      }
      if (readRecord(operation["x-payment-info"]) === undefined) {
        continue;
      }
      const price = readOpenApiPrice(operation["x-payment-info"]);
      const description = readOptionalString(operation.description);
      const inputSchema = readOpenApiInputSchema(operation);
      routes.push({
        method,
        path: normalizedPath,
        probePath: materializeOpenApiPath(normalizedPath, operation),
        operationId:
          readOptionalString(operation.operationId) ??
          operationIdFromPath(method, normalizedPath),
        ...(description === undefined ? {} : { description }),
        ...(price === undefined ? {} : { price }),
        ...(inputSchema === undefined ? {} : { inputSchema }),
        source: {
          manifest: false,
          openapi: true
        }
      });
    }
  }
  return routes;
}

function readOpenApiPrice(value: unknown): string | undefined {
  const paymentInfo = readRecord(value);
  const price = readRecord(paymentInfo?.price);
  const amount = readOptionalString(price?.amount);
  const currency = readOptionalString(price?.currency);
  if (amount === undefined) {
    return undefined;
  }
  return currency === undefined ? amount : `${amount} ${currency}`;
}

function readOpenApiInputSchema(operation: Record<string, unknown>): unknown {
  const requestBody = readRecord(operation.requestBody);
  const content = readRecord(requestBody?.content);
  const json = readRecord(content?.["application/json"]);
  const bodySchema = json?.schema;
  if (bodySchema !== undefined) {
    return bodySchema;
  }
  const parameters = Array.isArray(operation.parameters)
    ? operation.parameters
    : [];
  if (parameters.length === 0) {
    return undefined;
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const parameterValue of parameters) {
    const parameter = readRecord(parameterValue);
    const name = readOptionalString(parameter?.name);
    if (name === undefined) {
      continue;
    }
    properties[name] = parameter?.schema ?? { type: "string" };
    if (parameter?.required === true) {
      required.push(name);
    }
  }
  return {
    type: "object",
    properties,
    ...(required.length === 0 ? {} : { required })
  };
}

function materializeOpenApiPath(
  path: string,
  operation: Record<string, unknown>
): string {
  let materialized = path;
  const parameters = Array.isArray(operation.parameters)
    ? operation.parameters
    : [];
  for (const parameterValue of parameters) {
    const parameter = readRecord(parameterValue);
    if (parameter?.in !== "path") {
      continue;
    }
    const name = readOptionalString(parameter.name);
    if (name === undefined) {
      continue;
    }
    const replacement = readOpenApiPathParameterReplacement(parameter, name);
    materialized = materialized.replace(
      `{${name}}`,
      encodeURIComponent(replacement)
    );
  }
  return materialized;
}

function readOpenApiPathParameterReplacement(
  parameter: Record<string, unknown>,
  name: string
): string {
  const schema = readRecord(parameter.schema);
  return (
    readStringLike(parameter.example) ??
    readOpenApiExamplesValue(parameter.examples) ??
    readStringLike(schema?.example) ??
    readOpenApiExamplesValue(schema?.examples) ??
    readStringLike(schema?.default) ??
    readStringLike(schema?.const) ??
    readFirstStringLike(schema?.enum) ??
    readNamedPathParameterFallback(name, schema) ??
    name
  );
}

function readOpenApiExamplesValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.map(readStringLike).find((item) => item !== undefined);
  }
  const examples = readRecord(value);
  if (examples === undefined) {
    return undefined;
  }
  for (const example of Object.values(examples)) {
    const record = readRecord(example);
    const candidate = readStringLike(record?.value) ?? readStringLike(example);
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
}

function readFirstStringLike(value: unknown): string | undefined {
  return Array.isArray(value)
    ? value.map(readStringLike).find((item) => item !== undefined)
    : undefined;
}

function readStringLike(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function readNamedPathParameterFallback(
  name: string,
  schema: Record<string, unknown> | undefined
): string | undefined {
  const normalized = name.toLowerCase();
  if (normalized === "coin" || normalized === "symbol" || normalized === "token") {
    return "btc";
  }
  if (normalized === "topic" || normalized === "query") {
    return "market";
  }
  if (normalized.endsWith("id") || normalized === "id") {
    return "sample-id";
  }
  if (schema?.type === "integer" || schema?.type === "number") {
    return "1";
  }
  if (schema?.type === "boolean") {
    return "true";
  }
  return undefined;
}

function parsePaymentRequiredBody(text: string): PaymentRequired | undefined {
  if (text.trim().length === 0) {
    return undefined;
  }
  try {
    const value = JSON.parse(text) as unknown;
    const record = readRecord(value);
    if (record?.x402Version !== 2) {
      return undefined;
    }
    const resource = readRecord(record.resource);
    if (resource === undefined) {
      return undefined;
    }
    const resourceUrl = readOptionalString(resource?.url);
    if (resourceUrl === undefined) {
      return undefined;
    }
    const resourceDescription = readOptionalString(resource.description);
    const resourceMimeType = readOptionalString(resource.mimeType);
    const extensions = readRecord(record.extensions);
    return {
      x402Version: 2,
      error: readOptionalString(record.error) ?? "Payment required",
      resource: {
        url: resourceUrl,
        ...(resourceDescription === undefined
          ? {}
          : { description: resourceDescription }),
        ...(resourceMimeType === undefined ? {} : { mimeType: resourceMimeType })
      },
      accepts: normalizePaymentAccepts(record.accepts),
      ...(extensions === undefined ? {} : { extensions })
    };
  } catch {
    return undefined;
  }
}

function normalizePaymentAccepts(value: unknown): PaymentRequired["accepts"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(readRecord)
    .flatMap((accept) => {
      const network = readOptionalString(accept?.network);
      const amount =
        readOptionalString(accept?.amount) ??
        parseUsdPriceToUsdcAtomic(readOptionalString(accept?.price));
      const asset = readOptionalString(accept?.asset);
      const payTo =
        readOptionalString(accept?.payTo) ?? readOptionalString(accept?.pay_to);
      if (
        accept?.scheme !== "exact" ||
        network === undefined ||
        amount === undefined ||
        asset === undefined ||
        payTo === undefined
      ) {
        return [];
      }
      return [
        {
          scheme: "exact",
          network: network as `${string}:${string}`,
          amount,
          asset,
          payTo,
          maxTimeoutSeconds:
            typeof accept.maxTimeoutSeconds === "number"
              ? accept.maxTimeoutSeconds
              : 300,
          extra: readRecord(accept.extra) ?? {}
        }
      ] satisfies PaymentRequired["accepts"];
    });
}

function selectExactPaymentRequirement(
  paymentRequired: PaymentRequired | undefined
): PaymentRequired["accepts"][number] | undefined {
  return paymentRequired?.accepts.find((accept) => accept.scheme === "exact");
}

function parseSplit402OfferFromPaymentRequired(
  paymentRequired: PaymentRequired | undefined
): {
  present: boolean;
  offer?: Split402OfferV1;
  errors: string[];
} {
  const split402 = readRecord(readRecord(paymentRequired?.extensions)?.split402);
  if (split402?.info === undefined) {
    return { present: false, errors: [] };
  }
  const parsed = Split402OfferV1Schema.safeParse(split402.info);
  if (parsed.success) {
    return { present: true, offer: parsed.data, errors: [] };
  }
  return {
    present: true,
    errors: parsed.error.issues.map((issue) => {
      const path = issue.path.length === 0 ? "info" : issue.path.join(".");
      return `${path}: ${issue.message}`;
    })
  };
}

function verifySplit402OfferMatchesExternalX402Payment(input: {
  offer: Split402OfferV1;
  merchantOrigin: string;
  network: string | undefined;
  asset: string | undefined;
  payToWallet: string | undefined;
  amountAtomic: string | undefined;
}): string[] {
  const errors: string[] = [];
  if (input.offer.resourceOrigin !== input.merchantOrigin) {
    errors.push(
      `resourceOrigin: expected ${input.merchantOrigin} from external merchant origin`
    );
  }
  if (input.network !== undefined && input.offer.network !== input.network) {
    errors.push(`network: expected ${input.network} from x402 exact payment metadata`);
  }
  if (input.asset !== undefined && input.offer.asset !== input.asset) {
    errors.push(`asset: expected ${input.asset} from x402 exact payment metadata`);
  }
  if (
    input.payToWallet !== undefined &&
    input.offer.payToWallet !== input.payToWallet
  ) {
    errors.push(
      `payToWallet: expected ${input.payToWallet} from x402 exact payment metadata`
    );
  }
  if (
    input.amountAtomic !== undefined &&
    input.offer.requiredAmountAtomic !== input.amountAtomic
  ) {
    errors.push(
      `requiredAmountAtomic: expected ${input.amountAtomic} from x402 exact payment metadata`
    );
  }
  return errors;
}

function readPaymentResourcePath(
  paymentRequired: PaymentRequired | undefined
): string | undefined {
  const resource = readRecord(paymentRequired?.resource);
  const url = readOptionalString(resource?.url);
  if (url === undefined) {
    return undefined;
  }
  return parseUrl(url)?.pathname;
}

function readResponseHeader(
  response: Split402DiscoveryFetchResponse,
  name: string
): string | undefined {
  const headers = readRecord(readRecord(response)?.headers);
  if (headers === undefined) {
    return undefined;
  }
  if (typeof (headers as { get?: unknown }).get === "function") {
    const value = (headers as { get(name: string): unknown }).get(name);
    return typeof value === "string" ? value : undefined;
  }
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName && typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function parseUsdPriceToUsdcAtomic(value: string | undefined): string | undefined {
  const match = /^\$?([0-9]+)(?:\.([0-9]{1,6}))?$/u.exec(value ?? "");
  if (match === null) {
    return undefined;
  }
  const whole = BigInt(match[1]!);
  const fractional = (match[2] ?? "").padEnd(6, "0");
  return (whole * 1_000_000n + BigInt(fractional)).toString();
}

function normalizeOpenApiPath(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function readExampleCurlPath(value: unknown): string | undefined {
  const command = readOptionalString(value);
  if (command === undefined) {
    return undefined;
  }
  const match = /https?:\/\/[^\s'"]+/iu.exec(command);
  if (match === null) {
    return undefined;
  }
  const url = parseUrl(match[0]);
  return url === undefined ? undefined : `${url.pathname}${url.search}`;
}

function operationIdFromPath(
  method: Split402ProviderHttpMethod,
  path: string
): string {
  const suffix = path
    .replace(/^\//u, "")
    .replace(/\{([^}]+)\}/gu, "$1")
    .split("/")
    .filter((segment) => segment.length > 0)
    .join(".");
  return `${method.toLowerCase()}.${suffix.length === 0 ? "root" : suffix}`;
}

function createExternalProviderId(
  prefix: string,
  route: Split402ExternalX402RouteDescriptor
): string {
  const normalizedPrefix = prefix.replace(/[^a-z0-9_.-]+/giu, "-");
  return `${normalizedPrefix}:${route.operationId}`;
}

function routeKey(method: Split402ProviderHttpMethod, path: string): string {
  return `${method} ${path}`;
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
  if (trimTrailingSlashes(offer.resourceOrigin) !== trimTrailingSlashes(provider.merchantOrigin)) {
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

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
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

function validateReceiptMatchesProviderRouteMetadata(
  receipt: Split402ReceiptV1,
  provider: Split402CapabilityProvider
): string[] {
  const errors: string[] = [];
  if (provider.routeId !== undefined && receipt.routeId !== provider.routeId) {
    errors.push("receipt routeId does not match provider routeId");
  }
  if (
    provider.metadata?.referrerWallet !== undefined &&
    receipt.referrerWallet !== provider.metadata.referrerWallet
  ) {
    errors.push("receipt referrerWallet does not match provider referrerWallet");
  }
  if (
    provider.metadata?.payoutWallet !== undefined &&
    receipt.payoutWallet !== provider.metadata.payoutWallet
  ) {
    errors.push("receipt payoutWallet does not match provider payoutWallet");
  }
  return errors;
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

function validateInputAgainstProviderSchema(
  provider: Split402CapabilityProvider,
  input: unknown
): string[] {
  if (provider.metadata?.inputSchema === undefined) {
    return [];
  }
  return validateJsonSchemaValue(input, provider.metadata.inputSchema, "input");
}

function validateOutputAgainstProviderSchema(
  provider: Split402CapabilityProvider,
  output: unknown,
  receipt: Split402ReceiptV1
): void {
  if (provider.metadata?.outputSchema === undefined) {
    return;
  }
  const errors = validateJsonSchemaValue(
    output,
    provider.metadata.outputSchema,
    "output"
  );
  if (errors.length > 0) {
    throw new Split402RouterProviderError(
      `invalid provider output: ${errors.join("; ")}`,
      {
        retryable: false,
        receiptId: receipt.receiptId
      }
    );
  }
}

function validateJsonSchemaValue(
  value: unknown,
  schema: unknown,
  path: string
): string[] {
  const record = readSchemaRecord(schema);
  if (record === undefined) {
    return [`${path} schema must be an object`];
  }
  const errors: string[] = [];
  if (record.const !== undefined && !schemaValuesEqual(value, record.const)) {
    errors.push(`${path} must equal the schema const value`);
  }
  const enumValues = record.enum;
  if (enumValues !== undefined) {
    if (!Array.isArray(enumValues)) {
      errors.push(`${path} enum must be an array`);
    } else if (!enumValues.some((allowed) => schemaValuesEqual(value, allowed))) {
      errors.push(`${path} must be one of the allowed enum values`);
    }
  }
  const schemaTypes = readSchemaTypes(record.type);
  if (schemaTypes === undefined) {
    errors.push(`${path} type is unsupported`);
  } else if (schemaTypes.length > 0 && !schemaTypes.some((type) => valueMatchesSchemaType(value, type))) {
    errors.push(`${path} must be ${schemaTypes.join(" or ")}`);
  }
  errors.push(...validateJsonSchemaCombinators(value, record, path));
  const hasObjectShape =
    schemaTypes?.includes("object") === true ||
    record.properties !== undefined ||
    record.required !== undefined ||
    record.additionalProperties !== undefined ||
    record.patternProperties !== undefined ||
    record.propertyNames !== undefined ||
    record.dependentRequired !== undefined ||
    record.dependentSchemas !== undefined ||
    record.minProperties !== undefined ||
    record.maxProperties !== undefined;
  if (hasObjectShape) {
    if (isJsonObject(value)) {
      errors.push(...validateJsonObjectShape(value, record, path));
    } else if (!valueMatchesExplicitNonTargetType(value, schemaTypes, "object")) {
      errors.push(`${path} must be an object`);
      return errors;
    }
  }
  const hasArrayShape =
    schemaTypes?.includes("array") === true ||
    record.items !== undefined ||
    record.minItems !== undefined ||
    record.maxItems !== undefined;
  if (hasArrayShape) {
    if (Array.isArray(value)) {
      errors.push(...validateJsonArrayShape(value, record, path));
    } else if (!valueMatchesExplicitNonTargetType(value, schemaTypes, "array")) {
      errors.push(`${path} must be an array`);
      return errors;
    }
  }
  if (!valueMatchesExplicitNonTargetType(value, schemaTypes, "string")) {
    errors.push(...validateJsonStringConstraints(value, record, path));
  }
  if (
    typeof value === "number" ||
    (!valueMatchesExplicitNonTargetType(value, schemaTypes, "number") &&
      !valueMatchesExplicitNonTargetType(value, schemaTypes, "integer"))
  ) {
    errors.push(...validateJsonNumberConstraints(value, record, path));
  }
  return errors;
}

function validateJsonObjectShape(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  path: string
): string[] {
  const errors: string[] = [];
  const properties =
    schema.properties === undefined ? undefined : readSchemaRecord(schema.properties);
  if (schema.properties !== undefined && properties === undefined) {
    errors.push(`${path} properties must be an object`);
  }
  const patternProperties = readPatternProperties(schema.patternProperties);
  if (schema.patternProperties !== undefined && patternProperties === undefined) {
    errors.push(`${path} patternProperties must be an object of schema objects`);
  }
  const propertyNames =
    schema.propertyNames === undefined
      ? undefined
      : readSchemaRecord(schema.propertyNames);
  if (schema.propertyNames !== undefined && propertyNames === undefined) {
    errors.push(`${path} propertyNames must be a schema object`);
  }
  const dependentRequired = readDependentRequired(schema.dependentRequired);
  if (
    schema.dependentRequired !== undefined &&
    dependentRequired === undefined
  ) {
    errors.push(
      `${path} dependentRequired must be an object of string arrays`
    );
  }
  const dependentSchemas = readDependentSchemas(schema.dependentSchemas);
  if (schema.dependentSchemas !== undefined && dependentSchemas === undefined) {
    errors.push(`${path} dependentSchemas must be an object of schema objects`);
  }
  const additionalProperties = readAdditionalPropertiesSchema(
    schema.additionalProperties
  );
  if (
    schema.additionalProperties !== undefined &&
    additionalProperties === undefined
  ) {
    errors.push(
      `${path} additionalProperties must be a boolean or schema object`
    );
  }
  const required = readRequiredSchemaProperties(schema.required);
  if (required === undefined) {
    errors.push(`${path} required must be an array of strings`);
  } else {
    for (const property of required) {
      if (!(property in value)) {
        errors.push(`${path}.${property} is required`);
      }
    }
  }
  if (dependentRequired !== undefined) {
    for (const [property, requiredProperties] of Object.entries(
      dependentRequired
    )) {
      if (property in value) {
        for (const requiredProperty of requiredProperties) {
          if (!(requiredProperty in value)) {
            errors.push(
              `${path}.${requiredProperty} is required when ${path}.${property} is present`
            );
          }
        }
      }
    }
  }
  if (dependentSchemas !== undefined) {
    for (const [property, dependentSchema] of Object.entries(dependentSchemas)) {
      if (property in value) {
        const dependentErrors = validateJsonSchemaValue(
          value,
          dependentSchema,
          path
        );
        if (dependentErrors.length > 0) {
          errors.push(
            `${path} must satisfy dependentSchema for ${path}.${property}: ${dependentErrors.join("; ")}`
          );
        }
      }
    }
  }
  if (propertyNames !== undefined) {
    for (const property of Object.keys(value)) {
      errors.push(
        ...validateJsonSchemaValue(property, propertyNames, `${path}.${property} name`)
      );
    }
  }
  if (schema.minProperties !== undefined) {
    const minProperties = readNonNegativeIntegerSchemaKeyword(schema.minProperties);
    if (minProperties === undefined) {
      errors.push(`${path} minProperties must be a non-negative integer`);
    } else if (Object.keys(value).length < minProperties) {
      errors.push(`${path} must contain at least ${minProperties} properties`);
    }
  }
  if (schema.maxProperties !== undefined) {
    const maxProperties = readNonNegativeIntegerSchemaKeyword(schema.maxProperties);
    if (maxProperties === undefined) {
      errors.push(`${path} maxProperties must be a non-negative integer`);
    } else if (Object.keys(value).length > maxProperties) {
      errors.push(`${path} must contain at most ${maxProperties} properties`);
    }
  }
  if (patternProperties !== undefined) {
    for (const [property, propertyValue] of Object.entries(value)) {
      for (const pattern of patternProperties) {
        if (pattern.regex.test(property)) {
          errors.push(
            ...validateJsonSchemaValue(
              propertyValue,
              pattern.schema,
              `${path}.${property}`
            )
          );
        }
      }
    }
  }
  if (properties !== undefined) {
    for (const [property, propertySchema] of Object.entries(properties)) {
      if (property in value) {
        errors.push(
          ...validateJsonSchemaValue(
            value[property],
            propertySchema,
            `${path}.${property}`
          )
        );
      }
    }
  }
  for (const property of Object.keys(value)) {
    if (propertyIsAdditional(property, properties, patternProperties)) {
      if (additionalProperties === false) {
        errors.push(`${path}.${property} is not allowed`);
      } else if (
        typeof additionalProperties === "object" &&
        additionalProperties !== null
      ) {
        errors.push(
          ...validateJsonSchemaValue(
            value[property],
            additionalProperties,
            `${path}.${property}`
          )
        );
      }
    }
  }
  return errors;
}

function validateJsonArrayShape(
  value: unknown[],
  schema: Record<string, unknown>,
  path: string
): string[] {
  const errors: string[] = [];
  if (schema.minItems !== undefined) {
    const minItems = readNonNegativeIntegerSchemaKeyword(schema.minItems);
    if (minItems === undefined) {
      errors.push(`${path} minItems must be a non-negative integer`);
    } else if (value.length < minItems) {
      errors.push(`${path} must contain at least ${minItems} items`);
    }
  }
  if (schema.maxItems !== undefined) {
    const maxItems = readNonNegativeIntegerSchemaKeyword(schema.maxItems);
    if (maxItems === undefined) {
      errors.push(`${path} maxItems must be a non-negative integer`);
    } else if (value.length > maxItems) {
      errors.push(`${path} must contain at most ${maxItems} items`);
    }
  }
  if (schema.uniqueItems !== undefined) {
    if (typeof schema.uniqueItems !== "boolean") {
      errors.push(`${path} uniqueItems must be a boolean`);
    } else if (schema.uniqueItems && !arrayItemsAreUnique(value)) {
      errors.push(`${path} items must be unique`);
    }
  }
  if (schema.items !== undefined) {
    const itemSchema = readSchemaRecord(schema.items);
    if (itemSchema === undefined) {
      errors.push(`${path} items must be a schema object`);
    } else {
      for (const [index, item] of value.entries()) {
        errors.push(...validateJsonSchemaValue(item, itemSchema, `${path}[${index}]`));
      }
    }
  }
  if (
    schema.contains !== undefined ||
    schema.minContains !== undefined ||
    schema.maxContains !== undefined
  ) {
    errors.push(...validateJsonArrayContains(value, schema, path));
  }
  return errors;
}

function validateJsonArrayContains(
  value: unknown[],
  schema: Record<string, unknown>,
  path: string
): string[] {
  const errors: string[] = [];
  const containsRequired =
    schema.contains !== undefined ||
    schema.minContains !== undefined ||
    schema.maxContains !== undefined;
  const contains = readSchemaRecord(schema.contains);
  if (containsRequired && contains === undefined) {
    errors.push(`${path} contains must be a schema object`);
  }
  const minContains =
    schema.minContains === undefined
      ? contains === undefined
        ? 0
        : 1
      : readNonNegativeIntegerSchemaKeyword(schema.minContains);
  if (schema.minContains !== undefined && minContains === undefined) {
    errors.push(`${path} minContains must be a non-negative integer`);
  }
  const maxContains =
    schema.maxContains === undefined
      ? undefined
      : readNonNegativeIntegerSchemaKeyword(schema.maxContains);
  if (schema.maxContains !== undefined && maxContains === undefined) {
    errors.push(`${path} maxContains must be a non-negative integer`);
  }
  if (
    contains === undefined ||
    minContains === undefined ||
    (schema.maxContains !== undefined && maxContains === undefined)
  ) {
    return errors;
  }
  const matchCount = value.filter(
    (item) => validateJsonSchemaValue(item, contains, path).length === 0
  ).length;
  if (matchCount < minContains) {
    errors.push(`${path} must contain at least ${minContains} matching items`);
  }
  if (maxContains !== undefined && matchCount > maxContains) {
    errors.push(`${path} must contain at most ${maxContains} matching items`);
  }
  return errors;
}

function validateJsonSchemaCombinators(
  value: unknown,
  schema: Record<string, unknown>,
  path: string
): string[] {
  const errors: string[] = [];
  if (schema.anyOf !== undefined) {
    const variants = readSchemaArrayKeyword(schema.anyOf);
    if (variants === undefined) {
      errors.push(`${path} anyOf must be a non-empty array of schema objects`);
    } else if (
      !variants.some(
        (variant) => validateJsonSchemaValue(value, variant, path).length === 0
      )
    ) {
      errors.push(`${path} must match at least one anyOf schema`);
    }
  }
  if (schema.oneOf !== undefined) {
    const variants = readSchemaArrayKeyword(schema.oneOf);
    if (variants === undefined) {
      errors.push(`${path} oneOf must be a non-empty array of schema objects`);
    } else {
      const matchCount = variants.filter(
        (variant) => validateJsonSchemaValue(value, variant, path).length === 0
      ).length;
      if (matchCount !== 1) {
        errors.push(`${path} must match exactly one oneOf schema`);
      }
    }
  }
  if (schema.allOf !== undefined) {
    const variants = readSchemaArrayKeyword(schema.allOf);
    if (variants === undefined) {
      errors.push(`${path} allOf must be a non-empty array of schema objects`);
    } else {
      for (const [index, variant] of variants.entries()) {
        const variantErrors = validateJsonSchemaValue(value, variant, path);
        if (variantErrors.length > 0) {
          errors.push(
            `${path} must match allOf schema ${index + 1}: ${variantErrors.join("; ")}`
          );
        }
      }
    }
  }
  if (
    schema.if !== undefined ||
    schema.then !== undefined ||
    schema.else !== undefined
  ) {
    errors.push(...validateJsonSchemaConditionals(value, schema, path));
  }
  if (schema.not !== undefined) {
    const excluded = readSchemaRecord(schema.not);
    if (excluded === undefined) {
      errors.push(`${path} not must be a schema object`);
    } else if (validateJsonSchemaValue(value, excluded, path).length === 0) {
      errors.push(`${path} must not match not schema`);
    }
  }
  return errors;
}

function validateJsonSchemaConditionals(
  value: unknown,
  schema: Record<string, unknown>,
  path: string
): string[] {
  const errors: string[] = [];
  const ifSchema = readSchemaRecord(schema.if);
  if (schema.if === undefined) {
    errors.push(`${path} if is required when then or else is present`);
  } else if (ifSchema === undefined) {
    errors.push(`${path} if must be a schema object`);
  }
  const thenSchema = readSchemaRecord(schema.then);
  if (schema.then !== undefined && thenSchema === undefined) {
    errors.push(`${path} then must be a schema object`);
  }
  const elseSchema = readSchemaRecord(schema.else);
  if (schema.else !== undefined && elseSchema === undefined) {
    errors.push(`${path} else must be a schema object`);
  }
  if (
    ifSchema === undefined ||
    (schema.then !== undefined && thenSchema === undefined) ||
    (schema.else !== undefined && elseSchema === undefined)
  ) {
    return errors;
  }
  const conditionMatches = validateJsonSchemaValue(value, ifSchema, path).length === 0;
  const branch = conditionMatches ? thenSchema : elseSchema;
  if (branch === undefined) {
    return errors;
  }
  const branchErrors = validateJsonSchemaValue(value, branch, path);
  if (branchErrors.length > 0) {
    errors.push(
      `${path} must satisfy ${conditionMatches ? "then" : "else"} schema: ${branchErrors.join("; ")}`
    );
  }
  return errors;
}

function readSchemaTypes(value: unknown): JsonSchemaType[] | undefined {
  if (value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    return isJsonSchemaType(value) ? [value] : undefined;
  }
  if (Array.isArray(value)) {
    const types = value.filter(isJsonSchemaType);
    return types.length === value.length ? types : undefined;
  }
  return undefined;
}

function readRequiredSchemaProperties(value: unknown): string[] | undefined {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function readSchemaArrayKeyword(
  value: unknown
): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const schemas = value.map(readSchemaRecord);
  return schemas.every((schema) => schema !== undefined)
    ? (schemas as Record<string, unknown>[])
    : undefined;
}

function readPatternProperties(
  value: unknown
): Array<{ regex: RegExp; schema: Record<string, unknown> }> | undefined {
  if (value === undefined) {
    return [];
  }
  const record = readSchemaRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const patterns: Array<{ regex: RegExp; schema: Record<string, unknown> }> = [];
  for (const [pattern, schemaValue] of Object.entries(record)) {
    const schema = readSchemaRecord(schemaValue);
    if (schema === undefined) {
      return undefined;
    }
    try {
      patterns.push({ regex: new RegExp(pattern, "u"), schema });
    } catch {
      return undefined;
    }
  }
  return patterns;
}

function readDependentRequired(
  value: unknown
): Record<string, string[]> | undefined {
  if (value === undefined) {
    return {};
  }
  const record = readSchemaRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const dependencies: Record<string, string[]> = {};
  for (const [property, requiredProperties] of Object.entries(record)) {
    if (
      !Array.isArray(requiredProperties) ||
      !requiredProperties.every((item) => typeof item === "string")
    ) {
      return undefined;
    }
    dependencies[property] = requiredProperties;
  }
  return dependencies;
}

function readDependentSchemas(
  value: unknown
): Record<string, Record<string, unknown>> | undefined {
  if (value === undefined) {
    return {};
  }
  const record = readSchemaRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const dependencies: Record<string, Record<string, unknown>> = {};
  for (const [property, schema] of Object.entries(record)) {
    const schemaRecord = readSchemaRecord(schema);
    if (schemaRecord === undefined) {
      return undefined;
    }
    dependencies[property] = schemaRecord;
  }
  return dependencies;
}

function propertyMatchesPatternProperties(
  property: string,
  patternProperties:
    | Array<{ regex: RegExp; schema: Record<string, unknown> }>
    | undefined
): boolean {
  return patternProperties?.some((pattern) => pattern.regex.test(property)) ?? false;
}

function propertyIsAdditional(
  property: string,
  properties: Record<string, unknown> | undefined,
  patternProperties:
    | Array<{ regex: RegExp; schema: Record<string, unknown> }>
    | undefined
): boolean {
  return (
    (properties === undefined || !(property in properties)) &&
    !propertyMatchesPatternProperties(property, patternProperties)
  );
}

function readAdditionalPropertiesSchema(
  value: unknown
): boolean | Record<string, unknown> | undefined {
  if (value === undefined) {
    return true;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return readSchemaRecord(value);
}

function validateJsonStringConstraints(
  value: unknown,
  schema: Record<string, unknown>,
  path: string
): string[] {
  const errors: string[] = [];
  if (schema.format !== undefined) {
    if (typeof schema.format !== "string") {
      errors.push(`${path} format must be a string`);
    } else {
      errors.push(...validateJsonStringFormat(value, schema.format, path));
    }
  }
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== "string") {
      errors.push(`${path} pattern must be a string`);
    } else if (typeof value !== "string") {
      errors.push(`${path} must be a string matching pattern`);
    } else {
      try {
        if (!new RegExp(schema.pattern, "u").test(value)) {
          errors.push(`${path} must match pattern ${schema.pattern}`);
        }
      } catch {
        errors.push(`${path} pattern must be a valid regular expression`);
      }
    }
  }
  if (schema.minLength !== undefined) {
    const minLength = readNonNegativeIntegerSchemaKeyword(schema.minLength);
    if (minLength === undefined) {
      errors.push(`${path} minLength must be a non-negative integer`);
    } else if (typeof value !== "string" || value.length < minLength) {
      errors.push(`${path} length must be at least ${minLength}`);
    }
  }
  if (schema.maxLength !== undefined) {
    const maxLength = readNonNegativeIntegerSchemaKeyword(schema.maxLength);
    if (maxLength === undefined) {
      errors.push(`${path} maxLength must be a non-negative integer`);
    } else if (typeof value !== "string" || value.length > maxLength) {
      errors.push(`${path} length must be at most ${maxLength}`);
    }
  }
  return errors;
}

function validateJsonStringFormat(
  value: unknown,
  format: string,
  path: string
): string[] {
  if (!isSupportedJsonStringFormat(format)) {
    return [`${path} format ${format} is unsupported`];
  }
  if (typeof value !== "string") {
    return [`${path} must be a string with format ${format}`];
  }
  switch (format) {
    case "date-time":
      return isDateTimeString(value)
        ? []
        : [`${path} must be a valid date-time string`];
    case "email":
      return isEmailString(value) ? [] : [`${path} must be a valid email string`];
    case "uri":
      return isAbsoluteUrlString(value) ? [] : [`${path} must be a valid URI`];
    case "url":
      return isHttpUrlString(value) ? [] : [`${path} must be a valid URL`];
    case "uuid":
      return isUuidString(value) ? [] : [`${path} must be a valid UUID`];
  }
}

function isSupportedJsonStringFormat(
  value: string
): value is "date-time" | "email" | "uri" | "url" | "uuid" {
  return (
    value === "date-time" ||
    value === "email" ||
    value === "uri" ||
    value === "url" ||
    value === "uuid"
  );
}

function isAbsoluteUrlString(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.length > 1;
  } catch {
    return false;
  }
}

function isHttpUrlString(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isUuidString(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value
  );
}

function isEmailString(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function isDateTimeString(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value
    ) && Number.isFinite(Date.parse(value))
  );
}

function validateJsonNumberConstraints(
  value: unknown,
  schema: Record<string, unknown>,
  path: string
): string[] {
  const errors: string[] = [];
  if (schema.minimum !== undefined) {
    if (typeof schema.minimum !== "number" || !Number.isFinite(schema.minimum)) {
      errors.push(`${path} minimum must be a finite number`);
    } else if (typeof value !== "number" || value < schema.minimum) {
      errors.push(`${path} must be at least ${schema.minimum}`);
    }
  }
  if (schema.maximum !== undefined) {
    if (typeof schema.maximum !== "number" || !Number.isFinite(schema.maximum)) {
      errors.push(`${path} maximum must be a finite number`);
    } else if (typeof value !== "number" || value > schema.maximum) {
      errors.push(`${path} must be at most ${schema.maximum}`);
    }
  }
  if (schema.exclusiveMinimum !== undefined) {
    if (
      typeof schema.exclusiveMinimum !== "number" ||
      !Number.isFinite(schema.exclusiveMinimum)
    ) {
      errors.push(`${path} exclusiveMinimum must be a finite number`);
    } else if (typeof value !== "number" || value <= schema.exclusiveMinimum) {
      errors.push(`${path} must be greater than ${schema.exclusiveMinimum}`);
    }
  }
  if (schema.exclusiveMaximum !== undefined) {
    if (
      typeof schema.exclusiveMaximum !== "number" ||
      !Number.isFinite(schema.exclusiveMaximum)
    ) {
      errors.push(`${path} exclusiveMaximum must be a finite number`);
    } else if (typeof value !== "number" || value >= schema.exclusiveMaximum) {
      errors.push(`${path} must be less than ${schema.exclusiveMaximum}`);
    }
  }
  if (schema.multipleOf !== undefined) {
    if (
      typeof schema.multipleOf !== "number" ||
      !Number.isFinite(schema.multipleOf) ||
      schema.multipleOf <= 0
    ) {
      errors.push(`${path} multipleOf must be a positive finite number`);
    } else if (
      typeof value !== "number" ||
      !numberIsMultipleOf(value, schema.multipleOf)
    ) {
      errors.push(`${path} must be a multiple of ${schema.multipleOf}`);
    }
  }
  return errors;
}

function readNonNegativeIntegerSchemaKeyword(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

type JsonSchemaType =
  | "array"
  | "boolean"
  | "integer"
  | "null"
  | "number"
  | "object"
  | "string";

function isJsonSchemaType(value: unknown): value is JsonSchemaType {
  return (
    value === "array" ||
    value === "boolean" ||
    value === "integer" ||
    value === "null" ||
    value === "number" ||
    value === "object" ||
    value === "string"
  );
}

function valueMatchesSchemaType(value: unknown, type: JsonSchemaType): boolean {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isJsonObject(value);
    case "string":
      return typeof value === "string";
  }
}

function valueMatchesExplicitNonTargetType(
  value: unknown,
  schemaTypes: JsonSchemaType[] | undefined,
  targetType: JsonSchemaType
): boolean {
  return (
    schemaTypes !== undefined &&
    schemaTypes.length > 0 &&
    schemaTypes.some(
      (type) => type !== targetType && valueMatchesSchemaType(value, type)
    )
  );
}

function schemaValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function arrayItemsAreUnique(value: readonly unknown[]): boolean {
  const seen = new Set<string>();
  for (const item of value) {
    const key = JSON.stringify(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
  }
  return true;
}

function numberIsMultipleOf(value: number, divisor: number): boolean {
  const quotient = value / divisor;
  return Number.isInteger(quotient) || Math.abs(quotient - Math.round(quotient)) < 1e-12;
}

function readSchemaRecord(value: unknown): Record<string, unknown> | undefined {
  return isJsonObject(value) ? value : undefined;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  assertQuoteInput(input);
}

function assertQuoteInput(input: Split402RouterQuoteInput): void {
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

function normalizeExternalMerchantOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Split402DiscoveryError("merchantOrigin must be an http(s) URL");
  }
  return url.origin;
}

async function defaultDiscoveryFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
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
  const output = readRecord(metadata?.output);
  const method = readOptionalString(metadata?.method);
  const operationId = readOptionalString(metadata?.operationId);
  const routeId = readOptionalString(split402?.routeId);
  const campaignId = readOptionalString(split402?.campaignId);
  const referrerWallet = readOptionalString(split402?.referrerWallet);
  const payoutWallet = readOptionalString(split402?.payoutWallet);
  const network = readOptionalString(accept?.network);
  const amount = readOptionalString(accept?.amount);
  const asset = readOptionalString(accept?.asset);
  const payTo = readOptionalString(accept?.payTo);
  if (
    resourceUrl === undefined ||
    accept?.scheme !== "exact" ||
    network === undefined ||
    amount === undefined ||
    readOptionalAtomicAmount(amount) === undefined ||
    asset === undefined ||
    payTo === undefined ||
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
        network,
        amount,
        asset,
        payTo
      }
    ],
    metadata: {
      method,
      operationId,
      ...(input === undefined || input.schema === undefined
        ? {}
        : { input: { schema: input.schema } }),
      ...(output === undefined || output.schema === undefined
        ? {}
        : { output: { schema: output.schema } }),
      split402: {
        routeId,
        campaignId,
        ...(referrerWallet === undefined ? {} : { referrerWallet }),
        ...(payoutWallet === undefined ? {} : { payoutWallet })
      }
    }
  };
}

function parseProviderHttpMethod(
  value: string | undefined
): Split402ProviderHttpMethod | undefined {
  const method = value?.toUpperCase();
  return method === "GET" || method === "POST" ? method : undefined;
}

function inputToQuery(input: unknown): Record<string, unknown> | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  return input as Record<string, unknown>;
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

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function formatReceiptRecorderErrorBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length === 0 ? "" : `: ${trimmed}`;
}

function readReceiptRecorderResponseStatus(
  body: string
): Split402ReceiptRecordingStatus | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const status = (parsed as { status?: unknown }).status;
    return status === "created" || status === "duplicate" ? status : undefined;
  } catch {
    return undefined;
  }
}

function isDuplicateReceiptIdConflict(body: string, receiptId: string): boolean {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return false;
    }
    const record = parsed as {
      status?: unknown;
      conflictField?: unknown;
      existingReceiptId?: unknown;
    };
    return (
      record.status === "conflict" &&
      record.conflictField === "receiptId" &&
      record.existingReceiptId === receiptId
    );
  } catch {
    return false;
  }
}
