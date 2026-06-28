import {
  createMcpGatewayContextFromEnv,
  handleMcpGatewayLineAsync,
  type McpGatewayResponse,
} from "../apps/mcp-demo/src/gateway.js";
import type { Split402DiscoveryFetch } from "../packages/router/src/index.js";

export interface Phase7McpGatewayEvidenceInput {
  outputDir: string;
  env?: NodeJS.ProcessEnv;
  fetch?: Split402DiscoveryFetch;
  writeArtifact: (path: string, text: string) => void;
  joinPath?: (directory: string, fileName: string) => string;
}

export interface Phase7McpGatewayEvidenceReport {
  schema: "split402.phase7_mcp_gateway_evidence.v1";
  outputDir: string;
  artifactPath: string;
  executionMode: "router-demo-mock" | "router-live-agent-sdk";
  capability: string;
  proofReady: boolean;
  blockers: string[];
  executionCaptured: boolean;
  receiptLookupCaptured: boolean;
  providerId?: string;
  maxAmountAtomic?: string;
  providerAmountAtomic?: string;
  providerPayToWallet?: string;
  amountPaidAtomic?: string;
  receiptId?: string;
  receiptVerificationStatus?: string;
  referrerCreditAtomic?: string;
  routeId?: string;
  payToWallet?: string;
  commissionBps?: number;
  protocolFeeBpsOfCommission?: number;
  commissionAmountAtomic?: string;
  protocolFeeAtomic?: string;
  requestCount: number;
  responseCount: number;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: unknown;
}

interface TranscriptLine {
  direction: "request" | "response";
  message: JsonRpcRequest | McpGatewayResponse;
}

