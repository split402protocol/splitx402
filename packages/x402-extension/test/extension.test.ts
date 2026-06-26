import {
  buildOfferSigningBytes,
  buildReferralClaimSigningBytes,
  calculateOperationDigest,
  deriveEd25519PublicKey,
  hashProtocolObject,
  hexToBytes,
  signEd25519Message,
  verifySplit402Receipt,
  Split402OfferV1Schema,
  Split402ReceiptV1Schema,
  type ReferralClaimV1,
  type Split402ReceiptV1,
  type Split402OfferV1
} from "@split402/protocol";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  ResourceServerExtension,
  SettleResultContext,
  VerifyContext
} from "@x402/core/types";
import { describe, expect, it } from "vitest";

import {
  SPLIT402_EXTENSION_KEY,
  buildReceipt,
  createSplit402ClientExtension,
  createSplit402ResourceServerExtension,
  type Split402CampaignConfig,
  type Split402ServiceKeyProvider,
  type ValidatedSplit402Attribution
} from "../src/index.js";

const MERCHANT_SEED = hexToBytes(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
);
const NEXT_MERCHANT_SEED = hexToBytes(
  "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf"
);
const REFERRER_SEED = hexToBytes(
  "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f"
);
const PAYOUT_SEED = hexToBytes(
  "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f"
);
const PAYER_SEED = hexToBytes(
  "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f"
);
const PAY_TO_SEED = hexToBytes(
  "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f"
);

const MERCHANT_ID = "mrc_00000000000000000000000000000001";
const CAMPAIGN_ID = "cmp_00000000000000000000000000000002";
const ROUTE_ID = "rte_00000000000000000000000000000003";
const OPERATION_ID = "wallet-risk-score";
const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const ASSET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const AMOUNT = "10000";
const PAY_TO = deriveEd25519PublicKey(PAY_TO_SEED);
const PAYER = deriveEd25519PublicKey(PAYER_SEED);

