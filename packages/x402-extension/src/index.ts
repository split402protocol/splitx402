import {
  calculateCommission,
  calculateOperationDigest,
  type CalculateOperationDigestInput,
  createPrefixedId,
  deriveEd25519PublicKey,
  hashProtocolObject,
  parseAtomicAmount,
  serializeAtomicAmount,
  Split402OfferV1Schema,
  ReferralClaimV1Schema,
  signEd25519Message,
  verifyReferralClaimObject,
  verifySplit402OfferObject,
  buildOfferSigningBytes,
  buildReceiptSigningBytes,
  type ReferralClaimV1,
  type Split402OfferV1,
  type Split402ReceiptV1
} from "@split402/protocol";
import type { ClientExtension } from "@x402/core/client";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  ResourceServerExtension,
  SettleResponse,
  SettleResultContext,
  VerifyContext
} from "@x402/core/types";

export const SPLIT402_EXTENSION_KEY = "split402";

export interface Split402RouteDeclaration {
  campaignId: string;
  operationId: string;
}

export interface Split402CampaignConfig {
  campaignId: string;
  campaignVersion: number;
  campaignTermsHash: `sha256:${string}`;
  commissionBps: number;
  attributionRequired: boolean;
  allowSelfReferral: boolean;
}

export interface Split402ServiceSigningKey {
  kid: string;
  privateSeed: Uint8Array;
}

export interface Split402ServiceKeyProvider {
  current(): Split402ServiceSigningKey;
  resolvePublicKey(kid: string): string | undefined;
}

export interface Split402ServerExtensionOptions {
  merchantId: string;
  merchantOrigin: string;
  servicePrivateSeed?: Uint8Array;
  serviceKid?: string;
  serviceKeyProvider?: Split402ServiceKeyProvider;
  resolveCampaign: (declaration: Split402RouteDeclaration) => Split402CampaignConfig;
  receiptSink?: (receipt: Split402ReceiptV1) => void | Promise<void>;
  now?: () => Date;
}

export interface Split402ClientExtensionOptions {
  referralClaim?: ReferralClaimV1;
  body?: unknown;
  pathTemplate?: string;
  pathParams?: Record<string, unknown>;
  query?: Record<string, unknown>;
  paymentIdFactory?: () => string;
}

export interface ValidatedSplit402Attribution {
  offer: Split402OfferV1;
  paymentId: string;
  requestDigest: `sha256:${string}`;
  referralClaim?: ReferralClaimV1;
  claimStatus: "valid" | "missing" | "invalid";
  claimErrors: string[];
}

export function declareSplit402(
  declaration: Split402RouteDeclaration
): Record<typeof SPLIT402_EXTENSION_KEY, Split402RouteDeclaration> {
  return { [SPLIT402_EXTENSION_KEY]: declaration };
}

export function createSplit402ClientExtension(
  options: Split402ClientExtensionOptions = {}
): ClientExtension {
  return {
    key: SPLIT402_EXTENSION_KEY,
    enrichPaymentPayload: (
      paymentPayload: PaymentPayload,
      paymentRequired: PaymentRequired
    ) => {
      const info = extractAdvertisedInfo(paymentRequired.extensions?.[SPLIT402_EXTENSION_KEY]);
      const offer = parseAdvertisedOffer(info);
      const paymentId = options.paymentIdFactory?.() ?? createPrefixedId("pay");
      const digestInput: CalculateOperationDigestInput = {
        merchantId: offer.merchantId,
        operationId: offer.operationId,
        method: inferMethod(paymentPayload),
        pathTemplate: options.pathTemplate ?? inferPath(paymentRequired),
        paymentId,
        offerNonce: offer.offerNonce
      };
      if (options.pathParams !== undefined) {
        digestInput.pathParams = options.pathParams;
      }
      if (options.query !== undefined) {
        digestInput.query = options.query;
      }
      if (options.body !== undefined) {
        digestInput.body = options.body;
      }
      const requestDigest = calculateOperationDigest(digestInput);

      const extensionInfo: Record<string, unknown> = {
        ...offer,
        paymentId,
        requestDigest
      };
      if (options.referralClaim !== undefined) {
        extensionInfo.referralClaim = options.referralClaim;
      }

      return Promise.resolve({
        ...paymentPayload,
        extensions: {
          ...paymentPayload.extensions,
          [SPLIT402_EXTENSION_KEY]: {
            info: extensionInfo
          }
        }
      });
    }
  };
}

