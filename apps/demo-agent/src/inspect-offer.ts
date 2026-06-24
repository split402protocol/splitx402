import "./env.js";

import { Split402AgentClient } from "@split402/agent-sdk";
import {
  deriveEd25519PublicKey,
  hexToBytes
} from "@split402/protocol";

const MERCHANT_ORIGIN = process.env.SPLIT402_MERCHANT_ORIGIN ?? "http://localhost:4021";
const MERCHANT_PUBLIC_KEY =
  process.env.SPLIT402_MERCHANT_PUBLIC_KEY ??
  deriveEd25519PublicKey(
    hexToBytes("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
  );

await main();

async function main(): Promise<void> {
  const client = new Split402AgentClient({
    merchantOrigin: MERCHANT_ORIGIN,
    merchantPublicKey: MERCHANT_PUBLIC_KEY
  });
  const inspection = await client.inspectOffer({
    path: "/v1/risk",
    body: { wallet: MERCHANT_PUBLIC_KEY }
  });

  console.log(
    JSON.stringify(
      {
        status: inspection.status,
        x402Version: inspection.paymentRequired.x402Version,
        accepts: inspection.paymentRequired.accepts.map((accept) => ({
          scheme: accept.scheme,
          network: accept.network,
          asset: accept.asset,
          amount: accept.amount,
          payTo: accept.payTo
        })),
        split402OfferVerified: inspection.verification.ok,
        split402OfferErrors: inspection.verification.errors,
        offer: {
          campaignId: inspection.offer.campaignId,
          operationId: inspection.offer.operationId,
          commissionBps: inspection.offer.commissionBps,
          asset: inspection.offer.asset,
          requiredAmountAtomic: inspection.offer.requiredAmountAtomic,
          payToWallet: inspection.offer.payToWallet,
          validUntil: inspection.offer.validUntil
        }
      },
      null,
      2
    )
  );

  if (inspection.verification.ok !== true) {
    process.exitCode = 1;
  }
}
