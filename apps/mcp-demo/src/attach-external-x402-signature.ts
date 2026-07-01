#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Split402OfferV1Schema,
  Split402ReceiptV1Schema,
  verifySplit402Offer,
  verifySplit402Receipt,
  type Split402OfferV1,
  type Split402ReceiptV1
} from "@split402/protocol";

export type ExternalX402SignatureArtifactKind = "offer" | "receipt";

export interface AttachExternalX402SignatureInput {
  kind: ExternalX402SignatureArtifactKind;
  unsignedArtifact: unknown;
  signature: string;
  merchantPublicKey?: string;
}

export interface AttachExternalX402SignatureResult {
  ok: boolean;
  errors: string[];
  kind: ExternalX402SignatureArtifactKind;
  artifact?: Split402OfferV1 | Split402ReceiptV1;
  signatureVerified?: boolean;
}

interface AttachExternalX402SignatureCliInput {
  kind?: string;
  unsignedFile?: string;
  signature?: string;
  merchantPublicKey?: string;
  outputFile?: string;
}

export function attachExternalX402Signature(
  input: AttachExternalX402SignatureInput
): AttachExternalX402SignatureResult {
  const errors: string[] = [];
  if (!isRecord(input.unsignedArtifact)) {
    return {
      ok: false,
      errors: ["unsignedArtifact must be an object"],
      kind: input.kind
    };
  }
  if ("signature" in input.unsignedArtifact) {
    errors.push("unsignedArtifact must not include signature");
  }
  const artifactWithSignature = {
    ...input.unsignedArtifact,
    signature: input.signature
  };
  const parsed =
    input.kind === "offer"
      ? Split402OfferV1Schema.safeParse(artifactWithSignature)
      : Split402ReceiptV1Schema.safeParse(artifactWithSignature);
  if (!parsed.success) {
    errors.push(
      ...parsed.error.issues.map(
        (issue) => `artifact.${issue.path.join(".") || "root"}: ${issue.message}`
      )
    );
    return {
      ok: false,
      errors,
      kind: input.kind
    };
  }
  const artifact = parsed.data;
  let signatureVerified: boolean | undefined;
  if (input.merchantPublicKey !== undefined) {
    const verification =
      input.kind === "offer"
        ? verifySplit402Offer(artifact as Split402OfferV1, input.merchantPublicKey)
        : verifySplit402Receipt(
            artifact as Split402ReceiptV1,
            input.merchantPublicKey
          );
    signatureVerified = verification.ok;
    errors.push(...verification.errors);
  }
  return {
    ok: errors.length === 0,
    errors,
    kind: input.kind,
    artifact,
    ...(signatureVerified === undefined ? {} : { signatureVerified })
  };
}

export function parseAttachExternalX402SignatureArgs(
  argv: readonly string[]
): AttachExternalX402SignatureCliInput | { help: true } {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const input: AttachExternalX402SignatureCliInput = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = readFollowingArg(argv, index, arg);
    if (arg === "--kind") {
      input.kind = value;
    } else if (arg === "--unsigned-file") {
      input.unsignedFile = value;
    } else if (arg === "--signature") {
      input.signature = value;
    } else if (arg === "--merchant-public-key") {
      input.merchantPublicKey = value;
    } else if (arg === "--output-file") {
      input.outputFile = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
    index += 1;
  }
  return input;
}

export async function runAttachExternalX402SignatureCli(
  argv: readonly string[]
): Promise<number> {
  const parsed = parseAttachExternalX402SignatureArgs(argv);
  if ("help" in parsed) {
    console.log(ATTACH_EXTERNAL_X402_SIGNATURE_USAGE);
    return 0;
  }
  const result = attachExternalX402Signature({
    kind: readKind(required(parsed.kind, "--kind")),
    unsignedArtifact: readJson(required(parsed.unsignedFile, "--unsigned-file")),
    signature: required(parsed.signature, "--signature"),
    ...(parsed.merchantPublicKey === undefined
      ? {}
      : { merchantPublicKey: parsed.merchantPublicKey })
  });
  if (parsed.outputFile !== undefined && result.artifact !== undefined) {
    writeJsonOutput(parsed.outputFile, result.artifact);
  }
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 2;
}

export const ATTACH_EXTERNAL_X402_SIGNATURE_USAGE = `Usage:
  corepack pnpm demo:attach-external-x402-signature -- \\
    --kind offer|receipt \\
    --unsigned-file offer-to-sign.json \\
    --signature <base64url-signature> \\
    [--merchant-public-key <merchant-offer-receipt-public-key>] \\
    [--output-file offer.json]

This no-secret helper attaches an externally produced base64url signature to an
unsigned Split402 offer or receipt. When a merchant public key is supplied, it
also verifies the signed artifact. It never needs merchant private keys, bearer
tokens, raw payment payloads, or facilitator secrets.`;

function readKind(value: string): ExternalX402SignatureArtifactKind {
  if (value === "offer" || value === "receipt") {
    return value;
  }
  throw new Error("--kind must be offer or receipt");
}

function writeJsonOutput(path: string, value: unknown): void {
  const resolvedPath = resolveOutputPath(path);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFollowingArg(
  argv: readonly string[],
  index: number,
  flag: string
): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${flag} is required`);
  }
  return value;
}

function resolveOutputPath(outputPath: string): string {
  return isAbsolute(outputPath)
    ? outputPath
    : resolve(process.env.INIT_CWD ?? process.cwd(), outputPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runAttachExternalX402SignatureCli(
      process.argv.slice(2)
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
