import {
  SOLANA_MAINNET_DEMO_MAX_GROSS_AMOUNT_ATOMIC,
  resolveSolanaNetwork,
  type SolanaNetworkDescriptor
} from "@split402/protocol";

export const MAINNET_DEMO_CONFIRMATION = "split402-mainnet-canary";

export function readDemoNetwork(): SolanaNetworkDescriptor {
  return resolveSolanaNetwork(
    process.env.SPLIT402_DEMO_NETWORK ?? "solana:devnet"
  );
}

export interface MainnetPaymentGuardResult {
  required: boolean;
  ok: boolean;
  problems: string[];
}

export function checkMainnetPaymentGuards(input: {
  network: SolanaNetworkDescriptor;
  buyerWallet?: string;
  requiredAmountAtomic?: string;
}): MainnetPaymentGuardResult {
  if (input.network.cluster !== "mainnet") {
    return { required: false, ok: true, problems: [] };
  }

  const problems: string[] = [];
  if (
    process.env.SPLIT402_MAINNET_CANARY_CONFIRM !== MAINNET_DEMO_CONFIRMATION
  ) {
    problems.push(
      `set SPLIT402_MAINNET_CANARY_CONFIRM=${MAINNET_DEMO_CONFIRMATION} to acknowledge a mainnet canary payment`
    );
  }

  const allowlistedWallet = process.env.SPLIT402_MAINNET_CANARY_WALLET?.trim();
  if (allowlistedWallet === undefined || allowlistedWallet.length === 0) {
    problems.push(
      "set SPLIT402_MAINNET_CANARY_WALLET to the single approved canary payer wallet"
    );
  } else if (
    input.buyerWallet !== undefined &&
    input.buyerWallet !== allowlistedWallet
  ) {
    problems.push(
      `buyer wallet ${input.buyerWallet} is not the allowlisted SPLIT402_MAINNET_CANARY_WALLET`
    );
  }

  if (input.requiredAmountAtomic !== undefined) {
    const amount = input.requiredAmountAtomic;
    if (
      !/^(0|[1-9][0-9]*)$/u.test(amount) ||
      BigInt(amount) > BigInt(SOLANA_MAINNET_DEMO_MAX_GROSS_AMOUNT_ATOMIC)
    ) {
      problems.push(
        `offer amount ${amount} exceeds the ${SOLANA_MAINNET_DEMO_MAX_GROSS_AMOUNT_ATOMIC} atomic mainnet canary gross cap`
      );
    }
  }

  return { required: true, ok: problems.length === 0, problems };
}
