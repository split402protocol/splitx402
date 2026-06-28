import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import {
  buildReceiptSigningBytes,
  calculateCommission,
  createSampleProtocolArtifacts,
  hashProtocolObject,
  hexToBytes,
  parseAtomicAmount,
  serializeAtomicAmount,
  signEd25519Message,
  type Split402ReceiptV1
} from "@split402/protocol";
import {
  Split402Router,
  type Split402CapabilityProvider,
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
): McpGatewayContext {
  return {
    bundle,
    router,
    receipts: new Map()
  };
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
  return {
    providerId: "split402-demo-merchant",
    capability: "solana.wallet-risk",
    merchantOrigin: bundle.merchant.origin,
    path: new URL(tool.paidHttpCall.url).pathname,
    method: tool.paidHttpCall.method,
    operationId: tool.split402.operationId,
    campaignId: tool.split402.campaignId,
    merchantPublicKey: bundle.merchant.servicePublicKey,
    network: tool.x402.network,
    asset: tool.x402.asset,
    amountAtomic: tool.x402.amountAtomic,
    reliability: {
      successRateBps: 9500,
      medianLatencyMs: 250
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
  const context = createMcpGatewayContext();
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
    return createResultResponse(id, {
      structuredContent: {
        capabilities: context.router
          .searchCapabilities(readOptionalStringArgument(record.arguments, "capability"))
          .map(publicProviderView)
      },
      isError: false
    });
  }
  if (record.name === "split402.execute") {
    return handleRouterExecuteTool(id, record.arguments, context);
  }
  if (record.name === "split402.getReceipt") {
    return handleGetReceiptTool(id, record.arguments, context);
  }
  return handleToolCall(id, params, context.bundle);
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
  const provider = context.router.searchCapabilities(capability)[0];
  if (provider === undefined) {
    return createErrorResponse(id, -32602, `unknown capability: ${capability}`);
  }
  const budget = readBudget(record.budget, provider);
  if ("message" in budget) {
    return createErrorResponse(id, -32602, budget.message);
  }

  try {
    const result = await context.router.execute({
      capability,
      input: record.input ?? {},
      budget,
      ...(typeof record.maxAttempts === "number"
        ? { maxAttempts: record.maxAttempts }
        : {})
    });
    context.receipts.set(result.receipt.receiptId, result.receipt);
    return createRouterExecuteResponse(id, result);
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
): McpGatewayResponse {
  return createToolResultResponse(id, {
    status: "executed",
    executionMode: "router-demo-mock",
    providerId: result.providerId,
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
      description: "Search the demo Split402 router's static paid-tool providers.",
      inputSchema: {
        type: "object",
        properties: {
          capability: { type: "string" }
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
          budget: {
            type: "object",
            properties: {
              network: { type: "string" },
              asset: { type: "string" },
              maxAmountAtomic: { type: "string" }
            },
            required: ["network", "asset", "maxAmountAtomic"],
            additionalProperties: false
          },
          maxAttempts: { type: "number" }
        },
        required: ["capability", "input"],
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
  return {
    execute: async (input: Parameters<Split402RouterExecutor["execute"]>[0]) => ({
      data: {
        executionMode: "router-demo-mock",
        wallet:
          typeof input.body === "object" && input.body !== null
            ? ((input.body as Record<string, unknown>).wallet ?? null)
            : null,
        riskScore: 17,
        risk: "low"
      },
      receipt: createDemoReceipt(bundle, input.provider, input.body)
    })
  };
}

function createDemoReceipt(
  bundle: McpDemoBundle,
  provider: Split402CapabilityProvider,
  body: unknown,
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
    receiptId: "rcp_00000000000000000000000000000005",
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
    paymentId: "pay_00000000000000000000000000000004",
    network: provider.network,
    asset: provider.asset,
    payerWallet: sample.artifacts.receipt.payerWallet,
    payToWallet: sample.artifacts.receipt.payToWallet,
    requiredAmountAtomic: provider.amountAtomic,
    settledAmountAtomic: provider.amountAtomic,
    settlementTxSignature: "demo-mcp-gateway-mock-settlement",
    commissionBps: bundle.mcp.tools[0].split402.commissionBps,
    protocolFeeBpsOfCommission:
      bundle.mcp.tools[0].split402.protocolFeeBpsOfCommission,
    commissionBaseAtomic: provider.amountAtomic,
    commissionAmountAtomic: serializeAtomicAmount(commission.commission),
    protocolFeeAtomic: serializeAtomicAmount(commission.protocolFee),
    referrerCreditAtomic: serializeAtomicAmount(commission.referrerCredit),
    settlementMode: "accrual",
    offerNonce: "ofn_00000000000000000000000000000006",
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

function publicProviderView(provider: Split402CapabilityProvider) {
  return {
    providerId: provider.providerId,
    capability: provider.capability,
    merchantOrigin: provider.merchantOrigin,
    path: provider.path,
    method: provider.method,
    operationId: provider.operationId,
    campaignId: provider.campaignId,
    network: provider.network,
    asset: provider.asset,
    amountAtomic: provider.amountAtomic,
    reliability: provider.reliability ?? null
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
  const network = readRequiredStringArgument(record.network, "budget.network");
  if (typeof network !== "string") {
    return network;
  }
  const asset = readRequiredStringArgument(record.asset, "budget.asset");
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
  return { network, asset, maxAmountAtomic };
}

function readOptionalStringArgument(
  args: unknown,
  key: string,
): string | undefined {
  if (typeof args !== "object" || args === null) {
    return undefined;
  }
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runMcpGateway();
}