export function createSplit402ResourceServerExtension(
  options: Split402ServerExtensionOptions
): ResourceServerExtension {
  const validatedByPaymentId = new Map<string, ValidatedSplit402Attribution>();
  const serviceKeyProvider = createServiceKeyProvider(options);

  return {
    key: SPLIT402_EXTENSION_KEY,
    dynamicInfoFields: ["offerNonce", "issuedAt", "validUntil", "signature"],
    enrichPaymentRequiredResponse: (declaration, context) => {
      const route = parseDeclaration(declaration);
      const requirement = firstRequirement(context.requirements);
      const campaign = options.resolveCampaign(route);
      const serviceKey = serviceKeyProvider.current();
      const offer = signOffer(
        buildOffer({
          campaign,
          merchantId: options.merchantId,
          merchantOrigin: options.merchantOrigin,
          operationId: route.operationId,
          requirement,
          kid: serviceKey.kid,
          now: options.now?.() ?? new Date()
        }),
        serviceKey.privateSeed
      );

      return Promise.resolve({ info: offer });
    },
    enrichSettlementResponse: async (declaration, context) => {
      const attribution = getValidatedAttribution(context, validatedByPaymentId);
      if (!context.result.success || attribution === undefined) {
        return {};
      }
      const route = parseDeclarationOrOffer(declaration, attribution.offer);
      const serviceKey = serviceKeyProvider.current();

      const receipt = signReceipt(
        buildReceipt({
          attribution,
          campaign: options.resolveCampaign(route),
          merchantId: options.merchantId,
          merchantOrigin: options.merchantOrigin,
          requirement: context.requirements,
          settlement: context.result,
          kid: serviceKey.kid,
          now: options.now?.() ?? new Date()
        }),
        serviceKey.privateSeed
      );
      await options.receiptSink?.(receipt);

      return { receipt };
    },
    hooks: {
      onBeforeVerify: (_declaration, context) => {
        const validation = validateAttributionPayload(
          context,
          options.merchantOrigin,
          serviceKeyProvider,
          options.now?.() ?? new Date()
        );
        if (!validation.ok) {
          return Promise.resolve({
            abort: true,
            reason: "split402_invalid_attribution",
            message: validation.errors.join("; ")
          });
        }

        const attribution = validation.attribution;
        if (
          attribution.claimStatus === "invalid" &&
          attribution.offer.attributionRequired
        ) {
          return Promise.resolve({
            abort: true,
            reason: "split402_invalid_referral_claim",
            message: attribution.claimErrors.join("; ")
          });
        }

        validatedByPaymentId.set(attribution.paymentId, attribution);
        return Promise.resolve();
      }
    }
  };
}

export function createStaticSplit402ServiceKeyProvider(
  key: Split402ServiceSigningKey
): Split402ServiceKeyProvider {
  const publicKey = deriveEd25519PublicKey(key.privateSeed);
  return {
    current: () => key,
    resolvePublicKey: (kid) => (kid === key.kid ? publicKey : undefined)
  };
}

