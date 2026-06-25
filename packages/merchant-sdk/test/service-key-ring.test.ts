import {
  deriveEd25519PublicKey,
  hexToBytes
} from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  InMemoryMerchantServiceKeyRing,
  MerchantServiceKeyRingError
} from "../src/index.js";

const OLD_SEED = hexToBytes(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
);
const NEW_SEED = hexToBytes(
  "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf"
);

describe("InMemoryMerchantServiceKeyRing", () => {
  it("serves the current signing key and resolves old public keys by kid", () => {
    const keyRing = new InMemoryMerchantServiceKeyRing({
      current: {
        kid: "kid_old",
        privateSeed: OLD_SEED
      },
      additional: [
        {
          kid: "kid_new",
          privateSeed: NEW_SEED
        }
      ]
    });

    expect(keyRing.current().kid).toBe("kid_old");
    expect(Array.from(keyRing.current().privateSeed)).toEqual(
      Array.from(OLD_SEED)
    );
    expect(keyRing.resolvePublicKey("kid_old")).toBe(
      deriveEd25519PublicKey(OLD_SEED)
    );
    expect(keyRing.resolvePublicKey("kid_new")).toBe(
      deriveEd25519PublicKey(NEW_SEED)
    );

    expect(keyRing.rotateTo("kid_new")).toEqual({
      kid: "kid_new",
      publicKey: deriveEd25519PublicKey(NEW_SEED),
      current: true
    });
    expect(keyRing.current().kid).toBe("kid_new");
    expect(Array.from(keyRing.current().privateSeed)).toEqual(
      Array.from(NEW_SEED)
    );
    expect(keyRing.listPublicKeys()).toEqual([
      {
        kid: "kid_new",
        publicKey: deriveEd25519PublicKey(NEW_SEED),
        current: true
      },
      {
        kid: "kid_old",
        publicKey: deriveEd25519PublicKey(OLD_SEED),
        current: false
      }
    ]);
  });

  it("clones private seeds and rejects unknown rotations", () => {
    const mutableSeed = new Uint8Array(OLD_SEED);
    const keyRing = new InMemoryMerchantServiceKeyRing({
      current: {
        kid: "kid_old",
        privateSeed: mutableSeed
      }
    });
    mutableSeed.fill(0);

    expect(Array.from(keyRing.current().privateSeed)).toEqual(
      Array.from(OLD_SEED)
    );
    expect(() => keyRing.rotateTo("kid_missing")).toThrow(
      MerchantServiceKeyRingError
    );
  });
});
