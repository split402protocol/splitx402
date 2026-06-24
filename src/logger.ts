import { pino } from "pino";

import type { AppConfig } from "./config.js";

export function createLogger(config: Pick<AppConfig, "logLevel" | "nodeEnv">) {
  return pino({
    level: config.logLevel,
    base: config.nodeEnv === "test" ? undefined : { service: "split402" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
