import { randomBytes } from "node:crypto";

export type Split402IdPrefix =
  | "cmp"
  | "mrc"
  | "ofn"
  | "pay"
  | "pob"
  | "rcp"
  | "rte";

export function createPrefixedId(prefix: Split402IdPrefix, entropyBytes = 16): string {
  if (entropyBytes < 16) {
    throw new Error("Split402 IDs require at least 128 bits of entropy");
  }

  return `${prefix}_${randomBytes(entropyBytes).toString("hex")}`;
}

export function isPrefixedId(value: string, prefix?: Split402IdPrefix): boolean {
  const source = prefix === undefined ? "[a-z]{3}" : prefix;
  return new RegExp(`^${source}_[0-9a-f]{32,}$`, "u").test(value);
}

export function assertPrefixedId(value: string, prefix?: Split402IdPrefix): void {
  if (!isPrefixedId(value, prefix)) {
    throw new Error(prefix === undefined ? "invalid Split402 ID" : `invalid ${prefix}_ ID`);
  }
}

