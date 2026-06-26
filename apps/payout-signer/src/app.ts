import {
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionDecoder,
  signTransaction
} from "@solana/kit";
import {
  hashSolanaPayoutDestinationAmountList,
  verifySolanaPayoutTransactionBytesAgainstPlan,
  type SolanaPayoutInstructionPlan,
  type SolanaPayoutPlannedItem,
  type SolanaPayoutPlannedTransaction,
  type SolanaPayoutSignerPolicy,
  type SolanaPayoutTransactionPlan,
  type SolanaTransferCheckedInstructionPlan
} from "@split402/control-plane";
import express, { type Request, type Response } from "express";
import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

export interface PayoutSignerConfig {
  signerReference: string;
  network: string;
  expectedFundingWallet: string;
  sharedSecret?: string;
  sharedSecretKeyId?: string;
  authKeys?: readonly PayoutSignerAuthKeyInput[];
  port: number;
  privateKeyBytes?: Uint8Array | readonly number[];
  secretKeyBytes?: Uint8Array | readonly number[];
  privateKeyBase64?: string;
  secretKeyBase64?: string;
  secretKeyJson?: string;
  signatureToleranceSeconds?: number;
  auditSink?: PayoutSignerAuditSink;
  now?: () => Date;
}

export type PayoutSignerAuthKeyStatus = "active" | "retired";

export interface PayoutSignerAuthKeyInput {
  keyId: string;
  sharedSecret: string;
  status?: PayoutSignerAuthKeyStatus;
}

interface PayoutSignerAuthKey {
  keyId: string;
  sharedSecret: string;
  status: PayoutSignerAuthKeyStatus;
}

interface NormalizedPayoutSignerConfig
  extends Omit<PayoutSignerConfig, "authKeys" | "signatureToleranceSeconds"> {
  authKeys: PayoutSignerAuthKey[];
  signatureToleranceSeconds: number;
}

type PayoutSigner = Awaited<ReturnType<typeof createSigner>>;

interface PayoutSignerState {
  promise: Promise<PayoutSigner | undefined>;
  error?: unknown;
}

export type PayoutSignerAuditOutcome = "signed" | "rejected";

export interface PayoutSignerAuditEvent {
  schema: "split402.payout_signer.audit_event.v1";
  observedAt: string;
  outcome: PayoutSignerAuditOutcome;
  statusCode: number;
  code: string;
  signerReference: string;
  network: string;
  authKeyId?: string;
  batchId?: string;
  transactionIndex?: number;
  amountAtomic?: string;
  destinationAmountListHash?: `sha256:${string}`;
  expectedSignature?: string;
  message?: string;
}

export type PayoutSignerAuditSink = (
  event: PayoutSignerAuditEvent
) => void | Promise<void>;

export interface PayoutSignerEnvOptions {
  auditLogWriter?: (line: string) => void;
}

export interface PayoutSignerMetricsSnapshot {
  service: "split402-payout-signer";
  signerReference: string;
  network: string;
  requestsTotal: number;
  signedTotal: number;
  rejectedTotal: number;
  rejectedByCode: Record<string, number>;
}

interface RemotePayoutSignRequest {
  schema: "split402.solana.remote_payout_sign_request.v1";
  batchId: string;
  network: string;
  signerReference: string;
  destinationAmountListHash: `sha256:${string}`;
  transactionIndex: number;
  amountAtomic: string;
  transactionBase64: string;
  plannedTransaction: SolanaPayoutPlannedTransaction;
  policy: SolanaPayoutSignerPolicy;
}

