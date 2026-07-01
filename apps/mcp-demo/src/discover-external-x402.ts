import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { calculateCommission } from "@split402/protocol";
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
  split402OfferErrors?: string[];
  requiredSplit402Fields: string[];
  split402OfferTemplate?: ExternalX402OfferTemplateView;
  split402ReceiptTemplate?: ExternalX402ReceiptTemplateView;
  nextActions: string[];
  source: {
    manifest: boolean;
    openapi: boolean;
    paymentRequiredHeader: boolean;
  };
  routerReady: boolean;
}

export interface ExternalX402OfferTemplateView {
  extensionPath: "extensions.split402.info";
  note: string;
  campaignTermsTemplate: {
    protocolVersion: "0.1";
    campaignId: string;
    campaignVersion: number;
    merchantId: string;
    resourceOrigin: string;
    operationIds: string[];
    network: string;
    asset: string;
    requiredAmountAtomic: string;
    payToWallet: string;
    commissionBps: number;
    protocolFeeBpsOfCommission: number;
    commissionBase: "required_amount";
    settlementMode: "accrual";
    attributionRequired: boolean;
    allowSelfReferral: boolean;
  };
  unsignedOfferTemplate: {
    protocolVersion: "0.1";
    campaignId: string;
    campaignVersion: number;
    campaignTermsHash: string;
    merchantId: string;
    resourceOrigin: string;
    operationId: string;
    network: string;
    asset: string;
    requiredAmountAtomic: string;
    payToWallet: string;
    commissionBps: number;
    protocolFeeBpsOfCommission: number;
    commissionBase: "required_amount";
    settlementMode: "accrual";
    attributionRequired: boolean;
    allowSelfReferral: boolean;
    offerNonce: string;
    issuedAt: string;
    validUntil: string;
    kid: string;
  };
  signatureInstructions: string[];
}

export interface ExternalX402ReceiptTemplateView {
  responseRequirement: string;
  note: string;
  commissionBearingReceiptTemplate: {
    protocolVersion: "0.1";
    receiptId: string;
    merchantId: string;
    merchantOrigin: string;
    operationId: string;
    requestDigest: string;
    campaignId: string;
    campaignVersion: number;
    campaignTermsHash: string;
    routeId: string;
    referralClaimHash: string;
    referrerWallet: string;
    payoutWallet: string;
    paymentId: string;
    network: string;
    asset: string;
    payerWallet: string;
    payToWallet: string;
    requiredAmountAtomic: string;
    settledAmountAtomic: string;
    settlementTxSignature: string;
    commissionBps: number;
    protocolFeeBpsOfCommission: number;
    commissionBaseAtomic: string;
    commissionAmountAtomic: string;
    protocolFeeAtomic: string;
    referrerCreditAtomic: string;
    settlementMode: "accrual";
    offerNonce: string;
    settledAt: string;
    issuedAt: string;
    recordingStatus: "accepted";
    eventId: string;
    kid: string;
  };
  noReferralReceiptRule: string;
  signatureInstructions: string[];
}

export interface ExternalX402RouteMetadataView {
  schema: "split402.external_x402_route_metadata.v1";
  providerId: string;
  capability: string;
  merchantOrigin: string;
  path: string;
  method: string;
  operationId: string;
  network: string;
  asset: string;
  payToWallet: string;
  requiredAmountAtomic: string;
}

export interface DiscoverExternalX402Input {
  merchantOrigin: string;
  capability?: string;
  matchPath?: string;
  providerIdPrefix?: string;
  merchantPublicKey?: string;
  includeFreeRoutes?: boolean;
  fetch?: Split402ExternalX402DiscoveryFetch;
  generatedAt?: string;
}

