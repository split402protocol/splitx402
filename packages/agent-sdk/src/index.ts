import { randomBytes } from "node:crypto";

import axios, { type AxiosInstance, type AxiosResponse } from "axios";
import {
  decodePaymentResponseHeader,
  wrapAxiosWithPayment,
  x402Client
} from "@x402/axios";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import {
  buildReferralClaimSigningBytes,
  calculateOperationDigest,
  deriveEd25519PublicKey,
  hashProtocolObject,
  signEd25519Message,
  verifySplit402Offer,
  verifySplit402Receipt,
  Split402OfferV1Schema,
  Split402ReceiptV1Schema,
  type ReferralClaimV1,
  type Split402OfferV1,
  type Split402ReceiptV1,
  base58Decode
} from "@split402/protocol";
import { createSplit402ClientExtension } from "@split402/x402-extension";
import {
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  type KeyPairSigner
} from "@solana/kit";

export const SOLANA_DEVNET =
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export interface Split402AgentClientOptions {
  merchantOrigin: string;
  merchantPublicKey?: string;
  signer?: KeyPairSigner;
  network?: `${string}:${string}`;
  axios?: AxiosInstance;
}

export interface CreateReferralClaimInput {
  privateSeed: Uint8Array;
  routeId: string;
  campaignId: string;
  campaignVersionMin: number;
  payoutWallet: string;
  resourceOrigin: string;
  operationIds: ["*"] | [string, ...string[]];
  expiresAt: `${string}Z`;
  issuedAt?: `${string}Z`;
  nonce?: string;
  metadata?: unknown;
  metadataHash?: `sha256:${string}`;
}

export interface InspectOfferInput {
  path: string;
  method?: Split402HttpMethod;
  body?: unknown;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface InspectOfferResult {
  status: number;
  paymentRequired: ReturnType<typeof decodePaymentRequiredHeader>;
  offer: Split402OfferV1;
  verification:
    | { checked: false; ok: undefined; errors: [] }
    | { checked: true; ok: boolean; errors: string[] };
}

export interface PostJsonInput {
  path: string;
  body: unknown;
  referralClaim?: ReferralClaimV1;
  pathTemplate?: string;
  pathParams?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  paymentIdFactory?: () => string;
}

export interface GetJsonInput {
  path: string;
  referralClaim?: ReferralClaimV1;
  pathTemplate?: string;
  pathParams?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  paymentIdFactory?: () => string;
}

export interface PaidJsonRequestInput {
  method: Split402HttpMethod;
  path: string;
  body?: unknown;
  referralClaim?: ReferralClaimV1;
  pathTemplate?: string;
  pathParams?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  paymentIdFactory?: () => string;
}

export interface PaidJsonResult<TData = unknown> {
  data: TData;
  status: number;
  receipt?: Split402ReceiptV1;
  receiptVerification:
    | { checked: false; ok: undefined; errors: [] }
    | { checked: true; ok: boolean; errors: string[] };
  settlement?: unknown;
}

export type Split402HttpMethod = "GET" | "POST";

export class Split402AgentClient {
  readonly merchantOrigin: string;
  readonly merchantPublicKey?: string;
  readonly signer?: KeyPairSigner;
  readonly network: `${string}:${string}`;

  private readonly axios: AxiosInstance;

  constructor(options: Split402AgentClientOptions) {
    this.merchantOrigin = options.merchantOrigin.replace(/\/$/u, "");
    this.network = options.network ?? SOLANA_DEVNET;
    this.axios =
      options.axios ??
      axios.create({
        baseURL: this.merchantOrigin,
        headers: {
          Accept: "application/json"
        }
      });
    if (options.merchantPublicKey !== undefined) {
      this.merchantPublicKey = options.merchantPublicKey;
    }
    if (options.signer !== undefined) {
      this.signer = options.signer;
    }
  }

