import { describe, expect, it } from "vitest";

import {
  createPayoutPreview,
  filterPayoutEligibleAccruals,
  type CommissionAccrual
} from "../src/index.js";

const NOW = "2026-06-24T00:10:00.000Z";

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