export function buildReceipt(input: {
  attribution: ValidatedSplit402Attribution;
  campaign: Split402CampaignConfig;
  merchantId: string;
  merchantOrigin: string;
  requirement: PaymentRequirements;
  settlement: Pick<SettleResponse, "payer" | "transaction" | "network" | "amount">;
  kid: string;
  now: Date;
}): Omit<Split402ReceiptV1, "signature"> {
  const offer = input.attribution.offer;
  const requiredAmount = parseAtomicAmount(offer.requiredAmountAtomic);
  const hasValidClaim =
    input.attribution.claimStatus === "valid" &&
    input.attribution.referralClaim !== undefined;
  const commissionBps = hasValidClaim ? offer.commissionBps : 0;
  const commission = calculateCommission(requiredAmount, BigInt(commissionBps));
  const timestamp = toRfc3339Utc(input.now);

  const receipt: Omit<Split402ReceiptV1, "signature"> = {
    protocolVersion: "0.1",
    receiptId: createPrefixedId("rcp"),
    merchantId: input.merchantId,
    merchantOrigin: input.merchantOrigin,
    operationId: offer.operationId,
    requestDigest: input.attribution.requestDigest,
    campaignId: offer.campaignId,
    campaignVersion: offer.campaignVersion,
    campaignTermsHash: input.campaign.campaignTermsHash,
    paymentId: input.attribution.paymentId,
    network: input.settlement.network,
    asset: offer.asset,
    payerWallet: requiredString(input.settlement.payer, "settlement payer"),
    payToWallet: offer.payToWallet,
    requiredAmountAtomic: offer.requiredAmountAtomic,
    settledAmountAtomic: input.settlement.amount ?? offer.requiredAmountAtomic,
    settlementTxSignature: requiredString(
      input.settlement.transaction,
      "settlement transaction"
    ),
    commissionBps,
    commissionBaseAtomic: offer.requiredAmountAtomic,
    commissionAmountAtomic: serializeAtomicAmount(commission.commission),
    protocolFeeAtomic: serializeAtomicAmount(commission.protocolFee),
    referrerCreditAtomic: serializeAtomicAmount(commission.referrerCredit),
    settlementMode: "accrual",
    offerNonce: offer.offerNonce,
    settledAt: timestamp,
    issuedAt: timestamp,
    recordingStatus: "accepted",
    kid: input.kid
  };

  const claim = input.attribution.referralClaim;
  if (hasValidClaim && claim !== undefined) {
    receipt.routeId = claim.routeId;
    receipt.referralClaimHash = hashProtocolObject(claim);
    receipt.referrerWallet = claim.referrerWallet;
    receipt.payoutWallet = claim.payoutWallet;
  }

  return receipt;
}

function buildOffer(input: {
  campaign: Split402CampaignConfig;
  merchantId: string;
  merchantOrigin: string;
  operationId: string;
  requirement: PaymentRequirements;
  kid: string;
  now: Date;
}): Omit<Split402OfferV1, "signature"> {
  const issuedAt = input.now;
  const validUntil = new Date(issuedAt.getTime() + 90_000);

  return {
    protocolVersion: "0.1",
    campaignId: input.campaign.campaignId,
    campaignVersion: input.campaign.campaignVersion,
    campaignTermsHash: input.campaign.campaignTermsHash,
    merchantId: input.merchantId,
    resourceOrigin: input.merchantOrigin,
    operationId: input.operationId,
    network: input.requirement.network,
    asset: input.requirement.asset,
    requiredAmountAtomic: input.requirement.amount,
    payToWallet: input.requirement.payTo,
    commissionBps: input.campaign.commissionBps,
    commissionBase: "required_amount",
    settlementMode: "accrual",
    attributionRequired: input.campaign.attributionRequired,
    allowSelfReferral: input.campaign.allowSelfReferral,
    offerNonce: createPrefixedId("ofn"),
    issuedAt: toRfc3339Utc(issuedAt),
    validUntil: toRfc3339Utc(validUntil),
    kid: input.kid
  };
}

function signOffer(
  offer: Omit<Split402OfferV1, "signature">,
  privateSeed: Uint8Array
): Split402OfferV1 {
  const signature = signEd25519Message(buildOfferSigningBytes(offer), privateSeed);
  return { ...offer, signature: signature.signature };
}

