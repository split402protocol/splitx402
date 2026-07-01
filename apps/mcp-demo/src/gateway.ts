import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { createSvmSignerFromBase58 } from "@split402/agent-sdk";
import {
  buildReceiptSigningBytes,
  calculateCommission,
  createSampleProtocolArtifacts,
  hashProtocolObject,
  hexToBytes,
  parseAtomicAmount,
  ReferralClaimV1Schema,
  serializeAtomicAmount,
  signEd25519Message,
  type ReferralClaimV1,
  type Split402ReceiptV1
} from "@split402/protocol";
import {
  Split402Router,
  Split402ControlPlaneDiscoveryClient,
  Split402ExternalX402DiscoveryClient,
  type Split402CapabilityProvider,
  type Split402DiscoveryFetch,
  type Split402ExternalX402DiscoveryFetch,
  type Split402ExternalX402ProviderCandidate,
  type Split402RouterExecuteResult,
  type Split402RouterExecutor
} from "@split402/router";

import {
  MCP_DEMO_DEFAULT_SERVICE_SEED_HEX,
  createMcpDemoBundle,
  type McpDemoBundle
} from "./index.js";

export interface McpGatewayRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export interface McpGatewayResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export interface McpGatewayToolResult {
  status: "payment_required";
  tool: string;
  wallet: string;
  merchant: McpDemoBundle["merchant"];
  paidHttpCall: Omit<
    McpDemoBundle["mcp"]["tools"][number]["paidHttpCall"],
    "bodyTemplate"
  > & {
    bodyTemplate: {
      wallet: string;
    };
  };
  x402: McpDemoBundle["mcp"]["tools"][number]["x402"];
  split402: McpDemoBundle["mcp"]["tools"][number]["split402"];
  expectedEconomics: McpDemoBundle["expectedEconomics"];
}

export interface McpGatewayContext {
  bundle: McpDemoBundle;
  router: Split402Router;
  receipts: Map<string, Split402ReceiptV1>;
  executionMode: "router-demo-mock" | "router-live-agent-sdk";
  externalDiscoveryFetch?: Split402ExternalX402DiscoveryFetch;
}

export interface McpGatewayRuntimeOptions {
  bundle?: McpDemoBundle;
  env?: NodeJS.ProcessEnv;
  fetch?: Split402DiscoveryFetch & Split402ExternalX402DiscoveryFetch;
  requireSigner?: boolean;
}

export function handleMcpGatewayLine(
  line: string,
  bundle: McpDemoBundle | McpGatewayContext = createMcpDemoBundle(),
): McpGatewayResponse | undefined {
  const response = handleParsedGatewayRequest(
    line,
    readGatewayContext(bundle),
    false
  );
  return response instanceof Promise
    ? createErrorResponse(null, -32603, "Use async gateway handler")
    : response;
}

export async function handleMcpGatewayLineAsync(
  line: string,
  context: McpGatewayContext = createMcpGatewayContext(),
): Promise<McpGatewayResponse | undefined> {
  const response = handleParsedGatewayRequest(line, context, true);
  return response instanceof Promise ? await response : response;
}

export function createMcpGatewayContext(
  bundle: McpDemoBundle = createMcpDemoBundle(),
  router: Split402Router = createMcpDemoRouter(bundle),
  executionMode: McpGatewayContext["executionMode"] = "router-demo-mock",
  externalDiscoveryFetch?: Split402ExternalX402DiscoveryFetch,
): McpGatewayContext {
  return {
    bundle,
    router,
    receipts: new Map(),
    executionMode,
    ...(externalDiscoveryFetch === undefined ? {} : { externalDiscoveryFetch })
  };
}

