import { writeCliTextOutput } from "./cliOutput.js";
import { createPhase6SignerPolicyEnvTemplate } from "./phase6SignerPolicyEnvTemplate.js";

try {
  const cli = parseArgs(process.argv.slice(2));
  writeCliTextOutput({
    text: createPhase6SignerPolicyEnvTemplate({
      phase7ProofPath: cli.phase7ProofPath,
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
    ].join("\n"),
  );
  process.exitCode = 1;
}

function parseArgs(argv: string[]): {
  outputPath?: string;
  phase7ProofPath?: string;
} {
  let outputPath: string | undefined;
  let phase7ProofPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
    if (arg?.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (outputPath !== undefined) {
      throw new Error("Only one output path is supported");
    }
    outputPath = arg;
  }
  return { outputPath, phase7ProofPath };
}
