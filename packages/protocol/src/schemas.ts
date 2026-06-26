import { z } from "zod";

const sha256Regex = /^sha256:[0-9a-f]{64}$/u;
const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,88}$/u;
const base64UrlRegex = /^[A-Za-z0-9_-]+$/u;
const idRegex = /^[a-z]{3}_[0-9a-f]{32,}$/u;
const decimalAmountRegex = /^(0|[1-9][0-9]*)$/u;

export const Split402IdSchema = z.string().regex(idRegex);

export const Sha256HashSchema = z
  .string()
  .regex(sha256Regex) as z.ZodType<`sha256:${string}`>;

export const Base58PublicKeySchema = z.string().regex(base58Regex);

export const Base64UrlSignatureSchema = z.string().regex(base64UrlRegex);

export const AtomicAmountStringSchema = z.string().regex(decimalAmountRegex);

export const Rfc3339UtcSchema = z
  .string()
  .datetime({ offset: false })
  .refine((value) => value.endsWith("Z"), "timestamp must be UTC");

export const SolanaEd25519SignatureSchema = z
  .object({
    type: z.literal("solana-ed25519"),
    publicKey: Base58PublicKeySchema,
    value: Base64UrlSignatureSchema
  })
  .strict();

export const ReferralClaimV1Schema = z
  .object({
    version: z.literal("1"),
    routeId: Split402IdSchema,
    campaignId: Split402IdSchema,
    campaignVersionMin: z.number().int().positive(),
    referrerWallet: Base58PublicKeySchema,
    payoutWallet: Base58PublicKeySchema,
    resourceOrigin: z.string().url(),
    operationIds: z.union([
      z.tuple([z.literal("*")]),
      z.array(z.string().min(1)).nonempty()
    ]),
    issuedAt: Rfc3339UtcSchema,
    expiresAt: Rfc3339UtcSchema,
    nonce: z.string().min(16).max(128),
    metadataHash: Sha256HashSchema.optional(),
    signature: SolanaEd25519SignatureSchema
  })
  .strict();

export const Split402OfferV1Schema = z
  .object({
    protocolVersion: z.literal("0.1"),
    campaignId: Split402IdSchema,
    campaignVersion: z.number().int().positive(),
    campaignTermsHash: Sha256HashSchema,
    merchantId: Split402IdSchema,
    resourceOrigin: z.string().url(),
    operationId: z.string().min(1),
    network: z.string().min(1),
    asset: Base58PublicKeySchema,
    requiredAmountAtomic: AtomicAmountStringSchema,
    payToWallet: Base58PublicKeySchema,
    commissionBps: z.number().int().min(0).max(10_000),
    protocolFeeBpsOfCommission: z.number().int().min(0).max(10_000),
    commissionBase: z.literal("required_amount"),
    settlementMode: z.literal("accrual"),
    attributionRequired: z.boolean(),
    allowSelfReferral: z.boolean(),
    offerNonce: Split402IdSchema,
    issuedAt: Rfc3339UtcSchema,
    validUntil: Rfc3339UtcSchema,
    kid: z.string().min(1),
    signature: Base64UrlSignatureSchema
  })
  .strict();

export const BuyerProofV1Schema = z
  .object({
    type: z.literal("solana-ed25519"),
    publicKey: Base58PublicKeySchema,
    signature: Base64UrlSignatureSchema
  })
  .strict();

export const Split402AttributionV1Schema = z
  .object({
    protocolVersion: z.literal("0.1"),
    offer: Split402OfferV1Schema,
    paymentId: Split402IdSchema,
    requestDigest: Sha256HashSchema,
    referralClaim: ReferralClaimV1Schema.optional(),
    buyerProof: BuyerProofV1Schema.optional()
  })
  .strict();

export const Split402ReceiptV1Schema = z
  .object({
    protocolVersion: z.literal("0.1"),
    receiptId: Split402IdSchema,
    merchantId: Split402IdSchema,
    merchantOrigin: z.string().url(),
    operationId: z.string().min(1),
    requestDigest: Sha256HashSchema,
    campaignId: Split402IdSchema,
    campaignVersion: z.number().int().positive(),
    campaignTermsHash: Sha256HashSchema,
    routeId: Split402IdSchema.optional(),
    referralClaimHash: Sha256HashSchema.optional(),
    referrerWallet: Base58PublicKeySchema.optional(),
    payoutWallet: Base58PublicKeySchema.optional(),
    paymentId: Split402IdSchema,
    network: z.string().min(1),
    asset: Base58PublicKeySchema,
    payerWallet: Base58PublicKeySchema,
    payToWallet: Base58PublicKeySchema,
    requiredAmountAtomic: AtomicAmountStringSchema,
    settledAmountAtomic: AtomicAmountStringSchema.optional(),
    settlementTxSignature: z.string().min(1),
    commissionBps: z.number().int().min(0).max(10_000),
    protocolFeeBpsOfCommission: z.number().int().min(0).max(10_000),
    commissionBaseAtomic: AtomicAmountStringSchema,
    commissionAmountAtomic: AtomicAmountStringSchema,
    protocolFeeAtomic: AtomicAmountStringSchema,
    referrerCreditAtomic: AtomicAmountStringSchema,
    settlementMode: z.literal("accrual"),
    offerNonce: Split402IdSchema,
    settledAt: Rfc3339UtcSchema,
    issuedAt: Rfc3339UtcSchema,
    recordingStatus: z.enum(["accepted", "deferred"]),
    eventId: Split402IdSchema.optional(),
    kid: z.string().min(1),
    signature: Base64UrlSignatureSchema
  })
  .strict()
  .superRefine((receipt, ctx) => {
    const routeFields = [
      receipt.routeId,
      receipt.referralClaimHash,
      receipt.referrerWallet,
      receipt.payoutWallet
    ];
    const hasAnyRouteField = routeFields.some((value) => value !== undefined);
    const hasAllRouteFields = routeFields.every((value) => value !== undefined);

    if (hasAnyRouteField && !hasAllRouteFields) {
      ctx.addIssue({
        code: "custom",
        message:
          "routeId, referralClaimHash, referrerWallet, and payoutWallet must appear together"
      });
    }
  });

export type ReferralClaimV1 = z.infer<typeof ReferralClaimV1Schema>;
export type Split402OfferV1 = z.infer<typeof Split402OfferV1Schema>;
export type Split402AttributionV1 = z.infer<typeof Split402AttributionV1Schema>;
export type Split402ReceiptV1 = z.infer<typeof Split402ReceiptV1Schema>;
export type BuyerProofV1 = z.infer<typeof BuyerProofV1Schema>;
