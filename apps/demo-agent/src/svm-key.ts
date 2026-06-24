import { randomBytes } from "node:crypto";

import {
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  type KeyPairSigner
} from "@solana/kit";
import { base58Decode, base58Encode } from "@split402/protocol";

export function generateSvmPrivateSeed(): Uint8Array {
  return randomBytes(32);
}

export function encodeSvmPrivateSeed(seed: Uint8Array): string {
  return base58Encode(seed);
}

export async function createSvmSignerFromBase58(secret: string): Promise<KeyPairSigner> {
  const bytes = base58Decode(secret);
  if (bytes.length === 32) {
    return await createKeyPairSignerFromPrivateKeyBytes(bytes);
  }
  if (bytes.length === 64) {
    return await createKeyPairSignerFromBytes(bytes);
  }
  throw new Error(
    `SVM_PRIVATE_KEY must decode to 32 private-seed bytes or 64 keypair bytes; got ${bytes.length}`
  );
}

export async function createSvmSignerFromEnv(): Promise<KeyPairSigner> {
  const privateKey = process.env.SVM_PRIVATE_KEY;
  if (privateKey === undefined || privateKey.length === 0) {
    throw new Error(
      "SVM_PRIVATE_KEY is required. Use a funded Solana Devnet buyer key encoded as base58 bytes."
    );
  }
  return await createSvmSignerFromBase58(privateKey);
}
