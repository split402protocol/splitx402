import {
  buildReceiptSigningBytes,
  createSampleProtocolArtifacts,
  deriveEd25519PublicKey,
  hexToBytes,
  signEd25519Message,
  type Split402ReceiptV1
} from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  ControlPlaneReceiptPolicyVerifier,
  InMemoryCampaignRegistry,
  InMemoryMerchantRegistry,
  InMemoryReceiptIngestionStore,
  InMemoryRouteRegistry,
  ReceiptIngestor,
  buildCampaignTermsSigningBytes,
  type CampaignProfile,
  type CampaignTermsInput
} from "../src/index.js";

const MERCHANT_SEED = hexToBytes(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
);
const FIXED_NOW = new Date("2026-06-24T00:01:30Z");

describe("control-plane receipt policy verifier", () => {
  it("accepts a valid receipt and gates accrual creation", async () => {
    const fixture = createPolicyFixture();
    const store = new InMemoryReceiptIngestionStore();
    const ingestor = new ReceiptIngestor(store, {
      resolveMerchantPublicKey: () => fixture.bundle.keys.merchantPublicKey,
      policyVerifier: fixture.verifier,
      now: () => FIXED_NOW
    });

    const result = await ingestor.ingest({ receipt: fixture.receipt });

    expect(result.status).toBe("created");
    if (result.status !== "created") {
      throw new Error("expected valid policy receipt to be created");
    }
    expect(result.accrual?.amountAtomic).toBe(fixture.receipt.referrerCreditAtomic);
    expect(store.listAccruals()).toHaveLength(1);
  });

  it("rejects campaign terms hash mismatches", async () => {
    const fixture = createPolicyFixture();
    const receipt = signReceipt(fixture.receipt, {
      campaignTermsHash:
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    });

    await expectPolicyErrors(fixture.verifier, receipt, [
      "campaign terms hash does not match receipt"
    ]);
  });

  it("rejects inactive campaigns", async () => {
    const fixture = createPolicyFixture({ activateCampaign: false });

    await expectPolicyErrors(fixture.verifier, fixture.receipt, [
      "campaign is not active"
    ]);
  });

  it("rejects unverified merchant origins", async () => {
    const fixture = createPolicyFixture({ originStatus: "pending" });

    await expectPolicyErrors(fixture.verifier, fixture.receipt, [
      "merchant origin is not verified"
    ]);
  });

  it("rejects suspended routes", async () => {
    const fixture = createPolicyFixture();
    fixture.routeRegistry.suspendRoute({ routeId: fixture.receipt.routeId ?? "" });

    await expectPolicyErrors(fixture.verifier, fixture.receipt, [
      "route is not active"
    ]);
  });

  it("rejects routes that do not cover the receipt operation", async () => {
    const fixture = createPolicyFixture();
    const receipt = signReceipt(fixture.receipt, {
      operationId: "unlisted-operation"
    });

    await expectPolicyErrors(fixture.verifier, receipt, [
      "operationId is not in campaign version terms",
      "route does not cover receipt operationId"
    ]);
  });

  it("rejects asset, amount, pay-to, and protocol-fee policy drift", async () => {
    const fixture = createPolicyFixture();
    const receipt = signReceipt(fixture.receipt, {
      asset: fixture.bundle.keys.payToWallet,
      requiredAmountAtomic: "10001",
      payToWallet: fixture.bundle.keys.payerWallet,
      protocolFeeBpsOfCommission:
        fixture.receipt.protocolFeeBpsOfCommission + 1
    });

    await expectPolicyErrors(fixture.verifier, receipt, [
      "asset does not match campaign policy",
      "requiredAmountAtomic does not match campaign policy",
      "payToWallet does not match campaign policy",
      "protocolFeeBpsOfCommission does not match campaign policy"
    ]);
  });

  it("rejects merchant-owner self-referral", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fixture = createPolicyFixture({
      ownerWallet: bundle.keys.referrerPublicKey
    });

    await expectPolicyErrors(fixture.verifier, fixture.receipt, [
      "self-referral policy violation: merchant_owner_is_referrer"
    ]);
  });

  it("rejects commission amounts on unattributed receipts", async () => {
    const fixture = createPolicyFixture();
    const receiptWithoutRoute: Partial<Split402ReceiptV1> = { ...fixture.receipt };
    delete receiptWithoutRoute.routeId;
    delete receiptWithoutRoute.referralClaimHash;
    delete receiptWithoutRoute.referrerWallet;
    delete receiptWithoutRoute.payoutWallet;
    const receipt = signReceipt(
      receiptWithoutRoute as Omit<Split402ReceiptV1, "signature">
    );

    await expectPolicyErrors(fixture.verifier, receipt, [
      "unattributed receipt must have zero commission amounts"
    ]);
  });
});

