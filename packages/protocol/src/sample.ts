import { parseAtomicAmount, serializeAtomicAmount } from "./amounts.js";
import { canonicalizeToBytes, hashProtocolObject } from "./canonical.js";
import { calculateCommission } from "./commission.js";
import { base58Encode, bytesToHex, hexToBytes } from "./encoding.js";
import { calculateOperationDigest } from "./operation.js";
import type {
  BuyerProofV1,
  ReferralClaimV1,
  Split402AttributionV1,
  Split402OfferV1,
  Split402ReceiptV1
} from "./schemas.js";
import {
  buildBuyerProofSigningBytes,
  buildOfferSigningBytes,
  buildReceiptSigningBytes,
  buildReferralClaimSigningBytes,
  deriveEd25519PublicKey,
  signEd25519Message
} from "./signing.js";

export interface SampleProtocolArtifacts {
  keys: {
    merchantPublicKey: string;
    referrerPublicKey: string;
    payoutWallet: string;
    payerWallet: string;
    payToWallet: string;
  };
  artifacts: {
    referralClaim: ReferralClaimV1;
    offer: Split402OfferV1;
    attribution: Split402AttributionV1;
    receipt: Split402ReceiptV1;
  };
}

export interface ProtocolTestVector {
  name: string;
  artifactType: "referralClaim" | "offer" | "attribution" | "receipt";
  expectedValid: boolean;
  publicKey?: string;
  signature?: string;
  unsigned?: unknown;
  artifact: unknown;
  canonicalUtf8Hex: string;
  signingBytesHex?: string;
  expectedSha256: `sha256:${string}`;
}

export interface ProtocolTestVectorBundle extends SampleProtocolArtifacts {
  vectors: Record<string, ProtocolTestVector>;
  requestDigestCases: unknown[];
  commissionCases: unknown[];
}

