import { loadConfig } from "./config.js";
import { createApp } from "./server.js";

const config = loadConfig();
const { app, logger } = createApp(config);

app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      paymentMode: config.paymentMode,
      network: config.network,
      facilitatorUrl: config.facilitatorUrl,
    },
    "SplitX402 service listening",
  );
});

