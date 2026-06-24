import { Buffer } from "node:buffer";
import {
  createPrivateKey,
  createPublicKey,
  sign as nodeSign,
  verify as nodeVerify
} from "node:crypto";
import type { KeyObject } from "node:crypto";

import { canonicalizeProtocolObject } from "./canonical.js";
import {
  assertByteLength,
  base58Decode,
  base58Encode,
  base64UrlDecode,
  base64UrlEncode,
  utf8Bytes
} from "./encoding.js";
import type {
  ReferralClaimV1,
  Split402AttributionV1,
  Split402OfferV1,
  Split402ReceiptV1
} from "./schemas.js";

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface DetachedSignature {
  publicKey: string;
  signature: string;
}

export interface VerificationResult {
  ok: boolean;
  errors: string[];
}

export function buildReferralClaimSigningBytes(
  claim: Omit<ReferralClaimV1, "signature"> | ReferralClaimV1
): Uint8Array {
  return buildDomainSeparatedSigningBytes(
    "split402:referral-claim:v1",
    omitKeys(claim, ["signature"])
  );
}

export function buildOfferSigningBytes(
  offer: Omit<Split402OfferV1, "signature"> | Split402OfferV1
): Uint8Array {
  return buildDomainSeparatedSigningBytes(
    "split402:offer:v1",
    omitKeys(offer, ["signature"])
  );
}

export function buildReceiptSigningBytes(
  receipt: Omit<Split402ReceiptV1, "signature"> | Split402ReceiptV1
): Uint8Array {
  return buildDomainSeparatedSigningBytes(
    "split402:receipt:v1",
    omitKeys(receipt, ["signature"])
  );
}

export function buildBuyerProofSigningBytes(
  attribution: Split402AttributionV1
): Uint8Array {
  const routeId = attribution.referralClaim?.routeId ?? null;
  return buildDomainSeparatedSigningBytes("split402:buyer-proof:v1", {
    paymentId: attribution.paymentId,
    requestDigest: attribution.requestDigest,
    offerNonce: attribution.offer.offerNonce,
    routeId
  });
}

export function buildDomainSeparatedSigningBytes(
  domain: string,
  value: unknown
): Uint8Array {
  return utf8Bytes(`${domain}\n${canonicalizeProtocolObject(value)}`);
}

export function signEd25519Message(
  message: Uint8Array,
  privateSeedOrSecretKey: Uint8Array
): DetachedSignature {
  const privateKey = createEd25519PrivateKey(privateSeedOrSecretKey);
  const publicKey = exportRawEd25519PublicKey(createPublicKey(privateKey));
  const signature = nodeSign(null, Buffer.from(message), privateKey);

  return {
    publicKey: base58Encode(publicKey),
    signature: base64UrlEncode(signature)
  };
}

export function verifyEd25519Signature(
  message: Uint8Array,
  publicKeyBase58: string,
  signatureBase64Url: string
): boolean {
  const publicKeyBytes = base58Decode(publicKeyBase58);
  const signatureBytes = base64UrlDecode(signatureBase64Url);
  assertByteLength(publicKeyBytes, 32, "Ed25519 public key");
  assertByteLength(signatureBytes, 64, "Ed25519 signature");

  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyBytes)]),
    type: "spki",
    format: "der"
  });

  return nodeVerify(null, Buffer.from(message), publicKey, Buffer.from(signatureBytes));
}

export function deriveEd25519PublicKey(privateSeedOrSecretKey: Uint8Array): string {
  const privateKey = createEd25519PrivateKey(privateSeedOrSecretKey);
  return base58Encode(exportRawEd25519PublicKey(createPublicKey(privateKey)));
}

export function verifyReferralClaimSignature(claim: ReferralClaimV1): VerificationResult {
  const errors: string[] = [];

  if (claim.signature.publicKey !== claim.referrerWallet) {
    errors.push("signature.publicKey must equal referrerWallet");
  }
  if (
    !safeVerify(
      buildReferralClaimSigningBytes(claim),
      claim.signature.publicKey,
      claim.signature.value
    )
  ) {
    errors.push("invalid referral claim signature");
  }

  return { ok: errors.length === 0, errors };
}

export function verifySplit402OfferSignature(
  offer: Split402OfferV1,
  merchantPublicKey: string
): VerificationResult {
  const ok = safeVerify(buildOfferSigningBytes(offer), merchantPublicKey, offer.signature);
  return ok ? { ok: true, errors: [] } : { ok: false, errors: ["invalid offer signature"] };
}

export function verifySplit402ReceiptSignature(
  receipt: Split402ReceiptV1,
  merchantPublicKey: string
): VerificationResult {
  const ok = safeVerify(buildReceiptSigningBytes(receipt), merchantPublicKey, receipt.signature);
  return ok ? { ok: true, errors: [] } : { ok: false, errors: ["invalid receipt signature"] };
}

export function verifyBuyerProof(attribution: Split402AttributionV1): VerificationResult {
  if (attribution.buyerProof === undefined) {
    return { ok: true, errors: [] };
  }

  const ok = safeVerify(
    buildBuyerProofSigningBytes(attribution),
    attribution.buyerProof.publicKey,
    attribution.buyerProof.signature
  );

  return ok ? { ok: true, errors: [] } : { ok: false, errors: ["invalid buyer proof"] };
}

function safeVerify(message: Uint8Array, publicKey: string, signature: string): boolean {
  try {
    return verifyEd25519Signature(message, publicKey, signature);
  } catch {
    return false;
  }
}

function createEd25519PrivateKey(privateSeedOrSecretKey: Uint8Array): KeyObject {
  const seed =
    privateSeedOrSecretKey.length === 64
      ? privateSeedOrSecretKey.slice(0, 32)
      : privateSeedOrSecretKey;
  assertByteLength(seed, 32, "Ed25519 private seed");

  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)]),
    type: "pkcs8",
    format: "der"
  });
}

function exportRawEd25519PublicKey(publicKey: KeyObject): Uint8Array {
  const spki = publicKey.export({ type: "spki", format: "der" });
  const rawKey = Buffer.from(spki).subarray(-32);
  assertByteLength(rawKey, 32, "Ed25519 public key");
  return rawKey;
}

function omitKeys<T extends object>(
  value: T,
  keys: readonly string[]
): Record<string, unknown> {
  const omitted: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const key of keys) {
    delete omitted[key];
  }
  return omitted;
}
