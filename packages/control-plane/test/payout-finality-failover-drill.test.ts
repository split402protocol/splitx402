import { describe, expect, it } from "vitest";

import { runPayoutFinalityFailoverDrill } from "../src/payout-finality-failover-drill.js";

describe("payout finality failover drill", () => {
  it("passes only when finality is read from the secondary RPC", async () => {
    await expect(runPayoutFinalityFailoverDrill()).resolves.toEqual(
      expect.objectContaining({
        schema: "split402.payout_finality_failover_drill.v1",
        passed: true,
        primaryRpcUrl: "https://primary-unavailable.invalid",
        secondaryRpcUrl: "https://secondary-healthy.invalid",
        requestedRpcUrls: [
          "https://primary-unavailable.invalid",
          "https://secondary-healthy.invalid"
        ],
        result: expect.objectContaining({
          status: "confirmed",
          rpcUrl: "https://secondary-healthy.invalid"
        })
      })
    );
  });

  it("fails when no secondary confirmation is observed", async () => {
    const report = await runPayoutFinalityFailoverDrill({
      fetch: (async () =>
        ({
          status: 503,
          ok: false,
          async json() {
            return {
              jsonrpc: "2.0",
              id: "split402-payout-finality-drill",
              error: { code: -32005, message: "unavailable" }
            };
          }
        }) as Response) as typeof fetch
    });

    expect(report.passed).toBe(false);
    expect(report.result.status).toBe("retry");
  });
});
