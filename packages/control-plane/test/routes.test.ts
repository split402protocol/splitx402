import {
  buildReferralClaimSigningBytes,
  createSampleProtocolArtifacts,
  deriveEd25519PublicKey,
  hashProtocolObject,
  hexToBytes,
  signEd25519Message,
  type ReferralClaimV1
} from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  InMemoryRouteRegistry,
  RouteRegistryConflictError,
  RouteRegistryValidationError,
  type RouteDraft,
  type UnsignedReferralClaim
} from "../src/index.js";

const REFERRER_SEED = hexToBytes(
  "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f"
);
const PAYOUT_SEED = hexToBytes(
  "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f"
);
const REFERRER_WALLET = deriveEd25519PublicKey(REFERRER_SEED);
const PAYOUT_WALLET = deriveEd25519PublicKey(PAYOUT_SEED);

describe("InMemoryRouteRegistry", () => {
  it("creates canonical unsigned route drafts and activates signed claims", () => {
    const draft = createRouteDraft();
    const registry = createRouteRegistry();
    const claim = signRouteDraft(draft);

    const route = registry.activateRoute({ claim });
    const duplicate = registry.activateRoute({ claim });
    const loaded = registry.getRoute(route.id);

    expect(draft.routeId).toBe("rte_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(draft.signingBytesHex).toMatch(/^[0-9a-f]+$/u);
    expect(draft.unsignedClaimHash).toBe(hashProtocolObject(draft.claim));
    expect(route.status).toBe("active");
    expect(route.claimHash).toBe(hashProtocolObject(claim));
    expect(route.signingBytesHex).toBe(draft.signingBytesHex);
    expect(route.referrerWallet).toBe(REFERRER_WALLET);
    expect(route.payoutWallet).toBe(PAYOUT_WALLET);
    expect(duplicate.id).toBe(route.id);
    expect(loaded?.claimHash).toBe(route.claimHash);
  });

  it("rejects invalid signatures and expired route claims", () => {
    const registry = createRouteRegistry();
    const validClaim = signRouteDraft(createRouteDraft());

    expect(() =>
      registry.activateRoute({
        claim: {
          ...validClaim,
          signature: {
            ...validClaim.signature,
            value: mutateSignature(validClaim.signature.value)
          }
        }
      })
    ).toThrow(RouteRegistryValidationError);
    expect(() =>
      registry.activateRoute({
        claim: signRouteDraft(
          createRouteDraft({
            issuedAt: "2026-06-23T00:00:00Z",
            expiresAt: "2026-06-23T01:00:00Z"
          })
        )
      })
    ).toThrow("route claim is expired");
  });

  it("rejects conflicting claims for an existing route id", () => {
    const registry = createRouteRegistry();
    const firstClaim = signRouteDraft(createRouteDraft());
    const secondClaim = signRouteDraft(
      createRouteDraft({
        operationIds: ["operation-two"]
      })
    );
    registry.activateRoute({ claim: firstClaim });

    expect(() => registry.activateRoute({ claim: secondClaim })).toThrow(
      RouteRegistryConflictError
    );
  });

  it("suspends active routes idempotently", () => {
    const registry = createRouteRegistry();
    const route = registry.activateRoute({ claim: signRouteDraft(createRouteDraft()) });

    const suspended = registry.suspendRoute({ routeId: route.id });
    const duplicate = registry.suspendRoute({ routeId: route.id });
    const loaded = registry.getRoute(route.id);

    expect(suspended?.status).toBe("suspended");
    expect(duplicate?.status).toBe("suspended");
    expect(loaded?.status).toBe("suspended");
    expect(
      registry.suspendRoute({ routeId: "rte_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" })
    ).toBeUndefined();
  });

  it("searches routes with active defaults, filters, wildcard operation matches, and limits", () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRouteRegistry();
    const first = registry.activateRoute({
      claim: signRouteDraft(createRouteDraft())
    });
    const second = registry.activateRoute({
      claim: signRouteDraft(
        createRouteDraft({
          id: "rte_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          operationIds: ["operation-two"],
          nonce: "route-nonce-0002"
        })
      )
    });
    const wildcard = registry.activateRoute({
      claim: signRouteDraft(
        createRouteDraft({
          id: "rte_cccccccccccccccccccccccccccccccc",
          operationIds: ["*"],
          nonce: "route-nonce-0003"
        })
      )
    });

    registry.suspendRoute({ routeId: second.id });

    expect(registry.searchRoutes().map((route) => route.id)).toEqual([
      wildcard.id,
      first.id
    ]);
    expect(
      registry
        .searchRoutes({ operationId: bundle.artifacts.receipt.operationId })
        .map((route) => route.id)
    ).toEqual([wildcard.id, first.id]);
    expect(
      registry.searchRoutes({ operationId: "operation-two" }).map((route) => route.id)
    ).toEqual([wildcard.id]);
    expect(
      registry.searchRoutes({ status: "suspended" }).map((route) => route.id)
    ).toEqual([second.id]);
    expect(
      registry
        .searchRoutes({
          campaignId: first.campaignId,
          referrerWallet: REFERRER_WALLET,
          resourceOrigin: first.resourceOrigin,
          limit: 1
        })
        .map((route) => route.id)
    ).toEqual([wildcard.id]);
    expect(() => registry.searchRoutes({ limit: 101 })).toThrow(
      RouteRegistryValidationError
    );
  });

  it("excludes expired active routes from default search", () => {
    let now = new Date("2026-06-24T00:00:00Z");
    const registry = new InMemoryRouteRegistry({
      now: () => now,
      routeIdFactory: () => "rte_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nonceFactory: () => "route-nonce-0001"
    });
    const route = registry.activateRoute({ claim: signRouteDraft(createRouteDraft()) });

    expect(registry.searchRoutes().map((record) => record.id)).toEqual([route.id]);

    now = new Date("2026-06-26T00:00:00Z");

    expect(registry.searchRoutes()).toEqual([]);
  });
});

