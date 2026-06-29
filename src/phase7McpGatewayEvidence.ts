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
  providerNetwork?: string;
  providerAsset?: string;
  providerMerchantOrigin?: string;
  providerOperationId?: string;
  providerCampaignId?: string;
  providerAmountAtomic?: string;
  providerPayToWallet?: string;
  providerRouteId?: string;
  providerReferrerWallet?: string;
  providerPayoutWallet?: string;
  executeProviderNetwork?: string;
  executeProviderAsset?: string;
  executeProviderMerchantOrigin?: string;
  executeProviderOperationId?: string;
  executeProviderCampaignId?: string;
  executeProviderAmountAtomic?: string;
  executeProviderPayToWallet?: string;
  executeProviderRouteId?: string;
  executeProviderReferrerWallet?: string;
  executeProviderPayoutWallet?: string;
  amountPaidAtomic?: string;
  receiptId?: string;
  receiptVerificationStatus?: string;
  executeExecutionMode?: string;
  referrerCreditAtomic?: string;
  routeId?: string;
  network?: string;
  asset?: string;
  merchantOrigin?: string;
  operationId?: string;
  campaignId?: string;
  requiredAmountAtomic?: string;
  payToWallet?: string;
  receiptReferrerCreditAtomic?: string;
  receiptReferrerWallet?: string;
  receiptPayoutWallet?: string;
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
      if (
        executeResponse.error === undefined &&
        executionSummary === undefined
      ) {
        addExecutionSummaryBlockers(executeResponse, blockers);
      }
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
    if (receiptSummary !== undefined) {
      verifyReceiptEconomics(receiptSummary, blockers);
      if (receiptSummary.requiredAmountAtomic !== executionSummary.amountPaidAtomic) {
        blockers.push(
          "mcp_gateway_evidence getReceipt requiredAmountAtomic does not match execute amountPaidAtomic",
        );
      }
      if (receiptSummary.referrerCreditAtomic !== executionSummary.referrerCreditAtomic) {
        blockers.push(
          "mcp_gateway_evidence getReceipt referrerCreditAtomic does not match execute response",
        );
      }
    }
    if (executionSummary.receiptVerificationStatus !== "verified") {
      blockers.push(
        "mcp_gateway_evidence execute response receiptVerificationStatus is not verified",
      );
    }
    if (
      readPositiveAtomicAmount(executionSummary.referrerCreditAtomic) ===
      undefined
    ) {
      blockers.push(
        "mcp_gateway_evidence execute response referrerCreditAtomic must be positive",
      );
    }
    if (executionSummary.executionMode !== context.executionMode) {
      blockers.push(
        "mcp_gateway_evidence execute response executionMode does not match collector execution mode",
      );
    }
    if (executionSummary.provider.providerId !== executionSummary.providerId) {
      blockers.push(
        "mcp_gateway_evidence execute provider providerId does not match execute providerId",
      );
    }
    if (executionSummary.amountPaidAtomic !== executionSummary.provider.amountAtomic) {
      blockers.push(
        "mcp_gateway_evidence execute amountPaidAtomic does not match execute provider amountAtomic",
      );
    }
    if (providerSummary === undefined) {
      blockers.push(
        "mcp_gateway_evidence search response missing executed provider details",
      );
    } else {
      compareProviderSummaries(
        executionSummary.provider,
        providerSummary,
        "execute provider",
        "selected provider",
        blockers,
      );
      if (executionSummary.amountPaidAtomic !== providerSummary.amountAtomic) {
        blockers.push(
          "mcp_gateway_evidence execute amountPaidAtomic does not match selected provider amountAtomic",
        );
      }
      if (receiptSummary !== undefined) {
        compareReceiptToProviderSummary(
          receiptSummary,
          executionSummary.provider,
          "execute provider",
          blockers,
        );
        if (receiptSummary.network !== providerSummary.network) {
          blockers.push(
            "mcp_gateway_evidence getReceipt network does not match selected provider",
          );
        }
        if (receiptSummary.asset !== providerSummary.asset) {
          blockers.push(
            "mcp_gateway_evidence getReceipt asset does not match selected provider",
          );
        }
        if (receiptSummary.merchantOrigin !== providerSummary.merchantOrigin) {
          blockers.push(
            "mcp_gateway_evidence getReceipt merchantOrigin does not match selected provider",
          );
        }
        if (receiptSummary.operationId !== providerSummary.operationId) {
          blockers.push(
            "mcp_gateway_evidence getReceipt operationId does not match selected provider",
          );
        }
        if (receiptSummary.campaignId !== providerSummary.campaignId) {
          blockers.push(
            "mcp_gateway_evidence getReceipt campaignId does not match selected provider",
          );
        }
        if (receiptSummary.payToWallet !== providerSummary.payToWallet) {
          blockers.push(
            "mcp_gateway_evidence getReceipt payToWallet does not match selected provider",
          );
        }
        if (receiptSummary.routeId !== providerSummary.routeId) {
          blockers.push(
            "mcp_gateway_evidence getReceipt routeId does not match selected provider",
          );
        }
        if (receiptSummary.referrerWallet !== providerSummary.referrerWallet) {
          blockers.push(
            "mcp_gateway_evidence getReceipt referrerWallet does not match selected provider",
          );
        }
        if (receiptSummary.payoutWallet !== providerSummary.payoutWallet) {
          blockers.push(
            "mcp_gateway_evidence getReceipt payoutWallet does not match selected provider",
          );
        }
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
          providerNetwork: providerSummary.network,
          providerAsset: providerSummary.asset,
          providerMerchantOrigin: providerSummary.merchantOrigin,
          providerOperationId: providerSummary.operationId,
          providerCampaignId: providerSummary.campaignId,
          providerAmountAtomic: providerSummary.amountAtomic,
          providerPayToWallet: providerSummary.payToWallet,
          providerRouteId: providerSummary.routeId,
          providerReferrerWallet: providerSummary.referrerWallet,
          providerPayoutWallet: providerSummary.payoutWallet,
        }),
    ...(executionSummary === undefined
      ? {}
      : {
          providerId: executionSummary.providerId,
          amountPaidAtomic: executionSummary.amountPaidAtomic,
          receiptId: executionSummary.receiptId,
          receiptVerificationStatus: executionSummary.receiptVerificationStatus,
          executeExecutionMode: executionSummary.executionMode,
          referrerCreditAtomic: executionSummary.referrerCreditAtomic,
          executeProviderNetwork: executionSummary.provider.network,
          executeProviderAsset: executionSummary.provider.asset,
          executeProviderMerchantOrigin: executionSummary.provider.merchantOrigin,
          executeProviderOperationId: executionSummary.provider.operationId,
          executeProviderCampaignId: executionSummary.provider.campaignId,
          executeProviderAmountAtomic: executionSummary.provider.amountAtomic,
          executeProviderPayToWallet: executionSummary.provider.payToWallet,
          executeProviderRouteId: executionSummary.provider.routeId,
          executeProviderReferrerWallet: executionSummary.provider.referrerWallet,
          executeProviderPayoutWallet: executionSummary.provider.payoutWallet,
        }),
    ...(receiptSummary === undefined
      ? {}
      : {
          routeId: receiptSummary.routeId,
          network: receiptSummary.network,
          asset: receiptSummary.asset,
          merchantOrigin: receiptSummary.merchantOrigin,
          operationId: receiptSummary.operationId,
          campaignId: receiptSummary.campaignId,
          requiredAmountAtomic: receiptSummary.requiredAmountAtomic,
          payToWallet: receiptSummary.payToWallet,
          receiptReferrerCreditAtomic: receiptSummary.referrerCreditAtomic,
          receiptReferrerWallet: receiptSummary.referrerWallet,
          receiptPayoutWallet: receiptSummary.payoutWallet,
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
  executionMode: Phase7McpGatewayEvidenceReport["executionMode"];
  referrerCreditAtomic: string;
  provider: McpGatewayProviderSummary;
}

interface McpGatewayReceiptSummary {
  routeId: string;
  network: string;
  asset: string;
  merchantOrigin: string;
  operationId: string;
  campaignId: string;
  requiredAmountAtomic: string;
  payToWallet: string;
  referrerCreditAtomic: string;
  referrerWallet: string;
  payoutWallet: string;
  commissionBps: number;
  protocolFeeBpsOfCommission: number;
  commissionAmountAtomic: string;
  protocolFeeAtomic: string;
}

interface McpGatewayProviderSummary {
  providerId: string;
  network: string;
  asset: string;
  merchantOrigin: string;
  operationId: string;
  campaignId: string;
  amountAtomic: string;
  payToWallet: string;
  routeId: string;
  referrerWallet: string;
  payoutWallet: string;
}

type McpGatewaySearchProviderSummary = McpGatewayProviderSummary;

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
  const executionMode = readExecutionMode(structuredContent?.executionMode);
  const referrerCreditAtomic = readNonEmptyString(
    structuredContent?.referrerCreditAtomic,
  );
  const provider = readProviderSummary(readRecord(structuredContent?.provider));
  if (
    providerId === undefined ||
    amountPaidAtomic === undefined ||
    receiptId === undefined ||
    receiptVerificationStatus === undefined ||
    executionMode === undefined ||
    referrerCreditAtomic === undefined ||
    provider === undefined
  ) {
    return undefined;
  }
  return {
    providerId,
    amountPaidAtomic,
    receiptId,
    receiptVerificationStatus,
    executionMode,
    referrerCreditAtomic,
    provider,
  };
}

