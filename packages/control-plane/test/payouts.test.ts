import { describe, expect, it } from "vitest";

import {
  attachPayoutTransactionItemMappings,
  comparePayoutTransactionsPendingFinality,
  createPayoutBatchPlan,
  createPayoutFinalizationLedgerTransaction,
  createMerchantObligationSummary,
  createPayoutPreview,
  createReferrerBalanceSummary,
  createReferrerPayoutHistoryItems,
  createSignedPayoutTransactionRecords,
  filterPayoutEligibleAccruals,
  isPayoutTransactionPendingFinality,
  normalizePayoutPendingFinalityLimit,
  releasePayoutBatchAllocationsForBatch,
  summarizePayoutBatchTransactionItemFinality,
  summarizePayoutBatchFinality,
  type CommissionAccrual,
  type PayoutBatchRecord,
  type PayoutTransactionRecord
} from "../src/index.js";

const NOW = "2026-06-24T00:10:00.000Z";

describe("payout pending finality helpers", () => {
  it("treats only submitted and confirmed transactions as pending finality", () => {
    const statuses: Array<[PayoutTransactionRecord["status"], boolean]> = [
      ["planned", false],
      ["signed", false],
      ["submitted", true],
      ["confirmed", true],
      ["finalized", false],
      ["expired", false],
      ["failed", false],
      ["outcome_unknown", false]
    ];
    for (const [status, expected] of statuses) {
      expect(
        isPayoutTransactionPendingFinality(
          createFinalityTransaction({ id: `ptx_${status}`, status })
        )
      ).toBe(expected);
    }
  });

  it("excludes signature-less transactions from pending finality", () => {
    const unsigned = createFinalityTransaction({ id: "ptx_unsigned" });
    delete unsigned.expectedSignature;
    expect(isPayoutTransactionPendingFinality(unsigned)).toBe(false);

    const emptySignature = createFinalityTransaction({
      id: "ptx_empty",
      expectedSignature: ""
    });
    expect(isPayoutTransactionPendingFinality(emptySignature)).toBe(false);
  });

  it("orders pending transactions by submission time with unsubmitted last", () => {
    const early = createFinalityTransaction({
      id: "ptx_early",
      submittedAt: "2026-06-24T00:01:00.000Z"
    });
    const late = createFinalityTransaction({
      id: "ptx_late",
      submittedAt: "2026-06-24T00:02:00.000Z"
    });
    const unsubmitted = createFinalityTransaction({ id: "ptx_none" });
    delete unsubmitted.submittedAt;
    const tieBreakByCreation = createFinalityTransaction({
      id: "ptx_tie",
      submittedAt: "2026-06-24T00:01:00.000Z",
      createdAt: "2026-06-24T00:00:30.000Z"
    });

    const sorted = [unsubmitted, late, early, tieBreakByCreation].sort(
      comparePayoutTransactionsPendingFinality
    );

    expect(sorted.map((transaction) => transaction.id)).toEqual([
      "ptx_tie",
      "ptx_early",
      "ptx_late",
      "ptx_none"
    ]);
  });

  it("normalizes the pending finality limit fail-closed", () => {
    expect(normalizePayoutPendingFinalityLimit(undefined)).toBe(25);
    expect(normalizePayoutPendingFinalityLimit(10)).toBe(10);
    expect(normalizePayoutPendingFinalityLimit(500)).toBe(100);
    expect(() => normalizePayoutPendingFinalityLimit(0)).toThrowError(
      "pending finality limit must be a positive integer"
    );
    expect(() => normalizePayoutPendingFinalityLimit(1.5)).toThrowError(
      "pending finality limit must be a positive integer"
    );
  });
});

function createFinalityTransaction(
  overrides: Partial<PayoutTransactionRecord> = {}
): PayoutTransactionRecord {
  return {
    id: "ptx_default",
    payoutBatchId: "pbt_default",
    sequence: 0,
    attempt: 1,
    expectedSignature: "sig_default",
    status: "submitted",
    submittedAt: "2026-06-24T00:01:00.000Z",
    createdAt: "2026-06-24T00:01:00.000Z",
    items: [],
    ...overrides
  };
}

