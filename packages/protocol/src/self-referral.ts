export interface SelfReferralPolicyInput {
  allowSelfReferral: boolean;
  payerWallet: string;
  referrerWallet?: string;
  payoutWallet?: string;
  merchantOwnerWallet?: string;
}

export interface SelfReferralPolicyResult {
  allowed: boolean;
  reason?:
    | "payer_is_referrer"
    | "payer_is_payout_wallet"
    | "merchant_owner_is_referrer"
    | "merchant_owner_is_payout_wallet";
}

export function evaluateSelfReferralPolicy(
  input: SelfReferralPolicyInput
): SelfReferralPolicyResult {
  if (input.allowSelfReferral) {
    return { allowed: true };
  }
  if (input.referrerWallet === undefined && input.payoutWallet === undefined) {
    return { allowed: true };
  }
  if (input.referrerWallet !== undefined && input.payerWallet === input.referrerWallet) {
    return { allowed: false, reason: "payer_is_referrer" };
  }
  if (input.payoutWallet !== undefined && input.payerWallet === input.payoutWallet) {
    return { allowed: false, reason: "payer_is_payout_wallet" };
  }
  if (
    input.merchantOwnerWallet !== undefined &&
    input.referrerWallet !== undefined &&
    input.merchantOwnerWallet === input.referrerWallet
  ) {
    return { allowed: false, reason: "merchant_owner_is_referrer" };
  }
  if (
    input.merchantOwnerWallet !== undefined &&
    input.payoutWallet !== undefined &&
    input.merchantOwnerWallet === input.payoutWallet
  ) {
    return { allowed: false, reason: "merchant_owner_is_payout_wallet" };
  }
  return { allowed: true };
}