export function createPayoutSignerApp(config: PayoutSignerConfig): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));
  const normalizedConfig = normalizePayoutSignerConfig(config);
  const signerState = createSignerState(normalizedConfig);
  const metrics = createMetrics(normalizedConfig);

  app.get("/v1/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "split402-payout-signer",
      releaseStage: "public-alpha",
      signerReference: normalizedConfig.signerReference,
      network: normalizedConfig.network,
      authKeys: normalizedConfig.authKeys?.map((key) => ({
        keyId: key.keyId,
        status: key.status
      }))
    });
  });

  app.get("/v1/ready", async (_req, res) => {
    try {
      await requireReadySigner(signerState);
      res.json({
        status: "ready",
        service: "split402-payout-signer",
        signerReference: normalizedConfig.signerReference,
        network: normalizedConfig.network
      });
    } catch (error) {
      res.status(503).json({
        status: "not_ready",
        service: "split402-payout-signer",
        message: error instanceof Error ? error.message : "unknown error"
      });
    }
  });

  app.get("/v1/metrics", (_req, res) => {
    res.json({ metrics: snapshotMetrics(metrics) });
  });

  app.post("/v1/solana/payouts/sign", async (req, res) => {
    let authKeyId: string | undefined;
    let signRequest: RemotePayoutSignRequest | undefined;
    try {
      metrics.requestsTotal += 1;
      const rawBody = JSON.stringify(req.body);
      authKeyId = assertRequestSignature(
        req,
        rawBody,
        normalizedConfig
      ).keyId;
      signRequest = readRemotePayoutSignRequest(req.body);
      assertRemotePayoutSignRequest(signRequest, normalizedConfig);
      assertRequestTransactionBytesMatchPlan(signRequest);
      const signer = await requireReadySigner(signerState);
      const transactionBytes = Buffer.from(signRequest.transactionBase64, "base64");
      const transaction = getTransactionDecoder().decode(transactionBytes);
      const signed = await signTransaction([signer.keyPair], transaction);
      const expectedSignature = getSignatureFromTransaction(signed);
      metrics.signedTotal += 1;
      await emitAuditEvent(normalizedConfig, {
        outcome: "signed",
        statusCode: 200,
        code: "signed",
        authKeyId,
        request: signRequest,
        expectedSignature
      });
      res.json({
        transactionIndex: signRequest.transactionIndex,
        signedTransactionBase64: getBase64EncodedWireTransaction(signed),
        expectedSignature
      });
    } catch (error) {
      const errorResponse = readSignerErrorResponse(error);
      metrics.rejectedTotal += 1;
      metrics.rejectedByCode[errorResponse.code] =
        (metrics.rejectedByCode[errorResponse.code] ?? 0) + 1;
      await emitAuditEvent(normalizedConfig, {
        outcome: "rejected",
        statusCode: errorResponse.statusCode,
        code: errorResponse.code,
        message: errorResponse.message,
        ...(authKeyId === undefined ? {} : { authKeyId }),
        ...(signRequest === undefined ? {} : { request: signRequest })
      });
      sendSignerError(res, error);
    }
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return app;
}

export function readPayoutSignerConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: PayoutSignerEnvOptions = {}
): PayoutSignerConfig {
  const auditSink = readAuditSinkFromEnv(
    env.SPLIT402_PAYOUT_SIGNER_SERVICE_AUDIT_LOG,
    options.auditLogWriter ?? console.log
  );
  return normalizePayoutSignerConfig({
    signerReference: readRequiredEnv(
      env.SPLIT402_PAYOUT_SIGNER_SERVICE_REF,
      "SPLIT402_PAYOUT_SIGNER_SERVICE_REF"
    ),
    network: readRequiredEnv(
      env.SPLIT402_PAYOUT_SIGNER_SERVICE_NETWORK,
      "SPLIT402_PAYOUT_SIGNER_SERVICE_NETWORK"
    ),
    expectedFundingWallet: readRequiredEnv(
      env.SPLIT402_PAYOUT_SIGNER_SERVICE_EXPECTED_FUNDING_WALLET,
      "SPLIT402_PAYOUT_SIGNER_SERVICE_EXPECTED_FUNDING_WALLET"
    ),
    ...(env.SPLIT402_PAYOUT_SIGNER_SERVICE_AUTH_KEYS_JSON === undefined
      ? {}
      : {
          authKeys: readAuthKeysJson(
            env.SPLIT402_PAYOUT_SIGNER_SERVICE_AUTH_KEYS_JSON
          )
        }),
    ...(env.SPLIT402_PAYOUT_SIGNER_SERVICE_SHARED_SECRET === undefined
      ? {}
      : {
          sharedSecret: env.SPLIT402_PAYOUT_SIGNER_SERVICE_SHARED_SECRET,
          ...(env.SPLIT402_PAYOUT_SIGNER_SERVICE_SHARED_SECRET_KEY_ID ===
          undefined
            ? {}
            : {
                sharedSecretKeyId:
                  env.SPLIT402_PAYOUT_SIGNER_SERVICE_SHARED_SECRET_KEY_ID
              })
        }),
    port: readOptionalPositiveIntegerEnv(
      env.SPLIT402_PAYOUT_SIGNER_SERVICE_PORT,
      "SPLIT402_PAYOUT_SIGNER_SERVICE_PORT"
    ) ?? 4022,
    signatureToleranceSeconds:
      readOptionalPositiveIntegerEnv(
        env.SPLIT402_PAYOUT_SIGNER_SERVICE_SIGNATURE_TOLERANCE_SECONDS,
        "SPLIT402_PAYOUT_SIGNER_SERVICE_SIGNATURE_TOLERANCE_SECONDS"
      ) ?? 300,
    ...(env.SPLIT402_PAYOUT_SIGNER_SERVICE_PRIVATE_KEY_BASE64 === undefined
      ? {}
      : {
          privateKeyBase64:
            env.SPLIT402_PAYOUT_SIGNER_SERVICE_PRIVATE_KEY_BASE64
        }),
    ...(env.SPLIT402_PAYOUT_SIGNER_SERVICE_SECRET_KEY_BASE64 === undefined
      ? {}
      : {
          secretKeyBase64: env.SPLIT402_PAYOUT_SIGNER_SERVICE_SECRET_KEY_BASE64
        }),
    ...(env.SPLIT402_PAYOUT_SIGNER_SERVICE_SECRET_KEY_JSON === undefined
      ? {}
      : { secretKeyJson: env.SPLIT402_PAYOUT_SIGNER_SERVICE_SECRET_KEY_JSON }),
    ...(auditSink === undefined ? {} : { auditSink })
  });
}