function addExecutionSummaryBlockers(
  response: McpGatewayResponse,
  blockers: string[],
): void {
  const result = readRecord(response.result);
  const structuredContent = readRecord(result?.structuredContent);
  if (structuredContent === undefined) {
    blockers.push("mcp_gateway_evidence execute response is missing structuredContent");
    return;
  }
  for (const [field, value] of [
    ["providerId", structuredContent.providerId],
    ["amountPaidAtomic", structuredContent.amountPaidAtomic],
    ["receiptId", structuredContent.receiptId],
    ["referrerCreditAtomic", structuredContent.referrerCreditAtomic],
  ] as const) {
    if (readNonEmptyString(value) === undefined) {
      blockers.push(`mcp_gateway_evidence execute response missing ${field}`);
    }
  }
  if (structuredContent.receiptVerificationStatus !== "verified") {
    blockers.push(
      "mcp_gateway_evidence execute response receiptVerificationStatus is not verified",
    );
  }
  if (readExecutionMode(structuredContent.executionMode) === undefined) {
    blockers.push(
      "mcp_gateway_evidence execute response executionMode is missing or unsupported",
    );
  }
  if (readProviderSummary(readRecord(structuredContent.provider)) === undefined) {
    blockers.push(
      "mcp_gateway_evidence execute response missing selected provider summary",
    );
  }
  const referrerCreditAtomic = readNonEmptyString(
    structuredContent.referrerCreditAtomic,
  );
  if (
    referrerCreditAtomic !== undefined &&
    readPositiveAtomicAmount(referrerCreditAtomic) === undefined
  ) {
    blockers.push(
      "mcp_gateway_evidence execute response referrerCreditAtomic must be positive",
    );
  }
}