function createPolicyFixture(
  input: {
    activateCampaign?: boolean;
    originStatus?: "pending" | "verified";
    ownerWallet?: string;
  } = {}
) {
  const bundle = createSampleProtocolArtifacts();
  const merchantRegistry = new InMemoryMerchantRegistry({ now: () => FIXED_NOW });
  const campaignRegistry = new InMemoryCampaignRegistry({ now: () => FIXED_NOW });
  const routeRegistry = new InMemoryRouteRegistry({ now: () => FIXED_NOW });

  merchantRegistry.createMerchant({
    id: bundle.artifacts.receipt.merchantId,
    slug: "demo-merchant",
    displayName: "Demo Merchant",
    ownerWallet: input.ownerWallet ?? bundle.keys.payerWallet,
    status: "active"
  });
  merchantRegistry.addOrigin({
    merchantId: bundle.artifacts.receipt.merchantId,
    origin: bundle.artifacts.receipt.merchantOrigin,
    status: input.originStatus ?? "verified",
    ...(input.originStatus === "pending"
      ? {}
      : { verifiedAt: "2026-06-24T00:00:30Z" })
  });
  merchantRegistry.addKey({
    merchantId: bundle.artifacts.receipt.merchantId,
    kid: bundle.artifacts.receipt.kid,
    publicKey: bundle.keys.merchantPublicKey,
    validFrom: "2026-06-24T00:00:00Z"
  });
  const campaign = campaignRegistry.createCampaign({
    id: bundle.artifacts.receipt.campaignId,
    merchantId: bundle.artifacts.receipt.merchantId,
    ...createCampaignTerms(bundle.artifacts.receipt)
  });
  const activeCampaign =
    input.activateCampaign === false
      ? campaign
      : activateCampaign(campaignRegistry, campaign);
  routeRegistry.activateRoute({ claim: bundle.artifacts.referralClaim });
  const receipt = signReceipt(bundle.artifacts.receipt, {
    campaignTermsHash: activeCampaign.current.termsHash
  });
  const verifier = new ControlPlaneReceiptPolicyVerifier({
    merchantRegistry,
    campaignRegistry,
    routeRegistry
  });

  return {
    bundle,
    campaignRegistry,
    merchantRegistry,
    receipt,
    routeRegistry,
    verifier
  };
}

function activateCampaign(
  registry: InMemoryCampaignRegistry,
  campaign: CampaignProfile
): CampaignProfile {
  const signature = signEd25519Message(
    buildCampaignTermsSigningBytes(campaign.current.terms),
    MERCHANT_SEED
  ).signature;
  return registry.activateCampaignVersion({
    campaignId: campaign.id,
    merchantKid: "kid_merchant_demo_1",
    merchantPublicKey: deriveEd25519PublicKey(MERCHANT_SEED),
    merchantSignature: signature
  });
}

function createCampaignTerms(receipt: Split402ReceiptV1): CampaignTermsInput {
  return {
    resourceOrigin: receipt.merchantOrigin,
    operations: [
      {
        operationId: receipt.operationId,
        method: "POST",
        pathTemplate: "/v1/risk"
      }
    ],
    network: receipt.network,
    asset: receipt.asset,
    requiredAmountAtomic: receipt.requiredAmountAtomic,
    payToWallet: receipt.payToWallet,
    commissionBps: receipt.commissionBps,
    protocolFeeBpsOfCommission: receipt.protocolFeeBpsOfCommission,
    payoutThresholdAtomic: "1",
    startsAt: "2026-06-24T00:00:00Z"
  };
}

function signReceipt(
  receipt: Omit<Split402ReceiptV1, "signature"> | Split402ReceiptV1,
  overrides: Partial<Omit<Split402ReceiptV1, "signature">> = {}
): Split402ReceiptV1 {
  const unsignedReceipt = { ...receipt } as Partial<Split402ReceiptV1>;
  delete unsignedReceipt.signature;
  const nextUnsignedReceipt = {
    ...unsignedReceipt,
    ...overrides
  } as Omit<Split402ReceiptV1, "signature">;
  return {
    ...nextUnsignedReceipt,
    signature: signEd25519Message(
      buildReceiptSigningBytes(nextUnsignedReceipt),
      MERCHANT_SEED
    ).signature
  };
}

async function expectPolicyErrors(
  verifier: ControlPlaneReceiptPolicyVerifier,
  receipt: Split402ReceiptV1,
  expectedErrors: string[]
): Promise<void> {
  const result = await verifier.verify(receipt);

  expect(result.ok).toBe(false);
  expect(result.errors).toEqual(expect.arrayContaining(expectedErrors));
}