function createRouteRegistry(): InMemoryRouteRegistry {
  return new InMemoryRouteRegistry({
    now: () => new Date("2026-06-24T00:00:00Z"),
    routeIdFactory: () => "rte_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    nonceFactory: () => "route-nonce-0001"
  });
}

function createRouteDraft(
  overrides: Partial<Parameters<InMemoryRouteRegistry["createRouteDraft"]>[0]> = {}
): RouteDraft {
  const bundle = createSampleProtocolArtifacts();
  return createRouteRegistry().createRouteDraft({
    id: "rte_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    campaignId: bundle.artifacts.receipt.campaignId,
    campaignVersionMin: 1,
    referrerWallet: REFERRER_WALLET,
    payoutWallet: PAYOUT_WALLET,
    resourceOrigin: bundle.artifacts.receipt.merchantOrigin,
    operationIds: [bundle.artifacts.receipt.operationId],
    issuedAt: "2026-06-24T00:00:00Z",
    expiresAt: "2026-06-25T00:00:00Z",
    nonce: "route-nonce-0001",
    ...overrides
  });
}

function signRouteDraft(draft: RouteDraft): ReferralClaimV1 {
  return signUnsignedClaim(draft.claim);
}

function signUnsignedClaim(claim: UnsignedReferralClaim): ReferralClaimV1 {
  const signed = signEd25519Message(
    buildReferralClaimSigningBytes(claim),
    REFERRER_SEED
  );
  return {
    ...claim,
    signature: {
      type: "solana-ed25519",
      publicKey: signed.publicKey,
      value: signed.signature
    }
  };
}

function mutateSignature(signature: string): string {
  const first = signature[0] ?? "A";
  return `${first === "A" ? "B" : "A"}${signature.slice(1)}`;
}