export interface ExternalX402ProviderArtifactManifest {
  schema: "split402.external_x402_provider_artifacts.v1";
  generatedAt: string;
  merchantOrigin: string;
  candidates: Array<{
    providerId: string;
    artifactDirectory: string;
    readiness: string;
    files: string[];
  }>;
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
    ...(input.merchantPublicKey === undefined
      ? {}
      : { merchantPublicKey: input.merchantPublicKey }),
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
  input: DiscoverExternalX402Input & {
    outputPath?: string;
    artifactsDir?: string;
  }
): Promise<void> {
  const report = await discoverExternalX402Onboarding(input);
  const json = renderExternalX402OnboardingReportJson(report);
  if (input.outputPath === undefined || input.outputPath.trim().length === 0) {
    process.stdout.write(json);
  } else {
    const resolvedOutputPath = resolveOutputPath(input.outputPath);
    mkdirSync(dirname(resolvedOutputPath), { recursive: true });
    writeFileSync(resolvedOutputPath, json, "utf8");
  }

  if (input.artifactsDir !== undefined && input.artifactsDir.trim().length > 0) {
    writeExternalX402ProviderArtifacts(report, input.artifactsDir);
  }
}

export function writeExternalX402ProviderArtifacts(
  report: ExternalX402OnboardingReport,
  artifactsDir: string
): ExternalX402ProviderArtifactManifest {
  const resolvedArtifactsDir = resolveOutputPath(artifactsDir);
  const manifest: ExternalX402ProviderArtifactManifest = {
    schema: "split402.external_x402_provider_artifacts.v1",
    generatedAt: report.generatedAt,
    merchantOrigin: report.merchantOrigin,
    candidates: []
  };
  mkdirSync(resolvedArtifactsDir, { recursive: true });
  for (const candidate of report.candidates) {
    const candidateDirectoryName = sanitizePathSegment(candidate.providerId);
    const candidateDirectory = join(resolvedArtifactsDir, candidateDirectoryName);
    mkdirSync(candidateDirectory, { recursive: true });
    const files: string[] = [];
    const routeMetadata = createExternalX402RouteMetadataView(candidate);
    if (routeMetadata !== undefined) {
      files.push(
        writeJsonArtifact(candidateDirectory, "route-metadata.json", routeMetadata)
      );
    }
    if (candidate.split402OfferTemplate !== undefined) {
      files.push(
        writeJsonArtifact(
          candidateDirectory,
          "campaign-terms.template.json",
          candidate.split402OfferTemplate.campaignTermsTemplate
        )
      );
      files.push(
        writeJsonArtifact(
          candidateDirectory,
          "unsigned-offer.template.json",
          candidate.split402OfferTemplate.unsignedOfferTemplate
        )
      );
    }
    if (candidate.split402ReceiptTemplate !== undefined) {
      files.push(
        writeJsonArtifact(
          candidateDirectory,
          "receipt.template.json",
          candidate.split402ReceiptTemplate.commissionBearingReceiptTemplate
        )
      );
    }
    files.push(writeProviderReadme(candidateDirectory, candidate));
    manifest.candidates.push({
      providerId: candidate.providerId,
      artifactDirectory: candidateDirectoryName,
      readiness: candidate.readiness,
      files
    });
  }
  writeProviderArtifactsReadme(resolvedArtifactsDir, report, manifest);
  writeJsonArtifact(resolvedArtifactsDir, "manifest.json", manifest);
  return manifest;
}

export function parseDiscoverExternalX402Args(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
):
  | (DiscoverExternalX402Input & { outputPath?: string; artifactsDir?: string })
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
  let merchantPublicKey = normalizeOptionalString(
    env.SPLIT402_EXTERNAL_X402_MERCHANT_PUBLIC_KEY
  );
  let outputPath = normalizeOptionalString(env.SPLIT402_EXTERNAL_X402_OUTPUT);
  let artifactsDir = normalizeOptionalString(
    env.SPLIT402_EXTERNAL_X402_ARTIFACTS_DIR
  );
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
    if (arg === "--merchant-public-key") {
      merchantPublicKey = readFollowingArg(argv, index, arg);
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
    if (arg === "--artifacts-dir") {
      artifactsDir = readFollowingArg(argv, index, arg);
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
    ...(merchantPublicKey === undefined ? {} : { merchantPublicKey }),
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(artifactsDir === undefined ? {} : { artifactsDir }),
    includeFreeRoutes
  };
}