export function createPayoutSignerJsonlAuditSink(
  writeLine: (line: string) => void = console.log
): PayoutSignerAuditSink {
  return (event) => {
    writeLine(JSON.stringify(event));
  };
}

function normalizePayoutSignerConfig(
  config: PayoutSignerConfig
): NormalizedPayoutSignerConfig {
  return {
    signerReference: assertNonEmptyString(
      config.signerReference,
      "signerReference"
    ),
    network: assertSolanaNetwork(config.network),
    expectedFundingWallet: assertNonEmptyString(
      config.expectedFundingWallet,
      "expectedFundingWallet"
    ),
    authKeys: normalizeAuthKeys(config),
    port: assertPositiveInteger(config.port, "port"),
    signatureToleranceSeconds: assertPositiveInteger(
      config.signatureToleranceSeconds ?? 300,
      "signatureToleranceSeconds"
    ),
    ...(config.privateKeyBytes === undefined
      ? {}
      : { privateKeyBytes: config.privateKeyBytes }),
    ...(config.secretKeyBytes === undefined
      ? {}
      : { secretKeyBytes: config.secretKeyBytes }),
    ...(config.privateKeyBase64 === undefined
      ? {}
      : { privateKeyBase64: config.privateKeyBase64 }),
    ...(config.secretKeyBase64 === undefined
      ? {}
      : { secretKeyBase64: config.secretKeyBase64 }),
    ...(config.secretKeyJson === undefined
      ? {}
      : { secretKeyJson: config.secretKeyJson }),
    ...(config.auditSink === undefined ? {} : { auditSink: config.auditSink }),
    ...(config.now === undefined ? {} : { now: config.now })
  };
}

async function createSigner(config: PayoutSignerConfig) {
  const keyMaterial = readSignerKeyMaterial(config);
  if (keyMaterial.kind === "secret") {
    return createKeyPairSignerFromBytes(keyMaterial.bytes, false);
  }
  return createKeyPairSignerFromPrivateKeyBytes(keyMaterial.bytes, false);
}

function createSignerState(config: PayoutSignerConfig): PayoutSignerState {
  const state: PayoutSignerState = {
    promise: createSigner(config).then(
      (signer) => signer,
      (error) => {
        state.error = error;
        return undefined;
      }
    )
  };
  return state;
}

async function requireReadySigner(state: PayoutSignerState): Promise<PayoutSigner> {
  const signer = await state.promise;
  if (signer !== undefined) {
    return signer;
  }
  if (state.error instanceof Error) {
    throw state.error;
  }
  throw new Error("payout signer key material failed to initialize");
}