export async function createMcpGatewayContextFromEnv(
  options: McpGatewayRuntimeOptions = {}
): Promise<McpGatewayContext> {
  const env = options.env ?? process.env;
  const bundle = options.bundle ?? createMcpDemoBundle();
  const controlPlaneUrl = readOptionalEnvString(
    env.SPLIT402_MCP_CONTROL_PLANE_URL
  );
  if (controlPlaneUrl === undefined) {
    return createMcpGatewayContext(bundle);
  }

  const capabilityOverride = readOptionalEnvString(env.SPLIT402_MCP_CAPABILITY);
  const bearerToken = readOptionalEnvString(env.SPLIT402_MCP_CONTROL_PLANE_TOKEN);
  const discovery = new Split402ControlPlaneDiscoveryClient({
    controlPlaneUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(bearerToken === undefined ? {} : { bearerToken }),
    ...(capabilityOverride === undefined
      ? {}
      : { capabilityMapper: () => capabilityOverride })
  });
  const resourceOrigin = readOptionalEnvString(env.SPLIT402_MCP_RESOURCE_ORIGIN);
  const operationId = readOptionalEnvString(env.SPLIT402_MCP_OPERATION_ID);
  const limit = readOptionalPositiveInteger(env.SPLIT402_MCP_DISCOVERY_LIMIT);
  const providers = await discovery.discoverProviders({
    ...(capabilityOverride === undefined ? {} : { capability: capabilityOverride }),
    ...(resourceOrigin === undefined ? {} : { resourceOrigin }),
    ...(operationId === undefined ? {} : { operationId }),
    ...(limit === undefined ? {} : { limit })
  });
  const signerSecret =
    readOptionalEnvString(env.SPLIT402_MCP_SVM_PRIVATE_KEY) ??
    readOptionalEnvString(env.SVM_PRIVATE_KEY);
  if (options.requireSigner === true && signerSecret === undefined) {
    throw new Error(
      "SPLIT402_MCP_SVM_PRIVATE_KEY or SVM_PRIVATE_KEY is required for live MCP gateway execution"
    );
  }
  const signer =
    signerSecret === undefined
      ? undefined
      : await createSvmSignerFromBase58(signerSecret);
  return createMcpGatewayContext(
    bundle,
    new Split402Router({
      providers,
      ...(signer === undefined ? {} : { signer })
    }),
    "router-live-agent-sdk",
    options.fetch
  );
}

export function createMcpDemoRouter(
  bundle: McpDemoBundle = createMcpDemoBundle()
): Split402Router {
  return new Split402Router({
    providers: [createDemoProvider(bundle)],
    executor: createDemoRouterExecutor(bundle)
  });
}

export function createDemoProvider(
  bundle: McpDemoBundle
): Split402CapabilityProvider {
  const tool = bundle.mcp.tools[0];
  const sample = createSampleProtocolArtifacts();
  return {
    providerId: "split402-demo-merchant",
    capability: "solana.wallet-risk",
    routeId: sample.artifacts.receipt.routeId!,
    merchantOrigin: bundle.merchant.origin,
    path: new URL(tool.paidHttpCall.url).pathname,
    method: tool.paidHttpCall.method,
    operationId: tool.split402.operationId,
    campaignId: tool.split402.campaignId,
    merchantPublicKey: bundle.merchant.servicePublicKey,
    network: tool.x402.network,
    asset: tool.x402.asset,
    payToWallet: tool.x402.payToWallet,
    amountAtomic: tool.x402.amountAtomic,
    reliability: {
      successRateBps: 9500,
      medianLatencyMs: 250
    },
    metadata: {
      referrerWallet: sample.artifacts.receipt.referrerWallet!,
      payoutWallet: sample.artifacts.receipt.payoutWallet!
    }
  };
}

export function createWalletRiskToolResult(
  wallet: string,
  bundle: McpDemoBundle = createMcpDemoBundle(),
): McpGatewayToolResult {
  const tool = bundle.mcp.tools[0];
  return {
    status: "payment_required",
    tool: tool.name,
    wallet,
    merchant: bundle.merchant,
    paidHttpCall: {
      ...tool.paidHttpCall,
      bodyTemplate: {
        wallet
      }
    },
    x402: tool.x402,
    split402: tool.split402,
    expectedEconomics: bundle.expectedEconomics
  };
}

