import { fileURLToPath } from "node:url";

import {
  createMcpGatewayContext,
  handleMcpGatewayLineAsync,
  type McpGatewayResponse
} from "./gateway.js";

export interface McpGatewaySmokeReport {
  status: "ok";
  serverName: string;
  tools: string[];
  providerId: string;
  network: string;
  asset: string;
  payToWallet: string;
  maxAmountAtomic: string;
  providerAmountAtomic: string;
  executionMode: string;
  amountPaidAtomic: string;
  receiptId: string;
  receiptVerificationStatus: string;
  referrerCreditAtomic: string;
}

export async function runMcpGatewaySmoke(): Promise<McpGatewaySmokeReport> {
  const context = createMcpGatewayContext();
  const maxAmountAtomic = "50000";

  const initialize = await callGateway(context, {
    jsonrpc: "2.0",
    id: "smoke-initialize",
    method: "initialize",
    params: {}
  });
  const serverName = readString(
    initialize,
    ["result", "serverInfo", "name"],
    "initialize server name"
  );

  const listed = await callGateway(context, {
    jsonrpc: "2.0",
    id: "smoke-tools-list",
    method: "tools/list"
  });
  const tools = readToolNames(listed);
  assertTool(tools, "split402.searchCapabilities");
  assertTool(tools, "split402.execute");
  assertTool(tools, "split402.getReceipt");

  const searched = await callGateway(context, {
    jsonrpc: "2.0",
    id: "smoke-search",
    method: "tools/call",
    params: {
      name: "split402.searchCapabilities",
      arguments: {
        capability: "solana.wallet-risk",
        budget: {
          maxAmountAtomic
        }
      }
    }
  });
  const selectedProvider = readProvider(
    searched,
    "split402-demo-merchant"
  );

  const executed = await callGateway(context, {
    jsonrpc: "2.0",
    id: "smoke-execute",
    method: "tools/call",
    params: {
      name: "split402.execute",
      arguments: {
        capability: "solana.wallet-risk",
        input: {
          wallet: "smoke-wallet"
        },
        budget: {
          maxAmountAtomic
        }
      }
    }
  });
  const providerId = readString(
    executed,
    ["result", "structuredContent", "providerId"],
    "execute provider id"
  );
  if (providerId !== selectedProvider.providerId) {
    throw new Error("execute provider id must match search provider id");
  }
  const executionMode = readString(
    executed,
    ["result", "structuredContent", "executionMode"],
    "execute execution mode"
  );
  const amountPaidAtomic = readString(
    executed,
    ["result", "structuredContent", "amountPaidAtomic"],
    "execute amount paid"
  );
  if (amountPaidAtomic !== selectedProvider.amountAtomic) {
    throw new Error("execute amount paid must match search provider amount");
  }
  if (
    readAtomicAmount(amountPaidAtomic, "execute amount paid") >
    readAtomicAmount(maxAmountAtomic, "smoke max amount")
  ) {
    throw new Error("execute amount paid must not exceed smoke max amount");
  }
  const receiptId = readString(
    executed,
    ["result", "structuredContent", "receiptId"],
    "execute receipt id"
  );
  const receiptVerificationStatus = readString(
    executed,
    ["result", "structuredContent", "receiptVerificationStatus"],
    "execute receipt verification status"
  );
  const referrerCreditAtomic = readString(
    executed,
    ["result", "structuredContent", "referrerCreditAtomic"],
    "execute referrer credit"
  );

  const receipt = await callGateway(context, {
    jsonrpc: "2.0",
    id: "smoke-get-receipt",
    method: "tools/call",
    params: {
      name: "split402.getReceipt",
      arguments: {
        receiptId
      }
    }
  });
  const receiptNetwork = readString(
    receipt,
    ["result", "structuredContent", "receipt", "network"],
    "receipt network"
  );
  if (receiptNetwork !== selectedProvider.network) {
    throw new Error("receipt network must match search provider network");
  }
  const receiptAsset = readString(
    receipt,
    ["result", "structuredContent", "receipt", "asset"],
    "receipt asset"
  );
  if (receiptAsset !== selectedProvider.asset) {
    throw new Error("receipt asset must match search provider asset");
  }
  const receiptPayToWallet = readString(
    receipt,
    ["result", "structuredContent", "receipt", "payToWallet"],
    "receipt pay-to wallet"
  );
  if (receiptPayToWallet !== selectedProvider.payToWallet) {
    throw new Error("receipt pay-to wallet must match search provider pay-to wallet");
  }

  return {
    status: "ok",
    serverName,
    tools,
    providerId,
    network: selectedProvider.network,
    asset: selectedProvider.asset,
    payToWallet: selectedProvider.payToWallet,
    maxAmountAtomic,
    providerAmountAtomic: selectedProvider.amountAtomic,
    executionMode,
    amountPaidAtomic,
    receiptId,
    receiptVerificationStatus,
    referrerCreditAtomic
  };
}

function readProvider(
  response: McpGatewayResponse,
  expectedProviderId: string
): {
  providerId: string;
  network: string;
  asset: string;
  payToWallet: string;
  amountAtomic: string;
} {
  const capabilities = readPath(response, [
    "result",
    "structuredContent",
    "capabilities"
  ]);
  if (!Array.isArray(capabilities)) {
    throw new Error("search capabilities result must be an array");
  }
  for (const capability of capabilities) {
    const providerId = readString(capability, ["providerId"], "provider id");
    if (providerId === expectedProviderId) {
      return {
        providerId,
        network: readString(capability, ["network"], "provider network"),
        asset: readString(capability, ["asset"], "provider asset"),
        amountAtomic: readString(
          capability,
          ["amountAtomic"],
          "provider amount"
        ),
        payToWallet: readString(
          capability,
          ["payToWallet"],
          "provider pay-to wallet"
        )
      };
    }
  }
  throw new Error(`search missing expected provider ${expectedProviderId}`);
}

async function callGateway(
  context: Parameters<typeof handleMcpGatewayLineAsync>[1],
  request: Record<string, unknown>
): Promise<McpGatewayResponse> {
  const response = await handleMcpGatewayLineAsync(
    JSON.stringify(request),
    context
  );
  if (response === undefined) {
    throw new Error(`gateway returned no response for ${String(request.id)}`);
  }
  if (response.error !== undefined) {
    throw new Error(
      `gateway ${String(request.id)} failed: ${response.error.message}`
    );
  }
  return response;
}

function readToolNames(response: McpGatewayResponse): string[] {
  const tools = readPath(response, ["result", "tools"]);
  if (!Array.isArray(tools)) {
    throw new Error("tools/list result.tools must be an array");
  }
  return tools.map((tool) => readString(tool, ["name"], "tool name"));
}

function assertTool(tools: string[], toolName: string): void {
  if (!tools.includes(toolName)) {
    throw new Error(`tools/list missing ${toolName}`);
  }
}

function readString(
  value: unknown,
  path: readonly string[],
  label: string
): string {
  const target = readPath(value, path);
  if (typeof target !== "string" || target.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return target;
}

function readAtomicAmount(value: string, label: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${label} must be a non-negative atomic amount string`);
  }
  return BigInt(value);
}

function readPath(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runMcpGatewaySmoke(), null, 2));
}