function readSignerKeyMaterial(
  config: PayoutSignerConfig
): { kind: "private" | "secret"; bytes: Uint8Array } {
  const provided = [
    config.privateKeyBytes,
    config.secretKeyBytes,
    config.privateKeyBase64,
    config.secretKeyBase64,
    config.secretKeyJson
  ].filter((value) => value !== undefined);
  if (provided.length !== 1) {
    throw new Error("payout signer service requires exactly one key material input");
  }
  if (config.privateKeyBytes !== undefined) {
    return {
      kind: "private",
      bytes: readByteArray(config.privateKeyBytes, "privateKeyBytes", 32)
    };
  }
  if (config.secretKeyBytes !== undefined) {
    return {
      kind: "secret",
      bytes: readByteArray(config.secretKeyBytes, "secretKeyBytes", 64)
    };
  }
  if (config.privateKeyBase64 !== undefined) {
    return {
      kind: "private",
      bytes: readBase64Bytes(config.privateKeyBase64, "privateKeyBase64", 32)
    };
  }
  if (config.secretKeyBase64 !== undefined) {
    return {
      kind: "secret",
      bytes: readBase64Bytes(config.secretKeyBase64, "secretKeyBase64", 64)
    };
  }
  return {
    kind: "secret",
    bytes: readSecretKeyJson(config.secretKeyJson ?? "")
  };
}

function normalizeAuthKeys(config: PayoutSignerConfig): PayoutSignerAuthKey[] {
  const authKeys = [
    ...(config.authKeys ?? []),
    ...(config.sharedSecret === undefined
      ? []
      : [
          {
            keyId: config.sharedSecretKeyId ?? "default",
            sharedSecret: config.sharedSecret,
            status: "active" as const
          }
        ])
  ].map((key) => ({
    keyId: assertNonEmptyString(key.keyId, "authKey.keyId"),
    sharedSecret: assertNonEmptyString(
      key.sharedSecret,
      `authKey ${key.keyId} sharedSecret`
    ),
    status: key.status ?? "active"
  }));
  if (authKeys.length === 0) {
    throw new Error("payout signer service requires at least one auth key");
  }
  const keyIds = new Set<string>();
  for (const key of authKeys) {
    if (key.status !== "active" && key.status !== "retired") {
      throw new Error(`authKey ${key.keyId} status must be active or retired`);
    }
    if (keyIds.has(key.keyId)) {
      throw new Error(`duplicate payout signer auth key id: ${key.keyId}`);
    }
    keyIds.add(key.keyId);
  }
  if (!authKeys.some((key) => key.status === "active")) {
    throw new Error("payout signer service requires at least one active auth key");
  }
  return authKeys;
}

function assertRequestSignature(
  req: Request,
  body: string,
  config: NormalizedPayoutSignerConfig
): PayoutSignerAuthKey {
  const timestamp = readHeader(req, "x-split402-signature-timestamp");
  const signature = readHeader(req, "x-split402-signature");
  assertFreshSignatureTimestamp(timestamp, config);
  const authKey = selectAuthKey(req, config.authKeys);
  const expected = createRequestSignature({
    timestamp,
    body,
    sharedSecret: authKey.sharedSecret
  });
  if (!safeEqual(signature, expected)) {
    throw new SignerHttpError(401, "unauthorized", "invalid request signature");
  }
  return authKey;
}

function assertFreshSignatureTimestamp(
  timestamp: string,
  config: NormalizedPayoutSignerConfig
): void {
  const observedAt = Date.parse(timestamp);
  if (!Number.isFinite(observedAt)) {
    throw new SignerHttpError(
      401,
      "unauthorized",
      "x-split402-signature-timestamp must be an ISO timestamp"
    );
  }
  const now = (config.now?.() ?? new Date()).getTime();
  const toleranceMs = config.signatureToleranceSeconds * 1000;
  if (Math.abs(now - observedAt) > toleranceMs) {
    throw new SignerHttpError(
      401,
      "unauthorized",
      "request signature timestamp is outside tolerance"
    );
  }
}

function selectAuthKey(
  req: Request,
  authKeys: readonly PayoutSignerAuthKey[]
): PayoutSignerAuthKey {
  const keyId = readOptionalHeader(req, "x-split402-signer-key-id");
  if (keyId !== undefined) {
    const key = authKeys.find((candidate) => candidate.keyId === keyId);
    if (key === undefined || key.status !== "active") {
      throw new SignerHttpError(401, "unauthorized", "auth key is not active");
    }
    return key;
  }
  if (authKeys.length !== 1) {
    throw new SignerHttpError(
      401,
      "unauthorized",
      "x-split402-signer-key-id header is required"
    );
  }
  const key = authKeys[0];
  if (key === undefined || key.status !== "active") {
    throw new SignerHttpError(401, "unauthorized", "auth key is not active");
  }
  return key;
}