  async inspectOffer(input: InspectOfferInput): Promise<InspectOfferResult> {
    const url = new URL(input.path, this.merchantOrigin);
    for (const [key, value] of Object.entries(input.query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const headers = {
      accept: "application/json",
      ...input.headers
    };
    const response = await fetch(url.toString(), {
      method: input.method ?? "POST",
      headers:
        input.body === undefined
          ? headers
          : { ...headers, "content-type": "application/json" },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) })
    });

    const paymentRequiredHeader = response.headers.get("payment-required");
    if (response.status !== 402 || paymentRequiredHeader === null) {
      throw new Error(
        `expected x402 402 response with PAYMENT-REQUIRED header, got ${response.status}`
      );
    }

    const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
    const offer = extractSplit402Offer(paymentRequired.extensions?.split402);
    const verification = this.verifyOffer(offer);
    return {
      status: response.status,
      paymentRequired,
      offer,
      verification
    };
  }

  async postJson<TData = unknown>(input: PostJsonInput): Promise<PaidJsonResult<TData>> {
    return this.requestJson<TData>({
      ...input,
      method: "POST"
    });
  }

  async getJson<TData = unknown>(input: GetJsonInput): Promise<PaidJsonResult<TData>> {
    return this.requestJson<TData>({
      ...input,
      method: "GET"
    });
  }

  async requestJson<TData = unknown>(
    input: PaidJsonRequestInput
  ): Promise<PaidJsonResult<TData>> {
    if (this.signer === undefined) {
      throw new Error("a Solana signer is required to make a paid x402 request");
    }
    const client = new x402Client()
      .register(this.network, new ExactSvmScheme(this.signer))
      .registerExtension(
        createSplit402ClientExtension(split402ExtensionOptions(input))
      );
    const paidAxios = wrapAxiosWithPayment(this.axios, client);
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...input.headers
    };
    if (input.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const requestOptions = {
      headers,
      ...(input.query === undefined ? {} : { params: input.query })
    };
    const response: AxiosResponse<TData> =
      input.method === "GET"
        ? await paidAxios.get(input.path, requestOptions)
        : await paidAxios.post(input.path, input.body, requestOptions);
    const settlementHeader = getHeader(response.headers, "payment-response");
    const settlement =
      settlementHeader === undefined
        ? undefined
        : (decodePaymentResponseHeader(settlementHeader) as unknown);
    const receipt = extractReceipt(settlement);
    const receiptVerification = this.verifyReceipt(receipt);

    return {
      data: response.data,
      status: response.status,
      receiptVerification,
      ...(receipt === undefined ? {} : { receipt }),
      ...(settlement === undefined ? {} : { settlement })
    };
  }

  verifyOffer(
    offer: Split402OfferV1
  ):
    | { checked: false; ok: undefined; errors: [] }
    | { checked: true; ok: boolean; errors: string[] } {
    if (this.merchantPublicKey === undefined) {
      return { checked: false, ok: undefined, errors: [] };
    }
    const verification = verifySplit402Offer(offer, this.merchantPublicKey);
    return { checked: true, ok: verification.ok, errors: verification.errors };
  }

  verifyReceipt(
    receipt: Split402ReceiptV1 | undefined
  ):
    | { checked: false; ok: undefined; errors: [] }
    | { checked: true; ok: boolean; errors: string[] } {
    if (this.merchantPublicKey === undefined) {
      return { checked: false, ok: undefined, errors: [] };
    }
    if (receipt === undefined) {
      return { checked: true, ok: false, errors: ["missing Split402 receipt"] };
    }
    const verification = verifySplit402Receipt(receipt, this.merchantPublicKey);
    return { checked: true, ok: verification.ok, errors: verification.errors };
  }
}