function readReceiptSummary(
  response: McpGatewayResponse,
): McpGatewayReceiptSummary | undefined {
  const result = readRecord(response.result);
  const structuredContent = readRecord(result?.structuredContent);
  const receipt = readRecord(structuredContent?.receipt);
  const routeId = readNonEmptyString(receipt?.routeId);
  const network = readNonEmptyString(receipt?.network);
  const asset = readNonEmptyString(receipt?.asset);
  const merchantOrigin = readNonEmptyString(receipt?.merchantOrigin);
  const operationId = readNonEmptyString(receipt?.operationId);
  const campaignId = readNonEmptyString(receipt?.campaignId);
  const requiredAmountAtomic = readNonEmptyString(receipt?.requiredAmountAtomic);
  const payToWallet = readNonEmptyString(receipt?.payToWallet);
  const referrerCreditAtomic = readNonEmptyString(receipt?.referrerCreditAtomic);
  const referrerWallet = readNonEmptyString(receipt?.referrerWallet);
  const payoutWallet = readNonEmptyString(receipt?.payoutWallet);
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
    network === undefined ||
    asset === undefined ||
    merchantOrigin === undefined ||
    operationId === undefined ||
    campaignId === undefined ||
    requiredAmountAtomic === undefined ||
    payToWallet === undefined ||
    referrerCreditAtomic === undefined ||
    referrerWallet === undefined ||
    payoutWallet === undefined ||
    commissionBps === undefined ||
    protocolFeeBpsOfCommission === undefined ||
    commissionAmountAtomic === undefined ||
    protocolFeeAtomic === undefined
  ) {
    return undefined;
  }
  return {
    routeId,
    network,
    asset,
    merchantOrigin,
    operationId,
    campaignId,
    requiredAmountAtomic,
    payToWallet,
    referrerCreditAtomic,
    referrerWallet,
    payoutWallet,
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
    const network = readNonEmptyString(capability.network);
    const asset = readNonEmptyString(capability.asset);
    const merchantOrigin = readNonEmptyString(capability.merchantOrigin);
    const operationId = readNonEmptyString(capability.operationId);
    const campaignId = readNonEmptyString(capability.campaignId);
    const amountAtomic = readNonEmptyString(capability.amountAtomic);
    const payToWallet = readNonEmptyString(capability.payToWallet);
    const routeId = readNonEmptyString(capability.routeId);
    const referrerWallet = readNonEmptyString(capability.referrerWallet);
    const payoutWallet = readNonEmptyString(capability.payoutWallet);
    if (
      network === undefined ||
      asset === undefined ||
      merchantOrigin === undefined ||
      operationId === undefined ||
      campaignId === undefined ||
      amountAtomic === undefined ||
      payToWallet === undefined ||
      routeId === undefined ||
      referrerWallet === undefined ||
      payoutWallet === undefined
    ) {
      return undefined;
    }
    return {
      providerId,
      network,
      asset,
      merchantOrigin,
      operationId,
      campaignId,
      amountAtomic,
      payToWallet,
      routeId,
      referrerWallet,
      payoutWallet,
    };
  }
  return undefined;
}