describe("payout preview planner", () => {
  it("groups eligible accruals by asset and destination wallet", () => {
    const preview = createPayoutPreview({
      merchantId: "mrc_1",
      now: NOW,
      minimumPayoutAmountAtomic: "150",
      fundingBalances: [{ asset: "usdc_mint", amountAtomic: "250" }],
      accruals: [
        accrual({
          id: "acr_1",
          payoutWallet: "payout_a",
          amountAtomic: "100",
          availableAt: "2026-06-24T00:01:00Z"
        }),
        accrual({
          id: "acr_2",
          payoutWallet: "payout_a",
          amountAtomic: "80",
          availableAt: "2026-06-24T00:02:00Z"
        }),
        accrual({
          id: "acr_3",
          payoutWallet: "payout_b",
          amountAtomic: "90"
        }),
        accrual({ id: "acr_4", status: "pending_chain_verification" }),
        accrual({
          id: "acr_5",
          availableAt: "2026-06-24T00:12:00Z"
        }),
        accrual({ id: "acr_6", merchantId: "mrc_other" })
      ]
    });

    expect(preview.eligibleAccrualCount).toBe(2);
    expect(preview.totalAmountAtomicByAsset).toEqual({ usdc_mint: "180" });
    expect(preview.batches).toEqual([
      {
        merchantId: "mrc_1",
        asset: "usdc_mint",
        totalAmountAtomic: "180",
        itemCount: 1,
        accrualCount: 2,
        fundingStatus: "covered",
        fundingAmountAtomic: "250",
        fundingDeficitAtomic: "0",
        items: [
          {
            destinationWallet: "payout_a",
            referrerWallets: ["referrer_1"],
            amountAtomic: "180",
            accrualIds: ["acr_1", "acr_2"],
            oldestAvailableAt: "2026-06-24T00:01:00.000Z",
            newestAvailableAt: "2026-06-24T00:02:00.000Z"
          }
        ]
      }
    ]);
    expect(preview.skippedAccruals).toEqual(
      expect.arrayContaining([
        { accrualId: "acr_3", reason: "below_minimum_threshold" },
        { accrualId: "acr_4", reason: "not_available" },
        { accrualId: "acr_5", reason: "available_in_future" },
        { accrualId: "acr_6", reason: "merchant_mismatch" }
      ])
    );
  });

  it("reports funding deficits and recipient limits", () => {
    const preview = createPayoutPreview({
      merchantId: "mrc_1",
      now: NOW,
      maxRecipients: 1,
      fundingBalances: [{ asset: "usdc_mint", amountAtomic: "50" }],
      accruals: [
        accrual({
          id: "acr_1",
          payoutWallet: "payout_a",
          amountAtomic: "70",
          availableAt: "2026-06-24T00:01:00Z"
        }),
        accrual({
          id: "acr_2",
          payoutWallet: "payout_b",
          amountAtomic: "90",
          availableAt: "2026-06-24T00:03:00Z"
        })
      ]
    });

    expect(preview.batches[0]).toEqual(
      expect.objectContaining({
        totalAmountAtomic: "70",
        fundingStatus: "deficit",
        fundingAmountAtomic: "50",
        fundingDeficitAtomic: "20",
        itemCount: 1,
        accrualCount: 1
      })
    );
    expect(preview.skippedAccruals).toEqual([
      { accrualId: "acr_2", reason: "recipient_limit" }
    ]);
  });

  it("filters eligible accruals with merchant, asset, route, time, and limit", () => {
    const eligible = filterPayoutEligibleAccruals(
      [
        accrual({ id: "acr_1", routeId: "rte_1", availableAt: "2026-06-24T00:01:00Z" }),
        accrual({ id: "acr_2", routeId: "rte_1", availableAt: "2026-06-24T00:02:00Z" }),
        accrual({ id: "acr_3", routeId: "rte_2", availableAt: "2026-06-24T00:03:00Z" }),
        accrual({ id: "acr_4", asset: "other_mint" }),
        accrual({ id: "acr_5", status: "held" }),
        accrual({ id: "acr_6", availableAt: "2026-06-24T00:11:00Z" })
      ],
      {
        merchantId: "mrc_1",
        asset: "usdc_mint",
        routeId: "rte_1",
        now: NOW,
        limit: 1
      }
    );

    expect(eligible.map((item) => item.id)).toEqual(["acr_1"]);
  });

  it("creates a planned payout batch from selected preview items", () => {
    const batch = createPayoutBatchPlan({
      merchantId: "mrc_1",
      payoutWalletId: "mpw_ffffffffffffffffffffffffffffffff",
      network: "solana:devnet",
      asset: "usdc_mint",
      batchId: "pbt_ffffffffffffffffffffffffffffffff",
      itemIdFactory: () => "pit_ffffffffffffffffffffffffffffffff",
      now: NOW,
      accruals: [
        accrual({ id: "acr_1", payoutWallet: "payout_a", amountAtomic: "70" }),
        accrual({ id: "acr_2", payoutWallet: "payout_a", amountAtomic: "30" }),
        accrual({ id: "acr_3", payoutWallet: "payout_b", amountAtomic: "90" })
      ],
      maxRecipients: 1
    });

    expect(batch).toEqual(
      expect.objectContaining({
        id: "pbt_ffffffffffffffffffffffffffffffff",
        merchantId: "mrc_1",
        payoutWalletId: "mpw_ffffffffffffffffffffffffffffffff",
        network: "solana:devnet",
        asset: "usdc_mint",
        status: "planned",
        totalAmountAtomic: "100",
        itemCount: 1,
        accrualCount: 2
      })
    );
    expect(batch.items).toEqual([
      expect.objectContaining({
        destinationWallet: "payout_a",
        amountAtomic: "100",
        status: "allocated",
        allocations: [
          {
            payoutItemId: "pit_ffffffffffffffffffffffffffffffff",
            accrualId: "acr_1",
            amountAtomic: "70"
          },
          {
            payoutItemId: "pit_ffffffffffffffffffffffffffffffff",
            accrualId: "acr_2",
            amountAtomic: "30"
          }
        ]
      })
    ]);
  });
});