export const DISCOVER_EXTERNAL_X402_USAGE = `Usage:
  corepack pnpm demo:discover-external-x402 <merchant-origin> [options]

Options:
  --capability <name>             Label discovered candidates with a capability.
  --match-path <substring>        Keep only candidates whose path contains it.
  --provider-id-prefix <prefix>   Prefix generated provider ids.
  --merchant-public-key <key>     Verify signed Split402 offers with this merchant key.
  --include-free                  Include free routes from the external manifest.
  --output <path>                 Write JSON report to a file.
  --artifacts-dir <dir>           Export per-candidate provider template files.

Environment:
  SPLIT402_EXTERNAL_X402_ORIGIN
  SPLIT402_EXTERNAL_X402_CAPABILITY
  SPLIT402_EXTERNAL_X402_MATCH_PATH
  SPLIT402_EXTERNAL_X402_PROVIDER_ID_PREFIX
  SPLIT402_EXTERNAL_X402_MERCHANT_PUBLIC_KEY
  SPLIT402_EXTERNAL_X402_INCLUDE_FREE=1
  SPLIT402_EXTERNAL_X402_OUTPUT
  SPLIT402_EXTERNAL_X402_ARTIFACTS_DIR
`;

export const SPLIT402_OFFER_EXTENSION_REQUIRED_FIELDS = [
  "protocolVersion",
  "campaignId",
  "campaignVersion",
  "campaignTermsHash",
  "merchantId",
  "resourceOrigin",
  "operationId",
  "network",
  "asset",
  "payToWallet",
  "requiredAmountAtomic",
  "commissionBps",
  "protocolFeeBpsOfCommission",
  "commissionBase",
  "settlementMode",
  "attributionRequired",
  "allowSelfReferral",
  "offerNonce",
  "issuedAt",
  "validUntil",
  "kid",
  "signature"
] as const;

export function createExternalX402CandidateNextActions(
  candidate: Split402ExternalX402ProviderCandidate
): string[] {
  const actions =
    candidate.readiness === "router_ready"
      ? [
          "Register or refresh a staging Split402 route for this provider candidate.",
          "Run one low-value paid request and verify the returned merchant-signed Split402 receipt.",
          "Keep the provider public-alpha until hosted Phase 7 evidence passes from the same source commit."
        ]
      : candidate.readiness === "incomplete_payment_metadata"
        ? [
            "Expose complete x402 exact payment metadata for this route: network, asset, amount, and payTo.",
            "Ensure the unpaid route returns a parseable 402 Payment Required response.",
            "Rerun demo:discover-external-x402 before attempting a paid request."
          ]
        : candidate.blockers.includes("invalid Split402 offer extension")
          ? [
              "Fix extensions.split402.info so it parses as a Split402OfferV1.",
              "Use split402OfferErrors to correct missing or malformed offer fields.",
              "Ensure the signed offer binds the campaign, operation, amount, commission, protocol fee, and merchant signing key.",
              "Rerun demo:discover-external-x402; only router_ready candidates should enter paid staging tests."
            ]
          : candidate.blockers.includes(
                "Split402 offer does not match x402 payment metadata"
              )
            ? [
                "Fix extensions.split402.info so signed offer fields match the x402 exact payment metadata.",
                "Use split402OfferErrors to align network, asset, payToWallet, requiredAmountAtomic, and resourceOrigin.",
                "Rerun demo:discover-external-x402; only router_ready candidates should enter paid staging tests."
              ]
            : candidate.blockers.includes(
                  "missing merchant public key for Split402 offer verification"
                )
              ? [
                  "Configure the merchant public key used to verify Split402 offer and receipt signatures.",
                  "Publish or share the active offer_receipt key id and public key through the Split402 onboarding channel.",
                  "Rerun demo:discover-external-x402 after the verifier has the merchant public key."
                ]
              : candidate.blockers.includes("invalid Split402 offer signature")
                ? [
                    "Re-sign extensions.split402.info with the active merchant offer_receipt key.",
                    "Confirm the configured merchant public key matches the offer kid and signing key.",
                    "Rerun demo:discover-external-x402; only signature-verified candidates should enter paid staging tests."
                  ]
        : [
            "Add extensions.split402.info to the unpaid 402 Payment Required response.",
            "Bind the Split402 offer to the campaign, operation, amount, commission, protocol fee, and merchant signing key.",
            "Return a merchant-signed Split402 receipt after successful x402 settlement.",
            "Rerun demo:discover-external-x402; only router_ready candidates should enter paid staging tests."
          ];

  if (candidate.network?.startsWith("eip155:") === true) {
    return [
      ...actions,
      "For Base/EVM x402 routes, run a low-value hosted staging proof before any production or mainnet claim."
    ];
  }
  return actions;
}

