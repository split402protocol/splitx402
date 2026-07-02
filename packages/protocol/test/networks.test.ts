import { describe, expect, it } from "vitest";

import {
  SOLANA_DEVNET_NETWORK,
  SOLANA_DEVNET_NETWORK_ID,
  SOLANA_DEVNET_USDC_MINT,
  SOLANA_MAINNET_DEMO_MAX_GROSS_AMOUNT_ATOMIC,
  SOLANA_MAINNET_NETWORK,
  SOLANA_MAINNET_NETWORK_ID,
  SOLANA_MAINNET_USDC_MINT,
  isSolanaMainnet,
  resolveSolanaNetwork
} from "../src/index.js";

describe("solana networks", () => {
  it("resolves devnet aliases to the devnet descriptor", () => {
    for (const alias of [
      "devnet",
      "solana:devnet",
      "Solana:Devnet",
      SOLANA_DEVNET_NETWORK_ID
    ]) {
      const descriptor = resolveSolanaNetwork(alias);
      expect(descriptor).toEqual(SOLANA_DEVNET_NETWORK);
      expect(descriptor.cluster).toBe("devnet");
      expect(descriptor.networkId).toBe(SOLANA_DEVNET_NETWORK_ID);
      expect(descriptor.usdcMint).toBe(SOLANA_DEVNET_USDC_MINT);
    }
  });

  it("resolves mainnet aliases to the mainnet descriptor", () => {
    for (const alias of [
      "mainnet",
      "mainnet-beta",
      "solana:mainnet",
      "solana:mainnet-beta",
      SOLANA_MAINNET_NETWORK_ID
    ]) {
      const descriptor = resolveSolanaNetwork(alias);
      expect(descriptor).toEqual(SOLANA_MAINNET_NETWORK);
      expect(descriptor.cluster).toBe("mainnet");
      expect(descriptor.networkId).toBe(SOLANA_MAINNET_NETWORK_ID);
      expect(descriptor.usdcMint).toBe(SOLANA_MAINNET_USDC_MINT);
    }
  });

  it("rejects unknown network values", () => {
    expect(() => resolveSolanaNetwork("solana:testnet")).toThrow(
      /unknown Solana network/u
    );
    expect(() => resolveSolanaNetwork("")).toThrow(/unknown Solana network/u);
    expect(() => resolveSolanaNetwork("eip155:84532")).toThrow(
      /unknown Solana network/u
    );
  });

  it("detects mainnet through every alias", () => {
    expect(isSolanaMainnet("solana:mainnet")).toBe(true);
    expect(isSolanaMainnet(SOLANA_MAINNET_NETWORK_ID)).toBe(true);
    expect(isSolanaMainnet("solana:devnet")).toBe(false);
    expect(isSolanaMainnet(SOLANA_DEVNET_NETWORK_ID)).toBe(false);
  });

  it("keeps the demo mainnet gross cap aligned with the canary cap", () => {
    expect(SOLANA_MAINNET_DEMO_MAX_GROSS_AMOUNT_ATOMIC).toBe("100000");
    expect(/^[1-9][0-9]*$/u.test(SOLANA_MAINNET_DEMO_MAX_GROSS_AMOUNT_ATOMIC)).toBe(
      true
    );
  });
});