describe("signed payout transaction records", () => {
  it("creates signed transaction rows in deterministic sequence order", () => {
    const ids = [
      "ptx_11111111111111111111111111111111",
      "ptx_22222222222222222222222222222222"
    ];
    const records = createSignedPayoutTransactionRecords({
      payoutBatchId: "pbt_ffffffffffffffffffffffffffffffff",
      now: NOW,
      idFactory: () => {
        const id = ids.shift();
        if (id === undefined) {
          throw new Error("missing id");
        }
        return id;
      },
      transactions: [
        {
          sequence: 1,
          signedTransactionBase64: "BAUG",
          expectedSignature: "sig_1"
        },
        {
          sequence: 0,
          attempt: 2,
          recentBlockhash: "blockhash_0",
          lastValidBlockHeight: 123,
          signedTransactionBase64: "AQID",
          expectedSignature: "sig_0"
        }
      ]
    });

    expect(records).toEqual([
      {
        id: "ptx_11111111111111111111111111111111",
        payoutBatchId: "pbt_ffffffffffffffffffffffffffffffff",
        sequence: 0,
        attempt: 2,
        recentBlockhash: "blockhash_0",
        lastValidBlockHeight: 123,
        signedTransactionBase64: "AQID",
        expectedSignature: "sig_0",
        status: "signed",
        createdAt: NOW,
        items: []
      },
      {
        id: "ptx_22222222222222222222222222222222",
        payoutBatchId: "pbt_ffffffffffffffffffffffffffffffff",
        sequence: 1,
        attempt: 1,
        signedTransactionBase64: "BAUG",
        expectedSignature: "sig_1",
        status: "signed",
        createdAt: NOW,
        items: []
      }
    ]);
  });

  it("attaches and validates durable payout transaction item mappings", () => {
    const batch = finalizedBatch({
      status: "planned",
      itemStatus: "allocated"
    });
    const [record] = attachPayoutTransactionItemMappings(
      createSignedPayoutTransactionRecords({
        payoutBatchId: batch.id,
        now: NOW,
        transactions: [
          {
            sequence: 0,
            signedTransactionBase64: "AQID",
            items: [transactionItemInput(batch.items[0]!)]
          }
        ]
      }),
      batch
    );

    if (record === undefined) {
      throw new Error("expected payout transaction record");
    }
    expect(record?.items).toEqual([
      {
        payoutTransactionId: record.id,
        payoutItemId: batch.items[0]!.id,
        amountAtomic: batch.items[0]!.amountAtomic,
        destinationWallet: batch.items[0]!.destinationWallet
      }
    ]);
    expect(() =>
      attachPayoutTransactionItemMappings(
        createSignedPayoutTransactionRecords({
          payoutBatchId: batch.id,
          now: NOW,
          transactions: [
            {
              sequence: 0,
              signedTransactionBase64: "AQID",
              items: [
                {
                  ...transactionItemInput(batch.items[0]!),
                  amountAtomic: "1"
                }
              ]
            }
          ]
        }),
        batch
      )
    ).toThrow("payout transaction item amount mismatch");
  });

  it("rejects duplicate attempts, duplicate signatures, and invalid bytes", () => {
    expect(() =>
      createSignedPayoutTransactionRecords({
        payoutBatchId: "pbt_ffffffffffffffffffffffffffffffff",
        now: NOW,
        transactions: [
          { sequence: 0, signedTransactionBase64: "AQID" },
          { sequence: 0, signedTransactionBase64: "BAUG" }
        ]
      })
    ).toThrow("duplicate payout transaction sequence and attempt");
    expect(() =>
      createSignedPayoutTransactionRecords({
        payoutBatchId: "pbt_ffffffffffffffffffffffffffffffff",
        now: NOW,
        transactions: [
          { sequence: 0, signedTransactionBase64: "AQID", expectedSignature: "sig" },
          { sequence: 1, signedTransactionBase64: "BAUG", expectedSignature: "sig" }
        ]
      })
    ).toThrow("duplicate payout transaction expectedSignature");
    expect(() =>
      createSignedPayoutTransactionRecords({
        payoutBatchId: "pbt_ffffffffffffffffffffffffffffffff",
        now: NOW,
        transactions: [{ sequence: 0, signedTransactionBase64: "not-base64" }]
      })
    ).toThrow("signedTransactionBase64 must be base64");
  });
});