describe("Split402 x402 extension", () => {
  it("enriches the x402 payment payload with payment id, request digest, offer, and claim", async () => {
    const offer = createOffer();
    const claim = createClaim();
    const extension = createSplit402ClientExtension({
      referralClaim: claim,
      body: { wallet: PAYER },
      pathTemplate: "/v1/risk",
      paymentIdFactory: () => "pay_00000000000000000000000000000004"
    });

    const paymentPayload: PaymentPayload = {
      x402Version: 2,
      accepted: requirement(),
      payload: {}
    };
    const paymentRequired: PaymentRequired = {
      x402Version: 2,
      resource: { url: "http://localhost:4021/v1/risk" },
      accepts: [requirement()],
      extensions: {
        [SPLIT402_EXTENSION_KEY]: {
          info: offer
        }
      }
    };

    const enriched = await extension.enrichPaymentPayload?.(paymentPayload, paymentRequired);
    const info = getSplit402Info(enriched?.extensions?.[SPLIT402_EXTENSION_KEY]);

    expect(info.paymentId).toBe("pay_00000000000000000000000000000004");
    expect(info.referralClaim).toEqual(claim);
    expect(info.requestDigest).toBe(
      calculateOperationDigest({
        merchantId: MERCHANT_ID,
        operationId: OPERATION_ID,
        method: "POST",
        pathTemplate: "/v1/risk",
        body: { wallet: PAYER },
        paymentId: "pay_00000000000000000000000000000004",
        offerNonce: offer.offerNonce
      })
    );
  });

  it("builds a valid-claim receipt with 20 percent commission", () => {
    const offer = createOffer();
    const claim = createClaim();
    const attribution: ValidatedSplit402Attribution = {
      offer,
      paymentId: "pay_00000000000000000000000000000004",
      requestDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      referralClaim: claim,
      claimStatus: "valid",
      claimErrors: []
    };

    const receipt = buildReceipt({
      attribution,
      campaign: campaign(),
      merchantId: MERCHANT_ID,
      merchantOrigin: "http://localhost:4021",
      requirement: requirement(),
      settlement: {
        payer: PAYER,
        transaction: "demo-tx",
        network: NETWORK,
        amount: AMOUNT
      },
      kid: "kid_demo",
      now: new Date("2026-06-24T00:00:00Z")
    });

    expect(receipt.commissionBps).toBe(2000);
    expect(receipt.commissionAmountAtomic).toBe("2000");
    expect(receipt.protocolFeeBpsOfCommission).toBe(1000);
    expect(receipt.protocolFeeAtomic).toBe("200");
    expect(receipt.referrerCreditAtomic).toBe("1800");
    expect(receipt.routeId).toBe(ROUTE_ID);
  });

  it("builds an invalid-claim receipt with zero commission", () => {
    const offer = createOffer();
    const attribution: ValidatedSplit402Attribution = {
      offer,
      paymentId: "pay_00000000000000000000000000000004",
      requestDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      claimStatus: "invalid",
      claimErrors: ["invalid referral claim signature"]
    };

    const receipt = buildReceipt({
      attribution,
      campaign: campaign(),
      merchantId: MERCHANT_ID,
      merchantOrigin: "http://localhost:4021",
      requirement: requirement(),
      settlement: {
        payer: PAYER,
        transaction: "demo-tx",
        network: NETWORK,
        amount: AMOUNT
      },
      kid: "kid_demo",
      now: new Date("2026-06-24T00:00:00Z")
    });

    expect(receipt.commissionBps).toBe(0);
    expect(receipt.protocolFeeBpsOfCommission).toBe(0);
    expect(receipt.commissionAmountAtomic).toBe("0");
    expect(receipt.protocolFeeAtomic).toBe("0");
    expect(receipt.referrerCreditAtomic).toBe("0");
    expect(receipt.routeId).toBeUndefined();
  });

  it("runs the server hook path and returns a signed 20 percent receipt after settlement", async () => {
    const receipts: Split402ReceiptV1[] = [];
    const extension = createServerExtension(receipts);
    const offer = await advertiseOffer(extension);
    const paymentPayload = await createClientPaymentPayload(offer, createClaim());

    const verifyResult = await extension.hooks?.onBeforeVerify?.(
      routeDeclaration(),
      verifyContext(paymentPayload)
    );
    expect(verifyResult).toBeUndefined();

    const settlementExtension = await extension.enrichSettlementResponse?.(
      routeDeclaration(),
      settleContext(paymentPayload)
    );
    const receipt = extractReceipt(settlementExtension);

    expect(receipts).toHaveLength(1);
    expect(receipt.commissionBps).toBe(2000);
    expect(receipt.commissionAmountAtomic).toBe("2000");
    expect(receipt.protocolFeeAtomic).toBe("200");
    expect(receipt.referrerCreditAtomic).toBe("1800");
    expect(receipt.routeId).toBe(ROUTE_ID);
    expect(verifySplit402Receipt(receipt, deriveEd25519PublicKey(MERCHANT_SEED))).toEqual({
      ok: true,
      errors: []
    });
  });

  it("accepts offers signed before service-key rotation and signs receipts with the current key", async () => {
    const receipts: Split402ReceiptV1[] = [];
    let currentKey = {
      kid: "kid_old",
      privateSeed: MERCHANT_SEED
    };
    const publicKeys = new Map([
      ["kid_old", deriveEd25519PublicKey(MERCHANT_SEED)],
      ["kid_new", deriveEd25519PublicKey(NEXT_MERCHANT_SEED)]
    ]);
    const serviceKeyProvider: Split402ServiceKeyProvider = {
      current: () => currentKey,
      resolvePublicKey: (kid) => publicKeys.get(kid)
    };
    const extension = createSplit402ResourceServerExtension({
      merchantId: MERCHANT_ID,
      merchantOrigin: "http://localhost:4021",
      serviceKeyProvider,
      resolveCampaign: () => campaign(),
      receiptSink: (receipt) => {
        receipts.push(receipt);
      },
      now: () => new Date("2026-06-24T00:00:00Z")
    });
    const offer = await advertiseOffer(extension);
    const paymentPayload = await createClientPaymentPayload(offer, createClaim());

    currentKey = {
      kid: "kid_new",
      privateSeed: NEXT_MERCHANT_SEED
    };

    const verifyResult = await extension.hooks?.onBeforeVerify?.(
      routeDeclaration(),
      verifyContext(paymentPayload)
    );
    expect(verifyResult).toBeUndefined();

    const settlementExtension = await extension.enrichSettlementResponse?.(
      routeDeclaration(),
      settleContext(paymentPayload)
    );
    const receipt = extractReceipt(settlementExtension);

    expect(offer.kid).toBe("kid_old");
    expect(receipt.kid).toBe("kid_new");
    expect(receipts).toHaveLength(1);
    expect(verifySplit402Receipt(receipt, deriveEd25519PublicKey(NEXT_MERCHANT_SEED))).toEqual({
      ok: true,
      errors: []
    });
  });

  it("falls back to the verified offer when settlement omits the route declaration", async () => {
    const receipts: Split402ReceiptV1[] = [];
    const extension = createServerExtension(receipts);
    const offer = await advertiseOffer(extension);
    const paymentPayload = await createClientPaymentPayload(offer, createClaim());

    const verifyResult = await extension.hooks?.onBeforeVerify?.(
      routeDeclaration(),
      verifyContext(paymentPayload)
    );
    expect(verifyResult).toBeUndefined();

    const settlementExtension = await extension.enrichSettlementResponse?.(
      undefined,
      settleContext(paymentPayload)
    );
    const receipt = extractReceipt(settlementExtension);

    expect(receipts).toHaveLength(1);
    expect(receipt.campaignId).toBe(CAMPAIGN_ID);
    expect(receipt.operationId).toBe(OPERATION_ID);
    expect(receipt.commissionBps).toBe(2000);
    expect(receipt.protocolFeeAtomic).toBe("200");
    expect(receipt.referrerCreditAtomic).toBe("1800");
  });

  it("runs the server hook path and returns zero commission for an invalid claim", async () => {
    const receipts: Split402ReceiptV1[] = [];
    const extension = createServerExtension(receipts);
    const offer = await advertiseOffer(extension);
    const paymentPayload = await createClientPaymentPayload(offer, mutateClaim(createClaim()));

    const verifyResult = await extension.hooks?.onBeforeVerify?.(
      routeDeclaration(),
      verifyContext(paymentPayload)
    );
    expect(verifyResult).toBeUndefined();

    const settlementExtension = await extension.enrichSettlementResponse?.(
      routeDeclaration(),
      settleContext(paymentPayload)
    );
    const receipt = extractReceipt(settlementExtension);

    expect(receipts).toHaveLength(1);
    expect(receipt.commissionBps).toBe(0);
    expect(receipt.commissionAmountAtomic).toBe("0");
    expect(receipt.protocolFeeAtomic).toBe("0");
    expect(receipt.referrerCreditAtomic).toBe("0");
    expect(receipt.routeId).toBeUndefined();
    expect(verifySplit402Receipt(receipt, deriveEd25519PublicKey(MERCHANT_SEED))).toEqual({
      ok: true,
      errors: []
    });
  });

  it("accepts referrers that use the same identity and payout wallet", async () => {
    const receipts: Split402ReceiptV1[] = [];
    const extension = createServerExtension(receipts);
    const offer = await advertiseOffer(extension);
    const referrer = deriveEd25519PublicKey(REFERRER_SEED);
    const paymentPayload = await createClientPaymentPayload(
      offer,
      createClaim({ referrerWallet: referrer, payoutWallet: referrer })
    );

    const verifyResult = await extension.hooks?.onBeforeVerify?.(
      routeDeclaration(),
      verifyContext(paymentPayload)
    );
    expect(verifyResult).toBeUndefined();

    const settlementExtension = await extension.enrichSettlementResponse?.(
      routeDeclaration(),
      settleContext(paymentPayload)
    );
    const receipt = extractReceipt(settlementExtension);

    expect(receipt.referrerWallet).toBe(referrer);
    expect(receipt.payoutWallet).toBe(referrer);
    expect(receipt.referrerCreditAtomic).toBe("1800");
  });

  it("sets zero commission when payer is the referrer and self-referral is disabled", async () => {
    const offer = createOffer();
    const claim = createClaim({ referrerWallet: PAYER });
    const attribution: ValidatedSplit402Attribution = {
      offer,
      paymentId: "pay_00000000000000000000000000000004",
      requestDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      referralClaim: claim,
      claimStatus: "valid",
      claimErrors: []
    };

    const receipt = buildReceipt({
      attribution,
      campaign: campaign(),
      merchantId: MERCHANT_ID,
      merchantOrigin: "http://localhost:4021",
      requirement: requirement(),
      settlement: {
        payer: PAYER,
        transaction: "demo-tx",
        network: NETWORK,
        amount: AMOUNT
      },
      kid: "kid_demo",
      now: new Date("2026-06-24T00:00:00Z")
    });

    expect(receipt.commissionBps).toBe(0);
    expect(receipt.protocolFeeBpsOfCommission).toBe(0);
    expect(receipt.referrerCreditAtomic).toBe("0");
    expect(receipt.routeId).toBeUndefined();
  });

  it("sets zero commission when payer is the payout wallet and self-referral is disabled", () => {
    const offer = createOffer();
    const claim = createClaim({ payoutWallet: PAYER });
    const attribution: ValidatedSplit402Attribution = {
      offer,
      paymentId: "pay_00000000000000000000000000000004",
      requestDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      referralClaim: claim,
      claimStatus: "valid",
      claimErrors: []
    };

    const receipt = buildReceipt({
      attribution,
      campaign: campaign(),
      merchantId: MERCHANT_ID,
      merchantOrigin: "http://localhost:4021",
      requirement: requirement(),
      settlement: {
        payer: PAYER,
        transaction: "demo-tx",
        network: NETWORK,
        amount: AMOUNT
      },
      kid: "kid_demo",
      now: new Date("2026-06-24T00:00:00Z")
    });

    expect(receipt.commissionBps).toBe(0);
    expect(receipt.protocolFeeAtomic).toBe("0");
    expect(receipt.referrerCreditAtomic).toBe("0");
    expect(receipt.routeId).toBeUndefined();
  });

  it("allows self-referral earnings only when the offer allows self-referral", () => {
    const offer = createOffer({ allowSelfReferral: true });
    const claim = createClaim({ payoutWallet: PAYER });
    const attribution: ValidatedSplit402Attribution = {
      offer,
      paymentId: "pay_00000000000000000000000000000004",
      requestDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      referralClaim: claim,
      claimStatus: "valid",
      claimErrors: []
    };

    const receipt = buildReceipt({
      attribution,
      campaign: campaign(),
      merchantId: MERCHANT_ID,
      merchantOrigin: "http://localhost:4021",
      requirement: requirement(),
      settlement: {
        payer: PAYER,
        transaction: "demo-tx",
        network: NETWORK,
        amount: AMOUNT
      },
      kid: "kid_demo",
      now: new Date("2026-06-24T00:00:00Z")
    });

    expect(receipt.commissionBps).toBe(2000);
    expect(receipt.referrerCreditAtomic).toBe("1800");
    expect(receipt.payoutWallet).toBe(PAYER);
  });
});

