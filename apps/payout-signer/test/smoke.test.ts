import { describe, expect, it } from "vitest";

import {
  readPayoutSignerSmokeCheckFromEnv,
  runPayoutSignerSmokeCheck
} from "../src/smoke.js";

describe("payout signer smoke check", () => {
  it("checks health, readiness, and metrics", async () => {
    const requestedUrls: string[] = [];
    const result = await runPayoutSignerSmokeCheck({
      baseUrl: "https://signer.example/",
      fetch: createFetch({
        "https://signer.example/v1/health": {
          status: "ok",
          service: "split402-payout-signer",
          signerReference: "kms:split402-devnet-payout",
          network: "solana:devnet"
        },
        "https://signer.example/v1/ready": {
          status: "ready",
          service: "split402-payout-signer",
          signerReference: "kms:split402-devnet-payout",
          network: "solana:devnet"
        },
        "https://signer.example/v1/metrics": {
          metrics: {
            service: "split402-payout-signer",
            signerReference: "kms:split402-devnet-payout",
            network: "solana:devnet",
            requestsTotal: 2,
            signedTotal: 1,
            rejectedTotal: 1,
            rejectedByCode: {
              unauthorized: 1
            }
          }
        }
      }, requestedUrls)
    });

    expect(result).toEqual({
      signerReference: "kms:split402-devnet-payout",
      network: "solana:devnet",
      metrics: {
        requestsTotal: 2,
        signedTotal: 1,
        rejectedTotal: 1
      }
    });
    expect(requestedUrls).toEqual([
      "https://signer.example/v1/health",
      "https://signer.example/v1/ready",
      "https://signer.example/v1/metrics"
    ]);
  });

  it("fails when readiness is not healthy", async () => {
    await expect(
      runPayoutSignerSmokeCheck({
        baseUrl: "https://signer.example",
        fetch: createFetch({
          "https://signer.example/v1/health": {
            status: "ok",
            service: "split402-payout-signer",
            signerReference: "kms:split402-devnet-payout",
            network: "solana:devnet"
          },
          "https://signer.example/v1/ready": {
            status: "not_ready",
            service: "split402-payout-signer"
          }
        })
      })
    ).rejects.toThrow("readiness status mismatch");
  });

  it("fails if endpoint responses expose configured secrets", async () => {
    await expect(
      runPayoutSignerSmokeCheck({
        baseUrl: "https://signer.example",
        forbiddenSubstrings: ["super-secret"],
        fetch: createFetch({
          "https://signer.example/v1/health": {
            status: "ok",
            service: "split402-payout-signer",
            signerReference: "kms:super-secret",
            network: "solana:devnet"
          }
        })
      })
    ).rejects.toThrow("health response exposed a configured secret");
  });

  it("loads smoke configuration from environment", () => {
    expect(
      readPayoutSignerSmokeCheckFromEnv({
        SPLIT402_PAYOUT_SIGNER_URL: "https://signer.example",
        SPLIT402_PAYOUT_SIGNER_SERVICE_SHARED_SECRET: "shared-secret",
        SPLIT402_PAYOUT_SIGNER_SERVICE_PRIVATE_KEY_BASE64: "private-key"
      })
    ).toEqual({
      baseUrl: "https://signer.example",
      forbiddenSubstrings: ["shared-secret", "private-key"]
    });
  });
});

function createFetch(
  responses: Record<string, unknown>,
  requestedUrls: string[] = []
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = input.toString();
    requestedUrls.push(url);
    const body = responses[url];
    if (body === undefined) {
      return createResponse(404, { error: "not_found" }) as Response;
    }
    return createResponse(200, body) as Response;
  }) as typeof fetch;
}

function createResponse(status: number, body: unknown) {
  const raw = JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
    async text() {
      return raw;
    }
  };
}
