import { hashProtocolObject } from "./canonical.js";

export interface Split402OperationObjectV1 {
  version: "split402-operation-v1";
  merchantId: string;
  operationId: string;
  method: string;
  pathTemplate: string;
  pathParams: Record<string, unknown>;
  query: Record<string, unknown>;
  body: unknown;
  paymentId: string;
  offerNonce: string;
}

export interface CalculateOperationDigestInput {
  merchantId: string;
  operationId: string;
  method: string;
  pathTemplate: string;
  pathParams?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  paymentId: string;
  offerNonce: string;
}

export function buildOperationObject(
  input: CalculateOperationDigestInput
): Split402OperationObjectV1 {
  return {
    version: "split402-operation-v1",
    merchantId: input.merchantId,
    operationId: input.operationId,
    method: input.method.toUpperCase(),
    pathTemplate: input.pathTemplate,
    pathParams: input.pathParams ?? {},
    query: input.query ?? {},
    body: input.body ?? null,
    paymentId: input.paymentId,
    offerNonce: input.offerNonce
  };
}

export function calculateOperationDigest(
  input: CalculateOperationDigestInput
): `sha256:${string}` {
  return hashProtocolObject(buildOperationObject(input));
}

