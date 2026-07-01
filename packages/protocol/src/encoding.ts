import { Buffer } from "node:buffer";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_VALUES = new Map<string, number>(
  [...BASE58_ALPHABET].map((char, index) => [char, index])
);

export function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/u.test(hex)) {
    throw new Error("invalid lowercase hex");
  }
  return Buffer.from(hex, "hex");
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) {
    throw new Error("invalid base64url");
  }

  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Buffer.from(padded.replaceAll("-", "+").replaceAll("_", "/"), "base64");
}

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      const value = (digits[index] ?? 0) * 256 + carry;

      // codeql[js/biased-cryptographic-random]: Base58 encoding uses deterministic divmod arithmetic; no random value is generated here.
      digits[index] = value % 58;

      // codeql[js/biased-cryptographic-random]: Base58 encoding uses deterministic divmod arithmetic; no random value is generated here.
      carry = Math.floor(value / 58);
    }

    while (carry > 0) {

      // codeql[js/biased-cryptographic-random]: Base58 encoding uses deterministic divmod arithmetic; no random value is generated here.
      digits.push(carry % 58);

      // codeql[js/biased-cryptographic-random]: Base58 encoding uses deterministic divmod arithmetic; no random value is generated here.
      carry = Math.floor(carry / 58);
    }
  }

  let zeroPrefix = "";
  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }
    zeroPrefix += "1";
  }

  return zeroPrefix + digits.reverse().map((digit) => BASE58_ALPHABET[digit]).join("");
}

export function base58Decode(value: string): Uint8Array {
  if (value.length === 0) {
    return new Uint8Array();
  }

  const bytes = [0];
  for (const char of value) {
    const carryValue = BASE58_VALUES.get(char);
    if (carryValue === undefined) {
      throw new Error("invalid base58");
    }

    let carry = carryValue;
    for (let index = 0; index < bytes.length; index += 1) {
      const next = (bytes[index] ?? 0) * 58 + carry;
      bytes[index] = next & 0xff;
      carry = next >> 8;
    }

    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (const char of value) {
    if (char !== "1") {
      break;
    }
    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
}

export function assertByteLength(
  bytes: Uint8Array,
  expectedLength: number,
  label: string
): void {
  if (bytes.length !== expectedLength) {
    throw new Error(`${label} must be ${expectedLength} bytes`);
  }
}
