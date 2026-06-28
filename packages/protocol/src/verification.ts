import { calculateCommission } from "./commission.js";
import { parseAtomicAmount } from "./amounts.js";
import {
  verifyBuyerProof,
  verifyReferralClaimSignature,
  verifySplit402OfferSignature,
  verifySplit402ReceiptSignature
} from "./signing.js";
import {
  ReferralClaimV1Schema,
  Split402AttributionV1Schema,
  Split402OfferV1Schema,
  Split402ReceiptV1Schema,
  type ReferralClaimV1,
  type Split402AttributionV1,
  type Split402OfferV1,
  type Split402ReceiptV1
} from "./schemas.js";

export interface ProtocolVerificationResult {
  ok: boolean;
  errors: string[];
}

export function verifyReferralClaim(value: unknown): ProtocolVerificationResult {
  const parsed = ReferralClaimV1Schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }

  return verifyReferralClaimObject(parsed.data);
}

export function verifyReferralClaimObject(
  claim: ReferralClaimV1
): ProtocolVerificationResult {
  return verifyReferralClaimSignature(claim);
}

export function verifySplit402Offer(
  value: unknown,
  merchantPublicKey: string
): ProtocolVerificationResult {
  const parsed = Split402OfferV1Schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }

  return verifySplit402OfferObject(parsed.data, merchantPublicKey);
}

export function verifySplit402OfferObject(
  offer: Split402OfferV1,
  merchantPublicKey: string
): ProtocolVerificationResult {
  return verifySplit402OfferSignature(offer, merchantPublicKey);
}

export function verifySplit402Attribution(
  value: unknown,
  merchantPublicKey: string
): ProtocolVerificationResult {
  const parsed = Split402AttributionV1Schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }

  return verifySplit402AttributionObject(parsed.data, merchantPublicKey);
}

export function verifySplit402AttributionObject(
  attribution: Split402AttributionV1,
  merchantPublicKey: string
): ProtocolVerificationResult {
  const errors: string[] = [];
  errors.push(...verifySplit402OfferObject(attribution.offer, merchantPublicKey).errors);

  if (attribution.referralClaim !== undefined) {
    errors.push(...verifyReferralClaimObject(attribution.referralClaim).errors);
  }

  errors.push(...verifyBuyerProof(attribution).errors);

  return { ok: errors.length === 0, errors };
}

export function verifySplit402Receipt(
  value: unknown,
  merchantPublicKey: string
): ProtocolVerificationResult {
  const parsed = Split402ReceiptV1Schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }

  return verifySplit402ReceiptObject(parsed.data, merchantPublicKey);
}

export function verifySplit402ReceiptObject(
  receipt: Split402ReceiptV1,
  merchantPublicKey: string
): ProtocolVerificationResult {
  const errors: string[] = [];
  errors.push(...verifySplit402ReceiptSignature(receipt, merchantPublicKey).errors);
  errors.push(...verifyReceiptArithmetic(receipt).errors);

  return { ok: errors.length === 0, errors };
}

export function verifyReceiptArithmetic(
  receipt: Split402ReceiptV1
): ProtocolVerificationResult {
  const errors: string[] = [];
  const requiredAmount = parseAtomicAmount(receipt.requiredAmountAtomic);
  const commissionBase = parseAtomicAmount(receipt.commissionBaseAtomic);
  const commissionAmount = parseAtomicAmount(receipt.commissionAmountAtomic);
  const protocolFee = parseAtomicAmount(receipt.protocolFeeAtomic);
  const referrerCredit = parseAtomicAmount(receipt.referrerCreditAtomic);

  if (commissionBase !== requiredAmount) {
    errors.push("commissionBaseAtomic must equal requiredAmountAtomic in v0.1");
  }

  const expected = calculateCommission(
    requiredAmount,
    BigInt(receipt.commissionBps),
    BigInt(receipt.protocolFeeBpsOfCommission)
  );
  if (commissionAmount !== expected.commission) {
    errors.push("commissionAmountAtomic does not match commissionBps");
  }
  if (protocolFee !== expected.protocolFee) {
    errors.push("protocolFeeAtomic does not match protocol fee policy");
  }
  if (referrerCredit !== expected.referrerCredit) {
    errors.push("referrerCreditAtomic does not match commission minus protocol fee");
  }

  return { ok: errors.length === 0, errors };
}
