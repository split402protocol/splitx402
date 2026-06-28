export const PHASE6_RECORD_EXTRACTION_ENV = [
  "SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD",
  "SPLIT402_PHASE6_ASSEMBLE_SIGNER_POLICY_RECORD",
] as const;

export const PHASE6_RECORD_EXTRACTION_ENV_ENTRIES = [
  {
    envName: "SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD",
    examplePath: "split402-launch-evidence/phase6-image-provenance.txt",
  },
  {
    envName: "SPLIT402_PHASE6_ASSEMBLE_SIGNER_POLICY_RECORD",
    examplePath: "split402-launch-evidence/phase6-signer-policy-review.txt",
  },
] as const;

export const PHASE6_ATTACHMENT_ENV = [
  {
    field: "network_policy_record",
    envName: "SPLIT402_PHASE6_ASSEMBLE_NETWORK_POLICY_RECORD",
    examplePath: "split402-launch-evidence/phase6-network-policy-review.txt",
  },
  {
    field: "signer_policy_record",
    envName: "SPLIT402_PHASE6_ASSEMBLE_SIGNER_POLICY_RECORD",
    examplePath: "split402-launch-evidence/phase6-signer-policy-review.txt",
  },
  {
    field: "smoke_check_output",
    envName: "SPLIT402_PHASE6_ASSEMBLE_SMOKE_CHECK_OUTPUT",
    examplePath: "split402-launch-evidence/phase6-signer-smoke-review.txt",
  },
  {
    field: "unknown_outcome_reconciliation_record",
    envName: "SPLIT402_PHASE6_ASSEMBLE_UNKNOWN_OUTCOME_RECONCILIATION_RECORD",
    examplePath: "split402-launch-evidence/phase6-reconciliation-drill.txt",
  },
  {
    field: "rotation_drill_record",
    envName: "SPLIT402_PHASE6_ASSEMBLE_ROTATION_DRILL_RECORD",
    examplePath: "split402-launch-evidence/phase6-rotation-drill.txt",
  },
  {
    field: "emergency_revocation_drill_record",
    envName: "SPLIT402_PHASE6_ASSEMBLE_EMERGENCY_REVOCATION_DRILL_RECORD",
    examplePath: "split402-launch-evidence/phase6-emergency-revocation-drill.txt",
  },
  {
    field: "key_custody_record",
    envName: "SPLIT402_PHASE6_ASSEMBLE_KEY_CUSTODY_RECORD",
    examplePath: "split402-launch-evidence/phase6-key-custody-review.txt",
  },
  {
    field: "incident_drill_record",
    envName: "SPLIT402_PHASE6_ASSEMBLE_INCIDENT_DRILL_RECORD",
    examplePath: "split402-launch-evidence/phase6-incident-drill.txt",
  },
  {
    field: "rollback_drill_record",
    envName: "SPLIT402_PHASE6_ASSEMBLE_ROLLBACK_DRILL_RECORD",
    examplePath: "split402-launch-evidence/phase6-rollback-drill.txt",
  },
  {
    field: "rpc_failover_record",
    envName: "SPLIT402_PHASE6_ASSEMBLE_RPC_FAILOVER_RECORD",
    examplePath: "split402-launch-evidence/phase6-rpc-failover-review.txt",
  },
] as const;

export function createPhase6EvidenceAssemblyEnvTemplate(): string {
  return [
    "# Split402 Phase 6 custody evidence assembly environment",
    "#",
    "# Uncomment and fill these values after generating real Phase 6 custody",
    "# records. Do not commit private URLs, private keys, secrets, or transaction bytes.",
    "#",
    "# Direct bundle fields:",
    "# SPLIT402_PHASE6_EVIDENCE_REVIEW_ID=phase6-custody-YYYY-MM-DD",
    "# SPLIT402_PHASE6_EVIDENCE_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
    "# SPLIT402_PHASE6_EVIDENCE_APPROVAL_NOTES=human approval pending",
    "# SPLIT402_PHASE6_EVIDENCE_APPROVAL_DECISION=no-go",
    "",
    "# Generated record files used for field extraction:",
    ...PHASE6_RECORD_EXTRACTION_ENV_ENTRIES.map(
      (entry) => `# ${entry.envName}=${entry.examplePath}`,
    ),
    "",
    "# Attachment paths copied into the custody evidence bundle:",
    ...PHASE6_ATTACHMENT_ENV.filter(
      (entry) =>
        !PHASE6_RECORD_EXTRACTION_ENV.some((envName) => envName === entry.envName),
    ).map((entry) => `# ${entry.envName}=${entry.examplePath}`),
    "",
    "# Assemble and check:",
    "# corepack pnpm phase6:evidence:assemble > split402-launch-evidence/phase6-custody-evidence.txt",
    "# corepack pnpm phase6:evidence:status split402-launch-evidence/phase6-custody-evidence.txt",
    "",
  ].join("\n");
}