function readProviderSummary(
  provider: Record<string, unknown> | undefined,
): McpGatewayProviderSummary | undefined {
  const providerId = readNonEmptyString(provider?.providerId);
  const network = readNonEmptyString(provider?.network);
  const asset = readNonEmptyString(provider?.asset);
  const merchantOrigin = readNonEmptyString(provider?.merchantOrigin);
  const operationId = readNonEmptyString(provider?.operationId);
  const campaignId = readNonEmptyString(provider?.campaignId);
  const amountAtomic = readNonEmptyString(provider?.amountAtomic);
  const payToWallet = readNonEmptyString(provider?.payToWallet);
  const routeId = readNonEmptyString(provider?.routeId);
  const referrerWallet = readNonEmptyString(provider?.referrerWallet);
  const payoutWallet = readNonEmptyString(provider?.payoutWallet);
  if (
    providerId === undefined ||
    network === undefined ||
    asset === undefined ||
    merchantOrigin === undefined ||
    operationId === undefined ||
    campaignId === undefined ||
    amountAtomic === undefined ||
    payToWallet === undefined ||
    routeId === undefined ||
    referrerWallet === undefined ||
    payoutWallet === undefined
  ) {
    return undefined;
  }
  return {
    providerId,
    network,
    asset,
    merchantOrigin,
    operationId,
    campaignId,
    amountAtomic,
    payToWallet,
    routeId,
    referrerWallet,
    payoutWallet,
  };
}