function createOffer(input: { allowSelfReferral?: boolean } = {}): Split402OfferV1 {
  const campaignConfig = campaign();
  const unsigned = {
    protocolVersion: "0.1",
    campaignId: CAMPAIGN_ID,
    campaignVersion: 1,
    campaignTermsHash: campaignConfig.campaignTermsHash,
    merchantId: MERCHANT_ID,
    resourceOrigin: "http://localhost:4021",
    operationId: OPERATION_ID,
    network: NETWORK,
    asset: ASSET,
    requiredAmountAtomic: AMOUNT,
    payToWallet: PAY_TO,
    commissionBps: 2000,
    protocolFeeBpsOfCommission: 1000,
    commissionBase: "required_amount",
    settlementMode: "accrual",
    attributionRequired: false,
    allowSelfReferral: input.allowSelfReferral ?? false,
    offerNonce: "ofn_00000000000000000000000000000006",
    issuedAt: "2026-06-24T00:00:00Z",
    validUntil: "2099-06-24T00:00:00Z",
    kid: "kid_demo"
  } satisfies Omit<Split402OfferV1, "signature">;
  const signature = signEd25519Message(buildOfferSigningBytes(unsigned), MERCHANT_SEED);
  return { ...unsigned, signature: signature.signature };
}

function createClaim(
  input: { referrerWallet?: string; payoutWallet?: string } = {}
): ReferralClaimV1 {
  const referrer = input.referrerWallet ?? deriveEd25519PublicKey(REFERRER_SEED);
  const unsigned = {
    version: "1",
    routeId: ROUTE_ID,
    campaignId: CAMPAIGN_ID,
    campaignVersionMin: 1,
    referrerWallet: referrer,
    payoutWallet: input.payoutWallet ?? deriveEd25519PublicKey(PAYOUT_SEED),
    resourceOrigin: "http://localhost:4021",
    operationIds: [OPERATION_ID],
    issuedAt: "2026-06-24T00:00:00Z",
    expiresAt: "2099-06-24T00:00:00Z",
    nonce: "claim-nonce-000001",
    metadataHash: hashProtocolObject({ label: "demo" })
  } satisfies Omit<ReferralClaimV1, "signature">;
  const signature = signEd25519Message(buildReferralClaimSigningBytes(unsigned), REFERRER_SEED);
  return {
    ...unsigned,
    signature: {
      type: "solana-ed25519",
      publicKey: signature.publicKey,
      value: signature.signature
    }
  };
}