export async function runMcpGateway(
  input = process.stdin,
  output = process.stdout,
): Promise<void> {
  const context = await createMcpGatewayContextFromEnv();
  const reader = createInterface({
    input,
    crlfDelay: Number.POSITIVE_INFINITY,
    terminal: false
  });

  for await (const line of reader) {
    if (line.trim().length === 0) {
      continue;
    }
    const response = await handleMcpGatewayLineAsync(line, context);
    if (response !== undefined) {
      output.write(`${JSON.stringify(response)}\n`);
    }
  }
}

function handleParsedGatewayRequest(
  line: string,
  context: McpGatewayContext,
  allowAsync: boolean,
): McpGatewayResponse | Promise<McpGatewayResponse | undefined> | undefined {
  let request: unknown;
  try {
    request = JSON.parse(line);
  } catch {
    return createErrorResponse(null, -32700, "Parse error");
  }

  if (!isGatewayRequest(request)) {
    return createErrorResponse(null, -32600, "Invalid Request");
  }
  if (request.id === undefined && request.method?.startsWith("notifications/")) {
    return undefined;
  }
  const id = request.id ?? null;

  if (request.method === "initialize") {
    return createResultResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: context.bundle.mcp.serverName,
        version: "0.1.0"
      }
    });
  }

  if (request.method === "tools/list") {
    return createResultResponse(id, {
      tools: [
        ...context.bundle.mcp.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        })),
        ...routerToolCards()
      ]
    });
  }

  if (request.method === "tools/call") {
    return allowAsync
      ? handleToolCallAsync(id, request.params, context)
      : handleToolCall(id, request.params, context.bundle);
  }

  return createErrorResponse(id, -32601, "Method not found");
}

function handleToolCall(
  id: string | number | null,
  params: unknown,
  bundle: McpDemoBundle,
): McpGatewayResponse {
  if (typeof params !== "object" || params === null) {
    return createErrorResponse(id, -32602, "Invalid params");
  }
  const record = params as Record<string, unknown>;
  if (record.name !== "split402.walletRiskScore") {
    return createErrorResponse(id, -32602, "Unknown tool");
  }
  const args = record.arguments;
  if (typeof args !== "object" || args === null) {
    return createErrorResponse(id, -32602, "Tool arguments are required");
  }
  const wallet = (args as Record<string, unknown>).wallet;
  if (typeof wallet !== "string" || wallet.trim().length === 0) {
    return createErrorResponse(id, -32602, "wallet argument is required");
  }

  const result = createWalletRiskToolResult(wallet.trim(), bundle);
  return createToolResultResponse(id, result);
}

async function handleToolCallAsync(
  id: string | number | null,
  params: unknown,
  context: McpGatewayContext,
): Promise<McpGatewayResponse> {
  if (typeof params !== "object" || params === null) {
    return createErrorResponse(id, -32602, "Invalid params");
  }
  const record = params as Record<string, unknown>;
  if (record.name === "split402.searchCapabilities") {
    const searchInput = readCapabilitySearchInput(record.arguments);
    if ("message" in searchInput) {
      return createErrorResponse(id, -32602, searchInput.message);
    }
    return createResultResponse(id, {
      structuredContent: {
        capabilities: context.router
          .searchCapabilities(searchInput)
          .map(publicProviderView)
      },
      isError: false
    });
  }
  if (record.name === "split402.execute") {
    return handleRouterExecuteTool(id, record.arguments, context);
  }
  if (record.name === "split402.discoverExternalX402") {
    return handleExternalX402DiscoveryTool(id, record.arguments, context);
  }
  if (record.name === "split402.getReceipt") {
    return handleGetReceiptTool(id, record.arguments, context);
  }
  return handleToolCall(id, params, context.bundle);
}