function signReceipt(
  receipt: Omit<Split402ReceiptV1, "signature">,
  privateSeed: Uint8Array
): Split402ReceiptV1 {
  const signature = signEd25519Message(buildReceiptSigningBytes(receipt), privateSeed);
  return { ...receipt, signature: signature.signature };
}

function createServiceKeyProvider(
  options: Split402ServerExtensionOptions
): Split402ServiceKeyProvider {
  if (options.serviceKeyProvider !== undefined) {
    return options.serviceKeyProvider;
  }
  if (options.servicePrivateSeed === undefined || options.serviceKid === undefined) {
    throw new Error(
      "Split402 resource server extension requires serviceKeyProvider or servicePrivateSeed with serviceKid"
    );
  }
  return createStaticSplit402ServiceKeyProvider({
    kid: options.serviceKid,
    privateSeed: options.servicePrivateSeed
  });
}

function validateAttributionPayload(
  context: VerifyContext,
  merchantOrigin: string,
  serviceKeyProvider: Split402ServiceKeyProvider,
  now: Date
):
  | { ok: true; attribution: ValidatedSplit402Attribution }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const info = extractAdvertisedInfo(context.paymentPayload.extensions?.[SPLIT402_EXTENSION_KEY]);
  const offerParse = Split402OfferV1Schema.safeParse(pickOfferFields(info));
  if (!offerParse.success) {
    return {
      ok: false,
      errors: offerParse.error.issues.map((issue) => `offer ${issue.path.join(".")}: ${issue.message}`)
    };
  }

  const offer = offerParse.data;
  const merchantPublicKey = serviceKeyProvider.resolvePublicKey(offer.kid);
  if (merchantPublicKey === undefined) {
    errors.push(`unknown merchant service key kid: ${offer.kid}`);
  } else {
    const signatureCheck = verifySplit402OfferObject(offer, merchantPublicKey);
    errors.push(...signatureCheck.errors);
  }
  errors.push(...validateOfferAgainstRequirements(offer, context.requirements));
  errors.push(...validateOfferTiming(offer, now));
  if (offer.resourceOrigin !== merchantOrigin) {
    errors.push("offer resourceOrigin does not match merchant origin");
  }

  const paymentId = getString(info.paymentId);
  if (paymentId === undefined) {
    errors.push("missing paymentId");
  }
  const requestDigest = getString(info.requestDigest);
  if (requestDigest === undefined || !requestDigest.startsWith("sha256:")) {
    errors.push("missing requestDigest");
  }
  if (paymentId !== undefined && requestDigest !== undefined) {
    const expectedDigest = calculateServerRequestDigest(context, offer, paymentId);
    if (expectedDigest !== undefined && expectedDigest !== requestDigest) {
      errors.push("requestDigest does not match the HTTP request context");
    }
  }

  if (errors.length > 0 || paymentId === undefined || requestDigest === undefined) {
    return { ok: false, errors };
  }

  const claim = parseReferralClaim(info.referralClaim, offer, merchantOrigin, now);
  const attribution: ValidatedSplit402Attribution = {
    offer,
    paymentId,
    requestDigest: requestDigest as `sha256:${string}`,
    claimStatus: claim.status,
    claimErrors: claim.errors
  };
  if (claim.claim !== undefined) {
    attribution.referralClaim = claim.claim;
  }

  return { ok: true, attribution };
}

