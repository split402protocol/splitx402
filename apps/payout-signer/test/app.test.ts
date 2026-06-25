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

import { createPayoutSignerApp, readPayoutSignerConfigFromEnv } from "../src/app.js";

const PRIVATE_KEY_BYTES = new Uint8Array(32).fill(7);
const SHARED_SECRET = "signer-shared-secret";
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

  it("loads configuration from environment variables", () => {
    expect(
      readPayoutSignerConfigFromEnv({
        SPLIT402_PAYOUT_SIGNER_SERVICE_REF: "kms:env-payout",
        SPLIT402_PAYOUT_SIGNER_SERVICE_NETWORK: "solana:devnet",
        SPLIT402_PAYOUT_SIGNER_SERVICE_EXPECTED_FUNDING_WALLET: "wallet",
        SPLIT402_PAYOUT_SIGNER_SERVICE_SHARED_SECRET: "secret",
        SPLIT402_PAYOUT_SIGNER_SERVICE_PORT: "4999",
        SPLIT402_PAYOUT_SIGNER_SERVICE_PRIVATE_KEY_BASE64:
          Buffer.from(PRIVATE_KEY_BYTES).toString("base64")
      })
    ).toEqual(
      expect.objectContaining({
        signerReference: "kms:env-payout",
        network: "solana:devnet",
        port: 4999
      })
    );
  });
});

async function createFixture(input: { fundingWallet: string }) {
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
    sharedSecret: SHARED_SECRET,
    port: 4022,
    privateKeyBytes: PRIVATE_KEY_BYTES
  });
  return { app, body };
}

function signHeaders(body: unknown) {
  const rawBody = JSON.stringify(body);
  const digest = createHmac("sha256", SHARED_SECRET)
    .update(`${TIMESTAMP}.${rawBody}`)
    .digest("hex");
  return {
    "x-split402-signature-timestamp": TIMESTAMP,
    "x-split402-signature": `v1=${digest}`
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
