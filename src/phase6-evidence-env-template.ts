import { pathToFileURL } from "node:url";

import { writeCliTextOutput } from "./cliOutput.js";
import { createPhase6EvidenceAssemblyEnvTemplate } from "./phase6EvidenceAssemblyEnv.js";

export const PHASE6_EVIDENCE_ENV_TEMPLATE_USAGE =
  "Usage: corepack pnpm phase6:evidence:env-template [evidence-directory] [phase6-evidence.env]";

export interface Phase6EvidenceEnvTemplateCliArgs {
  directory?: string;
  outputPath?: string;
  help: boolean;
}

if (isMainModule()) {
  main();
}

function main(): void {
  const { directory, outputPath, help } = parseArgs();

  if (help) {
    console.log(PHASE6_EVIDENCE_ENV_TEMPLATE_USAGE);
    process.exit(0);
  }

  writeCliTextOutput({
    text: createPhase6EvidenceAssemblyEnvTemplate({ directory }),
    outputPath,
  });
}

export function parsePhase6EvidenceEnvTemplateCliArgs(
  args: readonly string[],
): Phase6EvidenceEnvTemplateCliArgs {
  const help = args.includes("--help") || args.includes("-h");
  const unknownOptions = args.filter(
    (arg) => arg.startsWith("-") && arg !== "--help" && arg !== "-h",
  );
  if (unknownOptions.length > 0) {
    throw new Error(
      `${PHASE6_EVIDENCE_ENV_TEMPLATE_USAGE}\nUnknown option: ${unknownOptions[0]}`,
    );
  }

  const positionalArgs = args.filter((arg) => arg !== "--help" && arg !== "-h");
  if (positionalArgs.length > 2) {
    throw new Error(PHASE6_EVIDENCE_ENV_TEMPLATE_USAGE);
  }

  return {
    ...(help || positionalArgs[0] === undefined
      ? {}
      : { directory: positionalArgs[0] }),
    ...(help || positionalArgs[1] === undefined
      ? {}
      : { outputPath: positionalArgs[1] }),
    help,
  };
}

function parseArgs(): Phase6EvidenceEnvTemplateCliArgs {
  try {
    return parsePhase6EvidenceEnvTemplateCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function isMainModule(): boolean {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(process.argv[1]).href
  );
}
