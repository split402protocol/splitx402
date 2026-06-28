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
  executionMode: string;
  amountPaidAtomic: string;
  receiptId: string;
  receiptVerificationStatus: string;
  referrerCreditAtomic: string;
}

export async function runMcpGatewaySmoke(): Promise<McpGatewaySmokeReport> {
  const context = createMcpGatewayContext();

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

  await callGateway(context, {
    jsonrpc: "2.0",
    id: "smoke-search",
    method: "tools/call",
    params: {
      name: "split402.searchCapabilities",
      arguments: {
        capability: "solana.wallet-risk"
      }
    }
  });

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
          maxAmountAtomic: "50000"
        }
      }
    }
  });
  const providerId = readString(
    executed,
    ["result", "structuredContent", "providerId"],
    "execute provider id"
  );
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

  await callGateway(context, {
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

  return {
    status: "ok",
    serverName,
    tools,
    providerId,
    executionMode,
    amountPaidAtomic,
    receiptId,
    receiptVerificationStatus,
    referrerCreditAtomic
  };
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