export async function collectPhase7McpGatewayEvidence(
  input: Phase7McpGatewayEvidenceInput,
): Promise<Phase7McpGatewayEvidenceReport> {
  const env = input.env ?? process.env;
  const capability = readOptionalEnv(env.SPLIT402_MCP_CAPABILITY) ?? "solana.wallet-risk";
  const wallet = readOptionalEnv(env.SPLIT402_MCP_WALLET) ?? "phase7-demo-wallet";
  const maxAmountAtomic =
    readOptionalEnv(env.SPLIT402_MCP_MAX_AMOUNT_ATOMIC) ?? "50000";
  const context = await createMcpGatewayContextFromEnv({
    env,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    requireSigner: shouldRequireHostedExecutionSigner(env),
  });
  const requests: JsonRpcRequest[] = [
    {
      jsonrpc: "2.0",
      id: "initialize",
      method: "initialize",
    },
    {
      jsonrpc: "2.0",
      id: "tools",
      method: "tools/list",
    },
    {
      jsonrpc: "2.0",
      id: "search",
      method: "tools/call",
      params: {
        name: "split402.searchCapabilities",
        arguments: {
          capability,
          budget: { maxAmountAtomic },
        },
      },
    },
  ];
  const transcript: TranscriptLine[] = [];
  let responseCount = 0;
  let executionCaptured = false;
  let receiptLookupCaptured = false;
  let searchResponse: McpGatewayResponse | undefined;
  let executionSummary: McpGatewayExecutionSummary | undefined;
  let receiptSummary: McpGatewayReceiptSummary | undefined;
  const blockers: string[] = [];
  for (const request of requests) {
    transcript.push({ direction: "request", message: request });
    const response = await handleMcpGatewayLineAsync(
      JSON.stringify(request),
      context,
    );
    if (response !== undefined) {
      responseCount += 1;
      transcript.push({ direction: "response", message: response });
      if (request.id === "search") {
        searchResponse = response;
      }
    }
  }
  if (shouldCaptureExecution(context.executionMode, env)) {
    const executeRequest: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: "execute",
      method: "tools/call",
      params: {
        name: "split402.execute",
        arguments: {
          capability,
          input: { wallet },
          budget: { maxAmountAtomic },
        },
      },
    };
    transcript.push({ direction: "request", message: executeRequest });
    const executeResponse = await handleMcpGatewayLineAsync(
      JSON.stringify(executeRequest),
      context,
    );
    if (executeResponse !== undefined) {
      responseCount += 1;
      transcript.push({ direction: "response", message: executeResponse });
      executionCaptured = executeResponse.error === undefined;
      if (executeResponse.error !== undefined) {
        blockers.push(
          `split402.execute failed: ${executeResponse.error.message}`,
        );
      }
      executionSummary = readExecutionSummary(executeResponse);
      const receiptId = executionSummary?.receiptId;
      if (receiptId !== undefined) {
        const receiptRequest: JsonRpcRequest = {
          jsonrpc: "2.0",
          id: "receipt",
          method: "tools/call",
          params: {
            name: "split402.getReceipt",
            arguments: { receiptId },
          },
        };
        transcript.push({ direction: "request", message: receiptRequest });
        const receiptResponse = await handleMcpGatewayLineAsync(
          JSON.stringify(receiptRequest),
          context,
        );
        if (receiptResponse !== undefined) {
          responseCount += 1;
          transcript.push({ direction: "response", message: receiptResponse });
          receiptLookupCaptured = receiptResponse.error === undefined;
          if (receiptResponse.error !== undefined) {
            blockers.push(
              `split402.getReceipt failed: ${receiptResponse.error.message}`,
            );
          } else {
            receiptSummary = readReceiptSummary(receiptResponse);
            if (receiptSummary === undefined) {
              blockers.push(
                "mcp_gateway_evidence getReceipt response missing receipt economics",
              );
            }
          }
        }
      }
    }
  } else {
    blockers.push(
      "mcp_gateway_evidence requires split402.execute; set SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1 for hosted mode",
    );
  }
  if (!executionCaptured) {
    blockers.push("mcp_gateway_evidence did not capture successful split402.execute");
  }
  if (!receiptLookupCaptured) {
    blockers.push("mcp_gateway_evidence did not capture successful split402.getReceipt");
  }
  if (context.executionMode !== "router-live-agent-sdk") {
    blockers.push(
      "mcp_gateway_evidence requires router-live-agent-sdk execution mode for Phase 7 hosted proof",
    );
  }
  const providerSummary =
    executionSummary === undefined || searchResponse === undefined
      ? undefined
      : readSearchProviderSummary(searchResponse, executionSummary.providerId);
  if (executionSummary !== undefined) {
    if (providerSummary === undefined) {
      blockers.push(
        "mcp_gateway_evidence search response missing executed provider details",
      );
    } else {
      if (executionSummary.amountPaidAtomic !== providerSummary.amountAtomic) {
        blockers.push(
          "mcp_gateway_evidence execute amountPaidAtomic does not match selected provider amountAtomic",
        );
      }
      if (
        receiptSummary !== undefined &&
        receiptSummary.payToWallet !== providerSummary.payToWallet
      ) {
        blockers.push(
          "mcp_gateway_evidence getReceipt payToWallet does not match selected provider",
        );
      }
    }
    const amountPaid = readAtomicAmount(executionSummary.amountPaidAtomic);
    const maxAmount = readAtomicAmount(maxAmountAtomic);
    if (amountPaid === undefined || maxAmount === undefined) {
      blockers.push(
        "mcp_gateway_evidence execute amountPaidAtomic and budget.maxAmountAtomic must be atomic amounts",
      );
    } else if (amountPaid > maxAmount) {
      blockers.push(
        "mcp_gateway_evidence execute amountPaidAtomic exceeds budget.maxAmountAtomic",
      );
    }
  }

  const artifactPath = joinPath(input, "mcp-gateway.jsonl");
  input.writeArtifact(
    artifactPath,
    transcript.map((line) => JSON.stringify(line)).join("\n") + "\n",
  );

  return {
    schema: "split402.phase7_mcp_gateway_evidence.v1",
    outputDir: input.outputDir,
    artifactPath,
    executionMode: context.executionMode,
    capability,
    proofReady: blockers.length === 0,
    blockers,
    executionCaptured,
    receiptLookupCaptured,
    maxAmountAtomic,
    ...(providerSummary === undefined
      ? {}
      : {
          providerAmountAtomic: providerSummary.amountAtomic,
          providerPayToWallet: providerSummary.payToWallet,
        }),
    ...(executionSummary === undefined
      ? {}
      : {
          providerId: executionSummary.providerId,
          amountPaidAtomic: executionSummary.amountPaidAtomic,
          receiptId: executionSummary.receiptId,
          receiptVerificationStatus: executionSummary.receiptVerificationStatus,
          referrerCreditAtomic: executionSummary.referrerCreditAtomic,
        }),
    ...(receiptSummary === undefined
      ? {}
      : {
          routeId: receiptSummary.routeId,
          payToWallet: receiptSummary.payToWallet,
          commissionBps: receiptSummary.commissionBps,
          protocolFeeBpsOfCommission:
            receiptSummary.protocolFeeBpsOfCommission,
          commissionAmountAtomic: receiptSummary.commissionAmountAtomic,
          protocolFeeAtomic: receiptSummary.protocolFeeAtomic,
        }),
    requestCount: transcript.filter((line) => line.direction === "request").length,
    responseCount,
  };
}

function shouldCaptureExecution(
  executionMode: Phase7McpGatewayEvidenceReport["executionMode"],
  env: NodeJS.ProcessEnv,
): boolean {
  const override = readOptionalEnv(env.SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE);
  if (override !== undefined) {
    return ["1", "true", "yes"].includes(override.toLowerCase());
  }
  return executionMode === "router-demo-mock";
}

