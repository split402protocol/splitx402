export const SOLANA_DEVNET_NETWORK_ID = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const SOLANA_MAINNET_NETWORK_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export const SOLANA_DEVNET_USDC_MINT =
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const SOLANA_MAINNET_USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const SOLANA_DEVNET_DEFAULT_RPC_URL = "https://api.devnet.solana.com";
export const SOLANA_MAINNET_DEFAULT_RPC_URL =
  "https://api.mainnet-beta.solana.com";

// Must stay equal to MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC in the launch
// tooling so the demo path cannot pay more than product:mainnet-canary allows.
export const SOLANA_MAINNET_DEMO_MAX_GROSS_AMOUNT_ATOMIC = "100000";

export type SolanaCluster = "devnet" | "mainnet";

export interface SolanaNetworkDescriptor {
  cluster: SolanaCluster;
  networkId: `${string}:${string}`;
  label: string;
  usdcMint: string;
  defaultRpcUrl: string;
}

export const SOLANA_DEVNET_NETWORK: SolanaNetworkDescriptor = {
  cluster: "devnet",
  networkId: SOLANA_DEVNET_NETWORK_ID,
  label: "Solana Devnet",
  usdcMint: SOLANA_DEVNET_USDC_MINT,
  defaultRpcUrl: SOLANA_DEVNET_DEFAULT_RPC_URL
};

export const SOLANA_MAINNET_NETWORK: SolanaNetworkDescriptor = {
  cluster: "mainnet",
  networkId: SOLANA_MAINNET_NETWORK_ID,
  label: "Solana Mainnet",
  usdcMint: SOLANA_MAINNET_USDC_MINT,
  defaultRpcUrl: SOLANA_MAINNET_DEFAULT_RPC_URL
};

const NETWORK_ALIASES: Record<string, SolanaNetworkDescriptor> = {
  devnet: SOLANA_DEVNET_NETWORK,
  "solana:devnet": SOLANA_DEVNET_NETWORK,
  [SOLANA_DEVNET_NETWORK_ID]: SOLANA_DEVNET_NETWORK,
  mainnet: SOLANA_MAINNET_NETWORK,
  "mainnet-beta": SOLANA_MAINNET_NETWORK,
  "solana:mainnet": SOLANA_MAINNET_NETWORK,
  "solana:mainnet-beta": SOLANA_MAINNET_NETWORK,
  [SOLANA_MAINNET_NETWORK_ID]: SOLANA_MAINNET_NETWORK
};

export function resolveSolanaNetwork(value: string): SolanaNetworkDescriptor {
  const descriptor = NETWORK_ALIASES[value.trim().toLowerCase()] ??
    NETWORK_ALIASES[value.trim()];
  if (descriptor === undefined) {
    throw new Error(
      `unknown Solana network "${value}"; use solana:devnet or solana:mainnet`
    );
  }
  return descriptor;
}

export function isSolanaMainnet(value: string): boolean {
  return resolveSolanaNetwork(value).cluster === "mainnet";
}
