import "./env.js";

import {
  Split402AgentClient,
  corruptReferralClaimSignature,
  createReferralClaim,
  createSvmSignerFromBase58
} from "@split402/agent-sdk";
import { deriveEd25519PublicKey, hexToBytes } from "@split402/protocol";

import { checkMainnetPaymentGuards, readDemoNetwork } from "./network.js";

const MERCHANT_ORIGIN = process.env.SPLIT402_MERCHANT_ORIGIN ?? "http://localhost:4021";
const MERCHANT_PUBLIC_KEY =
  process.env.SPLIT402_MERCHANT_PUBLIC_KEY ??
  deriveEd25519PublicKey(
    hexToBytes("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
  );
const REFERRER_SEED = hexToBytes(
  process.env.SPLIT402_REFERRER_SEED_HEX ??
    "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f"
);
const PAYOUT_SEED = hexToBytes(
  process.env.SPLIT402_PAYOUT_SEED_HEX ??
    "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f"
);
const CAMPAIGN_ID = "cmp_00000000000000000000000000000002";
const ROUTE_ID = "rte_00000000000000000000000000000003";
const OPERATION_ID = "wallet-risk-score";

await main();

async function main(): Promise<void> {
  const network = readDemoNetwork();
  const signer = await createSignerFromEnv();
  const buyerWallet = signer.address.toString();
  const body = { wallet: buyerWallet };
  const useInvalidClaim = process.env.SPLIT402_USE_INVALID_CLAIM === "true";
  const claim = createDemoReferralClaim();
  const referralClaim = useInvalidClaim
    ? corruptReferralClaimSignature(claim)
    : claim;
  const client = new Split402AgentClient({
    merchantOrigin: MERCHANT_ORIGIN,
    merchantPublicKey: MERCHANT_PUBLIC_KEY,
    signer,
    network: network.networkId
  });

  if (network.cluster === "mainnet") {
    if (useInvalidClaim) {
      throw new Error(
        "refusing the invalid-claim demo payment on Solana Mainnet; the canary allows one valid paid request only"
      );
    }
    const inspection = await client.inspectOffer({
      path: "/v1/risk",
      method: "POST",
      body
    });
    const guard = checkMainnetPaymentGuards({
      network,
      buyerWallet,
      requiredAmountAtomic: inspection.offer.requiredAmountAtomic
    });
    if (!guard.ok) {
      throw new Error(
        `refusing the mainnet paid request: ${guard.problems.join("; ")}`
      );
    }
  }

  const result = await client.postJson({
    path: "/v1/risk",
    pathTemplate: "/v1/risk",
    body,
    referralClaim
  });

  console.log(JSON.stringify(result.data, null, 2));
  if (result.receipt === undefined) {
    console.log("No Split402 receipt found in payment response header.");
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        split402ReceiptVerified: result.receiptVerification.ok,
        errors: result.receiptVerification.errors,
        receiptId: result.receipt.receiptId,
        referralCreditStatus:
          BigInt(result.receipt.referrerCreditAtomic) > 0n ? "credited" : "zero",
        commissionBps: result.receipt.commissionBps,
        commissionAmountAtomic: result.receipt.commissionAmountAtomic,
        referrerCreditAtomic: result.receipt.referrerCreditAtomic,
        settlementTxSignature: result.receipt.settlementTxSignature
      },
      null,
      2
    )
  );

  if (result.receiptVerification.ok !== true) {
    process.exitCode = 1;
  }
}

function createDemoReferralClaim() {
  return createReferralClaim({
    privateSeed: REFERRER_SEED,
    routeId: ROUTE_ID,
    campaignId: CAMPAIGN_ID,
    campaignVersionMin: 1,
    payoutWallet: deriveEd25519PublicKey(PAYOUT_SEED),
    resourceOrigin: MERCHANT_ORIGIN,
    operationIds: [OPERATION_ID],
    issuedAt: "2026-06-24T00:00:00Z",
    expiresAt: "2099-06-24T00:00:00Z",
    nonce: "claim-nonce-000001",
    metadata: { label: "demo referral" }
  });
}

async function createSignerFromEnv() {
  const privateKey = process.env.SVM_PRIVATE_KEY;
  if (privateKey === undefined || privateKey.length === 0) {
    throw new Error(
      "SVM_PRIVATE_KEY is required. Use a funded Solana Devnet buyer key encoded as base58 bytes."
    );
  }
  return await createSvmSignerFromBase58(privateKey);
}
