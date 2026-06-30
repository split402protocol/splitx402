import {
  createSplit402MainnetCanaryReport,
  formatSplit402MainnetCanaryBrief,
  MAINNET_CANARY_USAGE,
} from "./mainnetCanaryPlan.js";
import { readSplit402ProductReadinessCliInput } from "./productReadinessCli.js";

const { brief, help, report: productReadiness } = readArgs();

if (help) {
  console.log(MAINNET_CANARY_USAGE);
  process.exit(0);
}

const report = createSplit402MainnetCanaryReport({
  productReadiness,
  operatorConfirmation: process.env.SPLIT402_MAINNET_CANARY_CONFIRM,
  nonAtomicAcknowledgement: process.env.SPLIT402_MAINNET_CANARY_NON_ATOMIC_ACK,
  network: process.env.SPLIT402_MAINNET_CANARY_NETWORK,
  maxGrossAmountAtomic:
    process.env.SPLIT402_MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC,
  merchantId: process.env.SPLIT402_MAINNET_CANARY_MERCHANT_ID,
  campaignId: process.env.SPLIT402_MAINNET_CANARY_CAMPAIGN_ID,
  routeId: process.env.SPLIT402_MAINNET_CANARY_ROUTE_ID,
  canaryWallet: process.env.SPLIT402_MAINNET_CANARY_WALLET,
  dryRunEvidence: process.env.SPLIT402_MAINNET_CANARY_DRY_RUN_EVIDENCE,
  rollbackPlan: process.env.SPLIT402_MAINNET_CANARY_ROLLBACK_PLAN,
  reviewDecision: process.env.SPLIT402_MAINNET_CANARY_REVIEW_DECISION,
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
