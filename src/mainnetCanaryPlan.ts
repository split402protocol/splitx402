import type { Split402ProductReadinessReport } from "./productReadinessStatus.js";

export interface Split402MainnetCanaryInput {
  productReadiness: Split402ProductReadinessReport;
  operatorConfirmation?: string;
  nonAtomicAcknowledgement?: string;
  network?: string;
  maxGrossAmountAtomic?: string;
  merchantId?: string;
  campaignId?: string;
  routeId?: string;
  canaryWallet?: string;
  dryRunEvidence?: string;
  rollbackPlan?: string;
  reviewDecision?: string;
}

export interface Split402MainnetCanaryReport {
  schema: "split402.mainnet_canary_plan.v1";
  product: "Split402";
  repository: "split402protocol/splitx402";
  readyForMainnetCanary: boolean;
  readyForProductionMainnet: false;
  maxAllowedGrossAmountAtomic: string;
  checks: Split402MainnetCanaryCheck[];
  nextActions: string[];
  executionSteps: string[];
  notes: string[];
}

export interface Split402MainnetCanaryCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: "required" | "advisory";
  details: string[];
}

export const MAINNET_CANARY_USAGE =
  "Usage: corepack pnpm product:mainnet-canary [--brief] [--workspace directory] [phase6-custody-evidence.txt] [phase7-staging-proof.txt]";

export const MAINNET_CANARY_CONFIRMATION = "split402-mainnet-canary";
export const MAINNET_CANARY_NON_ATOMIC_ACKNOWLEDGEMENT =
  "referral-accounting-not-atomic-split";
export const MAINNET_CANARY_NETWORK = "solana:mainnet";
export const MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC = "100000";

const REQUIRED_ENV_SUMMARY = [
  "SPLIT402_MAINNET_CANARY_CONFIRM=split402-mainnet-canary",
  "SPLIT402_MAINNET_CANARY_NON_ATOMIC_ACK=referral-accounting-not-atomic-split",
  "SPLIT402_MAINNET_CANARY_NETWORK=solana:mainnet",
  "SPLIT402_MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC=<positive integer <= 100000>",
  "SPLIT402_MAINNET_CANARY_MERCHANT_ID=<allowlisted merchant id>",
  "SPLIT402_MAINNET_CANARY_CAMPAIGN_ID=<allowlisted campaign id>",
  "SPLIT402_MAINNET_CANARY_ROUTE_ID=<allowlisted route id>",
  "SPLIT402_MAINNET_CANARY_WALLET=<allowlisted buyer/payer wallet>",
  "SPLIT402_MAINNET_CANARY_DRY_RUN_EVIDENCE=attached: <dry-run evidence>",
  "SPLIT402_MAINNET_CANARY_ROLLBACK_PLAN=attached: <rollback plan>",
  "SPLIT402_MAINNET_CANARY_REVIEW_DECISION=approved",
] as const;

export function createSplit402MainnetCanaryReport(
  input: Split402MainnetCanaryInput,
): Split402MainnetCanaryReport {
  const checks = [
    createLaunchGateCheck(input.productReadiness),
    createMainnetScopeCheck(input.network),
    createAmountCapCheck(input.maxGrossAmountAtomic),
    createAllowlistCheck(input),
    createDryRunEvidenceCheck(input.dryRunEvidence),
    createRollbackPlanCheck(input.rollbackPlan),
    createOperatorConfirmationCheck(input.operatorConfirmation),
    createNonAtomicAcknowledgementCheck(input.nonAtomicAcknowledgement),
    createReviewDecisionCheck(input.reviewDecision),
    createProductionLaunchSeparationCheck(),
  ];
  const requiredFailures = checks.filter(
    (check) => check.severity === "required" && !check.ok,
  );

  return {
    schema: "split402.mainnet_canary_plan.v1",
    product: "Split402",
    repository: "split402protocol/splitx402",
    readyForMainnetCanary: requiredFailures.length === 0,
    readyForProductionMainnet: false,
    maxAllowedGrossAmountAtomic: MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC,
    checks,
    nextActions: createNextActions(checks),
    executionSteps: [
      "Run product:status against the launch evidence workspace and confirm every launch gate is ready.",
      "Run demo and payout dry-runs against the exact mainnet configuration without broadcasting payout bytes.",
      "Enable exactly one allowlisted merchant, campaign, route, and payer wallet.",
      "Execute one standard x402 mainnet payment at or below the canary amount cap.",
      "Verify the Split402 receipt, economic policy, route attribution, and chain settlement.",
      "Confirm the referrer accrual becomes available and dashboard/referrer views show the expected earning.",
      "Create a payout batch in dry-run mode before requesting signer approval.",
      "Require the signer to verify transaction bytes against the approved payout plan before signing.",
      "Broadcast one tiny payout only after dry-run evidence and reviewer approval are attached.",
      "Verify finalized transfer contents before closing ledger items to paid.",
    ],
    notes: [
      "This is a mainnet canary gate, not production launch approval.",
      "The canary validates referral accounting plus later payout. It is not an atomic on-chain splitter.",
      "Keep private URLs, tokens, custody details, transaction bytes, and partner-identifying evidence out of the public repository.",
    ],
  };
}

