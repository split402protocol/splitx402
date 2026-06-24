#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { createSampleProtocolArtifacts } from "./sample.js";
import {
  verifyReferralClaim,
  verifySplit402Attribution,
  verifySplit402Offer,
  verifySplit402Receipt
} from "./verification.js";

interface CliOptions {
  file?: string;
  merchantPublicKey?: string;
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);

  if (command === "create-fixtures") {
    console.log(JSON.stringify(createSampleProtocolArtifacts(), null, 2));
    return 0;
  }

  if (command === "verify-claim") {
    const result = verifyReferralClaim(readJson(required(options.file, "--file")));
    return printResult(result);
  }

  if (command === "verify-offer") {
    const result = verifySplit402Offer(
      readJson(required(options.file, "--file")),
      required(options.merchantPublicKey, "--merchant-public-key")
    );
    return printResult(result);
  }

  if (command === "verify-attribution") {
    const result = verifySplit402Attribution(
      readJson(required(options.file, "--file")),
      required(options.merchantPublicKey, "--merchant-public-key")
    );
    return printResult(result);
  }

  if (command === "verify-receipt") {
    const result = verifySplit402Receipt(
      readJson(required(options.file, "--file")),
      required(options.merchantPublicKey, "--merchant-public-key")
    );
    return printResult(result);
  }

  printUsage();
  return 1;
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--file" && next !== undefined) {
      options.file = next;
      index += 1;
    } else if (arg === "--merchant-public-key" && next !== undefined) {
      options.merchantPublicKey = next;
      index += 1;
    } else {
      throw new Error(`unknown or incomplete option: ${arg ?? ""}`);
    }
  }

  return options;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function required(value: string | undefined, label: string): string {
  if (value === undefined || value === "") {
    throw new Error(`${label} is required`);
  }
  return value;
}

function printResult(result: { ok: boolean; errors: string[] }): number {
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 2;
}

function printUsage(): void {
  console.error(`Usage:
  split402-protocol create-fixtures
  split402-protocol verify-claim --file claim.json
  split402-protocol verify-offer --file offer.json --merchant-public-key <base58>
  split402-protocol verify-attribution --file attribution.json --merchant-public-key <base58>
  split402-protocol verify-receipt --file receipt.json --merchant-public-key <base58>`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