describe("payout batch finality rollup", () => {
  it("finalizes a batch only when all payout transactions are finalized", () => {
    expect(
      summarizePayoutBatchFinality([
        payoutTransaction({ id: "ptx_1", status: "finalized" }),
        payoutTransaction({ id: "ptx_2", sequence: 1, status: "finalized" })
      ])
    ).toEqual({
      batchStatus: "finalized",
      itemStatus: "finalized"
    });
    expect(
      summarizePayoutBatchFinality([
        payoutTransaction({ id: "ptx_1", status: "confirmed" }),
        payoutTransaction({ id: "ptx_2", sequence: 1, status: "finalized" })
      ])
    ).toEqual({
      batchStatus: "confirmed",
      itemStatus: "confirmed"
    });
  });

  it("keeps unknown outcomes allocated and marks failed transactions failed", () => {
    expect(
      summarizePayoutBatchFinality([
        payoutTransaction({ status: "outcome_unknown" })
      ])
    ).toEqual({
      batchStatus: "outcome_unknown",
      failureCode: "payout_transaction_outcome_unknown",
      failureMessage: "payout transaction outcome is unknown: ptx_1"
    });
    expect(
      summarizePayoutBatchFinality([
        payoutTransaction({
          status: "failed",
          error: { message: "insufficient funds" }
        })
      ])
    ).toEqual({
      batchStatus: "failed",
      itemStatus: "failed",
      failureCode: "payout_transaction_failed",
      failureMessage: "insufficient funds"
    });
  });

  it("rolls up finality only for items mapped to the finalized transaction", () => {
    const batch = finalizedBatch({ status: "submitted", itemStatus: "submitted" });
    const transactions = attachPayoutTransactionItemMappings(
      createSignedPayoutTransactionRecords({
        payoutBatchId: batch.id,
        now: NOW,
        transactions: [
          {
            sequence: 0,
            signedTransactionBase64: "AQID",
            items: [transactionItemInput(batch.items[0]!)]
          },
          {
            sequence: 1,
            signedTransactionBase64: "BAUG",
            items: [transactionItemInput(batch.items[1]!)]
          }
        ]
      }),
      batch
    );

    expect(
      summarizePayoutBatchTransactionItemFinality({
        batch,
        transactions: [
          { ...transactions[0]!, status: "finalized" },
          { ...transactions[1]!, status: "submitted" }
        ]
      })
    ).toEqual({
      batchStatus: "submitted",
      updatedItems: [
        {
          payoutItemId: batch.items[0]!.id,
          status: "finalized"
        }
      ]
    });
  });

  it("allows retry attempts to supersede failed transaction item groups", () => {
    const batch = finalizedBatch({ status: "submitted", itemStatus: "submitted" });
    const [failedAttempt, retryAttempt] = attachPayoutTransactionItemMappings(
      createSignedPayoutTransactionRecords({
        payoutBatchId: batch.id,
        now: NOW,
        transactions: [
          {
            sequence: 0,
            attempt: 1,
            signedTransactionBase64: "AQID",
            items: [transactionItemInput(batch.items[0]!)]
          },
          {
            sequence: 0,
            attempt: 2,
            signedTransactionBase64: "BAUG",
            items: [transactionItemInput(batch.items[0]!)]
          }
        ]
      }),
      batch
    );

    expect(
      summarizePayoutBatchTransactionItemFinality({
        batch,
        transactions: [
          { ...failedAttempt!, status: "failed", error: { message: "dropped" } },
          { ...retryAttempt!, status: "submitted" }
        ]
      })
    ).toEqual({
      batchStatus: "submitted",
      updatedItems: []
    });
  });

  it("finalizes the batch only after every mapped item group finalizes", () => {
    const batch = finalizedBatch({ status: "submitted", itemStatus: "submitted" });
    const transactions = attachPayoutTransactionItemMappings(
      createSignedPayoutTransactionRecords({
        payoutBatchId: batch.id,
        now: NOW,
        transactions: [
          {
            sequence: 0,
            signedTransactionBase64: "AQID",
            items: [transactionItemInput(batch.items[0]!)]
          },
          {
            sequence: 1,
            signedTransactionBase64: "BAUG",
            items: [transactionItemInput(batch.items[1]!)]
          }
        ]
      }),
      batch
    );

    expect(
      summarizePayoutBatchTransactionItemFinality({
        batch,
        transactions: transactions.map((transaction) => ({
          ...transaction,
          status: "finalized" as const
        }))
      })
    ).toEqual({
      batchStatus: "finalized",
      updatedItems: [
        { payoutItemId: batch.items[0]!.id, status: "finalized" },
        { payoutItemId: batch.items[1]!.id, status: "finalized" }
      ]
    });
  });
});

