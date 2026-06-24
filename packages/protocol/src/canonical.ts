import { createHash } from "node:crypto";

import { bytesToHex, utf8Bytes } from "./encoding.js";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export function canonicalizeProtocolObject(value: unknown): string {
  return serializeJson(value);
}

export function canonicalizeToBytes(value: unknown): Uint8Array {
  return utf8Bytes(canonicalizeProtocolObject(value));
}

export function sha256Bytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${bytesToHex(createHash("sha256").update(bytes).digest())}`;
}

export function hashProtocolObject(value: unknown): `sha256:${string}` {
  return sha256Bytes(canonicalizeToBytes(value));
}

function serializeJson(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return serializeNumber(value);
  }
  if (typeof value === "bigint") {
    throw new Error("bigint cannot be canonicalized as JSON");
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return serializeObject(value as Record<string, unknown>);
  }

  throw new Error(`unsupported JSON value: ${typeof value}`);
}

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("non-finite number cannot be canonicalized");
  }

  if (Object.is(value, -0)) {
    return "0";
  }

  return JSON.stringify(value);
}

function serializeObject(value: Record<string, unknown>): string {
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error("only plain objects can be canonicalized");
  }

  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${serializeJson(item)}`)
    .join(",")}}`;
}

export type { JsonValue };