function shouldRequireHostedExecutionSigner(env: NodeJS.ProcessEnv): boolean {
  return (
    readOptionalEnv(env.SPLIT402_MCP_CONTROL_PLANE_URL) !== undefined &&
    ["1", "true", "yes"].includes(
      (readOptionalEnv(env.SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE) ?? "").toLowerCase(),
    )
  );
}

interface McpGatewayExecutionSummary {
  providerId: string;
  amountPaidAtomic: string;
  receiptId: string;
  receiptVerificationStatus: string;
  referrerCreditAtomic: string;
}

interface McpGatewayReceiptSummary {
  routeId: string;
  payToWallet: string;
  commissionBps: number;
  protocolFeeBpsOfCommission: number;
  commissionAmountAtomic: string;
  protocolFeeAtomic: string;
}

interface McpGatewaySearchProviderSummary {
  amountAtomic: string;
  payToWallet: string;
}

function readExecutionSummary(
  response: McpGatewayResponse,
): McpGatewayExecutionSummary | undefined {
  const result = readRecord(response.result);
  const structuredContent = readRecord(result?.structuredContent);
  const providerId = readNonEmptyString(structuredContent?.providerId);
  const amountPaidAtomic = readNonEmptyString(structuredContent?.amountPaidAtomic);
  const receiptId = readNonEmptyString(structuredContent?.receiptId);
  const receiptVerificationStatus = readNonEmptyString(
    structuredContent?.receiptVerificationStatus,
  );
  const referrerCreditAtomic = readNonEmptyString(
    structuredContent?.referrerCreditAtomic,
  );
  if (
    providerId === undefined ||
    amountPaidAtomic === undefined ||
    receiptId === undefined ||
    receiptVerificationStatus === undefined ||
    referrerCreditAtomic === undefined
  ) {
    return undefined;
  }
  return {
    providerId,
    amountPaidAtomic,
    receiptId,
    receiptVerificationStatus,
    referrerCreditAtomic,
  };
}

function readReceiptSummary(
  response: McpGatewayResponse,
): McpGatewayReceiptSummary | undefined {
  const result = readRecord(response.result);
  const structuredContent = readRecord(result?.structuredContent);
  const receipt = readRecord(structuredContent?.receipt);
  const routeId = readNonEmptyString(receipt?.routeId);
  const payToWallet = readNonEmptyString(receipt?.payToWallet);
  const commissionBps = readBasisPoints(receipt?.commissionBps);
  const protocolFeeBpsOfCommission = readBasisPoints(
    receipt?.protocolFeeBpsOfCommission,
  );
  const commissionAmountAtomic = readNonEmptyString(
    receipt?.commissionAmountAtomic,
  );
  const protocolFeeAtomic = readNonEmptyString(receipt?.protocolFeeAtomic);
  if (
    routeId === undefined ||
    payToWallet === undefined ||
    commissionBps === undefined ||
    protocolFeeBpsOfCommission === undefined ||
    commissionAmountAtomic === undefined ||
    protocolFeeAtomic === undefined
  ) {
    return undefined;
  }
  return {
    routeId,
    payToWallet,
    commissionBps,
    protocolFeeBpsOfCommission,
    commissionAmountAtomic,
    protocolFeeAtomic,
  };
}

function readSearchProviderSummary(
  response: McpGatewayResponse,
  providerId: string,
): McpGatewaySearchProviderSummary | undefined {
  const result = readRecord(response.result);
  const structuredContent = readRecord(result?.structuredContent);
  const capabilities = Array.isArray(structuredContent?.capabilities)
    ? structuredContent.capabilities
    : [];
  for (const value of capabilities) {
    const capability = readRecord(value);
    if (capability === undefined || capability.providerId !== providerId) {
      continue;
    }
    const amountAtomic = readNonEmptyString(capability.amountAtomic);
    const payToWallet = readNonEmptyString(capability.payToWallet);
    if (amountAtomic === undefined || payToWallet === undefined) {
      return undefined;
    }
    return { amountAtomic, payToWallet };
  }
  return undefined;
}

function joinPath(input: Phase7McpGatewayEvidenceInput, fileName: string): string {
  return input.joinPath === undefined
    ? `${input.outputDir}/${fileName}`
    : input.joinPath(input.outputDir, fileName);
}

function readOptionalEnv(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0
    ? undefined
    : value.trim();
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBasisPoints(value: unknown): number | undefined {
  return Number.isInteger(value) &&
    typeof value === "number" &&
    value >= 0 &&
    value <= 10_000
    ? value
    : undefined;
}

function readAtomicAmount(value: string): bigint | undefined {
  return /^(0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : undefined;
}
