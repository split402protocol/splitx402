import { describe, expect, it } from "vitest";

import { derivePhase7ReceiptVerificationEvidence } from "../src/phase7ReceiptVerificationEvidence.js";

describe("Phase 7 receipt verification evidence", () => {
  it("derives a verified receipt evidence artifact from the paid-suite log", () => {
    const writes = new Map<string, string>();
    const evidence = derivePhase7ReceiptVerificationEvidence({
      paidSuiteLogPath: "evidence/paid-suite.log",
      outputPath: "evidence/receipt-verification.json",
      now: "2026-06-26T00:00:00.000Z",
      readArtifact: () => createPaidSuiteLog(),
      writeArtifact: (path, text) => writes.set(path, text),
    });

    expect(evidence).toMatchObject({
      schema: "split402.phase7_receipt_verification_evidence.v1",
      generatedAt: "2026-06-26T00:00:00.000Z",
      sourceLogPath: "evidence/paid-suite.log",
      receiptId: "rcp_valid",
      verificationStatus: "verified",
      split402ReceiptVerified: true,
      errors: [],
      validReceipt: {
        receiptId: "rcp_valid",
        paymentId: "pay_valid",
        commissionBps: 2000,
        commissionAmountAtomic: "2000",
        referrerCreditAtomic: "1800",
        settlementTxSignature: "tx_valid",
        routeId: "rte_001",
      },
      invalidClaimReceipt: {
        receiptId: "rcp_invalid",
        paymentId: "pay_invalid",
        commissionBps: 0,
        commissionAmountAtomic: "0",
        referrerCreditAtomic: "0",
        settlementTxSignature: "tx_invalid",
      },
    });
    expect(writes.get("evidence/receipt-verification.json")).toContain(
      '"schema": "split402.phase7_receipt_verification_evidence.v1"',
    );
  });

  it("derives receipt evidence from PowerShell UTF-16LE redirected logs", () => {
    const writes = new Map<string, string>();
    const utf16Log = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(createPaidSuiteLog(), "utf16le"),
    ]);

    const evidence = derivePhase7ReceiptVerificationEvidence({
      paidSuiteLogPath: "evidence/paid-suite.log",
      outputPath: "evidence/receipt-verification.json",
      now: "2026-06-26T00:00:00.000Z",
      readArtifact: () => utf16Log,
      writeArtifact: (path, text) => writes.set(path, text),
    });

    expect(evidence.receiptId).toBe("rcp_valid");
    expect(writes.get("evidence/receipt-verification.json")).toContain(
      '"split402ReceiptVerified": true',
    );
  });

  it("rejects paid-suite logs without a commission-bearing valid receipt", () => {
    expect(() =>
      derivePhase7ReceiptVerificationEvidence({
        paidSuiteLogPath: "evidence/paid-suite.log",
        outputPath: "evidence/receipt-verification.json",
        readArtifact: () =>
          createPaidSuiteLog({
            validReceipt: {
              receiptId: "rcp_valid",
              paymentId: "pay_valid",
              commissionBps: 0,
              commissionAmountAtomic: "0",
              referrerCreditAtomic: "0",
              settlementTxSignature: "tx_valid",
              routeId: "rte_001",
            },
          }),
        writeArtifact: () => undefined,
      }),
    ).toThrow("validReceipt must be commission-bearing");
  });
});

function createPaidSuiteLog(
  overrides: {
    validReceipt?: Record<string, unknown>;
    invalidReceipt?: Record<string, unknown>;
  } = {},
): string {
  return [
    "merchant ready at http://127.0.0.1:4021",
    JSON.stringify({ risk: "low" }),
    JSON.stringify(
      {
        paidSuitePassed: true,
        validReceipt: overrides.validReceipt ?? {
          receiptId: "rcp_valid",
          paymentId: "pay_valid",
          commissionBps: 2000,
          commissionAmountAtomic: "2000",
          referrerCreditAtomic: "1800",
          settlementTxSignature: "tx_valid",
          routeId: "rte_001",
        },
        invalidReceipt: overrides.invalidReceipt ?? {
          receiptId: "rcp_invalid",
          paymentId: "pay_invalid",
          commissionBps: 0,
          commissionAmountAtomic: "0",
          referrerCreditAtomic: "0",
          settlementTxSignature: "tx_invalid",
        },
      },
      null,
      2,
    ),
    "",
  ].join("\n");
}
