import path from "node:path";

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4021),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SPLITX402_PAYMENT_MODE: z.enum(["mock", "x402"]).default("mock"),
  SPLITX402_NETWORK: z.custom<`${string}:${string}`>(
    (value) => typeof value === "string" && value.includes(":"),
    "network must be a CAIP-2 style value such as eip155:84532",
  ).default("eip155:84532"),
  SPLITX402_ASSET: z.string().min(1).default("USDC"),
  SPLITX402_PRICE_USD: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "price must be a positive decimal string")
    .default("0.001"),
  SPLITX402_PAY_TO: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "payTo must be an EVM address")
    .default("0x0000000000000000000000000000000000000000"),
  SPLITX402_FACILITATOR_URL: z.string().url().default("https://x402.org/facilitator"),
  SPLITX402_SYNC_FACILITATOR: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default("true"),
  SPLITX402_RESOURCE_BASE_URL: z.string().url().default("http://localhost:4021"),
  SPLITX402_DATA_DIR: z.string().min(1).default(".data"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(overrides: NodeJS.ProcessEnv = process.env) {
  const env = envSchema.parse(overrides);

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    paymentMode: env.SPLITX402_PAYMENT_MODE,
    network: env.SPLITX402_NETWORK,
    asset: env.SPLITX402_ASSET,
    priceUsd: env.SPLITX402_PRICE_USD,
    payTo: env.SPLITX402_PAY_TO,
    facilitatorUrl: env.SPLITX402_FACILITATOR_URL,
    syncFacilitator: env.SPLITX402_SYNC_FACILITATOR,
    resourceBaseUrl: env.SPLITX402_RESOURCE_BASE_URL.replace(/\/$/, ""),
    dataDir: path.resolve(env.SPLITX402_DATA_DIR),
  };
}
