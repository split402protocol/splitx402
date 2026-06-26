import { fileURLToPath } from "node:url";

import { createControlPlaneRuntimeFromEnv } from "./index.js";

export function readControlPlaneServerPort(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = env.PORT ?? env.SPLIT402_CONTROL_PLANE_PORT ?? "4021";
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error("PORT must be a positive integer");
  }
  return Number.parseInt(value, 10);
}

if (isMainModule()) {
  const runtime = createControlPlaneRuntimeFromEnv();
  const port = readControlPlaneServerPort();
  const server = runtime.app.listen(port, () => {
    console.log(`Split402 control plane listening on http://localhost:${port}`);
    console.log(`Split402 control plane auth policy: ${runtime.authPolicy}`);
  });

  const shutdown = (): void => {
    server.close(() => {
      runtime
        .close()
        .then(() => {
          process.exit(0);
        })
        .catch((error: unknown) => {
          console.error(error);
          process.exit(1);
        });
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function isMainModule(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}