export function formatSplit402MainnetCanaryBrief(
  report: Split402MainnetCanaryReport,
): string {
  const checkLines = report.checks.map((check) => {
    const status = check.ok ? "pass" : check.severity === "required" ? "block" : "note";
    return `- ${status}: ${check.label}`;
  });
  const nextActionLines = report.nextActions.map((action) => `- ${action}`);

  return [
    `Split402 mainnet canary: ${report.readyForMainnetCanary ? "ready" : "no-go"}`,
    `Production mainnet ready: ${report.readyForProductionMainnet ? "yes" : "no"}`,
    `Max canary gross amount atomic: ${report.maxAllowedGrossAmountAtomic}`,
    "",
    "Checks:",
    ...checkLines,
    "",
    "Next actions:",
    ...(nextActionLines.length > 0 ? nextActionLines : ["- No next actions."]),
    "",
    "Notes:",
    ...report.notes.map((note) => `- ${note}`),
  ].join("\n");
}

function createLaunchGateCheck(
  productReadiness: Split402ProductReadinessReport,
): Split402MainnetCanaryCheck {
  return {
    id: "launch_gates_ready",
    label: "All public boundary, hosted proof, and custody launch gates are ready",
    ok: productReadiness.launchDecision === "go",
    severity: "required",
    details:
      productReadiness.launchDecision === "go"
        ? ["product:status reports launch gates ready"]
        : [
            `product:status is ${productReadiness.launchDecision}; launch gates ready ${productReadiness.readiness.readyLaunchGates}/${productReadiness.readiness.totalLaunchGates}`,
          ],
  };
}

function createMainnetScopeCheck(network: string | undefined): Split402MainnetCanaryCheck {
  return {
    id: "network_is_mainnet",
    label: "Canary network is explicitly solana:mainnet",
    ok: network === MAINNET_CANARY_NETWORK,
    severity: "required",
    details:
      network === MAINNET_CANARY_NETWORK
        ? ["network is solana:mainnet"]
        : [`Set SPLIT402_MAINNET_CANARY_NETWORK=${MAINNET_CANARY_NETWORK}.`],
  };
}

function createAmountCapCheck(
  maxGrossAmountAtomic: string | undefined,
): Split402MainnetCanaryCheck {
  const amount = parsePositiveInteger(maxGrossAmountAtomic);
  const maxAmount = BigInt(MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC);
  const ok = amount !== undefined && amount <= maxAmount;

  return {
    id: "amount_cap",
    label: "Canary gross amount is tiny and capped",
    ok,
    severity: "required",
    details: ok
      ? [`gross amount cap is ${maxGrossAmountAtomic}`]
      : [
          `Set SPLIT402_MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC to a positive integer no greater than ${MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC}.`,
        ],
  };
}

function createAllowlistCheck(
  input: Split402MainnetCanaryInput,
): Split402MainnetCanaryCheck {
  const missing = [
    ["SPLIT402_MAINNET_CANARY_MERCHANT_ID", input.merchantId],
    ["SPLIT402_MAINNET_CANARY_CAMPAIGN_ID", input.campaignId],
    ["SPLIT402_MAINNET_CANARY_ROUTE_ID", input.routeId],
    ["SPLIT402_MAINNET_CANARY_WALLET", input.canaryWallet],
  ]
    .filter(([, value]) => !isFilled(value))
    .map(([key]) => key);

  return {
    id: "allowlisted_scope",
    label: "Exactly one merchant, campaign, route, and payer wallet are allowlisted",
    ok: missing.length === 0,
    severity: "required",
    details:
      missing.length === 0
        ? ["canary scope is explicitly allowlisted"]
        : [`Fill allowlist fields: ${missing.join(", ")}.`],
  };
}

