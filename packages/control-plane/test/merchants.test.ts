import { createSampleProtocolArtifacts } from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  InMemoryMerchantRegistry,
  InMemoryReceiptIngestionStore,
  MerchantRegistryConflictError,
  ReceiptIngestor,
  createMerchantReceiptKeyResolver
} from "../src/index.js";

const FIXED_NOW = new Date("2026-06-24T00:00:00Z");

describe("merchant registry", () => {
  it("registers merchants, origins, service keys, and payout wallets", () => {
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
    const payoutWallet = registry.addPayoutWallet({
      merchantId: merchant.id,
      network: bundle.artifacts.receipt.network,
      wallet: bundle.keys.payToWallet,
      asset: bundle.artifacts.receipt.asset,
      signerReference: "kms:split402-devnet-payout"
    });
    const profile = registry.getMerchantProfile(merchant.id);

    expect(merchant.status).toBe("pending");
    expect(origin.status).toBe("pending");
    expect(key.purpose).toBe("offer_receipt");
    expect(payoutWallet.status).toBe("active");
    expect(profile?.origins).toHaveLength(1);
    expect(profile?.keys).toHaveLength(1);
    expect(profile?.payoutWallets).toEqual([payoutWallet]);
  });

  it("rejects duplicate merchant payout wallets for the same asset and network", () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRegistry();
    const merchant = registry.createMerchant({
      id: bundle.artifacts.receipt.merchantId,
      slug: "demo-merchant",
      displayName: "Demo Merchant",
      ownerWallet: bundle.keys.payerWallet
    });
    const input = {
      merchantId: merchant.id,
      network: bundle.artifacts.receipt.network,
      wallet: bundle.keys.payToWallet,
      asset: bundle.artifacts.receipt.asset,
      signerReference: "kms:split402-devnet-payout"
    };

    registry.addPayoutWallet(input);

    expect(() => registry.addPayoutWallet(input)).toThrow(
      MerchantRegistryConflictError
    );
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
    merchantIdFactory: () => "mrc_ffffffffffffffffffffffffffffffff",
    merchantPayoutWalletIdFactory: () => "mpw_ffffffffffffffffffffffffffffffff"
  });
}