function createRequestSignature(input: {
  timestamp: string;
  body: string;
  sharedSecret: string;
}): string {
  const digest = createHmac("sha256", input.sharedSecret)
    .update(`${input.timestamp}.${input.body}`)
    .digest("hex");
  return `v1=${digest}`;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function createMetrics(
  config: NormalizedPayoutSignerConfig
): PayoutSignerMetricsSnapshot {
  return {
    service: "split402-payout-signer",
    signerReference: config.signerReference,
    network: config.network,
    requestsTotal: 0,
    signedTotal: 0,
    rejectedTotal: 0,
    rejectedByCode: {}
  };
}

function snapshotMetrics(
  metrics: PayoutSignerMetricsSnapshot
): PayoutSignerMetricsSnapshot {
  return {
    ...metrics,
    rejectedByCode: { ...metrics.rejectedByCode }
  };
}

async function emitAuditEvent(
  config: NormalizedPayoutSignerConfig,
  input: {
    outcome: PayoutSignerAuditOutcome;
    statusCode: number;
    code: string;
    authKeyId?: string;
    request?: RemotePayoutSignRequest;
    expectedSignature?: string;
    message?: string;
  }
): Promise<void> {
  if (config.auditSink === undefined) {
    return;
  }
  const event: PayoutSignerAuditEvent = {
    schema: "split402.payout_signer.audit_event.v1",
    observedAt: (config.now?.() ?? new Date()).toISOString(),
    outcome: input.outcome,
    statusCode: input.statusCode,
    code: input.code,
    signerReference: config.signerReference,
    network: config.network,
    ...(input.authKeyId === undefined ? {} : { authKeyId: input.authKeyId }),
    ...(input.request === undefined
      ? {}
      : {
          batchId: input.request.batchId,
          transactionIndex: input.request.transactionIndex,
          amountAtomic: input.request.amountAtomic,
          destinationAmountListHash: input.request.destinationAmountListHash
        }),
    ...(input.expectedSignature === undefined
      ? {}
      : { expectedSignature: input.expectedSignature }),
    ...(input.message === undefined ? {} : { message: input.message })
  };
  try {
    await config.auditSink(event);
  } catch {
    // Signing responses must not depend on the audit transport being healthy.
  }
}

function readRemotePayoutSignRequest(value: unknown): RemotePayoutSignRequest {
  const record = readRecord(value);
  const schema = readRequiredString(record.schema, "schema");
  if (schema !== "split402.solana.remote_payout_sign_request.v1") {
    throw new SignerHttpError(400, "invalid_request", "unsupported schema");
  }
  return {
    schema,
    batchId: readRequiredString(record.batchId, "batchId"),
    network: readRequiredString(record.network, "network"),
    signerReference: readRequiredString(
      record.signerReference,
      "signerReference"
    ),
    destinationAmountListHash: readHash(
      record.destinationAmountListHash,
      "destinationAmountListHash"
    ),
    transactionIndex: readInteger(record.transactionIndex, "transactionIndex"),
    amountAtomic: readAtomicAmount(record.amountAtomic, "amountAtomic"),
    transactionBase64: readBase64String(
      record.transactionBase64,
      "transactionBase64"
    ),
    plannedTransaction: readPlannedTransaction(record.plannedTransaction),
    policy: readSignerPolicy(record.policy)
  };
}

function assertRemotePayoutSignRequest(
  request: RemotePayoutSignRequest,
  config: PayoutSignerConfig
): void {
  if (request.signerReference !== config.signerReference) {
    throw new SignerHttpError(
      403,
      "forbidden",
      "signerReference is not allowed by this signer"
    );
  }
  if (request.policy.signerReference !== config.signerReference) {
    throw new SignerHttpError(
      403,
      "forbidden",
      "policy signerReference is not allowed by this signer"
    );
  }
  if (request.network !== config.network || request.policy.network !== config.network) {
    throw new SignerHttpError(403, "forbidden", "network is not allowed by this signer");
  }
  if (request.policy.fundingWallet !== config.expectedFundingWallet) {
    throw new SignerHttpError(
      403,
      "forbidden",
      "funding wallet is not allowed by this signer"
    );
  }
  if (request.plannedTransaction.index !== request.transactionIndex) {
    throw new SignerHttpError(
      400,
      "invalid_request",
      "plannedTransaction index does not match transactionIndex"
    );
  }
  const transfer = readSingleTransfer(request.plannedTransaction.instructions);
  if (transfer.source !== request.policy.sourceTokenAccount) {
    throw new SignerHttpError(
      403,
      "forbidden",
      "transfer source is not allowed by policy"
    );
  }
  if (transfer.authority !== request.policy.fundingWallet) {
    throw new SignerHttpError(
      403,
      "forbidden",
      "transfer authority is not allowed by policy"
    );
  }
  if (transfer.mint !== request.policy.mint) {
    throw new SignerHttpError(403, "forbidden", "transfer mint is not allowed by policy");
  }
  if (
    request.policy.allowedTokenProgramIds !== undefined &&
    !request.policy.allowedTokenProgramIds.includes(transfer.programId)
  ) {
    throw new SignerHttpError(
      403,
      "forbidden",
      "transfer token program is not allowed by policy"
    );
  }
  if (transfer.amountAtomic !== request.amountAtomic) {
    throw new SignerHttpError(
      400,
      "invalid_request",
      "transfer amount does not match request amount"
    );
  }
  if (
    request.policy.maxTransactionAmountAtomic !== undefined &&
    BigInt(request.amountAtomic) > BigInt(request.policy.maxTransactionAmountAtomic)
  ) {
    throw new SignerHttpError(
      403,
      "forbidden",
      "transaction amount exceeds signer policy"
    );
  }
  const plan = createSingleTransactionPlan(request, transfer);
  const hash = hashSolanaPayoutDestinationAmountList(plan);
  if (hash !== request.destinationAmountListHash) {
    throw new SignerHttpError(
      400,
      "invalid_request",
      "destination amount list hash mismatch"
    );
  }
  if (
    request.policy.expectedDestinationAmountListHash !== undefined &&
    request.policy.expectedDestinationAmountListHash !== hash
  ) {
    throw new SignerHttpError(
      403,
      "forbidden",
      "policy destination amount list hash mismatch"
    );
  }
}

function assertRequestTransactionBytesMatchPlan(
  request: RemotePayoutSignRequest
): void {
  const verification = verifySolanaPayoutTransactionBytesAgainstPlan({
    transactionBase64: request.transactionBase64,
    plannedTransaction: request.plannedTransaction,
    policy: request.policy
  });
  if (!verification.ok) {
    throw new SignerHttpError(
      400,
      "invalid_request",
      `transaction bytes do not match approved payout plan: ${verification.errors.join("; ")}`
    );
  }
}

function createSingleTransactionPlan(
  request: RemotePayoutSignRequest,
  transfer: SolanaTransferCheckedInstructionPlan
): SolanaPayoutTransactionPlan {
  return {
    batchId: request.batchId,
    network: request.network,
    asset: request.policy.mint,
    tokenProgramId: transfer.programId,
    tokenDecimals: transfer.decimals,
    fundingWallet: request.policy.fundingWallet,
    sourceTokenAccount: request.policy.sourceTokenAccount,
    totalAmountAtomic: request.amountAtomic,
    itemCount: request.plannedTransaction.items.length,
    transactionCount: 1,
    transactions: [request.plannedTransaction]
  };
}

function readSingleTransfer(
  instructions: readonly SolanaPayoutInstructionPlan[]
): SolanaTransferCheckedInstructionPlan {
  const transfers = instructions.filter(
    (instruction): instruction is SolanaTransferCheckedInstructionPlan =>
      instruction.kind === "transferChecked"
  );
  if (transfers.length !== 1) {
    throw new SignerHttpError(
      400,
      "invalid_request",
      "plannedTransaction must include exactly one transferChecked instruction"
    );
  }
  const transfer = transfers[0];
  if (transfer === undefined) {
    throw new SignerHttpError(
      400,
      "invalid_request",
      "plannedTransaction is missing a transferChecked instruction"
    );
  }
  return transfer;
}

function readPlannedTransaction(value: unknown): SolanaPayoutPlannedTransaction {
  const record = readRecord(value);
  return {
    index: readInteger(record.index, "plannedTransaction.index"),
    items: readArray(record.items, "plannedTransaction.items").map(readPlannedItem),
    instructions: readArray(
      record.instructions,
      "plannedTransaction.instructions"
    ).map(readInstruction)
  };
}

function readPlannedItem(value: unknown): SolanaPayoutPlannedItem {
  const record = readRecord(value);
  return {
    payoutItemId: readRequiredString(record.payoutItemId, "payoutItemId"),
    destinationWallet: readRequiredString(
      record.destinationWallet,
      "destinationWallet"
    ),
    destinationTokenAccount: readRequiredString(
      record.destinationTokenAccount,
      "destinationTokenAccount"
    ),
    amountAtomic: readAtomicAmount(record.amountAtomic, "amountAtomic"),
    createAssociatedTokenAccount: readBoolean(
      record.createAssociatedTokenAccount,
      "createAssociatedTokenAccount"
    )
  };
}

function readInstruction(value: unknown): SolanaPayoutInstructionPlan {
  const record = readRecord(value);
  const kind = readRequiredString(record.kind, "instruction.kind");
  if (kind === "transferChecked") {
    return {
      kind,
      programId: readRequiredString(record.programId, "programId"),
      source: readRequiredString(record.source, "source"),
      mint: readRequiredString(record.mint, "mint"),
      destination: readRequiredString(record.destination, "destination"),
      authority: readRequiredString(record.authority, "authority"),
      amountAtomic: readAtomicAmount(record.amountAtomic, "amountAtomic"),
      decimals: readNonNegativeInteger(record.decimals, "decimals"),
      payoutItemId: readRequiredString(record.payoutItemId, "payoutItemId")
    };
  }
  if (kind === "createAssociatedTokenIdempotent") {
    return {
      kind,
      programId: readRequiredString(record.programId, "programId"),
      payer: readRequiredString(record.payer, "payer"),
      associatedTokenAccount: readRequiredString(
        record.associatedTokenAccount,
        "associatedTokenAccount"
      ),
      owner: readRequiredString(record.owner, "owner"),
      mint: readRequiredString(record.mint, "mint"),
      tokenProgramId: readRequiredString(record.tokenProgramId, "tokenProgramId")
    };
  }
  throw new SignerHttpError(400, "invalid_request", "unsupported instruction kind");
}

function readSignerPolicy(value: unknown): SolanaPayoutSignerPolicy {
  const record = readRecord(value);
  return {
    network: readRequiredString(record.network, "policy.network"),
    signerReference: readRequiredString(
      record.signerReference,
      "policy.signerReference"
    ),
    fundingWallet: readRequiredString(record.fundingWallet, "policy.fundingWallet"),
    sourceTokenAccount: readRequiredString(
      record.sourceTokenAccount,
      "policy.sourceTokenAccount"
    ),
    mint: readRequiredString(record.mint, "policy.mint"),
    ...(record.allowedTokenProgramIds === undefined
      ? {}
      : {
          allowedTokenProgramIds: readArray(
            record.allowedTokenProgramIds,
            "policy.allowedTokenProgramIds"
          ).map((item) => readRequiredString(item, "allowedTokenProgramId"))
        }),
    ...(record.maxTransactionAmountAtomic === undefined
      ? {}
      : {
          maxTransactionAmountAtomic: readAtomicAmount(
            record.maxTransactionAmountAtomic,
            "policy.maxTransactionAmountAtomic"
          )
        }),
    ...(record.maxBatchAmountAtomic === undefined
      ? {}
      : {
          maxBatchAmountAtomic: readAtomicAmount(
            record.maxBatchAmountAtomic,
            "policy.maxBatchAmountAtomic"
          )
        }),
    ...(record.requireSuccessfulSimulation === undefined
      ? {}
      : {
          requireSuccessfulSimulation: readBoolean(
            record.requireSuccessfulSimulation,
            "policy.requireSuccessfulSimulation"
          )
        }),
    ...(record.expectedDestinationAmountListHash === undefined
      ? {}
      : {
          expectedDestinationAmountListHash: readHash(
            record.expectedDestinationAmountListHash,
            "policy.expectedDestinationAmountListHash"
          )
        })
  };
}

function readHeader(req: Request, name: string): string {
  const value = req.header(name);
  if (value === undefined || value.trim().length === 0) {
    throw new SignerHttpError(401, "unauthorized", `${name} header is required`);
  }
  return value.trim();
}

function readOptionalHeader(req: Request, name: string): string | undefined {
  const value = req.header(name);
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function readAuthKeysJson(value: string): PayoutSignerAuthKeyInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      "SPLIT402_PAYOUT_SIGNER_SERVICE_AUTH_KEYS_JSON must be a JSON array"
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      "SPLIT402_PAYOUT_SIGNER_SERVICE_AUTH_KEYS_JSON must be a JSON array"
    );
  }
  return parsed.map((item, index) => {
    const record = readPlainConfigRecord(
      item,
      `SPLIT402_PAYOUT_SIGNER_SERVICE_AUTH_KEYS_JSON[${index}]`
    );
    return {
      keyId: readPlainConfigString(record.keyId, `auth key ${index} keyId`),
      sharedSecret: readPlainConfigString(
        record.sharedSecret,
        `auth key ${index} sharedSecret`
      ),
      ...(record.status === undefined
        ? {}
        : {
            status: readPlainAuthKeyStatus(
              record.status,
              `auth key ${index} status`
            )
          })
    };
  });
}