export function publicCandidateView(
  candidate: Split402ExternalX402ProviderCandidate
): ExternalX402OnboardingCandidateView {
  const split402OfferTemplate =
    candidate.readiness === "router_ready"
      ? undefined
      : createSplit402OfferTemplateView(candidate);
  const split402ReceiptTemplate = createSplit402ReceiptTemplateView(candidate);
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
    ...(candidate.split402OfferErrors === undefined
      ? {}
      : { split402OfferErrors: candidate.split402OfferErrors }),
    requiredSplit402Fields:
      candidate.readiness === "requires_split402_campaign"
        ? [...SPLIT402_OFFER_EXTENSION_REQUIRED_FIELDS]
        : [],
    ...(split402OfferTemplate === undefined
      ? {}
      : { split402OfferTemplate }),
    ...(split402ReceiptTemplate === undefined
      ? {}
      : { split402ReceiptTemplate }),
    nextActions: createExternalX402CandidateNextActions(candidate),
    source: candidate.source,
    routerReady: candidate.provider !== undefined
  };
}

function createSplit402ReceiptTemplateView(
  candidate: Split402ExternalX402ProviderCandidate
): ExternalX402ReceiptTemplateView | undefined {
  if (
    candidate.network === undefined ||
    candidate.asset === undefined ||
    candidate.payToWallet === undefined ||
    candidate.amountAtomic === undefined
  ) {
    return undefined;
  }
  const commissionBps = 2000;
  const protocolFeeBpsOfCommission = 1000;
  const economics = calculateCommission(
    BigInt(candidate.amountAtomic),
    BigInt(commissionBps),
    BigInt(protocolFeeBpsOfCommission)
  );
  return {
    responseRequirement:
      "Return this merchant-signed Split402 receipt, or an equivalent field documented by the provider, after successful x402 settlement.",
    note:
      "Fill placeholders from the settled x402 payment, the accepted Split402 attribution route, and the finalized signed offer. Route fields must appear together for a commission-bearing receipt.",
    commissionBearingReceiptTemplate: {
      protocolVersion: "0.1",
      receiptId: "<rcp_...>",
      merchantId: "<mrc_...>",
      merchantOrigin: candidate.merchantOrigin,
      operationId: candidate.operationId,
      requestDigest: "sha256:<canonical paid request digest>",
      campaignId: "<cmp_...>",
      campaignVersion: 1,
      campaignTermsHash:
        "sha256:<hash of finalized campaignTermsTemplate canonical JSON>",
      routeId: "<rte_...>",
      referralClaimHash: "sha256:<hash of accepted referral claim>",
      referrerWallet: "<referrer identity wallet>",
      payoutWallet: "<referrer payout wallet>",
      paymentId: "<pay_...>",
      network: candidate.network,
      asset: candidate.asset,
      payerWallet: "<settled payer wallet>",
      payToWallet: candidate.payToWallet,
      requiredAmountAtomic: candidate.amountAtomic,
      settledAmountAtomic: candidate.amountAtomic,
      settlementTxSignature: "<x402 settlement transaction signature/hash>",
      commissionBps,
      protocolFeeBpsOfCommission,
      commissionBaseAtomic: candidate.amountAtomic,
      commissionAmountAtomic: economics.commission.toString(),
      protocolFeeAtomic: economics.protocolFee.toString(),
      referrerCreditAtomic: economics.referrerCredit.toString(),
      settlementMode: "accrual",
      offerNonce: "<offer nonce from signed offer>",
      settledAt: "<settlement RFC3339 UTC>",
      issuedAt: "<receipt issued RFC3339 UTC>",
      recordingStatus: "accepted",
      eventId: "<evt_...>",
      kid: "<merchant-offer-receipt-kid>"
    },
    noReferralReceiptRule:
      "If there is no accepted referral route, omit routeId/referralClaimHash/referrerWallet/payoutWallet together and set commissionAmountAtomic, protocolFeeAtomic, and referrerCreditAtomic to 0.",
    signatureInstructions: [
      "Verify the settled x402 payment before issuing the receipt.",
      "Sign the receipt with Split402 receipt signing bytes and the same merchant offer_receipt key family used for offers.",
      "Return the receipt with signature; the router/control plane must verify the signature, payment identifiers, route attribution, and commission arithmetic before accrual."
    ]
  };
}

