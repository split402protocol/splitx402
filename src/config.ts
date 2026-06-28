import path from "node:path";

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4021),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SPLIT402_PAYMENT_MODE: z.enum(["mock", "x402"]).default("mock"),
  SPLIT402_NETWORK: z.custom<`${string}:${string}`>(
    (value) => typeof value === "string" && value.includes(":"),
    "network must be a CAIP-2 style value such as solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  ).default("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"),
  SPLIT402_ASSET: z.string().min(1).default("usdc-devnet"),
  SPLIT402_PRICE_USD: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "price must be a positive decimal string")
    .default("0.001"),
  SPLIT402_PAY_TO: z
    .string()
    .regex(
      /^(?:[1-9A-HJ-NP-Za-km-z]{32,44}|0x[a-fA-F0-9]{40})$/,
      "payTo must be a Solana public key or an EVM address for legacy x402 mode",
    )
    .default("11111111111111111111111111111111"),
  SPLIT402_FACILITATOR_URL: z.string().url().default("https://x402.org/facilitator"),
  SPLIT402_SYNC_FACILITATOR: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default("true"),
  SPLIT402_RESOURCE_BASE_URL: z.string().url().default("http://localhost:4021"),
  SPLIT402_DATA_DIR: z.string().min(1).default(".data"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(overrides: NodeJS.ProcessEnv = process.env) {
  const env = envSchema.parse(overrides);

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    paymentMode: env.SPLIT402_PAYMENT_MODE,
    network: env.SPLIT402_NETWORK,
    asset: env.SPLIT402_ASSET,
    priceUsd: env.SPLIT402_PRICE_USD,
    payTo: env.SPLIT402_PAY_TO,
    facilitatorUrl: env.SPLIT402_FACILITATOR_URL,
    syncFacilitator: env.SPLIT402_SYNC_FACILITATOR,
    resourceBaseUrl: env.SPLIT402_RESOURCE_BASE_URL.replace(/\/$/, ""),
    dataDir: path.resolve(env.SPLIT402_DATA_DIR),
  };
}