async function handleExternalX402DiscoveryTool(
  id: string | number | null,
  args: unknown,
  context: McpGatewayContext,
): Promise<McpGatewayResponse> {
  if (typeof args !== "object" || args === null) {
    return createErrorResponse(id, -32602, "Tool arguments are required");
  }
  const record = args as Record<string, unknown>;
  const merchantOrigin = readRequiredStringArgument(
    record.merchantOrigin,
    "merchantOrigin"
  );
  if (typeof merchantOrigin !== "string") {
    return createErrorResponse(id, -32602, merchantOrigin.message);
  }
  const capability =
    record.capability === undefined
      ? undefined
      : readRequiredStringArgument(record.capability, "capability");
  if (capability !== undefined && typeof capability !== "string") {
    return createErrorResponse(id, -32602, capability.message);
  }
  const providerIdPrefix =
    record.providerIdPrefix === undefined
      ? undefined
      : readRequiredStringArgument(record.providerIdPrefix, "providerIdPrefix");
  if (providerIdPrefix !== undefined && typeof providerIdPrefix !== "string") {
    return createErrorResponse(id, -32602, providerIdPrefix.message);
  }
  const matchPath =
    record.matchPath === undefined
      ? undefined
      : readRequiredStringArgument(record.matchPath, "matchPath");
  if (matchPath !== undefined && typeof matchPath !== "string") {
    return createErrorResponse(id, -32602, matchPath.message);
  }
  const includeFreeRoutes =
    record.includeFreeRoutes === undefined
      ? false
      : readOptionalBooleanArgument(record.includeFreeRoutes, "includeFreeRoutes");
  if (typeof includeFreeRoutes === "object") {
    return createErrorResponse(id, -32602, includeFreeRoutes.message);
  }

  try {
    const discovery = new Split402ExternalX402DiscoveryClient({
      merchantOrigin,
      ...(context.externalDiscoveryFetch === undefined
        ? {}
        : { fetch: context.externalDiscoveryFetch }),
      ...(providerIdPrefix === undefined ? {} : { providerIdPrefix }),
      ...(capability === undefined
        ? {}
        : {
            capabilityMapper: (route) =>
              route.path.includes("/price")
                ? capability
                : `external.${route.operationId}`
          })
    });
    const discoveredCandidates = await discovery.discoverCandidates({
      ...(capability === undefined ? {} : { capability }),
      includeFreeRoutes
    });
    const candidates =
      matchPath === undefined
        ? discoveredCandidates
        : discoveredCandidates.filter((candidate) =>
            candidate.path.includes(matchPath)
          );
    return createToolResultResponse(id, {
      status: "discovered",
      merchantOrigin,
      candidateCount: candidates.length,
      routerReadyCount: candidates.filter(
        (candidate) => candidate.readiness === "router_ready"
      ).length,
      candidates: candidates.map(publicExternalX402CandidateView)
    });
  } catch (error) {
    return createErrorResponse(id, -32000, errorMessage(error));
  }
}

async function handleRouterExecuteTool(
  id: string | number | null,
  args: unknown,
  context: McpGatewayContext,
): Promise<McpGatewayResponse> {
  if (typeof args !== "object" || args === null) {
    return createErrorResponse(id, -32602, "Tool arguments are required");
  }
  const record = args as Record<string, unknown>;
  const capability = readRequiredStringArgument(record.capability, "capability");
  if (typeof capability !== "string") {
    return createErrorResponse(id, -32602, capability.message);
  }
  const budgetFilter = readOptionalBudgetFilter(record.budget);
  if (budgetFilter !== undefined && "message" in budgetFilter) {
    return createErrorResponse(id, -32602, budgetFilter.message);
  }
  if (record.budget === undefined) {
    return createErrorResponse(id, -32602, "budget argument is required");
  }
  const matchingProviders = context.router.searchCapabilities({
    capability,
    ...(budgetFilter === undefined ? {} : { budget: budgetFilter })
  });
  const provider =
    matchingProviders[0] ??
    (budgetFilter === undefined
      ? context.router.searchCapabilities(capability)[0]
      : undefined);
  if (provider === undefined) {
    return createErrorResponse(
      id,
      -32602,
      budgetFilter === undefined
        ? `unknown capability: ${capability}`
        : `no providers match capability and budget: ${capability}`
    );
  }
  const budget = readBudget(record.budget, provider);
  if ("message" in budget) {
    return createErrorResponse(id, -32602, budget.message);
  }
  const referralClaim = readOptionalReferralClaim(record.referralClaim);
  if (referralClaim !== undefined && "message" in referralClaim) {
    return createErrorResponse(id, -32602, referralClaim.message);
  }
  const maxAttempts = readOptionalPositiveIntegerArgument(
    record.maxAttempts,
    "maxAttempts"
  );
  if (typeof maxAttempts === "object") {
    return createErrorResponse(id, -32602, maxAttempts.message);
  }

  try {
    const result = await context.router.execute({
      capability,
      input: record.input ?? {},
      budget,
      ...(referralClaim === undefined ? {} : { referralClaim }),
      ...(maxAttempts === undefined ? {} : { maxAttempts })
    });
    context.receipts.set(result.receipt.receiptId, result.receipt);
    return createRouterExecuteResponse(id, result, context.executionMode);
  } catch (error) {
    return createErrorResponse(id, -32000, errorMessage(error));
  }
}