function campaign(): Split402CampaignConfig {
  return {
    campaignId: CAMPAIGN_ID,
    campaignVersion: 1,
    campaignTermsHash: hashProtocolObject({
      campaignId: CAMPAIGN_ID,
      operationId: OPERATION_ID,
      commissionBps: 2000,
      protocolFeeBpsOfCommission: 1000
    }),
    commissionBps: 2000,
    protocolFeeBpsOfCommission: 1000,
    attributionRequired: false,
    allowSelfReferral: false
  };
}

function createServerExtension(receipts: Split402ReceiptV1[]): ResourceServerExtension {
  return createSplit402ResourceServerExtension({
    merchantId: MERCHANT_ID,
    merchantOrigin: "http://localhost:4021",
    servicePrivateSeed: MERCHANT_SEED,
    serviceKid: "kid_demo",
    resolveCampaign: () => campaign(),
    receiptSink: (receipt) => {
      receipts.push(receipt);
    },
    now: () => new Date("2026-06-24T00:00:00Z")
  });
}

async function advertiseOffer(extension: ResourceServerExtension): Promise<Split402OfferV1> {
  const response = await extension.enrichPaymentRequiredResponse?.(
    routeDeclaration(),
    {
      requirements: [requirement()]
    } as unknown as Parameters<
      NonNullable<ResourceServerExtension["enrichPaymentRequiredResponse"]>
    >[1]
  );
  return Split402OfferV1Schema.parse(getSplit402Info(response));
}