function createExternalX402RouteMetadataView(
  candidate: ExternalX402OnboardingCandidateView
): ExternalX402RouteMetadataView | undefined {
  if (
    candidate.network === undefined ||
    candidate.asset === undefined ||
    candidate.payToWallet === undefined ||
    candidate.amountAtomic === undefined
  ) {
    return undefined;
  }
  return {
    schema: "split402.external_x402_route_metadata.v1",
    providerId: candidate.providerId,
    capability: candidate.capability,
    merchantOrigin: candidate.merchantOrigin,
    path: candidate.path,
    method: candidate.method,
    operationId: candidate.operationId,
    network: candidate.network,
    asset: candidate.asset,
    payToWallet: candidate.payToWallet,
    requiredAmountAtomic: candidate.amountAtomic
  };
}

function createSplit402OfferTemplateView(
  candidate: Split402ExternalX402ProviderCandidate
): ExternalX402OfferTemplateView | undefined {
  if (
    candidate.network === undefined ||
    candidate.asset === undefined ||
    candidate.payToWallet === undefined ||
    candidate.amountAtomic === undefined
  ) {
    return undefined;
  }
  const campaignId = "<cmp_...>";
  const campaignVersion = 1;
  const merchantId = "<mrc_...>";
  const commissionBps = 2000;
  const protocolFeeBpsOfCommission = 1000;
  const campaignTermsTemplate = {
    protocolVersion: "0.1",
    campaignId,
    campaignVersion,
    merchantId,
    resourceOrigin: candidate.merchantOrigin,
    operationIds: [candidate.operationId],
    network: candidate.network,
    asset: candidate.asset,
    requiredAmountAtomic: candidate.amountAtomic,
    payToWallet: candidate.payToWallet,
    commissionBps,
    protocolFeeBpsOfCommission,
    commissionBase: "required_amount",
    settlementMode: "accrual",
    attributionRequired: true,
    allowSelfReferral: false
  } satisfies ExternalX402OfferTemplateView["campaignTermsTemplate"];
  return {
    extensionPath: "extensions.split402.info",
    note:
      "Fill campaign/merchant ids, economics, timestamps, nonce, kid, and campaignTermsHash from your finalized campaign terms, then sign the unsigned offer with the merchant offer_receipt key.",
    campaignTermsTemplate,
    unsignedOfferTemplate: {
      protocolVersion: "0.1",
      campaignId,
      campaignVersion,
      campaignTermsHash:
        "sha256:<hash of finalized campaignTermsTemplate canonical JSON>",
      merchantId,
      resourceOrigin: candidate.merchantOrigin,
      operationId: candidate.operationId,
      network: candidate.network,
      asset: candidate.asset,
      requiredAmountAtomic: candidate.amountAtomic,
      payToWallet: candidate.payToWallet,
      commissionBps,
      protocolFeeBpsOfCommission,
      commissionBase: "required_amount",
      settlementMode: "accrual",
      attributionRequired: true,
      allowSelfReferral: false,
      offerNonce: "<ofn_...>",
      issuedAt: "<RFC3339 UTC>",
      validUntil: "<RFC3339 UTC>",
      kid: "<merchant-offer-receipt-kid>"
    },
    signatureInstructions: [
      "Compute campaignTermsHash from the finalized campaign terms object using Split402 canonical hashing.",
      "Sign the unsigned offer with Split402 offer signing bytes and the merchant offer_receipt private key.",
      "Set signature on extensions.split402.info and publish only the public verification key for the kid."
    ]
  };
}

