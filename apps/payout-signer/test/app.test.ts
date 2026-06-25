import {
  compileTransaction,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  address,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash
} from "@solana/kit";
import {
  createSolanaPayoutTransactionPlan,
  hashSolanaPayoutDestinationAmountList,
  type SolanaPayoutSignerPolicy
} from "@split402/control-plane";
import { createSampleProtocolArtifacts } from "@split402/protocol";
import request from "supertest";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createPayoutSignerApp,
  readPayoutSignerConfigFromEnv,
  type PayoutSignerAuditEvent
} from "../src/app.js";

const PRIVATE_KEY_BYTES = new Uint8Array(32).fill(7);
const SHARED_SECRET = "signer-shared-secret";
const NEXT_SHARED_SECRET = "next-signer-shared-secret";
const TIMESTAMP = "2026-06-24T00:00:00.000Z";

describe("payout signer app", () => {
  it("signs authorized policy-checked payout requests", async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(PRIVATE_KEY_BYTES);
    const { app, body } = await createFixture({ fundingWallet: signer.address });

    const response = await request(app)
      .post("/v1/solana/payouts/sign")
      .set(signHeaders(body))
      .send(body)
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        transactionIndex: 0,
        expectedSignature: expect.stringMatching(/^[1-9A-HJ-NP-Za-km-z]+$/u)
      })
    );
    const decoded = getTransactionDecoder().decode(
      Buffer.from(response.body.signedTransactionBase64 as string, "base64")
    );
    expect(decoded.signatures[signer.address]).not.toBeNull();
  });

  it("rejects missing signatures and signer policy mismatches", async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(PRIVATE_KEY_BYTES);
    const { app, body } = await createFixture({ fundingWallet: signer.address });

    await request(app)
      .post("/v1/solana/payouts/sign")
      .send(body)
      .expect(401);

    await request(app)
      .post("/v1/solana/payouts/sign")
      .set(signHeaders({ ...body, signerReference: "kms:other" }))
      .send({ ...body, signerReference: "kms:other" })
      .expect(403);
  });

  it("rejects destination amount list tampering", async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(PRIVATE_KEY_BYTES);
    const { app, body } = await createFixture({ fundingWallet: signer.address });
    const tampered = {
      ...body,
      amountAtomic: "1"
    };

    await request(app)
      .post("/v1/solana/payouts/sign")
      .set(signHeaders(tampered))
      .send(tampered)
      .expect(400);
  });

  it("supports active and retired HMAC auth keys for rotation", async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(PRIVATE_KEY_BYTES);
    const { app, body } = await createFixture({
      fundingWallet: signer.address,
      authKeys: [
        {
          keyId: "old-control-plane",
          sharedSecret: SHARED_SECRET,
          status: "retired"
        },
        {
          keyId: "new-control-plane",
          sharedSecret: NEXT_SHARED_SECRET,
          status: "active"
        }
      ]
    });

    await request(app)
      .post("/v1/solana/payouts/sign")
      .set(
        signHeaders(body, {
          keyId: "new-control-plane",
          sharedSecret: NEXT_SHARED_SECRET
        })
      )
      .send(body)
      .expect(200);

    await request(app)
      .post("/v1/solana/payouts/sign")
      .set(
        signHeaders(body, {
          keyId: "old-control-plane",
          sharedSecret: SHARED_SECRET
        })
      )
      .send(body)
      .expect(401);

    await request(app)
      .post("/v1/solana/payouts/sign")
      .set(signHeaders(body, { sharedSecret: NEXT_SHARED_SECRET }))
      .send(body)
      .expect(401);
  });

  it("reports auth key status without exposing secrets", async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(PRIVATE_KEY_BYTES);
    const { app } = await createFixture({
      fundingWallet: signer.address,
      authKeys: [
        {
          keyId: "current",
          sharedSecret: NEXT_SHARED_SECRET,
          status: "active"
        },
        {
          keyId: "previous",
          sharedSecret: SHARED_SECRET,
          status: "retired"
        }
      ]
    });

    const response = await request(app).get("/v1/health").expect(200);

    expect(response.body.authKeys).toEqual([
      { keyId: "current", status: "active" },
      { keyId: "previous", status: "retired" }
    ]);
    expect(JSON.stringify(response.body)).not.toContain(SHARED_SECRET);
    expect(JSON.stringify(response.body)).not.toContain(NEXT_SHARED_SECRET);
  });

  it("reports readiness only after signer key material initializes", async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(PRIVATE_KEY_BYTES);
    const { app } = await createFixture({
      fundingWallet: signer.address
    });

    await request(app).get("/v1/ready").expect(200, {
      status: "ready",
      service: "split402-payout-signer",
      signerReference: "kms:test-payout",
      network: "solana:devnet"
    });

    const notReadyApp = createPayoutSignerApp({
      signerReference: "kms:test-payout",
      network: "solana:devnet",
      expectedFundingWallet: signer.address,
      sharedSecret: SHARED_SECRET,
      port: 4022,
      privateKeyBase64: Buffer.from(new Uint8Array(31)).toString("base64")
    });

    const response = await request(notReadyApp).get("/v1/ready").expect(503);
    expect(response.body).toEqual(
      expect.objectContaining({
        status: "not_ready",
        service: "split402-payout-signer",
        message: "privateKeyBase64 must decode to 32 bytes"
      })
    );
  });

  it("records safe audit events and metrics for signed and rejected requests", async () => {
    const auditEvents: PayoutSignerAuditEvent[] = [];
    const signer = await createKeyPairSignerFromPrivateKeyBytes(PRIVATE_KEY_BYTES);
    const { app, body } = await createFixture({
      fundingWallet: signer.address,
      auditSink: (event) => {
        auditEvents.push(event);
      }
    });

    await request(app)
      .post("/v1/solana/payouts/sign")
      .set(signHeaders(body))
      .send(body)
      .expect(200);
    await request(app)
      .post("/v1/solana/payouts/sign")
      .set(signHeaders({ ...body, signerReference: "kms:other" }))
      .send({ ...body, signerReference: "kms:other" })
      .expect(403);

    const metricsResponse = await request(app).get("/v1/metrics").expect(200);
    expect(metricsResponse.body.metrics).toEqual(
      expect.objectContaining({
        requestsTotal: 2,
        signedTotal: 1,
        rejectedTotal: 1,
        rejectedByCode: {
          forbidden: 1
        }
      })
    );
    expect(auditEvents).toHaveLength(2);
    expect(auditEvents[0]).toEqual(
      expect.objectContaining({
        schema: "split402.payout_signer.audit_event.v1",
        outcome: "signed",
        statusCode: 200,
        code: "signed",
        signerReference: "kms:test-payout",
        batchId: body.batchId,
        transactionIndex: 0,
        amountAtomic: "3000",
        destinationAmountListHash: body.destinationAmountListHash,
        expectedSignature: expect.stringMatching(/^[1-9A-HJ-NP-Za-km-z]+$/u)
      })
    );
    expect(auditEvents[1]).toEqual(
      expect.objectContaining({
        outcome: "rejected",
        statusCode: 403,
        code: "forbidden",
        signerReference: "kms:test-payout",
        message: expect.stringContaining("signerReference")
      })
    );
    const serializedEvents = JSON.stringify(auditEvents);
    expect(serializedEvents).not.toContain(body.transactionBase64);
    expect(serializedEvents).not.toContain(SHARED_SECRET);
    expect(serializedEvents).not.toContain(NEXT_SHARED_SECRET);
  });

  it("loads configuration from environment variables", () => {
    expect(
      readPayoutSignerConfigFromEnv({
        SPLIT402_PAYOUT_SIGNER_SERVICE_REF: "kms:env-payout",
        SPLIT402_PAYOUT_SIGNER_SERVICE_NETWORK: "solana:devnet",
        SPLIT402_PAYOUT_SIGNER_SERVICE_EXPECTED_FUNDING_WALLET: "wallet",
        SPLIT402_PAYOUT_SIGNER_SERVICE_AUTH_KEYS_JSON: JSON.stringify([
          {
            keyId: "current",
            sharedSecret: "secret",
            status: "active"
          },
          {
            keyId: "previous",
            sharedSecret: "old-secret",
            status: "retired"
          }
        ]),
        SPLIT402_PAYOUT_SIGNER_SERVICE_PORT: "4999",
        SPLIT402_PAYOUT_SIGNER_SERVICE_PRIVATE_KEY_BASE64:
          Buffer.from(PRIVATE_KEY_BYTES).toString("base64")
      })
    ).toEqual(
      expect.objectContaining({
        signerReference: "kms:env-payout",
        network: "solana:devnet",
        port: 4999,
        authKeys: [
          {
            keyId: "current",
            sharedSecret: "secret",
            status: "active"
          },
          {
            keyId: "previous",
            sharedSecret: "old-secret",
            status: "retired"
          }
        ]
      })
    );
  });
});

