import { createPhase6EvidenceAssemblyEnvTemplate } from "./phase6EvidenceAssemblyEnv.js";

const directory = parseDirectoryArg(process.argv.slice(2));

console.log(createPhase6EvidenceAssemblyEnvTemplate({ directory }));

function parseDirectoryArg(args: readonly string[]): string | undefined {
  if (args.length > 1) {
    throw new Error(
      "Usage: corepack pnpm phase6:evidence:env-template [evidence-directory]",
    );
  }

  return args[0];
}
