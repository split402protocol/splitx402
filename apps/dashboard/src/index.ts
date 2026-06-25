import "dotenv/config";

import { createDashboardApp, readDashboardConfig } from "./app.js";

const config = readDashboardConfig();
const { app } = createDashboardApp({ config });

app.listen(config.port, () => {
  console.log(`Split402 dashboard listening on http://localhost:${config.port}`);
  console.log(`Split402 dashboard control plane: ${config.controlPlaneUrl}`);
});