async function createFixture(input: {
  fundingWallet: string;
  authKeys?: Parameters<typeof createPayoutSignerApp>[0]["authKeys"];
  auditSink?: Parameters<typeof createPayoutSignerApp>[0]["auditSink"];
}) {
  const receipt = createSampleProtocolArtifacts().artifacts.receipt;
  const batch = {
    id: "pbt_ffffffffffffffffffffffffffffffff",
    merchantId: receipt.merchantId,
    payoutWalletId: "mpw_ffffffffffffffffffffffffffffffff",
    network: "solana:devnet",
    asset: receipt.asset,
    status: "planned" as const,
    totalAmountAtomic: "3000",
    itemCount: 1,
    accrualCount: 1,
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    items: [
      {
        id: "pit_11111111111111111111111111111111",
        payoutBatchId: "pbt_ffffffffffffffffffffffffffffffff",
        destinationWallet: receipt.payoutWallet ?? receipt.payerWallet,
        destinationTokenAccount: receipt.payerWallet,
        asset: receipt.asset,
        amountAtomic: "3000",
        status: "allocated" as const,
        createdAt: "2026-06-24T00:00:00.000Z",
        allocations: [
          {
            id: "pal_11111111111111111111111111111111",
            payoutItemId: "pit_11111111111111111111111111111111",
            accrualId: "acr_11111111111111111111111111111111",
            amountAtomic: "3000"
          }
        ]
      }
    ]
  };
  const plan = await createSolanaPayoutTransactionPlan({
    batch,
    fundingWallet: input.fundingWallet,
    sourceTokenAccount: receipt.payerWallet,
    tokenDecimals: 6
  });
  const plannedTransaction = plan.transactions[0];
  if (plannedTransaction === undefined) {
    throw new Error("expected planned transaction");
  }
  const policy: SolanaPayoutSignerPolicy = {
    network: plan.network,
    signerReference: "kms:test-payout",
    fundingWallet: input.fundingWallet,
    sourceTokenAccount: plan.sourceTokenAccount,
    mint: plan.asset,
    allowedTokenProgramIds: [plan.tokenProgramId],
    maxTransactionAmountAtomic: "3000",
    expectedDestinationAmountListHash:
      hashSolanaPayoutDestinationAmountList(plan)
  };
  const body = {
    schema: "split402.solana.remote_payout_sign_request.v1",
    batchId: plan.batchId,
    network: plan.network,
    signerReference: "kms:test-payout",
    destinationAmountListHash: hashSolanaPayoutDestinationAmountList(plan),
    transactionIndex: 0,
    amountAtomic: "3000",
    transactionBase64: createUnsignedTransactionBase64(input.fundingWallet),
    plannedTransaction,
    policy
  };
  const app = createPayoutSignerApp({
    signerReference: "kms:test-payout",
    network: plan.network,
    expectedFundingWallet: input.fundingWallet,
    ...(input.authKeys === undefined
      ? { sharedSecret: SHARED_SECRET }
      : { authKeys: input.authKeys }),
    ...(input.auditSink === undefined ? {} : { auditSink: input.auditSink }),
    now: () => new Date(TIMESTAMP),
    port: 4022,
    privateKeyBytes: PRIVATE_KEY_BYTES
  });
  return { app, body };
}

function signHeaders(
  body: unknown,
  options: { keyId?: string; sharedSecret?: string } = {}
) {
  const rawBody = JSON.stringify(body);
  const digest = createHmac("sha256", options.sharedSecret ?? SHARED_SECRET)
    .update(`${TIMESTAMP}.${rawBody}`)
    .digest("hex");
  return {
    "x-split402-signature-timestamp": TIMESTAMP,
    "x-split402-signature": `v1=${digest}`,
    ...(options.keyId === undefined
      ? {}
      : { "x-split402-signer-key-id": options.keyId })
  };
}

function createUnsignedTransactionBase64(feePayer: string): string {
  return getBase64EncodedWireTransaction(
    compileTransaction(
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: feePayer as Blockhash,
          lastValidBlockHeight: 1n
        },
        setTransactionMessageFeePayer(
          address(feePayer),
          createTransactionMessage({ version: 0 })
        )
      )
    )
  );
}
