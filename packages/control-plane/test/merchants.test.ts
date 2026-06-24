import { createSampleProtocolArtifacts } from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  InMemoryMerchantRegistry,
  InMemoryReceiptIngestionStore,
  ReceiptIngestor,
  createMerchantReceiptKeyResolver
} from "../src/index.js";

const FIXED_NOW = new Date("2026-06-24T00:00:00Z");

describe("merchant registry", () => {
  it("registers merchants, origins, and offer/receipt service keys", () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRegistry();

    const merchant = registry.createMerchant({
      id: bundle.artifacts.receipt.merchantId,
      slug: "demo-merchant",
      displayName: "Demo Merchant",
      ownerWallet: bundle.keys.payerWallet
    });
    const origin = registry.addOrigin({
      merchantId: merchant.id,
      origin: bundle.artifacts.receipt.merchantOrigin
    });
    const key = registry.addKey({
      merchantId: merchant.id,
      kid: bundle.artifacts.receipt.kid,
      publicKey: bundle.keys.merchantPublicKey,
      validFrom: "2026-06-24T00:00:00Z"
    });
    const profile = registry.getMerchantProfile(merchant.id);

    expect(merchant.status).toBe("pending");
    expect(origin.status).toBe("pending");
    expect(key.purpose).toBe("offer_receipt");
    expect(profile?.origins).toHaveLength(1);
    expect(profile?.keys).toHaveLength(1);
  });

  it("resolves a receipt verification key by merchant id, kid, purpose, and receipt time", async () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRegistry();
    registry.createMerchant({
      id: bundle.artifacts.receipt.merchantId,
      slug: "demo-merchant",
      displayName: "Demo Merchant",
      ownerWallet: bundle.keys.payerWallet
    });
    registry.addKey({
      merchantId: bundle.artifacts.receipt.merchantId,
      kid: bundle.artifacts.receipt.kid,
      publicKey: bundle.keys.merchantPublicKey,
      validFrom: "2026-06-24T00:00:00Z"
    });

    const publicKey = await createMerchantReceiptKeyResolver(registry)(
      bundle.artifacts.receipt
    );

    expect(publicKey).toBe(bundle.keys.merchantPublicKey);
  });

  it("keeps historical receipts verifiable when a key is revoked later", async () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRegistry();
    registry.createMerchant({
      id: bundle.artifacts.receipt.merchantId,
      slug: "demo-merchant",
      displayName: "Demo Merchant",
      ownerWallet: bundle.keys.payerWallet
    });
    registry.addKey({
      merchantId: bundle.artifacts.receipt.merchantId,
      kid: bundle.artifacts.receipt.kid,
      publicKey: bundle.keys.merchantPublicKey,
      validFrom: "2026-06-24T00:00:00Z"
    });
    registry.revokeKey({
      merchantId: bundle.artifacts.receipt.merchantId,
      kid: bundle.artifacts.receipt.kid,
      revokedAt: "2026-06-24T00:02:00Z",
      reason: "rotation complete"
    });

    const publicKey = await createMerchantReceiptKeyResolver(registry)(
      bundle.artifacts.receipt
    );

    expect(publicKey).toBe(bundle.keys.merchantPublicKey);
  });

  it("rejects receipts issued after a key revocation effective time", async () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRegistry();
    registry.createMerchant({
      id: bundle.artifacts.receipt.merchantId,
      slug: "demo-merchant",
      displayName: "Demo Merchant",
      ownerWallet: bundle.keys.payerWallet
    });
    registry.addKey({
      merchantId: bundle.artifacts.receipt.merchantId,
      kid: bundle.artifacts.receipt.kid,
      publicKey: bundle.keys.merchantPublicKey,
      validFrom: "2026-06-24T00:00:00Z"
    });
    registry.revokeKey({
      merchantId: bundle.artifacts.receipt.merchantId,
      kid: bundle.artifacts.receipt.kid,
      revokedAt: "2026-06-24T00:01:00Z",
      reason: "compromised"
    });
    const store = new InMemoryReceiptIngestionStore();
    const ingestor = new ReceiptIngestor(store, {
      resolveMerchantPublicKey: createMerchantReceiptKeyResolver(registry)
    });

    const result = await ingestor.ingest({ receipt: bundle.artifacts.receipt });

    expect(result).toEqual({
      status: "rejected",
      statusCode: 400,
      errors: [
        `unknown merchant public key for ${bundle.artifacts.receipt.merchantId}`
      ]
    });
  });
});

function createRegistry(): InMemoryMerchantRegistry {
  return new InMemoryMerchantRegistry({
    now: () => FIXED_NOW,
    merchantIdFactory: () => "mrc_ffffffffffffffffffffffffffffffff"
  });
}
