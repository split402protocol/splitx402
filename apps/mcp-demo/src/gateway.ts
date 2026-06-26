import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { createMcpDemoBundle, type McpDemoBundle } from "./index.js";

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

export function handleMcpGatewayLine(
  line: string,
  bundle: McpDemoBundle = createMcpDemoBundle(),
): McpGatewayResponse | undefined {
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
        name: bundle.mcp.serverName,
        version: "0.1.0"
      }
    });
  }

  if (request.method === "tools/list") {
    return createResultResponse(id, {
      tools: bundle.mcp.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    });
  }

  if (request.method === "tools/call") {
    return handleToolCall(id, request.params, bundle);
  }

  return createErrorResponse(id, -32601, "Method not found");
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
  const bundle = createMcpDemoBundle();
  const reader = createInterface({
    input,
    crlfDelay: Number.POSITIVE_INFINITY,
    terminal: false
  });

  for await (const line of reader) {
    if (line.trim().length === 0) {
      continue;
    }
    const response = handleMcpGatewayLine(line, bundle);
    if (response !== undefined) {
      output.write(`${JSON.stringify(response)}\n`);
    }
  }
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runMcpGateway();
}
