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
  extends Omit<PayoutSignerConfig, "authKeys"> {
  authKeys: PayoutSignerAuthKey[];
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
  const signerPromise = createSigner(normalizedConfig);

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

  app.post("/v1/solana/payouts/sign", async (req, res) => {
    try {
      const rawBody = JSON.stringify(req.body);
      assertRequestSignature(req, rawBody, normalizedConfig.authKeys ?? []);
      const request = readRemotePayoutSignRequest(req.body);
      assertRemotePayoutSignRequest(request, normalizedConfig);
      const signer = await signerPromise;
      const transactionBytes = Buffer.from(request.transactionBase64, "base64");
      const transaction = getTransactionDecoder().decode(transactionBytes);
      const signed = await signTransaction([signer.keyPair], transaction);
      res.json({
        transactionIndex: request.transactionIndex,
        signedTransactionBase64: getBase64EncodedWireTransaction(signed),
        expectedSignature: getSignatureFromTransaction(signed)
      });
    } catch (error) {
      sendSignerError(res, error);
    }
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return app;
}

export function readPayoutSignerConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): PayoutSignerConfig {
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
      : { secretKeyJson: env.SPLIT402_PAYOUT_SIGNER_SERVICE_SECRET_KEY_JSON })
  });
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
      : { secretKeyJson: config.secretKeyJson })
  };
}

async function createSigner(config: PayoutSignerConfig) {
  const keyMaterial = readSignerKeyMaterial(config);
  if (keyMaterial.kind === "secret") {
    return createKeyPairSignerFromBytes(keyMaterial.bytes, false);
  }
  return createKeyPairSignerFromPrivateKeyBytes(keyMaterial.bytes, false);
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
  authKeys: readonly PayoutSignerAuthKey[]
): void {
  const timestamp = readHeader(req, "x-split402-signature-timestamp");
  const signature = readHeader(req, "x-split402-signature");
  const authKey = selectAuthKey(req, authKeys);
  const expected = createRequestSignature({
    timestamp,
    body,
    sharedSecret: authKey.sharedSecret
  });
  if (!safeEqual(signature, expected)) {
    throw new SignerHttpError(401, "unauthorized", "invalid request signature");
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
  if (error instanceof SignerHttpError) {
    res.status(error.statusCode).json({
      error: error.code,
      message: error.message
    });
    return;
  }
  res.status(500).json({
    error: "internal_server_error",
    message: error instanceof Error ? error.message : "unknown error"
  });
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