function handleGetReceiptTool(
  id: string | number | null,
  args: unknown,
  context: McpGatewayContext,
): McpGatewayResponse {
  if (typeof args !== "object" || args === null) {
    return createErrorResponse(id, -32602, "Tool arguments are required");
  }
  const receiptId = readRequiredStringArgument(
    (args as Record<string, unknown>).receiptId,
    "receiptId"
  );
  if (typeof receiptId !== "string") {
    return createErrorResponse(id, -32602, receiptId.message);
  }
  const receipt = context.receipts.get(receiptId);
  if (receipt === undefined) {
    return createErrorResponse(id, -32004, "receipt was not found");
  }
  return createResultResponse(id, {
    structuredContent: {
      receiptId,
      receipt
    },
    isError: false
  });
}

function isGatewayRequest(value: unknown): value is McpGatewayRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.jsonrpc === "2.0" &&
    (record.id === undefined ||
      record.id === null ||
      typeof record.id === "string" ||
      typeof record.id === "number") &&
    typeof record.method === "string"
  );
}

function createToolResultResponse(
  id: string | number | null,
  result: unknown,
): McpGatewayResponse {
  return createResultResponse(id, {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ],
    structuredContent: result,
    isError: false
  });
}

function createRouterExecuteResponse(
  id: string | number | null,
  result: Split402RouterExecuteResult,
  executionMode: McpGatewayContext["executionMode"],
): McpGatewayResponse {
  return createToolResultResponse(id, {
    status: "executed",
    executionMode,
    providerId: result.providerId,
    provider: publicProviderView(result.provider),
    capability: result.capability,
    amountPaidAtomic: result.receipt.requiredAmountAtomic,
    receiptId: result.receipt.receiptId,
    receiptVerificationStatus: "verified",
    referrerCreditAtomic: result.receipt.referrerCreditAtomic,
    data: result.data,
    attempts: result.attempts
  });
}

function createResultResponse(
  id: string | number | null,
  result: unknown,
): McpGatewayResponse {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function createErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
): McpGatewayResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  };
}

function routerToolCards() {
  return [
    {
      name: "split402.searchCapabilities",
      description: "Search the Split402 router's paid-tool providers.",
      inputSchema: {
        type: "object",
        properties: {
          capability: { type: "string" },
          budget: {
            type: "object",
            properties: {
              network: { type: "string" },
              asset: { type: "string" },
              maxAmountAtomic: { type: "string" }
            },
            additionalProperties: false
          }
        },
        additionalProperties: false
      }
    },
    {
      name: "split402.execute",
      description:
        "Execute a paid capability through the demo Split402 router and return receipt verification details.",
      inputSchema: {
        type: "object",
        properties: {
          capability: { type: "string" },
          input: { type: "object" },
          referralClaim: { type: "object" },
          budget: {
            type: "object",
            properties: {
              network: { type: "string" },
              asset: { type: "string" },
              maxAmountAtomic: { type: "string" }
            },
            required: ["maxAmountAtomic"],
            additionalProperties: false
          },
          maxAttempts: { type: "number" }
        },
        required: ["capability", "input", "budget"],
        additionalProperties: false
      }
    },
    {
      name: "split402.discoverExternalX402",
      description:
        "Inspect an external x402 API and classify whether its paid routes are ready for Split402 routing.",
      inputSchema: {
        type: "object",
        properties: {
          merchantOrigin: { type: "string" },
          capability: { type: "string" },
          matchPath: { type: "string" },
          providerIdPrefix: { type: "string" },
          includeFreeRoutes: { type: "boolean" }
        },
        required: ["merchantOrigin"],
        additionalProperties: false
      }
    },
    {
      name: "split402.getReceipt",
      description: "Return a receipt captured during this gateway session.",
      inputSchema: {
        type: "object",
        properties: {
          receiptId: { type: "string" }
        },
        required: ["receiptId"],
        additionalProperties: false
      }
    }
  ];
}

