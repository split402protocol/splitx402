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

  it("updates merchant status through operator transitions", () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRegistry();
    const merchant = registry.createMerchant({
      id: bundle.artifacts.receipt.merchantId,
      slug: "demo-merchant",
      displayName: "Demo Merchant",
      ownerWallet: bundle.keys.payerWallet
    });

    const approved = registry.updateMerchantStatus({
      merchantId: merchant.id,
      status: "active"
    });
    expect(approved?.status).toBe("active");
    expect(registry.getMerchantProfile(merchant.id)?.status).toBe("active");

    const suspended = registry.updateMerchantStatus({
      merchantId: merchant.id,
      status: "suspended"
    });
    expect(suspended?.status).toBe("suspended");

    expect(
      registry.updateMerchantStatus({
        merchantId: "mrc_00000000000000000000000000000099",
        status: "active"
      })
    ).toBeUndefined();
    expect(() =>
      registry.updateMerchantStatus({
        merchantId: merchant.id,
        // @ts-expect-error pending is not an operator transition
        status: "pending"
      })
    ).toThrow(/must be active, suspended, or closed/u);
  });

  it("pauses, resumes, and retires payout wallets with a terminal retire state", () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRegistry();
    const merchant = registry.createMerchant({
      id: bundle.artifacts.receipt.merchantId,
      slug: "demo-merchant",
      displayName: "Demo Merchant",
      ownerWallet: bundle.keys.payerWallet
    });
    const wallet = registry.addPayoutWallet({
      merchantId: merchant.id,
      network: bundle.artifacts.receipt.network,
      wallet: bundle.keys.payToWallet,
      asset: bundle.artifacts.receipt.asset,
      signerReference: "kms:split402-devnet-payout"
    });

    const paused = registry.updatePayoutWalletStatus({
      merchantId: merchant.id,
      payoutWalletId: wallet.id,
      status: "paused"
    });
    expect(paused?.status).toBe("paused");

    const resumed = registry.updatePayoutWalletStatus({
      merchantId: merchant.id,
      payoutWalletId: wallet.id,
      status: "active"
    });
    expect(resumed?.status).toBe("active");

    const retired = registry.updatePayoutWalletStatus({
      merchantId: merchant.id,
      payoutWalletId: wallet.id,
      status: "retired"
    });
    expect(retired?.status).toBe("retired");

    expect(() =>
      registry.updatePayoutWalletStatus({
        merchantId: merchant.id,
        payoutWalletId: wallet.id,
        status: "active"
      })
    ).toThrow(MerchantRegistryConflictError);
    expect(
      registry.updatePayoutWalletStatus({
        merchantId: "mrc_00000000000000000000000000000099",
        payoutWalletId: wallet.id,
        status: "paused"
      })
    ).toBeUndefined();
  });

  it("updates origin status and manages verifiedAt", () => {
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

    const verified = registry.updateOriginStatus({
      merchantId: merchant.id,
      origin: origin.origin,
      status: "verified"
    });
    expect(verified?.status).toBe("verified");
    expect(verified?.verifiedAt).toBe(FIXED_NOW.toISOString());

    const revoked = registry.updateOriginStatus({
      merchantId: merchant.id,
      origin: origin.origin,
      status: "revoked"
    });
    expect(revoked?.status).toBe("revoked");
    expect(revoked?.verifiedAt).toBeUndefined();

    expect(
      registry.updateOriginStatus({
        merchantId: merchant.id,
        origin: "https://unknown.example",
        status: "verified"
      })
    ).toBeUndefined();
    expect(() =>
      registry.updateOriginStatus({
        merchantId: merchant.id,
        origin: origin.origin,
        // @ts-expect-error pending is not an operator transition
        status: "pending"
      })
    ).toThrow(/must be verified, failed, or revoked/u);
  });
});

function createRegistry(): InMemoryMerchantRegistry {
  return new InMemoryMerchantRegistry({
    now: () => FIXED_NOW,
    merchantIdFactory: () => "mrc_ffffffffffffffffffffffffffffffff",
    merchantPayoutWalletIdFactory: () => "mpw_ffffffffffffffffffffffffffffffff"
  });
}
