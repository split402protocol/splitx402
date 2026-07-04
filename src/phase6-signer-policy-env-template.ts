import { writeCliTextOutput } from "./cliOutput.js";
import {
  createPhase6SignerPolicyEnvTemplate,
  derivePhase6SignerPolicyValues,
  resolveSolanaSourceTokenAccount,
} from "./phase6SignerPolicyEnvTemplate.js";

try {
  const cli = parseArgs(process.argv.slice(2));
  const sourceTokenAccount = await maybeResolveSourceTokenAccount(cli);
  writeCliTextOutput({
    text: createPhase6SignerPolicyEnvTemplate({
      phase7ProofPath: cli.phase7ProofPath,
      sourceTokenAccount,
    }),
    outputPath: cli.outputPath,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    [
      "Usage: corepack pnpm phase6:signer-policy:env-template [output.env]",
      "Options:",
      "  --phase7-proof <path> (optional; defaults to split402-launch-evidence/phase7-staging-proof.txt)",
      "  --resolve-source-token-account (optional; resolves funding token account through Solana RPC)",
      "  --solana-rpc-url <url> (optional; defaults to SPLIT402_SIGNER_POLICY_SOLANA_RPC_URL or Devnet RPC)",
    ].join("\n"),
  );
  process.exitCode = 1;
}

function parseArgs(argv: string[]): {
  outputPath?: string;
  phase7ProofPath?: string;
  resolveSourceTokenAccount: boolean;
  solanaRpcUrl?: string;
} {
  let outputPath: string | undefined;
  let phase7ProofPath: string | undefined;
  let resolveSourceTokenAccount = false;
  let solanaRpcUrl: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--resolve-source-token-account") {
      resolveSourceTokenAccount = true;
      continue;
    }
    if (arg === "--phase7-proof") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--phase7-proof requires a path");
      }
      phase7ProofPath = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--phase7-proof=")) {
      phase7ProofPath = arg.slice("--phase7-proof=".length);
      continue;
    }
    if (arg === "--solana-rpc-url") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--solana-rpc-url requires a URL");
      }
      solanaRpcUrl = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--solana-rpc-url=")) {
      solanaRpcUrl = arg.slice("--solana-rpc-url=".length);
      continue;
    }
    if (arg?.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (outputPath !== undefined) {
      throw new Error("Only one output path is supported");
    }
    outputPath = arg;
  }
  return {
    outputPath,
    phase7ProofPath,
    resolveSourceTokenAccount,
    solanaRpcUrl,
  };
}

async function maybeResolveSourceTokenAccount(input: {
  phase7ProofPath?: string;
  resolveSourceTokenAccount: boolean;
  solanaRpcUrl?: string;
}): Promise<string | undefined> {
  if (!input.resolveSourceTokenAccount) {
    return undefined;
  }

  const derivations = derivePhase6SignerPolicyValues({
    phase7ProofPath: input.phase7ProofPath,
  });
  if (derivations.fundingWallet === undefined) {
    throw new Error("Cannot resolve source token account without funding wallet");
  }
  if (derivations.mint === undefined) {
    throw new Error("Cannot resolve source token account without mint");
  }

  const result = await resolveSolanaSourceTokenAccount({
    rpcUrl:
      input.solanaRpcUrl ??
      process.env.SPLIT402_SIGNER_POLICY_SOLANA_RPC_URL ??
      "https://api.devnet.solana.com",
    fundingWallet: derivations.fundingWallet,
    mint: derivations.mint,
  });
  if (!result.ok || result.sourceTokenAccount === undefined) {
    throw new Error(result.errors.join("; "));
  }
  return result.sourceTokenAccount;
}