function createDemoRouterExecutor(bundle: McpDemoBundle): Split402RouterExecutor {
  let receiptSequence = 0;
  return {
    execute: async (input: Parameters<Split402RouterExecutor["execute"]>[0]) => {
      const sequence = receiptSequence;
      receiptSequence += 1;
      return {
        data: {
          executionMode: "router-demo-mock",
          wallet:
            typeof input.body === "object" && input.body !== null
              ? ((input.body as Record<string, unknown>).wallet ?? null)
              : null,
          referralClaimHash:
            input.referralClaim === undefined
              ? null
              : hashProtocolObject(input.referralClaim),
          riskScore: 17,
          risk: "low"
        },
        receipt: createDemoReceipt(bundle, input.provider, input.body, sequence)
      };
    }
  };
}

function createDemoReceipt(
  bundle: McpDemoBundle,
  provider: Split402CapabilityProvider,
  body: unknown,
  sequence: number,
): Split402ReceiptV1 {
  const sample = createSampleProtocolArtifacts();
  const requiredAmount = parseAtomicAmount(provider.amountAtomic);
  const commission = calculateCommission(
    requiredAmount,
    BigInt(bundle.mcp.tools[0].split402.commissionBps),
    BigInt(bundle.mcp.tools[0].split402.protocolFeeBpsOfCommission)
  );
  const unsigned = {
    protocolVersion: "0.1",
    receiptId: createDeterministicDemoId("rcp", {
      providerId: provider.providerId,
      body,
      sequence
    }),
    merchantId: "mrc_00000000000000000000000000000001",
    merchantOrigin: provider.merchantOrigin,
    operationId: provider.operationId,
    requestDigest: hashProtocolObject({
      providerId: provider.providerId,
      capability: provider.capability,
      input: body
    }),
    campaignId: provider.campaignId,
    campaignVersion: 1,
    campaignTermsHash: hashProtocolObject({
      campaignId: provider.campaignId,
      asset: provider.asset,
      amountAtomic: provider.amountAtomic
    }),
    routeId: sample.artifacts.receipt.routeId!,
    referralClaimHash: sample.artifacts.receipt.referralClaimHash!,
    referrerWallet: sample.artifacts.receipt.referrerWallet!,
    payoutWallet: sample.artifacts.receipt.payoutWallet!,
    paymentId: createDeterministicDemoId("pay", {
      providerId: provider.providerId,
      body,
      sequence
    }),
    network: provider.network,
    asset: provider.asset,
    payerWallet: sample.artifacts.receipt.payerWallet,
    payToWallet: provider.payToWallet,
    requiredAmountAtomic: provider.amountAtomic,
    settledAmountAtomic: provider.amountAtomic,
    settlementTxSignature: `demo-mcp-gateway-mock-settlement-${sequence}`,
    commissionBps: bundle.mcp.tools[0].split402.commissionBps,
    protocolFeeBpsOfCommission:
      bundle.mcp.tools[0].split402.protocolFeeBpsOfCommission,
    commissionBaseAtomic: provider.amountAtomic,
    commissionAmountAtomic: serializeAtomicAmount(commission.commission),
    protocolFeeAtomic: serializeAtomicAmount(commission.protocolFee),
    referrerCreditAtomic: serializeAtomicAmount(commission.referrerCredit),
    settlementMode: "accrual",
    offerNonce: createDeterministicDemoId("ofn", {
      providerId: provider.providerId,
      body,
      sequence
    }),
    settledAt: "2026-06-26T00:01:45Z",
    issuedAt: "2026-06-26T00:01:46Z",
    recordingStatus: "accepted",
    kid: "kid_mcp_demo_1"
  } satisfies Omit<Split402ReceiptV1, "signature">;
  const signature = signEd25519Message(
    buildReceiptSigningBytes(unsigned),
    hexToBytes(MCP_DEMO_DEFAULT_SERVICE_SEED_HEX)
  );
  return {
    ...unsigned,
    signature: signature.signature
  };
}