function createDryRunEvidenceCheck(
  dryRunEvidence: string | undefined,
): Split402MainnetCanaryCheck {
  return createAttachedEvidenceCheck({
    id: "dry_run_evidence",
    label: "Dry-run evidence exists before mainnet broadcast",
    envName: "SPLIT402_MAINNET_CANARY_DRY_RUN_EVIDENCE",
    value: dryRunEvidence,
  });
}

function createRollbackPlanCheck(
  rollbackPlan: string | undefined,
): Split402MainnetCanaryCheck {
  return createAttachedEvidenceCheck({
    id: "rollback_plan",
    label: "Rollback and stop-loss plan is attached",
    envName: "SPLIT402_MAINNET_CANARY_ROLLBACK_PLAN",
    value: rollbackPlan,
  });
}

function createAttachedEvidenceCheck(input: {
  id: string;
  label: string;
  envName: string;
  value: string | undefined;
}): Split402MainnetCanaryCheck {
  const ok = isFilled(input.value) && input.value.trim().toLowerCase() !== "pending";
  return {
    id: input.id,
    label: input.label,
    ok,
    severity: "required",
    details: ok
      ? [`${input.envName} is filled`]
      : [`Set ${input.envName}=attached: <evidence path or review record>.`],
  };
}

function createOperatorConfirmationCheck(
  confirmation: string | undefined,
): Split402MainnetCanaryCheck {
  return {
    id: "operator_confirmation",
    label: "Operator explicitly confirms this is a mainnet canary",
    ok: confirmation === MAINNET_CANARY_CONFIRMATION,
    severity: "required",
    details:
      confirmation === MAINNET_CANARY_CONFIRMATION
        ? ["operator confirmation is present"]
        : [`Set SPLIT402_MAINNET_CANARY_CONFIRM=${MAINNET_CANARY_CONFIRMATION}.`],
  };
}

function createNonAtomicAcknowledgementCheck(
  acknowledgement: string | undefined,
): Split402MainnetCanaryCheck {
  return {
    id: "non_atomic_acknowledgement",
    label: "Operator acknowledges this is not atomic split settlement",
    ok: acknowledgement === MAINNET_CANARY_NON_ATOMIC_ACKNOWLEDGEMENT,
    severity: "required",
    details:
      acknowledgement === MAINNET_CANARY_NON_ATOMIC_ACKNOWLEDGEMENT
        ? ["non-atomic settlement acknowledgement is present"]
        : [
            `Set SPLIT402_MAINNET_CANARY_NON_ATOMIC_ACK=${MAINNET_CANARY_NON_ATOMIC_ACKNOWLEDGEMENT}.`,
          ],
  };
}

function createReviewDecisionCheck(
  reviewDecision: string | undefined,
): Split402MainnetCanaryCheck {
  return {
    id: "review_decision",
    label: "Human reviewer approved this exact canary",
    ok: reviewDecision === "approved",
    severity: "required",
    details:
      reviewDecision === "approved"
        ? ["canary review decision is approved"]
        : ["Set SPLIT402_MAINNET_CANARY_REVIEW_DECISION=approved only after reviewing the exact canary plan."],
  };
}

function createProductionLaunchSeparationCheck(): Split402MainnetCanaryCheck {
  return {
    id: "production_launch_separation",
    label: "Mainnet canary does not approve production mainnet launch",
    ok: true,
    severity: "advisory",
    details: ["readyForProductionMainnet remains false by design"],
  };
}

function createNextActions(
  checks: readonly Split402MainnetCanaryCheck[],
): string[] {
  const failedRequired = checks.filter(
    (check) => check.severity === "required" && !check.ok,
  );
  if (failedRequired.length === 0) {
    return [
      "Run the canary manually using the approved one-merchant, one-route, one-wallet scope.",
      "Capture receipt, chain verification, dashboard, payout dry-run, signer byte-verification, finalized transfer, and ledger-closure evidence.",
    ];
  }
  return [
    ...failedRequired.flatMap((check) => check.details),
    "Do not broadcast mainnet payment or payout transactions until every required canary check passes.",
    `Required environment:\n${REQUIRED_ENV_SUMMARY.map((line) => `  ${line}`).join("\n")}`,
  ];
}

function parsePositiveInteger(value: string | undefined): bigint | undefined {
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value.trim())) {
    return undefined;
  }
  return BigInt(value.trim());
}

function isFilled(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}
