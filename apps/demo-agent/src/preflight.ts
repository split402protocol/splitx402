import "./env.js";

import { decodePaymentRequiredHeader } from "@x402/core/http";
import {
  deriveEd25519PublicKey,
  hexToBytes,
  Split402OfferV1Schema,
  verifySplit402Offer,
  type Split402OfferV1
} from "@split402/protocol";

import { DEVNET_USDC, getSolLamports, getTokenAccountSummary } from "./solana-rpc.js";
import { createSvmSignerFromBase58 } from "./svm-key.js";

const MERCHANT_ORIGIN = process.env.SPLIT402_MERCHANT_ORIGIN ?? "http://localhost:4021";
const MERCHANT_PUBLIC_KEY =
  process.env.SPLIT402_MERCHANT_PUBLIC_KEY ??
  deriveEd25519PublicKey(
    hexToBytes("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
  );
await main();

async function main(): Promise<void> {
  const health = await inspectMerchantHealth();
  const offerInspection = await inspectOffer();
  const buyer = await inspectBuyer(offerInspection.offer);
  const merchantSettlement = await inspectMerchantSettlement(offerInspection.offer);
  const funding = fundingInstructions(offerInspection.offer, merchantSettlement, buyer);
  const readyForPaidRun =
    health.ok &&
    offerInspection.verified &&
    buyer.privateKeyValid &&
    buyer.hasRequiredPaymentToken === true &&
    merchantSettlement.canReceivePaymentToken === true;

  console.log(
    JSON.stringify(
      {
        readyForPaidRun,
        merchant: health,
        x402: offerInspection.summary,
        merchantSettlement,
        buyer,
        funding
      },
      null,
      2
    )
  );

  if (!readyForPaidRun) {
    process.exitCode = 1;
  }
}

function fundingInstructions(
  offer: Split402OfferV1 | undefined,
  merchantSettlement: Record<string, unknown>,
  buyer: Record<string, unknown>
): Record<string, unknown> {
  const instructions: string[] = [];
  const buyerAddress = getString(buyer.address);
  const mint = offer?.asset ?? DEVNET_USDC;
  const assetLabel = mint === DEVNET_USDC ? "Devnet USDC" : "the configured SPL token";
  if (buyer.hasRequiredPaymentToken !== true && buyerAddress !== undefined) {
    instructions.push(
      `fund buyer ${buyerAddress} with ${assetLabel} mint ${mint}`
    );
  }

  const merchantPayTo = getString(merchantSettlement.payToWallet);
  if (
    merchantSettlement.canReceivePaymentToken !== true &&
    merchantPayTo !== undefined
  ) {
    instructions.push(
      `create or fund the merchant pay-to token account for ${merchantPayTo} and mint ${mint}`
    );
  }

  return {
    ready: instructions.length === 0,
    network: "Solana Devnet",
    asset: assetLabel,
    mint,
    canonicalUsdcFaucet: mint === DEVNET_USDC ? "https://faucet.circle.com/" : undefined,
    instructions
  };
}

async function inspectMerchantSettlement(
  offer: Split402OfferV1 | undefined
): Promise<Record<string, unknown>> {
  if (offer === undefined) {
    return {
      canReceivePaymentToken: false,
      error: "missing Split402 offer"
    };
  }

  try {
    const summary = await getTokenAccountSummary(offer.payToWallet, offer.asset);
    return {
      canReceivePaymentToken: summary.accountCount > 0,
      payToWallet: offer.payToWallet,
      paymentAsset: offer.asset,
      paymentTokenAccountCount: summary.accountCount,
      paymentTokenAtomic: summary.atomicBalance,
      next:
        summary.accountCount > 0
          ? undefined
          : "create the merchant pay-to associated token account for the configured payment asset"
    };
  } catch (error) {
    return {
      canReceivePaymentToken: false,
      error: errorMessage(error)
    };
  }
}

async function inspectMerchantHealth(): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${MERCHANT_ORIGIN}/health`);
    const body = await response.json();
    return {
      ok: response.ok && getBoolean(asOptionalRecord(body)?.ok) === true,
      status: response.status,
      body
    };
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error)
    };
  }
}

async function inspectOffer(): Promise<{
  offer: Split402OfferV1 | undefined;
  verified: boolean;
  summary: Record<string, unknown>;
}> {
  try {
    const response = await fetch(`${MERCHANT_ORIGIN}/v1/risk`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({ wallet: MERCHANT_PUBLIC_KEY })
    });
    const paymentRequiredHeader = response.headers.get("payment-required");
    if (response.status !== 402 || paymentRequiredHeader === null) {
      return {
        offer: undefined,
        verified: false,
        summary: {
          status: response.status,
          error: "expected x402 402 response with PAYMENT-REQUIRED header"
        }
      };
    }

    const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
    const offer = extractSplit402Offer(paymentRequired.extensions?.split402);
    const verification = verifySplit402Offer(offer, MERCHANT_PUBLIC_KEY);

    return {
      offer,
      verified: verification.ok,
      summary: {
        status: response.status,
        x402Version: paymentRequired.x402Version,
        split402OfferVerified: verification.ok,
        split402OfferErrors: verification.errors,
        accepts: paymentRequired.accepts.map((accept) => ({
          scheme: accept.scheme,
          network: accept.network,
          asset: accept.asset,
          amount: accept.amount,
          payTo: accept.payTo
        })),
        offer: {
          campaignId: offer.campaignId,
          operationId: offer.operationId,
          commissionBps: offer.commissionBps,
          asset: offer.asset,
          requiredAmountAtomic: offer.requiredAmountAtomic,
          payToWallet: offer.payToWallet,
          validUntil: offer.validUntil
        }
      }
    };
  } catch (error) {
    return {
      offer: undefined,
      verified: false,
      summary: {
        error: errorMessage(error)
      }
    };
  }
}

async function inspectBuyer(
  offer: Split402OfferV1 | undefined
): Promise<Record<string, unknown>> {
  const privateKey = process.env.SVM_PRIVATE_KEY;
  if (privateKey === undefined || privateKey.length === 0) {
    return {
      privateKeyPresent: false,
      privateKeyValid: false,
      next: "set SVM_PRIVATE_KEY to a funded Solana Devnet buyer secret key"
    };
  }

  try {
    const signer = await createSvmSignerFromBase58(privateKey);
    const address = signer.address.toString();
    const [solLamports, usdcSummary] = await Promise.all([
      getSolLamports(address),
      getTokenAccountSummary(address, offer?.asset ?? DEVNET_USDC)
    ]);
    const requiredAmount = offer?.requiredAmountAtomic ?? "0";
    const paymentAsset = offer?.asset ?? DEVNET_USDC;

    return {
      privateKeyPresent: true,
      privateKeyValid: true,
      address,
      solLamports,
      solRequiredForX402: false,
      paymentAsset,
      paymentTokenAccountCount: usdcSummary.accountCount,
      paymentTokenAtomic: usdcSummary.atomicBalance,
      requiredPaymentTokenAtomic: requiredAmount,
      hasSolForDirectTransactions: BigInt(solLamports) > 0n,
      hasRequiredPaymentToken: BigInt(usdcSummary.atomicBalance) >= BigInt(requiredAmount)
    };
  } catch (error) {
    return {
      privateKeyPresent: true,
      privateKeyValid: false,
      error: errorMessage(error)
    };
  }
}

function extractSplit402Offer(value: unknown): Split402OfferV1 {
  const record = asRecord(value);
  const parsed = Split402OfferV1Schema.safeParse(record.info);
  if (!parsed.success) {
    throw new Error(
      `invalid Split402 offer in x402 response: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`
    );
  }
  return parsed.data;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  const record = asOptionalRecord(value);
  if (record === undefined) {
    throw new Error("expected object");
  }
  return record;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
