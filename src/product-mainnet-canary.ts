import { createMainnetCanaryEnv } from "./mainnetCanaryEnv.js";
import { verifyMainnetCanaryEvidenceAttachment } from "./mainnetCanaryEvidence.js";
import {
  createSplit402MainnetCanaryReport,
  formatSplit402MainnetCanaryBrief,
  MAINNET_CANARY_USAGE,
} from "./mainnetCanaryPlan.js";
import { readSplit402ProductReadinessCliInput } from "./productReadinessCli.js";

const { brief, help, report: productReadiness, workspaceDirectory } = readArgs();

if (help) {
  console.log(MAINNET_CANARY_USAGE);
  process.exit(0);
}

const env = createMainnetCanaryEnv({ workspaceDirectory });
const expectedScope = {
  merchantId: env.SPLIT402_MAINNET_CANARY_MERCHANT_ID,
  campaignId: env.SPLIT402_MAINNET_CANARY_CAMPAIGN_ID,
  routeId: env.SPLIT402_MAINNET_CANARY_ROUTE_ID,
  payerWallet: env.SPLIT402_MAINNET_CANARY_WALLET,
  maxGrossAmountAtomic: env.SPLIT402_MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC,
};
const report = createSplit402MainnetCanaryReport({
  productReadiness,
  operatorConfirmation: env.SPLIT402_MAINNET_CANARY_CONFIRM,
  nonAtomicAcknowledgement: env.SPLIT402_MAINNET_CANARY_NON_ATOMIC_ACK,
  network: env.SPLIT402_MAINNET_CANARY_NETWORK,
  maxGrossAmountAtomic: env.SPLIT402_MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC,
  merchantId: env.SPLIT402_MAINNET_CANARY_MERCHANT_ID,
  campaignId: env.SPLIT402_MAINNET_CANARY_CAMPAIGN_ID,
  routeId: env.SPLIT402_MAINNET_CANARY_ROUTE_ID,
  canaryWallet: env.SPLIT402_MAINNET_CANARY_WALLET,
  dryRunEvidence: env.SPLIT402_MAINNET_CANARY_DRY_RUN_EVIDENCE,
  dryRunEvidenceVerification: verifyMainnetCanaryEvidenceAttachment({
    expectedScope,
    kind: "dry_run",
    value: env.SPLIT402_MAINNET_CANARY_DRY_RUN_EVIDENCE,
    workspaceDirectory,
  }),
  rollbackPlan: env.SPLIT402_MAINNET_CANARY_ROLLBACK_PLAN,
  rollbackPlanVerification: verifyMainnetCanaryEvidenceAttachment({
    expectedScope,
    kind: "rollback_plan",
    value: env.SPLIT402_MAINNET_CANARY_ROLLBACK_PLAN,
    workspaceDirectory,
  }),
  reviewDecision: env.SPLIT402_MAINNET_CANARY_REVIEW_DECISION,
});

console.log(
  brief ? formatSplit402MainnetCanaryBrief(report) : JSON.stringify(report, null, 2),
);

if (!report.readyForMainnetCanary) {
  process.exitCode = 1;
}

function readArgs() {
  try {
    return readSplit402ProductReadinessCliInput(
      process.argv.slice(2),
      MAINNET_CANARY_USAGE,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
