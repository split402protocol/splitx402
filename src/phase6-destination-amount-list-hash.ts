import { readFileSync } from "node:fs";

import { writeCliTextOutput } from "./cliOutput.js";
import { hashPhase6DestinationAmountList } from "./phase6DestinationAmountListHash.js";

try {
  const cli = parseArgs(process.argv.slice(2));
  const plan = JSON.parse(stripUtf8Bom(readFileSync(cli.planPath, "utf8")));
  const hash = hashPhase6DestinationAmountList(plan);
  writeCliTextOutput({
    text: `${cli.env ? "SPLIT402_SIGNER_POLICY_EXPECTED_DESTINATION_AMOUNT_LIST_HASH=" : ""}${hash}\n`,
    outputPath: cli.outputPath,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    [
      "Usage: corepack pnpm phase6:destination-amount-list:hash <plan.json> [output.txt]",
      "Options:",
      "  --env  Output SPLIT402_SIGNER_POLICY_EXPECTED_DESTINATION_AMOUNT_LIST_HASH=<hash>",
    ].join("\n"),
  );
  process.exitCode = 1;
}

function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseArgs(argv: string[]): {
  planPath: string;
  outputPath?: string;
  env: boolean;
} {
  let env = false;
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg === "--env") {
      env = true;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positional.push(arg);
  }

  const [planPath, outputPath, extra] = positional;
  if (planPath === undefined) {
    throw new Error("plan.json is required");
  }
  if (extra !== undefined) {
    throw new Error("Only one output path is supported");
  }
  return { planPath, outputPath, env };
}
