export interface CommissionBreakdown {
  commission: bigint;
  protocolFee: bigint;
  referrerCredit: bigint;
}

export function calculateCommission(
  requiredAmountAtomic: bigint,
  commissionBps: bigint,
  protocolFeeBpsOfCommission = 0n
): CommissionBreakdown {
  if (requiredAmountAtomic < 0n) {
    throw new Error("negative amount");
  }
  if (commissionBps < 0n || commissionBps > 10_000n) {
    throw new Error("invalid commission bps");
  }
  if (protocolFeeBpsOfCommission < 0n || protocolFeeBpsOfCommission > 10_000n) {
    throw new Error("invalid protocol fee bps");
  }

  const commission = (requiredAmountAtomic * commissionBps) / 10_000n;
  const protocolFee = (commission * protocolFeeBpsOfCommission) / 10_000n;

  return {
    commission,
    protocolFee,
    referrerCredit: commission - protocolFee
  };
}

