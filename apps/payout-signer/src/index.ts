import "./env.js";

import {
  createPayoutSignerApp,
  readPayoutSignerConfigFromEnv
} from "./app.js";

const config = readPayoutSignerConfigFromEnv();
const app = createPayoutSignerApp(config);

app.listen(config.port, () => {
  console.log(`Split402 payout signer listening on port ${config.port}`);
  console.log(`Split402 payout signer reference: ${config.signerReference}`);
  console.log(`Split402 payout signer network: ${config.network}`);
});
