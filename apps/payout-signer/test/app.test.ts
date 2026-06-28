import {
  compileTransaction,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  appendTransactionMessageInstruction,
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
  type SolanaPayoutInstructionPlan,
  type SolanaPayoutPlannedTransaction,
  type SolanaPayoutSignerPolicy
} from "@split402/control-plane";
import { createSampleProtocolArtifacts } from "@split402/protocol";
import request from "supertest";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createPayoutSignerJsonlAuditSink,
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

  it("rejects stale and future HMAC timestamps", async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(PRIVATE_KEY_BYTES);
    const { app, body } = await createFixture({
      fundingWallet: signer.address,
      signatureToleranceSeconds: 60
    });

    await request(app)
      .post("/v1/solana/payouts/sign")
      .set(signHeaders(body, { timestamp: "2026-06-23T23:58:59.000Z" }))
      .send(body)
      .expect(401);

    await request(app)
      .post("/v1/solana/payouts/sign")
      .set(signHeaders(body, { timestamp: "2026-06-24T00:01:01.000Z" }))
      .send(body)
      .expect(401);

    await request(app)
      .post("/v1/solana/payouts/sign")
      .set(signHeaders(body, { timestamp: "not-a-timestamp" }))
      .send(body)
      .expect(401);
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

  it("rejects transaction bytes that do not match the approved plan", async () => {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(PRIVATE_KEY_BYTES);
    const { app, body, plan, plannedTransaction } = await createFixture({
      fundingWallet: signer.address
    });
    const tampered = {
      ...body,
      transactionBase64: createUnsignedTransactionBase64(
        plan.fundingWallet,
        plannedTransaction,
        {
          mutateTransfer: (instruction) => ({
            ...instruction,
            amountAtomic: "1"
          })
        }
      )
    };

    const response = await request(app)
      .post("/v1/solana/payouts/sign")
      .set(signHeaders(tampered))
      .send(tampered)
      .expect(400);

    expect(response.body.message).toContain(
      "transaction bytes do not match approved payout plan"
    );
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

  it("writes safe JSONL audit events when enabled from environment", async () => {
    const auditLines: string[] = [];
    const config = readPayoutSignerConfigFromEnv(
      {
        SPLIT402_PAYOUT_SIGNER_SERVICE_REF: "kms:env-payout",
        SPLIT402_PAYOUT_SIGNER_SERVICE_NETWORK: "solana:devnet",
        SPLIT402_PAYOUT_SIGNER_SERVICE_EXPECTED_FUNDING_WALLET: "wallet",
        SPLIT402_PAYOUT_SIGNER_SERVICE_SHARED_SECRET: SHARED_SECRET,
        SPLIT402_PAYOUT_SIGNER_SERVICE_AUDIT_LOG: "stdout-jsonl",
        SPLIT402_PAYOUT_SIGNER_SERVICE_PRIVATE_KEY_BASE64:
          Buffer.from(PRIVATE_KEY_BYTES).toString("base64")
      },
      {
        auditLogWriter: (line) => {
          auditLines.push(line);
        }
      }
    );

    expect(config.auditSink).toBeDefined();
    await config.auditSink?.({
      schema: "split402.payout_signer.audit_event.v1",
      observedAt: TIMESTAMP,
      outcome: "rejected",
      statusCode: 401,
      code: "unauthorized",
      signerReference: "kms:env-payout",
      network: "solana:devnet",
      message: "invalid request signature"
    });

    expect(auditLines).toHaveLength(1);
    expect(JSON.parse(auditLines[0] ?? "{}")).toEqual({
      schema: "split402.payout_signer.audit_event.v1",
      observedAt: TIMESTAMP,
      outcome: "rejected",
      statusCode: 401,
      code: "unauthorized",
      signerReference: "kms:env-payout",
      network: "solana:devnet",
      message: "invalid request signature"
    });
    expect(auditLines[0]).not.toContain(SHARED_SECRET);
  });

  it("rejects unknown audit log modes", () => {
    expect(() =>
      readPayoutSignerConfigFromEnv({
        SPLIT402_PAYOUT_SIGNER_SERVICE_REF: "kms:env-payout",
        SPLIT402_PAYOUT_SIGNER_SERVICE_NETWORK: "solana:devnet",
        SPLIT402_PAYOUT_SIGNER_SERVICE_EXPECTED_FUNDING_WALLET: "wallet",
        SPLIT402_PAYOUT_SIGNER_SERVICE_SHARED_SECRET: SHARED_SECRET,
        SPLIT402_PAYOUT_SIGNER_SERVICE_AUDIT_LOG: "file",
        SPLIT402_PAYOUT_SIGNER_SERVICE_PRIVATE_KEY_BASE64:
          Buffer.from(PRIVATE_KEY_BYTES).toString("base64")
      })
    ).toThrow(
      "SPLIT402_PAYOUT_SIGNER_SERVICE_AUDIT_LOG must be off or stdout-jsonl"
    );
  });

  it("creates JSONL audit sinks", async () => {
    const auditLines: string[] = [];
    const sink = createPayoutSignerJsonlAuditSink((line) => {
      auditLines.push(line);
    });

    await sink({
      schema: "split402.payout_signer.audit_event.v1",
      observedAt: TIMESTAMP,
      outcome: "signed",
      statusCode: 200,
      code: "signed",
      signerReference: "kms:test-payout",
      network: "solana:devnet",
      batchId: "pbt_ffffffffffffffffffffffffffffffff"
    });

    expect(JSON.parse(auditLines[0] ?? "{}")).toEqual(
      expect.objectContaining({
        schema: "split402.payout_signer.audit_event.v1",
        outcome: "signed",
        code: "signed",
        batchId: "pbt_ffffffffffffffffffffffffffffffff"
      })
    );
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
        SPLIT402_PAYOUT_SIGNER_SERVICE_SIGNATURE_TOLERANCE_SECONDS: "120",
        SPLIT402_PAYOUT_SIGNER_SERVICE_PRIVATE_KEY_BASE64:
          Buffer.from(PRIVATE_KEY_BYTES).toString("base64")
      })
    ).toEqual(
      expect.objectContaining({
        signerReference: "kms:env-payout",
        network: "solana:devnet",
        port: 4999,
        signatureToleranceSeconds: 120,
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
  signatureToleranceSeconds?: number;
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
    transactionBase64: createUnsignedTransactionBase64(
      input.fundingWallet,
      plannedTransaction
    ),
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
    ...(input.signatureToleranceSeconds === undefined
      ? {}
      : { signatureToleranceSeconds: input.signatureToleranceSeconds }),
    now: () => new Date(TIMESTAMP),
    port: 4022,
    privateKeyBytes: PRIVATE_KEY_BYTES
  });
  return { app, body, plan, plannedTransaction };
}

function signHeaders(
  body: unknown,
  options: { keyId?: string; sharedSecret?: string; timestamp?: string } = {}
) {
  const rawBody = JSON.stringify(body);
  const timestamp = options.timestamp ?? TIMESTAMP;
  const digest = createHmac("sha256", options.sharedSecret ?? SHARED_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return {
    "x-split402-signature-timestamp": timestamp,
    "x-split402-signature": `v1=${digest}`,
    ...(options.keyId === undefined
      ? {}
      : { "x-split402-signer-key-id": options.keyId })
  };
}

function createUnsignedTransactionBase64(
  feePayer: string,
  plannedTransaction: SolanaPayoutPlannedTransaction,
  options: {
    mutateTransfer?: (
      instruction: Extract<SolanaPayoutInstructionPlan, { kind: "transferChecked" }>
    ) => Extract<SolanaPayoutInstructionPlan, { kind: "transferChecked" }>;
  } = {}
): string {
  const message = setTransactionMessageLifetimeUsingBlockhash(
    {
      blockhash: feePayer as Blockhash,
      lastValidBlockHeight: 1n
    },
    setTransactionMessageFeePayer(
      address(feePayer),
      createTransactionMessage({ version: 0 })
    )
  );
  let messageWithInstructions: unknown = message;
  for (const instruction of plannedTransaction.instructions) {
    const nextInstruction =
      instruction.kind === "transferChecked" && options.mutateTransfer !== undefined
        ? options.mutateTransfer(instruction)
        : instruction;
    messageWithInstructions = appendTransactionMessageInstruction(
      toSolanaInstruction(nextInstruction),
      messageWithInstructions as Parameters<typeof appendTransactionMessageInstruction>[1]
    );
  }
  return getBase64EncodedWireTransaction(
    compileTransaction(messageWithInstructions as Parameters<typeof compileTransaction>[0])
  );
}

function toSolanaInstruction(instruction: SolanaPayoutInstructionPlan) {
  if (instruction.kind === "createAssociatedTokenIdempotent") {
    return {
      programAddress: address(instruction.programId),
      accounts: [
        { address: address(instruction.payer), role: 1 },
        { address: address(instruction.associatedTokenAccount), role: 1 },
        { address: address(instruction.owner), role: 0 },
        { address: address(instruction.mint), role: 0 },
        { address: address("11111111111111111111111111111111"), role: 0 },
        { address: address(instruction.tokenProgramId), role: 0 }
      ],
      data: new Uint8Array([1])
    };
  }
  return {
    programAddress: address(instruction.programId),
    accounts: [
      { address: address(instruction.source), role: 1 },
      { address: address(instruction.mint), role: 0 },
      { address: address(instruction.destination), role: 1 },
      { address: address(instruction.authority), role: 0 }
    ],
    data: transferCheckedData(instruction.amountAtomic, instruction.decimals)
  };
}

function transferCheckedData(amountAtomic: string, decimals: number): Uint8Array {
  const data = new Uint8Array(10);
  data[0] = 12;
  let amount = BigInt(amountAtomic);
  for (let index = 0; index < 8; index += 1) {
    data[index + 1] = Number(amount & 0xffn);
    amount >>= 8n;
  }
  data[9] = decimals;
  return data;
}
