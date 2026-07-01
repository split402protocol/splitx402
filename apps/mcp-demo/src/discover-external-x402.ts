import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Split402ExternalX402DiscoveryClient,
  type Split402ExternalX402DiscoveryFetch,
  type Split402ExternalX402ProviderCandidate
} from "@split402/router";

export interface ExternalX402OnboardingReport {
  schema: "split402.external_x402_onboarding.v1";
  generatedAt: string;
  merchantOrigin: string;
  candidateCount: number;
  routerReadyCount: number;
  candidates: ExternalX402OnboardingCandidateView[];
}

export interface ExternalX402OnboardingCandidateView {
  providerId: string;
  capability: string;
  merchantOrigin: string;
  path: string;
  method: string;
  operationId: string;
  description?: string;
  price?: string;
  network?: string;
  asset?: string;
  payToWallet?: string;
  amountAtomic?: string;
  readiness: string;
  blockers: string[];
  source: {
    manifest: boolean;
    openapi: boolean;
    paymentRequiredHeader: boolean;
  };
  routerReady: boolean;
}

export interface DiscoverExternalX402Input {
  merchantOrigin: string;
  capability?: string;
  matchPath?: string;
  providerIdPrefix?: string;
  includeFreeRoutes?: boolean;
  fetch?: Split402ExternalX402DiscoveryFetch;
  generatedAt?: string;
}

export async function discoverExternalX402Onboarding(
  input: DiscoverExternalX402Input
): Promise<ExternalX402OnboardingReport> {
  const capability = normalizeOptionalString(input.capability);
  const discovery = new Split402ExternalX402DiscoveryClient({
    merchantOrigin: input.merchantOrigin,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    ...(input.providerIdPrefix === undefined
      ? {}
      : { providerIdPrefix: input.providerIdPrefix }),
    ...(capability === undefined
      ? {}
      : { capabilityMapper: () => capability })
  });
  const matchPath = normalizeOptionalString(input.matchPath);
  const discoveredCandidates = await discovery.discoverCandidates({
    ...(capability === undefined ? {} : { capability }),
    includeFreeRoutes: input.includeFreeRoutes === true
  });
  const candidates =
    matchPath === undefined
      ? discoveredCandidates
      : discoveredCandidates.filter((candidate) =>
          candidate.path.includes(matchPath)
        );
  return {
    schema: "split402.external_x402_onboarding.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    merchantOrigin: input.merchantOrigin,
    candidateCount: candidates.length,
    routerReadyCount: candidates.filter(
      (candidate) => candidate.readiness === "router_ready"
    ).length,
    candidates: candidates.map(publicCandidateView)
  };
}

export function renderExternalX402OnboardingReportJson(
  report: ExternalX402OnboardingReport
): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export async function writeExternalX402OnboardingOutput(
  input: DiscoverExternalX402Input & { outputPath?: string }
): Promise<void> {
  const json = renderExternalX402OnboardingReportJson(
    await discoverExternalX402Onboarding(input)
  );
  if (input.outputPath === undefined || input.outputPath.trim().length === 0) {
    process.stdout.write(json);
    return;
  }

  const resolvedOutputPath = resolveOutputPath(input.outputPath);
  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, json, "utf8");
}

export function parseDiscoverExternalX402Args(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
):
  | (DiscoverExternalX402Input & { outputPath?: string })
  | { help: true }
  | { error: string } {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  let merchantOrigin = normalizeOptionalString(env.SPLIT402_EXTERNAL_X402_ORIGIN);
  let capability = normalizeOptionalString(env.SPLIT402_EXTERNAL_X402_CAPABILITY);
  let matchPath = normalizeOptionalString(env.SPLIT402_EXTERNAL_X402_MATCH_PATH);
  let providerIdPrefix = normalizeOptionalString(
    env.SPLIT402_EXTERNAL_X402_PROVIDER_ID_PREFIX
  );
  let outputPath = normalizeOptionalString(env.SPLIT402_EXTERNAL_X402_OUTPUT);
  let includeFreeRoutes = env.SPLIT402_EXTERNAL_X402_INCLUDE_FREE === "1";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("--") && merchantOrigin === undefined) {
      merchantOrigin = arg;
      continue;
    }
    if (arg === "--capability") {
      capability = readFollowingArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--provider-id-prefix") {
      providerIdPrefix = readFollowingArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--match-path") {
      matchPath = readFollowingArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      outputPath = readFollowingArg(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--include-free") {
      includeFreeRoutes = true;
      continue;
    }
    return { error: `unknown argument: ${arg}` };
  }

  if (merchantOrigin === undefined) {
    return { error: "merchant origin is required" };
  }
  return {
    merchantOrigin,
    ...(capability === undefined ? {} : { capability }),
    ...(matchPath === undefined ? {} : { matchPath }),
    ...(providerIdPrefix === undefined ? {} : { providerIdPrefix }),
    ...(outputPath === undefined ? {} : { outputPath }),
    includeFreeRoutes
  };
}

export const DISCOVER_EXTERNAL_X402_USAGE = `Usage:
  corepack pnpm demo:discover-external-x402 <merchant-origin> [options]

Options:
  --capability <name>             Label discovered candidates with a capability.
  --match-path <substring>        Keep only candidates whose path contains it.
  --provider-id-prefix <prefix>   Prefix generated provider ids.
  --include-free                  Include free routes from the external manifest.
  --output <path>                 Write JSON report to a file.

Environment:
  SPLIT402_EXTERNAL_X402_ORIGIN
  SPLIT402_EXTERNAL_X402_CAPABILITY
  SPLIT402_EXTERNAL_X402_MATCH_PATH
  SPLIT402_EXTERNAL_X402_PROVIDER_ID_PREFIX
  SPLIT402_EXTERNAL_X402_INCLUDE_FREE=1
  SPLIT402_EXTERNAL_X402_OUTPUT
`;

function publicCandidateView(
  candidate: Split402ExternalX402ProviderCandidate
): ExternalX402OnboardingCandidateView {
  return {
    providerId: candidate.providerId,
    capability: candidate.capability,
    merchantOrigin: candidate.merchantOrigin,
    path: candidate.path,
    method: candidate.method,
    operationId: candidate.operationId,
    ...(candidate.description === undefined
      ? {}
      : { description: candidate.description }),
    ...(candidate.price === undefined ? {} : { price: candidate.price }),
    ...(candidate.network === undefined ? {} : { network: candidate.network }),
    ...(candidate.asset === undefined ? {} : { asset: candidate.asset }),
    ...(candidate.payToWallet === undefined
      ? {}
      : { payToWallet: candidate.payToWallet }),
    ...(candidate.amountAtomic === undefined
      ? {}
      : { amountAtomic: candidate.amountAtomic }),
    readiness: candidate.readiness,
    blockers: candidate.blockers,
    source: candidate.source,
    routerReady: candidate.provider !== undefined
  };
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

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function resolveOutputPath(outputPath: string): string {
  return isAbsolute(outputPath)
    ? outputPath
    : resolve(process.env.INIT_CWD ?? process.cwd(), outputPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const parsed = parseDiscoverExternalX402Args(process.argv.slice(2));
    if ("help" in parsed) {
      console.log(DISCOVER_EXTERNAL_X402_USAGE);
    } else if ("error" in parsed) {
      console.error(`${parsed.error}\n\n${DISCOVER_EXTERNAL_X402_USAGE}`);
      process.exitCode = 1;
    } else {
      await writeExternalX402OnboardingOutput(parsed);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
