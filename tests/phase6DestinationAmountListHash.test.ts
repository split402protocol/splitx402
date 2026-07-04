import { describe, expect, it } from "vitest";

import {
  hashPhase6DestinationAmountList,
  readDestinationAmountListPlan,
} from "../src/phase6DestinationAmountListHash.js";

const PLAN = {
  batchId: "batch_001",
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  asset: "devnet-usdc",
  tokenProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  sourceTokenAccount: "source-token-account",
  transactions: [
    {
      index: 0,
      items: [
        {
          payoutItemId: "item_001",
          destinationWallet: "destination-wallet",
          destinationTokenAccount: "destination-token-account",
          amountAtomic: "31",
        },
      ],
    },
  ],
};

describe("Phase 6 destination amount-list hash", () => {
  it("hashes an explicit payout destination amount-list plan", () => {
    expect(hashPhase6DestinationAmountList(PLAN)).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    expect(hashPhase6DestinationAmountList(PLAN)).toBe(
      hashPhase6DestinationAmountList({ ...PLAN, ignored: "field" }),
    );
  });

  it("rejects missing transactions and non-positive amounts", () => {
    expect(() =>
      readDestinationAmountListPlan({ ...PLAN, transactions: [] }),
    ).toThrow("transactions must include at least one transaction");
    expect(() =>
      readDestinationAmountListPlan({
        ...PLAN,
        transactions: [
          {
            index: 0,
            items: [{ ...PLAN.transactions[0]!.items[0]!, amountAtomic: "0" }],
          },
        ],
      }),
    ).toThrow("transactions[0].items[0].amountAtomic must be a positive atomic amount");
  });
});