function createDeterministicDemoId(
  prefix: "ofn" | "pay" | "rcp",
  value: unknown
): string {
  return `${prefix}_${hashProtocolObject(value).slice("sha256:".length, 39)}`;
}

function publicProviderView(provider: Split402CapabilityProvider) {
  return {
    providerId: provider.providerId,
    capability: provider.capability,
    ...(provider.routeId === undefined ? {} : { routeId: provider.routeId }),
    merchantOrigin: provider.merchantOrigin,
    path: provider.path,
    method: provider.method,
    operationId: provider.operationId,
    campaignId: provider.campaignId,
    network: provider.network,
    asset: provider.asset,
    payToWallet: provider.payToWallet,
    amountAtomic: provider.amountAtomic,
    ...(provider.metadata?.referrerWallet === undefined
      ? {}
      : { referrerWallet: provider.metadata.referrerWallet }),
    ...(provider.metadata?.payoutWallet === undefined
      ? {}
      : { payoutWallet: provider.metadata.payoutWallet }),
    reliability: provider.reliability ?? null
  };
}

function publicExternalX402CandidateView(
  candidate: Split402ExternalX402ProviderCandidate
) {
  return {
    providerId: candidate.providerId,
    capability: candidate.capability,
    merchantOrigin: candidate.merchantOrigin,
    path: candidate.path,
    method: candidate.method,
    operationId: candidate.operationId,
    ...(candidate.description === undefined
      ? {}
      : { description: candidate.description }),
    ...(candidate.price === undefined ? {} : { price: candidate.price }),
    ...(candidate.network === undefined ? {} : { network: candidate.network }),
    ...(candidate.asset === undefined ? {} : { asset: candidate.asset }),
    ...(candidate.payToWallet === undefined
      ? {}
      : { payToWallet: candidate.payToWallet }),
    ...(candidate.amountAtomic === undefined
      ? {}
      : { amountAtomic: candidate.amountAtomic }),
    readiness: candidate.readiness,
    blockers: candidate.blockers,
    source: candidate.source,
    routerReady: candidate.provider !== undefined
  };
}

function readBudget(
  value: unknown,
  provider: Split402CapabilityProvider,
):
  | {
      network: string;
      asset: string;
      maxAmountAtomic: string;
    }
  | { message: string } {
  if (value === undefined) {
    return {
      network: provider.network,
      asset: provider.asset,
      maxAmountAtomic: provider.amountAtomic
    };
  }
  if (typeof value !== "object" || value === null) {
    return { message: "budget must be an object" };
  }
  const record = value as Record<string, unknown>;
  const network =
    record.network === undefined
      ? provider.network
      : readRequiredStringArgument(record.network, "budget.network");
  if (typeof network !== "string") {
    return network;
  }
  const asset =
    record.asset === undefined
      ? provider.asset
      : readRequiredStringArgument(record.asset, "budget.asset");
  if (typeof asset !== "string") {
    return asset;
  }
  const maxAmountAtomic = readRequiredStringArgument(
    record.maxAmountAtomic,
    "budget.maxAmountAtomic"
  );
  if (typeof maxAmountAtomic !== "string") {
    return maxAmountAtomic;
  }
  if (!isNonNegativeAtomicAmount(maxAmountAtomic)) {
    return {
      message: "budget.maxAmountAtomic must be a non-negative atomic amount string"
    };
  }
  return { network, asset, maxAmountAtomic };
}