describe("payout allocation release", () => {
  it("cancels planned batches and marks items released", () => {
    const released = releasePayoutBatchAllocationsForBatch({
      batch: finalizedBatch({ status: "planned", itemStatus: "allocated" }),
      reason: "signer policy failed",
      now: "2026-06-24T00:11:00Z"
    });

    expect(released).toEqual(
      expect.objectContaining({
        status: "cancelled",
        failureCode: "allocations_released",
        failureMessage: "signer policy failed",
        updatedAt: "2026-06-24T00:11:00.000Z"
      })
    );
    expect(released.items.map((item) => item.status)).toEqual([
      "released",
      "released"
    ]);
  });

  it("does not release submitted or outcome-unknown batches", () => {
    expect(() =>
      releasePayoutBatchAllocationsForBatch({
        batch: finalizedBatch({ status: "submitted", itemStatus: "submitted" }),
        reason: "manual release"
      })
    ).toThrow("payout batch status submitted cannot release allocations");

    expect(() =>
      releasePayoutBatchAllocationsForBatch({
        batch: finalizedBatch({
          status: "outcome_unknown",
          itemStatus: "submitted"
        }),
        reason: "manual release"
      })
    ).toThrow("payout batch status outcome_unknown cannot release allocations");
  });
});

describe("payout finalization ledger", () => {
  it("creates a balanced ledger close for finalized payout items", () => {
    const ledger = createPayoutFinalizationLedgerTransaction({
      batch: finalizedBatch(),
      now: NOW,
      transactionId: "ldg_ffffffffffffffffffffffffffffffff",
      entryIdFactory: sequence([
        "lde_11111111111111111111111111111111",
        "lde_22222222222222222222222222222222",
        "lde_33333333333333333333333333333333"
      ])
    });

    expect(ledger).toEqual({
      id: "ldg_ffffffffffffffffffffffffffffffff",
      sourceType: "payout_batch",
      sourceId: "pbt_ffffffffffffffffffffffffffffffff",
      asset: "usdc_mint",
      createdAt: NOW,
      entries: [
        {
          id: "lde_11111111111111111111111111111111",
          transactionId: "ldg_ffffffffffffffffffffffffffffffff",
          accountType: "merchant_commission_liability",
          accountReference: "mrc_1",
          asset: "usdc_mint",
          amountAtomic: "100"
        },
        {
          id: "lde_22222222222222222222222222222222",
          transactionId: "ldg_ffffffffffffffffffffffffffffffff",
          accountType: "referrer_payable",
          accountReference: "payout_a",
          asset: "usdc_mint",
          amountAtomic: "-70"
        },
        {
          id: "lde_33333333333333333333333333333333",
          transactionId: "ldg_ffffffffffffffffffffffffffffffff",
          accountType: "referrer_payable",
          accountReference: "payout_b",
          asset: "usdc_mint",
          amountAtomic: "-30"
        }
      ]
    });
  });

  it("rejects ledger closure before all payout items finalize", () => {
    expect(() =>
      createPayoutFinalizationLedgerTransaction({
        batch: { ...finalizedBatch(), status: "confirmed" }
      })
    ).toThrow("payout batch must be finalized");
    expect(() =>
      createPayoutFinalizationLedgerTransaction({
        batch: {
          ...finalizedBatch(),
          items: [
            {
              ...finalizedBatch().items[0]!,
              status: "confirmed"
            }
          ]
        }
      })
    ).toThrow("all payout items must be finalized");
  });
});