function writeJsonArtifact(
  directory: string,
  filename: string,
  value: unknown
): string {
  writeFileSync(join(directory, filename), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filename;
}

function writeProviderReadme(
  directory: string,
  candidate: ExternalX402OnboardingCandidateView
): string {
  const filename = "README.md";
  const hasOfferTemplate = candidate.split402OfferTemplate !== undefined;
  const hasRouteMetadata =
    candidate.network !== undefined &&
    candidate.asset !== undefined &&
    candidate.payToWallet !== undefined &&
    candidate.amountAtomic !== undefined;
  const lines = [
    `# Split402 Provider Artifact Templates`,
    "",
    `Provider: \`${candidate.providerId}\``,
    "",
    `Route: \`${candidate.method} ${candidate.path}\``,
    "",
    `Readiness: \`${candidate.readiness}\``,
    "",
    "## Files",
    "",
    ...(hasRouteMetadata
      ? [
          "- `route-metadata.json`: exact public x402 route metadata for validation commands."
        ]
      : []),
    ...(hasOfferTemplate
      ? [
          "- `campaign-terms.template.json`: finalize campaign/merchant ids, economics, and policy fields, then compute its Split402 canonical hash.",
          "- `unsigned-offer.template.json`: set `campaignTermsHash`, nonce, timestamps, and key id before signing into `extensions.split402.info`."
        ]
      : [
          "- This candidate already has a signed Split402 offer in discovery output, so no offer template is exported."
        ]),
    ...(candidate.split402ReceiptTemplate === undefined
      ? []
      : [
          "- `receipt.template.json`: shape for the merchant-signed receipt returned after successful x402 settlement."
        ]),
    ...(hasOfferTemplate
      ? [
          "",
          "## Prepare Signing Inputs",
          "",
          "After finalizing campaign terms and the unsigned offer, compute the canonical campaign terms hash and exact offer signing bytes:",
          "",
          "```bash",
          "corepack pnpm demo:prepare-external-x402-offer -- \\",
          "  --campaign-terms-file campaign-terms.json \\",
          "  --unsigned-offer-file unsigned-offer.json \\",
          "  --output-dir prepared-offer",
          "```",
          "",
          "After signing externally, attach and optionally verify the signature:",
          "",
          "```bash",
          "corepack pnpm demo:attach-external-x402-signature -- \\",
          "  --kind offer \\",
          "  --unsigned-file prepared-offer/offer-to-sign.json \\",
          "  --signature <base64url-signature> \\",
          "  --merchant-public-key <merchant-offer-receipt-public-key> \\",
          "  --output-file offer.json",
          "```"
        ]
      : []),
    ...(candidate.split402ReceiptTemplate === undefined
      ? []
      : [
          "",
          "## Prepare Receipt Signing Inputs",
          "",
          "After a paid request settles, finalize the unsigned receipt and compute exact receipt signing bytes:",
          "",
          "```bash",
          "corepack pnpm demo:prepare-external-x402-receipt -- \\",
          "  --offer-file offer.json \\",
          "  --unsigned-receipt-file unsigned-receipt.json \\",
          "  --output-dir prepared-receipt",
          "```",
          "",
          "After signing externally, attach and optionally verify the receipt signature:",
          "",
          "```bash",
          "corepack pnpm demo:attach-external-x402-signature -- \\",
          "  --kind receipt \\",
          "  --unsigned-file prepared-receipt/receipt-to-sign.json \\",
          "  --signature <base64url-signature> \\",
          "  --merchant-public-key <merchant-offer-receipt-public-key> \\",
          "  --output-file receipt.json",
          "```"
        ]),
    "",
    "## Validation",
    "",
    "After signing the offer, validate public artifacts before paid staging:",
    "",
    "```bash",
    "corepack pnpm demo:validate-external-x402-artifacts -- \\",
    "  --route-metadata-file route-metadata.json \\",
    "  --merchant-public-key <merchant-offer-receipt-public-key> \\",
    "  --offer-file offer.json \\",
    ...(hasOfferTemplate
      ? ["  --campaign-terms-file campaign-terms.json"]
      : ["  --receipt-file receipt.json"]),
    "```",
    "",
    "Use public metadata only. Do not place private keys, bearer tokens, raw payment payloads, facilitator secrets, or private settlement evidence in these files.",
    ""
  ];
  writeFileSync(join(directory, filename), `${lines.join("\n")}`, "utf8");
  return filename;
}

function writeProviderArtifactsReadme(
  directory: string,
  report: ExternalX402OnboardingReport,
  manifest: ExternalX402ProviderArtifactManifest
): void {
  const lines = [
    "# Split402 External x402 Provider Artifacts",
    "",
    `Merchant origin: \`${report.merchantOrigin}\``,
    "",
    `Generated at: \`${report.generatedAt}\``,
    "",
    `Candidates: \`${report.candidateCount}\``,
    "",
    `Router-ready candidates: \`${report.routerReadyCount}\``,
    "",
    "## Candidate Summary",
    "",
    "| Provider | Route | Readiness | Directory |",
    "| --- | --- | --- | --- |",
    ...report.candidates.map((candidate, index) => {
      const manifestCandidate = manifest.candidates[index];
      const directoryName = manifestCandidate?.artifactDirectory ?? "";
      return [
        `| \`${candidate.providerId}\``,
        `\`${candidate.method} ${candidate.path}\``,
        `\`${candidate.readiness}\``,
        `\`${directoryName}\` |`
      ].join(" | ");
    }),
    "",
    "## Next Step",
    "",
    ...createProviderArtifactsNextStepLines(report),
    "",
    "## Public-Safety Boundary",
    "",
    "These artifacts are public scaffolds for Split402 public-alpha onboarding.",
    "Do not put private keys, bearer tokens, raw payment payloads, facilitator secrets, or private settlement evidence in this directory.",
    "Keep production listing, mainnet approval, and custody claims gated on Phase 6/Phase 7 evidence.",
    ""
  ];
  writeFileSync(join(directory, "README.md"), lines.join("\n"), "utf8");
}

function createProviderArtifactsNextStepLines(
  report: ExternalX402OnboardingReport
): string[] {
  const firstRouterReady = report.candidates.find(
    (candidate) => candidate.readiness === "router_ready"
  );
  if (firstRouterReady !== undefined) {
    return [
      `Start with \`${firstRouterReady.providerId}\`: it is router-ready in local artifact validation.`,
      "Run one low-value hosted staging proof before treating it as a launch candidate."
    ];
  }
  const firstCandidate = report.candidates[0];
  if (firstCandidate === undefined) {
    return [
      "No candidate routes were discovered. Re-run discovery with the correct merchant origin and match path."
    ];
  }
  return [
    `Start with \`${firstCandidate.providerId}\`. Current readiness is \`${firstCandidate.readiness}\`.`,
    ...firstCandidate.blockers.map((blocker) => `- Blocker: ${blocker}`),
    ...firstCandidate.nextActions.map((action) => `- ${action}`)
  ];
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/gu, "_");
  return sanitized.length === 0 ? "candidate" : sanitized;
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