function parseReferralClaim(
  value: unknown,
  offer: Split402OfferV1,
  merchantOrigin: string,
  now: Date
):
  | { status: "missing"; errors: []; claim?: undefined }
  | { status: "valid"; errors: []; claim: ReferralClaimV1 }
  | { status: "invalid"; errors: string[]; claim?: undefined } {
  if (value === undefined) {
    return { status: "missing", errors: [] };
  }

  const parsed = ReferralClaimV1Schema.safeParse(value);
  if (!parsed.success) {
    return {
      status: "invalid",
      errors: parsed.error.issues.map((issue) => `claim ${issue.path.join(".")}: ${issue.message}`)
    };
  }

  const verification = verifyReferralClaimObject(parsed.data);
  if (!verification.ok) {
    return { status: "invalid", errors: verification.errors };
  }
  const semanticErrors = validateClaimAgainstOffer(parsed.data, offer, merchantOrigin, now);
  if (semanticErrors.length > 0) {
    return { status: "invalid", errors: semanticErrors };
  }

  return { status: "valid", errors: [], claim: parsed.data };
}

function validateClaimAgainstOffer(
  claim: ReferralClaimV1,
  offer: Split402OfferV1,
  merchantOrigin: string,
  now: Date
): string[] {
  const errors: string[] = [];
  if (claim.campaignId !== offer.campaignId) {
    errors.push("claim campaignId does not match offer");
  }
  if (claim.campaignVersionMin > offer.campaignVersion) {
    errors.push("claim requires a newer campaign version");
  }
  if (claim.resourceOrigin !== merchantOrigin) {
    errors.push("claim resourceOrigin does not match merchant origin");
  }
  const coversOperation = claim.operationIds.some(
    (operationId) => operationId === "*" || operationId === offer.operationId
  );
  if (!coversOperation) {
    errors.push("claim does not cover offer operationId");
  }
  if (Date.parse(claim.expiresAt) < now.getTime()) {
    errors.push("claim is expired");
  }
  if (!offer.allowSelfReferral && claim.referrerWallet === claim.payoutWallet) {
    errors.push("self referral is not allowed for this offer");
  }
  return errors;
}

function validateOfferAgainstRequirements(
  offer: Split402OfferV1,
  requirement: PaymentRequirements
): string[] {
  const errors: string[] = [];
  if (offer.network !== requirement.network) {
    errors.push("offer network does not match x402 requirement");
  }
  if (offer.asset !== requirement.asset) {
    errors.push("offer asset does not match x402 requirement");
  }
  if (offer.requiredAmountAtomic !== requirement.amount) {
    errors.push("offer amount does not match x402 requirement");
  }
  if (offer.payToWallet !== requirement.payTo) {
    errors.push("offer payToWallet does not match x402 requirement");
  }
  return errors;
}

function validateOfferTiming(offer: Split402OfferV1, now: Date): string[] {
  const validUntil = Date.parse(offer.validUntil);
  if (Number.isNaN(validUntil)) {
    return ["offer validUntil is invalid"];
  }
  return validUntil < now.getTime() ? ["offer is expired"] : [];
}

function calculateServerRequestDigest(
  context: VerifyContext,
  offer: Split402OfferV1,
  paymentId: string
): `sha256:${string}` | undefined {
  const http = asHttpTransportContext(context.transportContext);
  if (http === undefined) {
    return undefined;
  }

  return calculateOperationDigest({
    merchantId: offer.merchantId,
    operationId: offer.operationId,
    method: http.request.method,
    pathTemplate: http.request.routePattern ?? http.request.path,
    query: http.request.adapter.getQueryParams(),
    body: http.request.adapter.getBody(),
    paymentId,
    offerNonce: offer.offerNonce
  });
}

function getValidatedAttribution(
  context: SettleResultContext,
  validated: Map<string, ValidatedSplit402Attribution>
): ValidatedSplit402Attribution | undefined {
  const info = extractAdvertisedInfo(context.paymentPayload.extensions?.[SPLIT402_EXTENSION_KEY]);
  const paymentId = getString(info.paymentId);
  return paymentId === undefined ? undefined : validated.get(paymentId);
}

function firstRequirement(requirements: readonly PaymentRequirements[]): PaymentRequirements {
  const requirement = requirements[0];
  if (requirement === undefined) {
    throw new Error("Split402 requires at least one x402 payment requirement");
  }
  return requirement;
}

