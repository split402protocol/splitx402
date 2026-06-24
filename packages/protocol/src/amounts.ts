export function parseAtomicAmount(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error("atomic amount must be a non-negative decimal string");
  }

  return BigInt(value);
}

export function serializeAtomicAmount(value: bigint): string {
  if (value < 0n) {
    throw new Error("atomic amount cannot be negative");
  }

  return value.toString(10);
}

export function assertAtomicAmountString(value: string): void {
  parseAtomicAmount(value);
}