async function createClientPaymentPayload(
  offer: Split402OfferV1,
  referralClaim: ReferralClaimV1
): Promise<PaymentPayload> {
  const extension = createSplit402ClientExtension({
    referralClaim,
    body: { wallet: PAYER },
    pathTemplate: "/v1/risk",
    paymentIdFactory: () => "pay_00000000000000000000000000000004"
  });
  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: requirement(),
    payload: {}
  };
  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    resource: { url: "http://localhost:4021/v1/risk" },
    accepts: [requirement()],
    extensions: {
      [SPLIT402_EXTENSION_KEY]: {
        info: offer
      }
    }
  };
  const enriched = await extension.enrichPaymentPayload?.(payload, paymentRequired);
  if (enriched === undefined) {
    throw new Error("client extension did not return a payment payload");
  }
  return enriched;
}

function verifyContext(paymentPayload: PaymentPayload): VerifyContext {
  return {
    paymentPayload,
    requirements: requirement(),
    declaredExtensions: {
      [SPLIT402_EXTENSION_KEY]: routeDeclaration()
    }
  };
}

function settleContext(paymentPayload: PaymentPayload): SettleResultContext {
  return {
    paymentPayload,
    requirements: requirement(),
    declaredExtensions: {
      [SPLIT402_EXTENSION_KEY]: routeDeclaration()
    },
    result: {
      success: true,
      payer: PAYER,
      transaction: "demo-tx",
      network: NETWORK,
      amount: AMOUNT
    }
  };
}

function routeDeclaration() {
  return {
    campaignId: CAMPAIGN_ID,
    operationId: OPERATION_ID
  };
}

function mutateClaim(claim: ReferralClaimV1): ReferralClaimV1 {
  return {
    ...claim,
    signature: {
      ...claim.signature,
      value: claim.signature.value.endsWith("A")
        ? `${claim.signature.value.slice(0, -1)}B`
        : `${claim.signature.value.slice(0, -1)}A`
    }
  };
}

function extractReceipt(value: unknown): Split402ReceiptV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("missing settlement extension object");
  }
  return Split402ReceiptV1Schema.parse((value as Record<string, unknown>).receipt);
}

function requirement(): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    asset: ASSET,
    amount: AMOUNT,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: {}
  };
}

function getSplit402Info(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("missing extension");
  }
  const record = value as Record<string, unknown>;
  const info = record.info;
  if (typeof info !== "object" || info === null || Array.isArray(info)) {
    throw new Error("missing extension info");
  }
  return info as Record<string, unknown>;
}