function readAuditSinkFromEnv(
  value: string | undefined,
  writeLine: (line: string) => void
): PayoutSignerAuditSink | undefined {
  const mode = value?.trim() ?? "off";
  if (mode.length === 0 || mode === "off") {
    return undefined;
  }
  if (mode === "stdout-jsonl") {
    return createPayoutSignerJsonlAuditSink(writeLine);
  }
  throw new Error(
    "SPLIT402_PAYOUT_SIGNER_SERVICE_AUDIT_LOG must be off or stdout-jsonl"
  );
}

function readPlainConfigRecord(
  value: unknown,
  label: string
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readPlainConfigString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function readPlainAuthKeyStatus(
  value: unknown,
  label: string
): PayoutSignerAuthKeyStatus {
  if (value === "active" || value === "retired") {
    return value;
  }
  throw new Error(`${label} must be active or retired`);
}

function readRequiredEnv(value: string | undefined, label: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function readOptionalPositiveIntegerEnv(
  value: string | undefined,
  label: string
): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  if (!/^[1-9][0-9]*$/u.test(value.trim())) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number.parseInt(value.trim(), 10);
}

function assertSolanaNetwork(value: string): string {
  const network = assertNonEmptyString(value, "network");
  if (!network.startsWith("solana:")) {
    throw new Error("network must start with solana:");
  }
  return network;
}

function assertNonEmptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function readInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value)) {
    throw new SignerHttpError(400, "invalid_request", `${label} must be an integer`);
  }
  return value as number;
}