export async function createSvmSignerFromBase58(secret: string): Promise<KeyPairSigner> {
  const bytes = base58Decode(secret);
  if (bytes.length === 32) {
    return await createKeyPairSignerFromPrivateKeyBytes(bytes);
  }
  if (bytes.length === 64) {
    return await createKeyPairSignerFromBytes(bytes);
  }
  throw new Error(
    `SVM private key must decode to 32 private-seed bytes or 64 keypair bytes; got ${bytes.length}`
  );
}

export function createReferralClaim(input: CreateReferralClaimInput): ReferralClaimV1 {
  const metadataHash =
    input.metadataHash ?? (input.metadata === undefined ? undefined : hashProtocolObject(input.metadata));
  const unsigned = {
    version: "1",
    routeId: input.routeId,
    campaignId: input.campaignId,
    campaignVersionMin: input.campaignVersionMin,
    referrerWallet: deriveEd25519PublicKey(input.privateSeed),
    payoutWallet: input.payoutWallet,
    resourceOrigin: input.resourceOrigin,
    operationIds: input.operationIds,
    issuedAt: input.issuedAt ?? toRfc3339Utc(new Date()),
    expiresAt: input.expiresAt,
    nonce: input.nonce ?? `claim-${randomBytes(16).toString("hex")}`,
    ...(metadataHash === undefined ? {} : { metadataHash })
  } satisfies Omit<ReferralClaimV1, "signature">;
  const signature = signEd25519Message(
    buildReferralClaimSigningBytes(unsigned),
    input.privateSeed
  );

  return {
    ...unsigned,
    signature: {
      type: "solana-ed25519",
      publicKey: signature.publicKey,
      value: signature.signature
    }
  };
}

export function corruptReferralClaimSignature(
  claim: ReferralClaimV1
): ReferralClaimV1 {
  const first = claim.signature.value[0] ?? "A";
  return {
    ...claim,
    signature: {
      ...claim.signature,
      value: `${first === "A" ? "B" : "A"}${claim.signature.value.slice(1)}`
    }
  };
}

export function extractReceipt(settlement: unknown): Split402ReceiptV1 | undefined {
  const split402 = asOptionalRecord(asOptionalRecord(settlement)?.extensions)?.split402;
  const parsed = Split402ReceiptV1Schema.safeParse(
    asOptionalRecord(split402)?.receipt
  );
  return parsed.success ? parsed.data : undefined;
}

export function extractSplit402Offer(value: unknown): Split402OfferV1 {
  const record = asRecord(value);
  const parsed = Split402OfferV1Schema.safeParse(record.info);
  if (!parsed.success) {
    throw new Error(
      `invalid Split402 offer in x402 response: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`
    );
  }
  return parsed.data;
}

export function operationDigestForPayment(input: {
  merchantId: string;
  operationId: string;
  method: string;
  pathTemplate: string;
  paymentId: string;
  offerNonce: string;
  body?: unknown;
  pathParams?: Record<string, unknown>;
  query?: Record<string, unknown>;
}): `sha256:${string}` {
  return calculateOperationDigest(input);
}

function split402ExtensionOptions(
  input: PaidJsonRequestInput
): Parameters<typeof createSplit402ClientExtension>[0] {
  return {
    body: input.body,
    pathTemplate: input.pathTemplate ?? input.path,
    ...(input.referralClaim === undefined ? {} : { referralClaim: input.referralClaim }),
    ...(input.pathParams === undefined ? {} : { pathParams: input.pathParams }),
    ...(input.query === undefined ? {} : { query: input.query }),
    ...(input.paymentIdFactory === undefined
      ? {}
      : { paymentIdFactory: input.paymentIdFactory })
  };
}

function getHeader(headers: unknown, name: string): string | undefined {
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
    return undefined;
  }
  const value = (headers as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  const record = asOptionalRecord(value);
  if (record === undefined) {
    throw new Error("expected object");
  }
  return record;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function toRfc3339Utc(value: Date): `${string}Z` {
  return value.toISOString().replace(/\.\d{3}Z$/u, "Z") as `${string}Z`;
}
