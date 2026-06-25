import { fileURLToPath } from "node:url";

export * from "./app.js";

import { createDemoMerchantApp, readDemoMerchantPort } from "./app.js";

if (isMainModule()) {
  const { app, config, servicePublicKey, merchantPayTo } = createDemoMerchantApp();
  const port = readDemoMerchantPort();

  app.listen(port, () => {
    console.log(`Split402 demo merchant listening on ${config.merchantOrigin}`);
    console.log(`Split402 service public key: ${servicePublicKey}`);
    console.log(`x402 Devnet payTo wallet: ${merchantPayTo}`);
    console.log(`x402 Devnet asset: ${config.paymentAsset}`);
  });
}

function isMainModule(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}
