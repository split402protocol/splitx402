import type { PayoutTransactionRecord } from "./payouts.js";
import {
  SolanaRpcPayoutTransactionFinalityMonitor,
  type SolanaPayoutFinalityResult
} from "./solana.js";

export interface PayoutFinalityFailoverDrillReport {
  schema: "split402.payout_finality_failover_drill.v1";
  passed: boolean;
  primaryRpcUrl: string;
  secondaryRpcUrl: string;
  requestedRpcUrls: string[];
  result: SolanaPayoutFinalityResult;
}

const DEFAULT_PRIMARY_RPC_URL = "https://primary-unavailable.invalid";
const DEFAULT_SECONDARY_RPC_URL = "https://secondary-healthy.invalid";
const DEFAULT_SIGNATURE =
  "5mR8Y6n3HfpLxq4NnEwD8phE8Ryj2N92dR6zM8GvG8eWm6vXg6UyY1uXo4gB4z8Gf9z9T4d2V5c7P8q9R1s2t3u";

export async function runPayoutFinalityFailoverDrill(input: {
  primaryRpcUrl?: string;
  secondaryRpcUrl?: string;
  signature?: string;
  fetch?: typeof fetch;
  now?: () => Date;
} = {}): Promise<PayoutFinalityFailoverDrillReport> {
  const primaryRpcUrl = input.primaryRpcUrl ?? DEFAULT_PRIMARY_RPC_URL;
  const secondaryRpcUrl = input.secondaryRpcUrl ?? DEFAULT_SECONDARY_RPC_URL;
  const signature = input.signature ?? DEFAULT_SIGNATURE;
  const requestedRpcUrls: string[] = [];
  const monitor = new SolanaRpcPayoutTransactionFinalityMonitor({
    network: "solana:devnet",
    rpcUrls: [primaryRpcUrl, secondaryRpcUrl],
    fetch:
      input.fetch ??
      createFailoverFetch({
        primaryRpcUrl,
        secondaryRpcUrl,
        requestedRpcUrls
      }),
    now: input.now ?? (() => new Date("2026-06-25T00:00:00.000Z"))
  });

  const result = await monitor.monitor({
    transaction: createSubmittedTransaction(signature)
  });
  const passed =
    result.status === "confirmed" &&
    result.rpcUrl === secondaryRpcUrl &&
    requestedRpcUrls[0] === primaryRpcUrl &&
    requestedRpcUrls[1] === secondaryRpcUrl;

  return {
    schema: "split402.payout_finality_failover_drill.v1",
    passed,
    primaryRpcUrl,
    secondaryRpcUrl,
    requestedRpcUrls,
    result
  };
}

function createFailoverFetch(input: {
  primaryRpcUrl: string;
  secondaryRpcUrl: string;
  requestedRpcUrls: string[];
}): typeof fetch {
  return (async (url: Parameters<typeof fetch>[0]) => {
    const rpcUrl = url.toString();
    input.requestedRpcUrls.push(rpcUrl);
    if (rpcUrl === input.primaryRpcUrl) {
      return createJsonResponse(503, {
        jsonrpc: "2.0",
        id: "split402-payout-finality-drill",
        error: {
          code: -32005,
          message: "primary RPC unavailable during failover drill"
        }
      }) as Response;
    }
    if (rpcUrl !== input.secondaryRpcUrl) {
      return createJsonResponse(404, {
        jsonrpc: "2.0",
        id: "split402-payout-finality-drill",
        error: { code: -32601, message: "unexpected RPC URL" }
      }) as Response;
    }
    return createJsonResponse(200, {
      jsonrpc: "2.0",
      id: "split402-payout-finality-drill",
      result: {
        value: [
          {
            slot: 1,
            confirmations: 1,
            confirmationStatus: "confirmed",
            err: null
          }
        ]
      }
    }) as Response;
  }) as typeof fetch;
}

function createSubmittedTransaction(signature: string): PayoutTransactionRecord {
  return {
    id: "ptx_failover_drill",
    payoutBatchId: "pbt_failover_drill",
    sequence: 0,
    attempt: 1,
    expectedSignature: signature,
    signedTransactionBase64: "AA==",
    status: "submitted",
    submittedAt: "2026-06-25T00:00:00.000Z",
    createdAt: "2026-06-25T00:00:00.000Z"
  };
}

function createJsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    }
  } as Response;
}

async function main(): Promise<void> {
  const report = await runPayoutFinalityFailoverDrill({
    ...(process.env.SPLIT402_PAYOUT_FINALITY_DRILL_PRIMARY_RPC_URL === undefined
      ? {}
      : {
          primaryRpcUrl:
            process.env.SPLIT402_PAYOUT_FINALITY_DRILL_PRIMARY_RPC_URL
        }),
    ...(process.env.SPLIT402_PAYOUT_FINALITY_DRILL_SECONDARY_RPC_URL ===
    undefined
      ? {}
      : {
          secondaryRpcUrl:
            process.env.SPLIT402_PAYOUT_FINALITY_DRILL_SECONDARY_RPC_URL
        }),
    ...(process.env.SPLIT402_PAYOUT_FINALITY_DRILL_SIGNATURE === undefined
      ? {}
      : { signature: process.env.SPLIT402_PAYOUT_FINALITY_DRILL_SIGNATURE })
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("payout-finality-failover-drill.ts") === true) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