function compareProviderSummaries(
  left: McpGatewayProviderSummary,
  right: McpGatewayProviderSummary,
  leftLabel: string,
  rightLabel: string,
  blockers: string[],
): void {
  for (const field of [
    "providerId",
    "network",
    "asset",
    "merchantOrigin",
    "operationId",
    "campaignId",
    "amountAtomic",
    "payToWallet",
    "routeId",
    "referrerWallet",
    "payoutWallet",
  ] as const) {
    if (left[field] !== right[field]) {
      blockers.push(
        `mcp_gateway_evidence ${leftLabel} ${field} does not match ${rightLabel}`,
      );
    }
  }
}

function compareReceiptToProviderSummary(
  receipt: McpGatewayReceiptSummary,
  provider: McpGatewayProviderSummary,
  providerLabel: string,
  blockers: string[],
): void {
  for (const [receiptField, providerField] of [
    ["network", "network"],
    ["asset", "asset"],
    ["merchantOrigin", "merchantOrigin"],
    ["operationId", "operationId"],
    ["campaignId", "campaignId"],
    ["requiredAmountAtomic", "amountAtomic"],
    ["payToWallet", "payToWallet"],
    ["routeId", "routeId"],
    ["referrerWallet", "referrerWallet"],
    ["payoutWallet", "payoutWallet"],
  ] as const) {
    if (receipt[receiptField] !== provider[providerField]) {
      blockers.push(
        `mcp_gateway_evidence getReceipt ${receiptField} does not match ${providerLabel}`,
      );
    }
  }
}

function verifyReceiptEconomics(
  receipt: McpGatewayReceiptSummary,
  blockers: string[],
): void {
  const commissionAmount = readPositiveAtomicAmount(receipt.commissionAmountAtomic);
  if (commissionAmount === undefined) {
    blockers.push(
      "mcp_gateway_evidence getReceipt commissionAmountAtomic must be positive",
    );
  }
  if (receipt.commissionBps === 0) {
    blockers.push(
      "mcp_gateway_evidence getReceipt commissionBps must be positive basis points",
    );
  }
  const protocolFee = readAtomicAmount(receipt.protocolFeeAtomic);
  if (protocolFee === undefined) {
    blockers.push(
      "mcp_gateway_evidence getReceipt protocolFeeAtomic must be a non-negative atomic amount",
    );
  }
  const requiredAmount = readAtomicAmount(receipt.requiredAmountAtomic);
  if (
    requiredAmount !== undefined &&
    commissionAmount !== undefined &&
    commissionAmount !==
      (requiredAmount * BigInt(receipt.commissionBps)) / 10_000n
  ) {
    blockers.push(
      "mcp_gateway_evidence getReceipt commissionAmountAtomic does not match commissionBps",
    );
  }
  if (
    commissionAmount !== undefined &&
    protocolFee !== undefined &&
    protocolFee !==
      (commissionAmount * BigInt(receipt.protocolFeeBpsOfCommission)) / 10_000n
  ) {
    blockers.push(
      "mcp_gateway_evidence getReceipt protocolFeeAtomic does not match protocolFeeBpsOfCommission",
    );
  }
  const referrerCredit = readAtomicAmount(receipt.referrerCreditAtomic);
  if (
    commissionAmount !== undefined &&
    protocolFee !== undefined &&
    referrerCredit !== undefined &&
    commissionAmount - protocolFee !== referrerCredit
  ) {
    blockers.push(
      "mcp_gateway_evidence getReceipt referrerCreditAtomic does not equal commission minus protocol fee",
    );
  }
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

function readExecutionMode(
  value: unknown,
): Phase7McpGatewayEvidenceReport["executionMode"] | undefined {
  return value === "router-demo-mock" || value === "router-live-agent-sdk"
    ? value
    : undefined;
}

function readAtomicAmount(value: string): bigint | undefined {
  return /^(0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : undefined;
}

function readPositiveAtomicAmount(value: string): bigint | undefined {
  return /^[1-9][0-9]*$/u.test(value) ? BigInt(value) : undefined;
}