describe("referrer payout views", () => {
  it("summarizes pending, available, in-flight, and paid balances", () => {
    const available = accrual({ id: "acr_available", amountAtomic: "50" });
    const pending = accrual({
      id: "acr_pending",
      amountAtomic: "70",
      status: "pending_chain_verification"
    });
    const inFlight = accrual({
      id: "acr_in_flight",
      amountAtomic: "90",
      status: "allocated"
    });
    const paid = accrual({
      id: "acr_paid",
      amountAtomic: "110",
      status: "allocated"
    });
    const batch = finalizedBatch();
    const viewBatch: PayoutBatchRecord = {
      ...batch,
      items: [
        {
          ...batch.items[0]!,
          status: "submitted",
          amountAtomic: "90",
          allocations: [
            {
              payoutItemId: batch.items[0]!.id,
              accrualId: inFlight.id,
              amountAtomic: "90"
            }
          ]
        },
        {
          ...batch.items[1]!,
          status: "finalized",
          amountAtomic: "110",
          allocations: [
            {
              payoutItemId: batch.items[1]!.id,
              accrualId: paid.id,
              amountAtomic: "110"
            }
          ]
        }
      ]
    };

    const summary = createReferrerBalanceSummary({
      referrerWallet: "referrer_1",
      now: NOW,
      accruals: [available, pending, inFlight, paid],
      payoutBatches: [viewBatch]
    });
    const history = createReferrerPayoutHistoryItems({
      referrerWallet: "referrer_1",
      accruals: [available, pending, inFlight, paid],
      payoutBatches: [viewBatch]
    });

    expect(summary.assets).toEqual([
      {
        asset: "usdc_mint",
        pendingAmountAtomic: "70",
        availableAmountAtomic: "50",
        heldAmountAtomic: "0",
        inFlightAmountAtomic: "90",
        paidAmountAtomic: "110",
        totalEarnedAmountAtomic: "320"
      }
    ]);
    expect(history.map((item) => item.status).sort()).toEqual([
      "available",
      "in_flight",
      "paid",
      "pending"
    ]);
  });

  it("does not paginate balance summaries", () => {
    const accruals = Array.from({ length: 55 }, (_, index) =>
      accrual({
        id: `acr_${index.toString().padStart(2, "0")}`,
        amountAtomic: "1"
      })
    );

    const summary = createReferrerBalanceSummary({
      referrerWallet: "referrer_1",
      now: NOW,
      accruals,
      payoutBatches: []
    });

    expect(summary.assets[0]?.availableAmountAtomic).toBe("55");
    expect(summary.assets[0]?.totalEarnedAmountAtomic).toBe("55");
  });
});