function readCapabilitySearchInput(
  args: unknown,
):
  | {
      capability?: string;
      budget?: {
        network?: string;
        asset?: string;
        maxAmountAtomic?: string;
      };
    }
  | { message: string } {
  if (typeof args !== "object" || args === null) {
    return {};
  }
  const record = args as Record<string, unknown>;
  const capability =
    record.capability === undefined
      ? undefined
      : readRequiredStringArgument(record.capability, "capability");
  if (capability !== undefined && typeof capability !== "string") {
    return capability;
  }
  const budget = readOptionalBudgetFilter(record.budget);
  if (budget !== undefined && "message" in budget) {
    return budget;
  }
  return {
    ...(capability === undefined ? {} : { capability }),
    ...(budget === undefined ? {} : { budget })
  };
}

function readOptionalBudgetFilter(
  value: unknown,
):
  | {
      network?: string;
      asset?: string;
      maxAmountAtomic?: string;
    }
  | undefined
  | { message: string } {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    return { message: "budget must be an object" };
  }
  const record = value as Record<string, unknown>;
  const network =
    record.network === undefined
      ? undefined
      : readRequiredStringArgument(record.network, "budget.network");
  if (network !== undefined && typeof network !== "string") {
    return network;
  }
  const asset =
    record.asset === undefined
      ? undefined
      : readRequiredStringArgument(record.asset, "budget.asset");
  if (asset !== undefined && typeof asset !== "string") {
    return asset;
  }
  const maxAmountAtomic =
    record.maxAmountAtomic === undefined
      ? undefined
      : readRequiredStringArgument(
          record.maxAmountAtomic,
          "budget.maxAmountAtomic"
        );
  if (maxAmountAtomic !== undefined && typeof maxAmountAtomic !== "string") {
    return maxAmountAtomic;
  }
  if (
    maxAmountAtomic !== undefined &&
    !isNonNegativeAtomicAmount(maxAmountAtomic)
  ) {
    return {
      message: "budget.maxAmountAtomic must be a non-negative atomic amount string"
    };
  }
  return {
    ...(network === undefined ? {} : { network }),
    ...(asset === undefined ? {} : { asset }),
    ...(maxAmountAtomic === undefined ? {} : { maxAmountAtomic })
  };
}

function readOptionalReferralClaim(
  value: unknown
): ReferralClaimV1 | undefined | { message: string } {
  if (value === undefined) {
    return undefined;
  }
  const parsed = ReferralClaimV1Schema.safeParse(value);
  if (!parsed.success) {
    return {
      message: `referralClaim is invalid: ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`
    };
  }
  return parsed.data;
}

function readRequiredStringArgument(
  value: unknown,
  label: string,
): string | { message: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { message: `${label} argument is required` };
  }
  return value.trim();
}

function readOptionalPositiveIntegerArgument(
  value: unknown,
  label: string,
): number | undefined | { message: string } {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return { message: `${label} must be a positive integer` };
  }
  return value;
}

function readOptionalBooleanArgument(
  value: unknown,
  label: string,
): boolean | { message: string } {
  if (typeof value !== "boolean") {
    return { message: `${label} must be a boolean` };
  }
  return value;
}

function isNonNegativeAtomicAmount(value: string): boolean {
  return /^(0|[1-9][0-9]*)$/u.test(value);
}

function readGatewayContext(
  value: McpDemoBundle | McpGatewayContext,
): McpGatewayContext {
  return "router" in value && "receipts" in value
    ? value
    : createMcpGatewayContext(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readOptionalEnvString(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0
    ? undefined
    : value.trim();
}

function readOptionalPositiveInteger(value: string | undefined): number | undefined {
  const normalized = readOptionalEnvString(value);
  if (normalized === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runMcpGateway();
}