function readNonNegativeInteger(value: unknown, label: string): number {
  const integer = readInteger(value, label);
  if (integer < 0) {
    throw new SignerHttpError(
      400,
      "invalid_request",
      `${label} must be non-negative`
    );
  }
  return integer;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new SignerHttpError(400, "invalid_request", `${label} must be a boolean`);
  }
  return value;
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SignerHttpError(
      400,
      "invalid_request",
      `${label} must be a non-empty string`
    );
  }
  return value.trim();
}

function readAtomicAmount(value: unknown, label: string): string {
  const amount = readRequiredString(value, label);
  if (!/^(0|[1-9][0-9]*)$/u.test(amount)) {
    throw new SignerHttpError(400, "invalid_request", `${label} must be atomic`);
  }
  return amount;
}

function readHash(value: unknown, label: string): `sha256:${string}` {
  const hash = readRequiredString(value, label);
  if (!/^sha256:[a-f0-9]{64}$/u.test(hash)) {
    throw new SignerHttpError(
      400,
      "invalid_request",
      `${label} must be a sha256 hash`
    );
  }
  return hash as `sha256:${string}`;
}

function readBase64String(value: unknown, label: string): string {
  const raw = readRequiredString(value, label);
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== raw) {
    throw new SignerHttpError(400, "invalid_request", `${label} must be base64`);
  }
  return raw;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SignerHttpError(400, "invalid_request", "request body must be an object");
  }
  return value as Record<string, unknown>;
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SignerHttpError(400, "invalid_request", `${label} must be an array`);
  }
  return value;
}