describe("merchant obligation views", () => {
  it("summarizes merchant obligations by lifecycle status", () => {
    const inFlight = accrual({
      id: "acr_in_flight",
      amountAtomic: "90",
      status: "allocated"
    });
    const paid = accrual({
      id: "acr_paid",
      amountAtomic: "110",
      status: "allocated"
    });
    const summary = createMerchantObligationSummary({
      merchantId: "mrc_1",
      now: NOW,
      accruals: [
        accrual({
          id: "acr_pending",
          amountAtomic: "70",
          status: "pending_chain_verification"
        }),
        accrual({ id: "acr_available", amountAtomic: "50" }),
        accrual({ id: "acr_held", amountAtomic: "30", status: "held" }),
        inFlight,
        paid,
        accrual({ id: "acr_other", merchantId: "mrc_other", amountAtomic: "999" })
      ],
      payoutBatches: [
        {
          ...finalizedBatch(),
          items: [
            {
              ...finalizedBatch().items[0]!,
              id: "pit_in_flight",
              status: "submitted",
              amountAtomic: "90",
              allocations: [
                {
                  payoutItemId: "pit_in_flight",
                  accrualId: inFlight.id,
                  amountAtomic: "90"
                }
              ]
            },
            {
              ...finalizedBatch().items[1]!,
              id: "pit_paid",
              amountAtomic: "110",
              allocations: [
                {
                  payoutItemId: "pit_paid",
                  accrualId: paid.id,
                  amountAtomic: "110"
                }
              ]
            }
          ]
        }
      ]
    });

    expect(summary).toEqual({
      schema: "split402.merchant_obligation_summary.v1",
      merchantId: "mrc_1",
      generatedAt: NOW,
      assets: [
        {
          asset: "usdc_mint",
          fundingStatus: "unknown",
          pendingAmountAtomic: "70",
          availableAmountAtomic: "50",
          heldAmountAtomic: "30",
          inFlightAmountAtomic: "90",
          paidAmountAtomic: "110",
          outstandingAmountAtomic: "240",
          totalAccruedAmountAtomic: "350",
          accrualCount: 5,
          pendingAccrualCount: 1,
          availableAccrualCount: 1,
          heldAccrualCount: 1,
          inFlightAccrualCount: 1,
          paidAccrualCount: 1
        }
      ]
    });
  });

  it("reports covered and deficit funding status when balances are supplied", () => {
    const covered = createMerchantObligationSummary({
      merchantId: "mrc_1",
      now: NOW,
      fundingBalances: [{ asset: "usdc_mint", amountAtomic: "250" }],
      accruals: [
        accrual({ id: "acr_available", amountAtomic: "200" })
      ],
      payoutBatches: []
    });
    const deficit = createMerchantObligationSummary({
      merchantId: "mrc_1",
      now: NOW,
      fundingBalances: [{ asset: "usdc_mint", amountAtomic: "120" }],
      accruals: [
        accrual({ id: "acr_available", amountAtomic: "200" })
      ],
      payoutBatches: []
    });

    expect(covered.assets[0]).toEqual(
      expect.objectContaining({
        fundingStatus: "covered",
        fundingAmountAtomic: "250",
        fundingDeficitAtomic: "0",
        outstandingAmountAtomic: "200"
      })
    );
    expect(deficit.assets[0]).toEqual(
      expect.objectContaining({
        fundingStatus: "deficit",
        fundingAmountAtomic: "120",
        fundingDeficitAtomic: "80",
        outstandingAmountAtomic: "200"
      })
    );
  });
});

