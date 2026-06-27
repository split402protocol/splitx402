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
  const context = await createMcpGatewayContextFromEnv({
    env,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
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
        arguments: { capability },
      },
    },
  ];
  const transcript: TranscriptLine[] = [];
  let responseCount = 0;
  for (const request of requests) {
    transcript.push({ direction: "request", message: request });
    const response = await handleMcpGatewayLineAsync(
      JSON.stringify(request),
      context,
    );
    if (response !== undefined) {
      responseCount += 1;
      transcript.push({ direction: "response", message: response });
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
    requestCount: requests.length,
    responseCount,
  };
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