function parseDeclaration(value: unknown): Split402RouteDeclaration {
  const record = asRecord(value);
  const campaignId = getString(record.campaignId);
  const operationId = getString(record.operationId);
  if (campaignId === undefined || operationId === undefined) {
    throw new Error("Split402 route declaration requires campaignId and operationId");
  }
  return { campaignId, operationId };
}

function parseDeclarationOrOffer(
  value: unknown,
  offer: Split402OfferV1
): Split402RouteDeclaration {
  const record = asOptionalRecord(value);
  const campaignId = getString(record?.campaignId) ?? offer.campaignId;
  const operationId = getString(record?.operationId) ?? offer.operationId;
  return { campaignId, operationId };
}

function extractAdvertisedInfo(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const nested = asOptionalRecord(record.info);
  return nested ?? record;
}

function parseAdvertisedOffer(info: Record<string, unknown>): Split402OfferV1 {
  return Split402OfferV1Schema.parse(pickOfferFields(info));
}

function pickOfferFields(info: Record<string, unknown>): Record<string, unknown> {
  return {
    protocolVersion: info.protocolVersion,
    campaignId: info.campaignId,
    campaignVersion: info.campaignVersion,
    campaignTermsHash: info.campaignTermsHash,
    merchantId: info.merchantId,
    resourceOrigin: info.resourceOrigin,
    operationId: info.operationId,
    network: info.network,
    asset: info.asset,
    requiredAmountAtomic: info.requiredAmountAtomic,
    payToWallet: info.payToWallet,
    commissionBps: info.commissionBps,
    commissionBase: info.commissionBase,
    settlementMode: info.settlementMode,
    attributionRequired: info.attributionRequired,
    allowSelfReferral: info.allowSelfReferral,
    offerNonce: info.offerNonce,
    issuedAt: info.issuedAt,
    validUntil: info.validUntil,
    kid: info.kid,
    signature: info.signature
  };
}

function inferMethod(paymentPayload: PaymentPayload): string {
  const method = getString(asOptionalRecord(paymentPayload.resource)?.method);
  return method ?? "POST";
}

function inferPath(paymentRequired: PaymentRequired): string {
  const resourceUrl = getString(paymentRequired.resource.url);
  if (resourceUrl === undefined) {
    return "/";
  }
  try {
    return new URL(resourceUrl).pathname;
  } catch {
    return resourceUrl;
  }
}

function toRfc3339Utc(value: Date): `${string}Z` {
  return value.toISOString().replace(/\.\d{3}Z$/u, "Z") as `${string}Z`;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing ${label}`);
  }
  return value;
}

function getString(value: unknown): string | undefined {
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

function asHttpTransportContext(value: unknown):
  | {
      request: {
        method: string;
        path: string;
        routePattern?: string;
        adapter: {
          getQueryParams(): Record<string, string | string[]>;
          getBody(): unknown;
        };
      };
    }
  | undefined {
  const context = asOptionalRecord(value);
  const request = asOptionalRecord(context?.request);
  const adapter = asOptionalRecord(request?.adapter);
  const getQueryParams = adapter?.getQueryParams;
  const getBody = adapter?.getBody;
  if (
    typeof request?.method !== "string" ||
    typeof request.path !== "string" ||
    typeof getQueryParams !== "function" ||
    typeof getBody !== "function"
  ) {
    return undefined;
  }

  const routePattern =
    typeof request.routePattern === "string" ? request.routePattern : undefined;
  return {
    request: {
      method: request.method,
      path: request.path,
      ...(routePattern === undefined ? {} : { routePattern }),
      adapter: {
        getQueryParams: () =>
          getQueryParams.call(adapter) as Record<string, string | string[]>,
        getBody: () => getBody.call(adapter) as unknown
      }
    }
  };
}