const MERCHANT_SEED = hexToBytes(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
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

const IDS = {
  merchantId: "mrc_00000000000000000000000000000001",
  campaignId: "cmp_00000000000000000000000000000002",
  routeId: "rte_00000000000000000000000000000003",
  paymentId: "pay_00000000000000000000000000000004",
  receiptId: "rcp_00000000000000000000000000000005",
  offerNonce: "ofn_00000000000000000000000000000006"
} as const;

const RESOURCE_ORIGIN = "https://api.example.com";
const OPERATION_ID = "wallet-risk-score";
const NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const ASSET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const REQUIRED_AMOUNT_ATOMIC = "10000";
const COMMISSION_BPS = 2000;
const PROTOCOL_FEE_BPS_OF_COMMISSION = 1000;

export function createSampleProtocolArtifacts(): SampleProtocolArtifacts {
  const merchantPublicKey = deriveEd25519PublicKey(MERCHANT_SEED);
  const referrerPublicKey = deriveEd25519PublicKey(REFERRER_SEED);
  const payoutWallet = deriveEd25519PublicKey(PAYOUT_SEED);
  const payerWallet = deriveEd25519PublicKey(PAYER_SEED);
  const payToWallet = deriveEd25519PublicKey(PAY_TO_SEED);

  const campaignTerms = {
    protocolVersion: "0.1",
    campaignId: IDS.campaignId,
    campaignVersion: 1,
    merchantId: IDS.merchantId,
    resourceOrigin: RESOURCE_ORIGIN,
    operationIds: [OPERATION_ID],
    network: NETWORK,
    asset: ASSET,
    requiredAmountAtomic: REQUIRED_AMOUNT_ATOMIC,
    payToWallet,
    commissionBps: COMMISSION_BPS,
    protocolFeeBpsOfCommission: PROTOCOL_FEE_BPS_OF_COMMISSION,
    commissionBase: "required_amount",
    settlementMode: "accrual"
  };
  const campaignTermsHash = hashProtocolObject(campaignTerms);

  const unsignedClaim = {
    version: "1",
    routeId: IDS.routeId,
    campaignId: IDS.campaignId,
    campaignVersionMin: 1,
    referrerWallet: referrerPublicKey,
    payoutWallet,
    resourceOrigin: RESOURCE_ORIGIN,
    operationIds: [OPERATION_ID],
    issuedAt: "2026-06-24T00:00:00Z",
    expiresAt: "2026-07-24T00:00:00Z",
    nonce: "claim-nonce-000001",
    metadataHash: hashProtocolObject({ label: "Example wallet risk route" })
  } satisfies Omit<ReferralClaimV1, "signature">;

  const claimSignature = signEd25519Message(
    buildReferralClaimSigningBytes(unsignedClaim),
    REFERRER_SEED
  );
  const referralClaim: ReferralClaimV1 = {
    ...unsignedClaim,
    signature: {
      type: "solana-ed25519",
      publicKey: claimSignature.publicKey,
      value: claimSignature.signature
    }
  };

  const unsignedOffer = {
    protocolVersion: "0.1",
    campaignId: IDS.campaignId,
    campaignVersion: 1,
    campaignTermsHash,
    merchantId: IDS.merchantId,
    resourceOrigin: RESOURCE_ORIGIN,
    operationId: OPERATION_ID,
    network: NETWORK,
    asset: ASSET,
    requiredAmountAtomic: REQUIRED_AMOUNT_ATOMIC,
    payToWallet,
    commissionBps: COMMISSION_BPS,
    protocolFeeBpsOfCommission: PROTOCOL_FEE_BPS_OF_COMMISSION,
    commissionBase: "required_amount",
    settlementMode: "accrual",
    attributionRequired: false,
    allowSelfReferral: false,
    offerNonce: IDS.offerNonce,
    issuedAt: "2026-06-24T00:01:00Z",
    validUntil: "2026-06-24T00:02:30Z",
    kid: "kid_merchant_demo_1"
  } satisfies Omit<Split402OfferV1, "signature">;

  const offerSignature = signEd25519Message(buildOfferSigningBytes(unsignedOffer), MERCHANT_SEED);
  const offer: Split402OfferV1 = {
    ...unsignedOffer,
    signature: offerSignature.signature
  };

  const requestDigest = calculateOperationDigest({
    merchantId: IDS.merchantId,
    operationId: OPERATION_ID,
    method: "POST",
    pathTemplate: "/v1/risk/:wallet",
    pathParams: {
      wallet: payerWallet
    },
    query: {},
    body: {
      includeLabels: true
    },
    paymentId: IDS.paymentId,
    offerNonce: IDS.offerNonce
  });

  const attributionWithoutBuyerProof: Split402AttributionV1 = {
    protocolVersion: "0.1",
    offer,
    paymentId: IDS.paymentId,
    requestDigest,
    referralClaim
  };
  const buyerSignature = signEd25519Message(
    buildBuyerProofSigningBytes(attributionWithoutBuyerProof),
    PAYER_SEED
  );
  const buyerProof: BuyerProofV1 = {
    type: "solana-ed25519",
    publicKey: buyerSignature.publicKey,
    signature: buyerSignature.signature
  };
  const attribution: Split402AttributionV1 = {
    ...attributionWithoutBuyerProof,
    buyerProof
  };

  const commission = calculateCommission(
    parseAtomicAmount(REQUIRED_AMOUNT_ATOMIC),
    BigInt(COMMISSION_BPS),
    BigInt(PROTOCOL_FEE_BPS_OF_COMMISSION)
  );
  const unsignedReceipt = {
    protocolVersion: "0.1",
    receiptId: IDS.receiptId,
    merchantId: IDS.merchantId,
    merchantOrigin: RESOURCE_ORIGIN,
    operationId: OPERATION_ID,
    requestDigest,
    campaignId: IDS.campaignId,
    campaignVersion: 1,
    campaignTermsHash,
    routeId: IDS.routeId,
    referralClaimHash: hashProtocolObject(referralClaim),
    referrerWallet: referrerPublicKey,
    payoutWallet,
    paymentId: IDS.paymentId,
    network: NETWORK,
    asset: ASSET,
    payerWallet,
    payToWallet,
    requiredAmountAtomic: REQUIRED_AMOUNT_ATOMIC,
    settledAmountAtomic: REQUIRED_AMOUNT_ATOMIC,
    settlementTxSignature: base58Encode(hexToBytes("aa".repeat(64))),
    commissionBps: COMMISSION_BPS,
    protocolFeeBpsOfCommission: PROTOCOL_FEE_BPS_OF_COMMISSION,
    commissionBaseAtomic: REQUIRED_AMOUNT_ATOMIC,
    commissionAmountAtomic: serializeAtomicAmount(commission.commission),
    protocolFeeAtomic: serializeAtomicAmount(commission.protocolFee),
    referrerCreditAtomic: serializeAtomicAmount(commission.referrerCredit),
    settlementMode: "accrual",
    offerNonce: IDS.offerNonce,
    settledAt: "2026-06-24T00:01:45Z",
    issuedAt: "2026-06-24T00:01:46Z",
    recordingStatus: "accepted",
    kid: "kid_merchant_demo_1"
  } satisfies Omit<Split402ReceiptV1, "signature">;

  const receiptSignature = signEd25519Message(
    buildReceiptSigningBytes(unsignedReceipt),
    MERCHANT_SEED
  );
  const receipt: Split402ReceiptV1 = {
    ...unsignedReceipt,
    signature: receiptSignature.signature
  };

  return {
    keys: {
      merchantPublicKey,
      referrerPublicKey,
      payoutWallet,
      payerWallet,
      payToWallet
    },
    artifacts: {
      referralClaim,
      offer,
      attribution,
      receipt
    }
  };
}

export function createTestVectorBundle(): ProtocolTestVectorBundle {
  const sample = createSampleProtocolArtifacts();
  const invalidClaim = structuredClone(sample.artifacts.referralClaim);
  invalidClaim.signature.value = mutateSignature(invalidClaim.signature.value);

  const unsignedClaim = omitKeys(sample.artifacts.referralClaim, ["signature"]);
  const unsignedOffer = omitKeys(sample.artifacts.offer, ["signature"]);
  const unsignedReceipt = omitKeys(sample.artifacts.receipt, ["signature"]);

  return {
    ...sample,
    vectors: {
      "referral-claim-valid": signedVector({
        name: "referral-claim-valid",
        artifactType: "referralClaim",
        artifact: sample.artifacts.referralClaim,
        unsigned: unsignedClaim,
        publicKey: sample.keys.referrerPublicKey,
        signature: sample.artifacts.referralClaim.signature.value,
        signingBytes: buildReferralClaimSigningBytes(sample.artifacts.referralClaim),
        expectedValid: true
      }),
      "referral-claim-invalid-signature": signedVector({
        name: "referral-claim-invalid-signature",
        artifactType: "referralClaim",
        artifact: invalidClaim,
        unsigned: omitKeys(invalidClaim, ["signature"]),
        publicKey: sample.keys.referrerPublicKey,
        signature: invalidClaim.signature.value,
        signingBytes: buildReferralClaimSigningBytes(invalidClaim),
        expectedValid: false
      }),
      "offer-valid": signedVector({
        name: "offer-valid",
        artifactType: "offer",
        artifact: sample.artifacts.offer,
        unsigned: unsignedOffer,
        publicKey: sample.keys.merchantPublicKey,
        signature: sample.artifacts.offer.signature,
        signingBytes: buildOfferSigningBytes(sample.artifacts.offer),
        expectedValid: true
      }),
      "attribution-valid": unsignedVector({
        name: "attribution-valid",
        artifactType: "attribution",
        artifact: sample.artifacts.attribution,
        publicKey: sample.keys.merchantPublicKey,
        expectedValid: true
      }),
      "receipt-valid": signedVector({
        name: "receipt-valid",
        artifactType: "receipt",
        artifact: sample.artifacts.receipt,
        unsigned: unsignedReceipt,
        publicKey: sample.keys.merchantPublicKey,
        signature: sample.artifacts.receipt.signature,
        signingBytes: buildReceiptSigningBytes(sample.artifacts.receipt),
        expectedValid: true
      })
    },
    requestDigestCases: [
      {
        name: "wallet-risk-json-post",
        digest: sample.artifacts.attribution.requestDigest,
        operation: {
          method: "POST",
          pathTemplate: "/v1/risk/:wallet",
          pathParams: { wallet: sample.keys.payerWallet },
          query: {},
          body: { includeLabels: true }
        }
      }
    ],
    commissionCases: [
      {
        name: "twenty-percent-usdc-micropayment",
        requiredAmountAtomic: REQUIRED_AMOUNT_ATOMIC,
        commissionBps: COMMISSION_BPS,
        protocolFeeBpsOfCommission: PROTOCOL_FEE_BPS_OF_COMMISSION,
        commissionAmountAtomic: "2000",
        protocolFeeAtomic: "200",
        referrerCreditAtomic: "1800"
      },
      {
        name: "rounds-toward-zero",
        requiredAmountAtomic: "3",
        commissionBps: 3333,
        protocolFeeBpsOfCommission: 0,
        commissionAmountAtomic: "0",
        protocolFeeAtomic: "0",
        referrerCreditAtomic: "0"
      }
    ]
  };
}

function signedVector(input: {
  name: string;
  artifactType: ProtocolTestVector["artifactType"];
  artifact: unknown;
  unsigned: unknown;
  publicKey: string;
  signature: string;
  signingBytes: Uint8Array;
  expectedValid: boolean;
}): ProtocolTestVector {
  return {
    name: input.name,
    artifactType: input.artifactType,
    expectedValid: input.expectedValid,
    publicKey: input.publicKey,
    signature: input.signature,
    unsigned: input.unsigned,
    artifact: input.artifact,
    canonicalUtf8Hex: bytesToHex(canonicalizeToBytes(input.unsigned)),
    signingBytesHex: bytesToHex(input.signingBytes),
    expectedSha256: hashProtocolObject(input.unsigned)
  };
}

function unsignedVector(input: {
  name: string;
  artifactType: ProtocolTestVector["artifactType"];
  artifact: unknown;
  publicKey: string;
  expectedValid: boolean;
}): ProtocolTestVector {
  return {
    name: input.name,
    artifactType: input.artifactType,
    expectedValid: input.expectedValid,
    publicKey: input.publicKey,
    artifact: input.artifact,
    canonicalUtf8Hex: bytesToHex(canonicalizeToBytes(input.artifact)),
    expectedSha256: hashProtocolObject(input.artifact)
  };
}

function mutateSignature(signature: string): string {
  const replacement = signature.endsWith("A") ? "B" : "A";
  return `${signature.slice(0, -1)}${replacement}`;
}

function omitKeys<T extends Record<string, unknown>, K extends keyof T>(
  value: T,
  keys: readonly K[]
): Omit<T, K> {
  const omitted = { ...value };
  for (const key of keys) {
    delete omitted[key];
  }
  return omitted;
}