function readSecretKeyJson(value: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("secretKeyJson must be a JSON array");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("secretKeyJson must be a JSON array");
  }
  return readByteArray(parsed, "secretKeyJson", 64);
}

function readBase64Bytes(value: string, label: string, length: number): Uint8Array {
  if (value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty base64 string`);
  }
  const normalized = value.trim();
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length !== length || bytes.toString("base64") !== normalized) {
    throw new Error(`${label} must decode to ${length} bytes`);
  }
  return new Uint8Array(bytes);
}

function readByteArray(
  value: Uint8Array | readonly number[],
  label: string,
  length: number
): Uint8Array {
  const raw = Array.from(value);
  if (raw.length !== length) {
    throw new Error(`${label} must contain ${length} bytes`);
  }
  for (const byte of raw) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`${label} must contain byte values`);
    }
  }
  return new Uint8Array(raw);
}

function sendSignerError(res: Response, error: unknown): void {
  const response = readSignerErrorResponse(error);
  res.status(response.statusCode).json({
    error: response.code,
    message: response.message
  });
}

function readSignerErrorResponse(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
} {
  if (error instanceof SignerHttpError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message
    };
  }
  return {
    statusCode: 500,
    code: "internal_server_error",
    message: error instanceof Error ? error.message : "unknown error"
  };
}

class SignerHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