function accrual(overrides: Partial<CommissionAccrual> = {}): CommissionAccrual {
  return {
    id: "acr_0",
    receiptId: "rcp_0",
    merchantId: "mrc_1",
    campaignId: "cmp_1",
    routeId: "rte_1",
    referrerWallet: "referrer_1",
    payoutWallet: "payout_default",
    asset: "usdc_mint",
    amountAtomic: "100",
    status: "available",
    availableAt: "2026-06-24T00:00:00.000Z",
    createdAt: "2026-06-24T00:00:00.000Z",
    ...overrides
  };
}

function finalizedBatch(
  options: {
    status?: PayoutBatchRecord["status"];
    itemStatus?: PayoutBatchRecord["items"][number]["status"];
  } = {}
): PayoutBatchRecord {
  const status = options.status ?? "finalized";
  const itemStatus = options.itemStatus ?? "finalized";
  return {
    id: "pbt_ffffffffffffffffffffffffffffffff",
    merchantId: "mrc_1",
    payoutWalletId: "mpw_ffffffffffffffffffffffffffffffff",
    network: "solana:devnet",
    asset: "usdc_mint",
    status,
    totalAmountAtomic: "100",
    itemCount: 2,
    accrualCount: 2,
    createdAt: NOW,
    updatedAt: NOW,
    items: [
      {
        id: "pit_11111111111111111111111111111111",
        payoutBatchId: "pbt_ffffffffffffffffffffffffffffffff",
        destinationWallet: "payout_a",
        amountAtomic: "70",
        status: itemStatus,
        createdAt: NOW,
        allocations: [
          {
            payoutItemId: "pit_11111111111111111111111111111111",
            accrualId: "acr_1",
            amountAtomic: "70"
          }
        ]
      },
      {
        id: "pit_22222222222222222222222222222222",
        payoutBatchId: "pbt_ffffffffffffffffffffffffffffffff",
        destinationWallet: "payout_b",
        amountAtomic: "30",
        status: itemStatus,
        createdAt: NOW,
        allocations: [
          {
            payoutItemId: "pit_22222222222222222222222222222222",
            accrualId: "acr_2",
            amountAtomic: "30"
          }
        ]
      }
    ]
  };
}

function transactionItemInput(item: PayoutBatchRecord["items"][number]) {
  return {
    payoutItemId: item.id,
    amountAtomic: item.amountAtomic,
    destinationWallet: item.destinationWallet,
    ...(item.destinationTokenAccount === undefined
      ? {}
      : { destinationTokenAccount: item.destinationTokenAccount })
  };
}

function payoutTransaction(
  overrides: Partial<PayoutTransactionRecord> = {}
): PayoutTransactionRecord {
  const transaction: PayoutTransactionRecord = {
    id: "ptx_1",
    payoutBatchId: "pbt_ffffffffffffffffffffffffffffffff",
    sequence: 0,
    attempt: 1,
    status: "submitted",
    createdAt: NOW,
    items: []
  };
  return {
    ...transaction,
    ...overrides,
    items: overrides.items ?? transaction.items
  };
}

function sequence(values: string[]): () => string {
  return () => {
    const value = values.shift();
    if (value === undefined) {
      throw new Error("sequence exhausted");
    }
    return value;
  };
}
