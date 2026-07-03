import { createHmac, timingSafeEqual } from "node:crypto";

import express, { type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";

export interface DashboardConfig {
  controlPlaneUrl: string;
  port: number;
  defaultMerchantId?: string;
  defaultReferrerWallet?: string;
  controlPlaneBearerToken?: string;
  viewerToken?: string;
  sessionCookieName: string;
  secureSessionCookie: boolean;
  sessionMaxAgeSeconds: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
}

export interface DashboardAppOptions {
  config?: Partial<DashboardConfig>;
  fetch?: DashboardFetch;
  now?: () => number;
}

export interface DashboardRuntime {
  app: express.Express;
  config: DashboardConfig;
}

export type DashboardFetch = (
  url: string,
  init?: {
    headers?: Record<string, string>;
  }
) => Promise<DashboardFetchResponse>;

export interface DashboardFetchResponse {
  status: number;
  headers: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
}

export function createDashboardApp(
  options: DashboardAppOptions = {}
): DashboardRuntime {
  const config = readDashboardConfig(options.config);
  const fetchJson = options.fetch ?? defaultFetch;
  const now = options.now ?? Date.now;
  const app = express();

  app.disable("x-powered-by");
  app.use(
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      limit: config.rateLimitMaxRequests,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: "rate_limited",
        message: "Too many dashboard requests"
      }
    })
  );
  app.use(express.json({ limit: "32kb" }));

  app.get("/", (_req, res) => {
    res.type("html").send(renderDashboardHtml(config));
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "split402-dashboard",
      controlPlaneUrl: config.controlPlaneUrl
    });
  });

  app.get("/api/session", (req, res) => {
    res.json({
      required: config.viewerToken !== undefined,
      authenticated: isDashboardViewerAuthenticated(req, config, now),
      sessionMaxAgeSeconds: config.sessionMaxAgeSeconds
    });
  });

  app.post("/api/session", (req, res) => {
    if (config.viewerToken === undefined) {
      res.json({ required: false, authenticated: true });
      return;
    }

    const token = readTokenBody(req);
    if (token === undefined || !safeEqual(token, config.viewerToken)) {
      res.status(401).json({
        error: "dashboard_auth_failed",
        message: "Dashboard viewer token is invalid"
      });
      return;
    }

    const expiresAt = setSessionCookie(res, config, now);
    res.json({ required: true, authenticated: true, expiresAt });
  });

  app.post("/api/session/logout", (_req, res) => {
    clearSessionCookie(res, config);
    res.json({ required: config.viewerToken !== undefined, authenticated: false });
  });

  app.use("/api", (req, res, next) => {
    if (isDashboardViewerAuthenticated(req, config, now)) {
      next();
      return;
    }
    res.status(401).json({
      error: "dashboard_auth_required",
      message: "Dashboard viewer session is required"
    });
  });

  app.get("/api/config", (_req, res) => {
    res.json({
      controlPlaneUrl: config.controlPlaneUrl,
      defaultMerchantId: config.defaultMerchantId,
      defaultReferrerWallet: config.defaultReferrerWallet,
      configuredBearerToken: config.controlPlaneBearerToken !== undefined,
      viewerAuthRequired: config.viewerToken !== undefined,
      sessionMaxAgeSeconds: config.sessionMaxAgeSeconds
    });
  });

  app.get("/api/merchants/:merchantId/reliability-profile", async (req, res) => {
    await proxyControlPlaneJson(
      req,
      res,
      fetchJson,
      config,
      `/v1/merchants/${encodePathSegment(req.params.merchantId)}/reliability-profile`
    );
  });

  app.get("/api/merchants/:merchantId/dashboard-summary", async (req, res) => {
    await proxyControlPlaneJson(
      req,
      res,
      fetchJson,
      config,
      `/v1/merchants/${encodePathSegment(req.params.merchantId)}/dashboard-summary`
    );
  });

  app.get("/api/merchants/:merchantId/webhook-events", async (req, res) => {
    await proxyControlPlaneJson(
      req,
      res,
      fetchJson,
      config,
      `/v1/merchants/${encodePathSegment(req.params.merchantId)}/webhook-events`,
      readAllowedQuery(req, ["status", "limit"])
    );
  });

  app.get("/api/merchants/:merchantId/payout-obligations", async (req, res) => {
    await proxyControlPlaneJson(
      req,
      res,
      fetchJson,
      config,
      `/v1/merchants/${encodePathSegment(req.params.merchantId)}/payout-obligations`,
      readAllowedQuery(req, ["asset"])
    );
  });

  app.get("/api/referrers/:referrerWallet/balances", async (req, res) => {
    await proxyControlPlaneJson(
      req,
      res,
      fetchJson,
      config,
      `/v1/referrers/${encodePathSegment(req.params.referrerWallet)}/balances`
    );
  });

  app.get("/api/referrers/:referrerWallet/payouts", async (req, res) => {
    await proxyControlPlaneJson(
      req,
      res,
      fetchJson,
      config,
      `/v1/referrers/${encodePathSegment(req.params.referrerWallet)}/payouts`,
      readAllowedQuery(req, ["limit"])
    );
  });

  app.get("/api/referrers/:referrerWallet/routes", async (req, res) => {
    await proxyControlPlaneJson(
      req,
      res,
      fetchJson,
      config,
      `/v1/referrers/${encodePathSegment(req.params.referrerWallet)}/routes`
    );
  });

  return { app, config };
}

export function readDashboardConfig(
  overrides: Partial<DashboardConfig> = {},
  env: NodeJS.ProcessEnv = process.env
): DashboardConfig {
  const controlPlaneUrl = normalizeUrl(
    overrides.controlPlaneUrl ??
      env.SPLIT402_DASHBOARD_CONTROL_PLANE_URL ??
      "http://localhost:4021"
  );
  const port =
    overrides.port ??
    readPositiveInteger(env.SPLIT402_DASHBOARD_PORT, "SPLIT402_DASHBOARD_PORT") ??
    4027;
  const defaultMerchantId =
    overrides.defaultMerchantId ?? env.SPLIT402_DASHBOARD_MERCHANT_ID;
  const defaultReferrerWallet =
    overrides.defaultReferrerWallet ?? env.SPLIT402_DASHBOARD_REFERRER_WALLET;
  const controlPlaneBearerToken =
    overrides.controlPlaneBearerToken ??
    env.SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN;
  const viewerToken =
    overrides.viewerToken ?? env.SPLIT402_DASHBOARD_VIEWER_TOKEN;
  const sessionCookieName =
    overrides.sessionCookieName ??
    env.SPLIT402_DASHBOARD_SESSION_COOKIE_NAME ??
    "split402_dashboard_session";
  const secureSessionCookie =
    overrides.secureSessionCookie ??
    readBoolean(env.SPLIT402_DASHBOARD_SESSION_COOKIE_SECURE) ??
    env.NODE_ENV === "production";
  const sessionMaxAgeSeconds =
    overrides.sessionMaxAgeSeconds ??
    readPositiveInteger(
      env.SPLIT402_DASHBOARD_SESSION_MAX_AGE_SECONDS,
      "SPLIT402_DASHBOARD_SESSION_MAX_AGE_SECONDS"
    ) ??
    28_800;
  const rateLimitWindowMs =
    overrides.rateLimitWindowMs ??
    readPositiveInteger(
      env.SPLIT402_DASHBOARD_RATE_LIMIT_WINDOW_MS,
      "SPLIT402_DASHBOARD_RATE_LIMIT_WINDOW_MS"
    ) ??
    60_000;
  const rateLimitMaxRequests =
    overrides.rateLimitMaxRequests ??
    readPositiveInteger(
      env.SPLIT402_DASHBOARD_RATE_LIMIT_MAX_REQUESTS,
      "SPLIT402_DASHBOARD_RATE_LIMIT_MAX_REQUESTS"
    ) ??
    1_000;
  return {
    controlPlaneUrl,
    port,
    ...(defaultMerchantId === undefined
      ? {}
      : {
          defaultMerchantId
        }),
    ...(defaultReferrerWallet === undefined
      ? {}
      : {
          defaultReferrerWallet
        }),
    ...(controlPlaneBearerToken === undefined
      ? {}
      : {
          controlPlaneBearerToken
        }),
    ...(viewerToken === undefined
      ? {}
      : {
          viewerToken
        }),
    sessionCookieName,
    secureSessionCookie,
    sessionMaxAgeSeconds,
    rateLimitWindowMs,
    rateLimitMaxRequests
  };
}

async function proxyControlPlaneJson(
  req: Request,
  res: Response,
  fetchJson: DashboardFetch,
  config: DashboardConfig,
  pathname: string,
  query?: URLSearchParams
): Promise<void> {
  const target = new URL(pathname, `${config.controlPlaneUrl}/`);
  if (query !== undefined) {
    target.search = query.toString();
  }
  try {
    const response = await fetchJson(target.toString(), {
      headers: buildProxyHeaders(req, config)
    });
    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "application/json";
    res.status(response.status).type(contentType).send(body);
  } catch (error) {
    res.status(502).json({
      error: "control_plane_unreachable",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function buildProxyHeaders(
  req: Request,
  config: DashboardConfig
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json"
  };
  const requestAuthorization = req.header("authorization");
  if (requestAuthorization !== undefined) {
    headers.authorization = requestAuthorization;
    return headers;
  }
  if (config.controlPlaneBearerToken !== undefined) {
    headers.authorization = config.controlPlaneBearerToken.startsWith("Bearer ")
      ? config.controlPlaneBearerToken
      : `Bearer ${config.controlPlaneBearerToken}`;
  }
  return headers;
}

function readAllowedQuery(req: Request, keys: readonly string[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = req.query[key];
    if (typeof value === "string" && value.length > 0) {
      params.set(key, value);
    }
  }
  return params;
}

function encodePathSegment(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error("path parameter is required");
  }
  return encodeURIComponent(value);
}

function normalizeUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("SPLIT402_DASHBOARD_CONTROL_PLANE_URL must be an http(s) URL");
  }
  return parsed.toString().replace(/\/$/u, "");
}

function readPositiveInteger(
  value: string | undefined,
  label: string
): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number.parseInt(value, 10);
}

function readBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error("boolean environment values must be true or false");
}

function isDashboardViewerAuthenticated(
  req: Request,
  config: DashboardConfig,
  now: () => number = Date.now
): boolean {
  if (config.viewerToken === undefined) {
    return true;
  }

  const headerToken = req.header("x-split402-dashboard-token");
  if (headerToken !== undefined && safeEqual(headerToken, config.viewerToken)) {
    return true;
  }

  const sessionHash = readCookie(req, config.sessionCookieName);
  return (
    sessionHash !== undefined &&
    verifySessionCookieValue(sessionHash, config, now)
  );
}

function readTokenBody(req: Request): string | undefined {
  const body = req.body as { token?: unknown } | undefined;
  return typeof body?.token === "string" && body.token.length > 0
    ? body.token
    : undefined;
}

function setSessionCookie(
  res: Response,
  config: DashboardConfig,
  now: () => number
): string {
  const expiresAtSeconds =
    Math.floor(now() / 1000) + config.sessionMaxAgeSeconds;
  const expiresAtDate = new Date(expiresAtSeconds * 1000);
  const expiresAt = expiresAtDate.toISOString();
  const cookieValue = createSessionCookieValue(config, expiresAtSeconds);
  const attributes = [
    `${config.sessionCookieName}=${encodeURIComponent(cookieValue)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${config.sessionMaxAgeSeconds}`,
    `Expires=${expiresAtDate.toUTCString()}`
  ];
  if (config.secureSessionCookie) {
    attributes.push("Secure");
  }
  res.setHeader("Set-Cookie", attributes.join("; "));
  return expiresAt;
}

function clearSessionCookie(res: Response, config: DashboardConfig): void {
  const attributes = [
    `${config.sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (config.secureSessionCookie) {
    attributes.push("Secure");
  }
  res.setHeader("Set-Cookie", attributes.join("; "));
}

function readCookie(req: Request, name: string): string | undefined {
  const cookieHeader = req.header("cookie");
  if (cookieHeader === undefined) {
    return undefined;
  }
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      const value = rawValue.join("=");
      return value.length === 0 ? undefined : decodeURIComponent(value);
    }
  }
  return undefined;
}

function createSessionCookieValue(
  config: DashboardConfig,
  expiresAtSeconds: number
): string {
  return `${expiresAtSeconds}.${signSessionCookie(config, expiresAtSeconds)}`;
}

function verifySessionCookieValue(
  value: string,
  config: DashboardConfig,
  now: () => number
): boolean {
  const parts = value.split(".");
  if (parts.length !== 2) {
    return false;
  }
  const [expiresAtRaw, signature] = parts;
  if (
    expiresAtRaw === undefined ||
    signature === undefined ||
    !/^[1-9][0-9]*$/u.test(expiresAtRaw)
  ) {
    return false;
  }
  const expiresAtSeconds = Number.parseInt(expiresAtRaw, 10);
  if (expiresAtSeconds <= Math.floor(now() / 1000)) {
    return false;
  }
  return safeEqual(signature, signSessionCookie(config, expiresAtSeconds));
}

function signSessionCookie(
  config: DashboardConfig,
  expiresAtSeconds: number
): string {
  return createHmac("sha256", config.viewerToken ?? "")
    .update(`${config.sessionCookieName}.${expiresAtSeconds}`)
    .digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

const defaultFetch: DashboardFetch = async (url, init) => {
  const response = await fetch(url, init);
  return {
    status: response.status,
    headers: response.headers,
    text: async () => await response.text()
  };
};

function renderDashboardHtml(config: DashboardConfig): string {
  const defaults = JSON.stringify({
    merchantId: config.defaultMerchantId ?? "",
    referrerWallet: config.defaultReferrerWallet ?? "",
    authRequired: config.viewerToken !== undefined
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Split402 Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --surface: #ffffff;
      --ink: #18202f;
      --muted: #647084;
      --line: #d9dee8;
      --accent: #0f766e;
      --accent-2: #7c3aed;
      --warn: #b45309;
      --bad: #b91c1c;
      --good: #047857;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-width: 320px;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    header {
      border-bottom: 1px solid var(--line);
      background: #101827;
      color: #f8fafc;
    }
    .shell {
      width: min(1360px, calc(100% - 32px));
      margin: 0 auto;
    }
    .topbar {
      min-height: 72px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .mark {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      background: #14b8a6;
      color: #082f49;
      font-weight: 800;
    }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 20px; line-height: 1.2; }
    .subtle { color: var(--muted); }
    header .subtle { color: #cbd5e1; }
    main {
      padding: 22px 0 36px;
    }
    .controls {
      display: grid;
      grid-template-columns: minmax(220px, 1.2fr) minmax(220px, 1.2fr) minmax(180px, 0.8fr) auto;
      gap: 12px;
      align-items: end;
      padding: 16px 0 20px;
    }
    label {
      display: grid;
      gap: 6px;
      font-size: 12px;
      font-weight: 700;
      color: #344054;
    }
    input, select, button {
      min-height: 40px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      color: var(--ink);
      font: inherit;
      letter-spacing: 0;
    }
    input, select { padding: 0 10px; min-width: 0; }
    button {
      padding: 0 14px;
      background: var(--accent);
      border-color: var(--accent);
      color: #ffffff;
      font-weight: 750;
      cursor: pointer;
      white-space: nowrap;
    }
    button:disabled { opacity: 0.6; cursor: wait; }
    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 14px;
    }
    section {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      min-width: 0;
    }
    .panel {
      padding: 16px;
      display: grid;
      gap: 14px;
    }
    .span-3 { grid-column: span 3; }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .span-8 { grid-column: span 8; }
    .span-12 { grid-column: span 12; }
    .metric {
      min-height: 112px;
      align-content: space-between;
    }
    .metric strong {
      display: block;
      font-size: 26px;
      line-height: 1.1;
      overflow-wrap: anywhere;
    }
    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    h2 { font-size: 15px; line-height: 1.2; }
    .status {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 26px;
      padding: 0 10px;
      border-radius: 999px;
      background: #eef2ff;
      color: var(--accent-2);
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }
    .status.good { background: #dcfce7; color: var(--good); }
    .status.warn { background: #fef3c7; color: var(--warn); }
    .status.bad { background: #fee2e2; color: var(--bad); }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 13px;
    }
    th, td {
      border-top: 1px solid var(--line);
      padding: 10px 8px;
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th {
      color: #475467;
      font-size: 12px;
      font-weight: 800;
      background: #f8fafc;
    }
    pre {
      margin: 0;
      min-height: 220px;
      max-height: 460px;
      overflow: auto;
      padding: 12px;
      border-radius: 6px;
      background: #111827;
      color: #e5e7eb;
      font-size: 12px;
      line-height: 1.45;
    }
    .empty {
      min-height: 96px;
      display: grid;
      place-items: center;
      border-top: 1px solid var(--line);
      color: var(--muted);
      text-align: center;
      padding: 14px;
    }
    .auth-panel {
      display: none;
      padding: 18px 0 4px;
    }
    .auth-panel.is-visible {
      display: grid;
      gap: 12px;
    }
    .auth-form {
      display: grid;
      grid-template-columns: minmax(220px, 360px) auto;
      gap: 10px;
      align-items: end;
    }
    .auth-error {
      color: var(--bad);
      font-size: 13px;
      font-weight: 700;
      min-height: 18px;
    }
    @media (max-width: 920px) {
      .controls { grid-template-columns: 1fr 1fr; }
      .span-3, .span-4, .span-6, .span-8 { grid-column: span 12; }
    }
    @media (max-width: 620px) {
      .shell { width: min(100% - 20px, 1360px); }
      .topbar { align-items: flex-start; flex-direction: column; padding: 14px 0; }
      .controls { grid-template-columns: 1fr; }
      .auth-form { grid-template-columns: 1fr; }
      .metric strong { font-size: 22px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="shell topbar">
      <div class="brand">
        <div class="mark">S</div>
        <div>
          <h1>Split402 Dashboard</h1>
          <p class="subtle">Merchant, referrer, route, payout, and webhook operations</p>
        </div>
      </div>
      <span class="status" id="connectionStatus">Idle</span>
    </div>
  </header>
  <main class="shell">
    <section class="auth-panel" id="authPanel">
      <form class="auth-form" id="authForm">
        <label>Viewer Token
          <input id="viewerToken" name="viewerToken" type="password" autocomplete="current-password">
        </label>
        <button type="submit" id="authButton">Sign in</button>
      </form>
      <p class="auth-error" id="authError"></p>
    </section>

    <form class="controls" id="dashboardForm">
      <label>Merchant ID
        <input id="merchantId" name="merchantId" autocomplete="off">
      </label>
      <label>Referrer Wallet
        <input id="referrerWallet" name="referrerWallet" autocomplete="off">
      </label>
      <label>Webhook Status
        <select id="webhookStatus" name="webhookStatus">
          <option value="">All events</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="delivered">Delivered</option>
          <option value="dead_letter">Dead letter</option>
        </select>
      </label>
      <button type="submit" id="refreshButton">Refresh</button>
    </form>

    <div class="grid">
      <section class="panel metric span-3">
        <p class="subtle">Readiness</p>
        <strong id="readinessMetric">-</strong>
        <span class="status" id="readinessStatus">Unknown</span>
      </section>
      <section class="panel metric span-3">
        <p class="subtle">Campaigns</p>
        <strong id="campaignMetric">-</strong>
        <span class="status">Merchant</span>
      </section>
      <section class="panel metric span-3">
        <p class="subtle">Routes</p>
        <strong id="routeMetric">-</strong>
        <span class="status">Discovery</span>
      </section>
      <section class="panel metric span-3">
        <p class="subtle">Referrer Balance</p>
        <strong id="balanceMetric">-</strong>
        <span class="status">USDC atomic</span>
      </section>

      <section class="panel span-12">
        <div class="section-title">
          <h2>Merchant Payout Obligations</h2>
          <span class="status" id="obligationStatus">Waiting</span>
        </div>
        <div id="obligationTable"></div>
      </section>

      <section class="panel span-6">
        <div class="section-title">
          <h2>Merchant Summary</h2>
          <span class="status" id="summaryStatus">Waiting</span>
        </div>
        <pre id="summaryJson">{}</pre>
      </section>

      <section class="panel span-6">
        <div class="section-title">
          <h2>Reliability Profile</h2>
          <span class="status" id="profileStatus">Waiting</span>
        </div>
        <pre id="profileJson">{}</pre>
      </section>

      <section class="panel span-8">
        <div class="section-title">
          <h2>Webhook Delivery Feed</h2>
          <span class="status" id="webhookCount">0 events</span>
        </div>
        <div id="webhookTable"></div>
      </section>

      <section class="panel span-4">
        <div class="section-title">
          <h2>Referrer Routes</h2>
          <span class="status" id="routeCount">0 routes</span>
        </div>
        <div id="routeTable"></div>
      </section>

      <section class="panel span-12">
        <div class="section-title">
          <h2>Referrer Payouts</h2>
          <span class="status" id="payoutCount">0 payouts</span>
        </div>
        <div id="payoutTable"></div>
      </section>
    </div>
  </main>

  <script>
    const defaults = ${defaults};
    const merchantInput = document.querySelector("#merchantId");
    const referrerInput = document.querySelector("#referrerWallet");
    const webhookStatusInput = document.querySelector("#webhookStatus");
    const form = document.querySelector("#dashboardForm");
    const refreshButton = document.querySelector("#refreshButton");
    const connectionStatus = document.querySelector("#connectionStatus");
    const authPanel = document.querySelector("#authPanel");
    const authForm = document.querySelector("#authForm");
    const authButton = document.querySelector("#authButton");
    const authError = document.querySelector("#authError");
    const viewerTokenInput = document.querySelector("#viewerToken");

    merchantInput.value = defaults.merchantId;
    referrerInput.value = defaults.referrerWallet;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await refreshDashboard();
    });

    authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await createSession();
    });

    async function initializeDashboard() {
      if (defaults.authRequired) {
        const session = await loadJson("/api/session");
        if (!session.authenticated) {
          showAuthPanel(true);
          return;
        }
      }
      showAuthPanel(false);
      if (merchantInput.value || referrerInput.value) {
        await refreshDashboard();
      }
    }

    async function createSession() {
      authButton.disabled = true;
      authError.textContent = "";
      try {
        const response = await fetch("/api/session", {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json"
          },
          body: JSON.stringify({ token: viewerTokenInput.value })
        });
        const body = await response.json();
        if (!response.ok || !body.authenticated) {
          throw new Error(body.message || body.error || "Unable to sign in");
        }
        viewerTokenInput.value = "";
        showAuthPanel(false);
        if (merchantInput.value || referrerInput.value) {
          await refreshDashboard();
        }
      } catch (error) {
        authError.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        authButton.disabled = false;
      }
    }

    function showAuthPanel(isVisible) {
      authPanel.className = isVisible ? "auth-panel is-visible" : "auth-panel";
      form.hidden = isVisible;
      document.querySelector(".grid").hidden = isVisible;
      connectionStatus.textContent = isVisible ? "Locked" : "Idle";
      connectionStatus.className = isVisible ? "status warn" : "status";
    }

    async function refreshDashboard() {
      const merchantId = merchantInput.value.trim();
      const referrerWallet = referrerInput.value.trim();
      setBusy(true);
      try {
        const merchantRequests = merchantId
          ? [
              loadJson("/api/merchants/" + encodeURIComponent(merchantId) + "/dashboard-summary"),
              loadJson("/api/merchants/" + encodeURIComponent(merchantId) + "/reliability-profile"),
              loadJson("/api/merchants/" + encodeURIComponent(merchantId) + "/webhook-events" + webhookQuery()),
              loadJson("/api/merchants/" + encodeURIComponent(merchantId) + "/payout-obligations")
            ]
          : [undefined, undefined, { events: [] }, { summary: { assets: [] } }];
        const referrerRequests = referrerWallet
          ? [
              loadJson("/api/referrers/" + encodeURIComponent(referrerWallet) + "/balances"),
              loadJson("/api/referrers/" + encodeURIComponent(referrerWallet) + "/routes"),
              loadJson("/api/referrers/" + encodeURIComponent(referrerWallet) + "/payouts?limit=25")
            ]
          : [undefined, { routes: [] }, { items: [] }];
        const [summary, profile, webhookEvents, obligations, balances, routes, payouts] =
          await Promise.all([...merchantRequests, ...referrerRequests]);
        renderSummary(summary);
        renderProfile(profile);
        renderWebhooks(webhookEvents?.events ?? []);
        renderObligations(obligations?.summary?.assets ?? []);
        renderRoutes(routes?.routes ?? []);
        renderPayouts(payouts?.items ?? []);
        renderBalance(balances?.summary);
        connectionStatus.textContent = "Live";
        connectionStatus.className = "status good";
      } catch (error) {
        connectionStatus.textContent = "Error";
        connectionStatus.className = "status bad";
        document.querySelector("#summaryJson").textContent = String(error);
      } finally {
        setBusy(false);
      }
    }

    function webhookQuery() {
      const params = new URLSearchParams({ limit: "25" });
      if (webhookStatusInput.value) params.set("status", webhookStatusInput.value);
      return "?" + params.toString();
    }

    async function loadJson(path) {
      const response = await fetch(path, { headers: { accept: "application/json" } });
      const text = await response.text();
      const body = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(body.message || body.error || response.statusText);
      }
      return body;
    }

    function renderSummary(value) {
      document.querySelector("#summaryJson").textContent = pretty(value);
      document.querySelector("#summaryStatus").textContent = value ? "Loaded" : "Missing merchant";
      const campaigns = findNumber(value, ["campaigns.total", "campaignCount", "campaigns.active"]);
      const routes = findNumber(value, ["routes.total", "routeCount", "routes.active"]);
      document.querySelector("#campaignMetric").textContent = campaigns ?? "-";
      document.querySelector("#routeMetric").textContent = routes ?? "-";
    }

    function renderProfile(value) {
      document.querySelector("#profileJson").textContent = pretty(value);
      document.querySelector("#profileStatus").textContent = value ? "Loaded" : "Missing merchant";
      const readiness = value?.profile?.discoveryReady ?? value?.discoveryReady ?? false;
      document.querySelector("#readinessMetric").textContent = readiness ? "Ready" : "Review";
      document.querySelector("#readinessStatus").textContent = readiness ? "Ready" : "Needs checks";
      document.querySelector("#readinessStatus").className = readiness ? "status good" : "status warn";
    }

    function renderBalance(value) {
      const assets = Array.isArray(value?.assets) ? value.assets : [];
      if (assets.length === 0) {
        document.querySelector("#balanceMetric").textContent = "-";
        return;
      }
      document.querySelector("#balanceMetric").textContent = assets
        .map((asset) => formatAssetBalance(asset))
        .join(" / ");
    }

    function renderWebhooks(events) {
      document.querySelector("#webhookCount").textContent = events.length + " events";
      renderTable("#webhookTable", events, ["eventType", "status", "attempts", "createdAt"]);
    }

    function renderObligations(assets) {
      document.querySelector("#obligationStatus").textContent = assets.length + " assets";
      renderTable("#obligationTable", assets, [
        "asset",
        "fundingStatus",
        "fundingAmountAtomic",
        "fundingDeficitAtomic",
        "outstandingAmountAtomic",
        "availableAmountAtomic",
        "inFlightAmountAtomic",
        "paidAmountAtomic",
        "accrualCount"
      ]);
    }

    function renderRoutes(routes) {
      document.querySelector("#routeCount").textContent = routes.length + " routes";
      renderTable("#routeTable", routes, ["routeId", "status", "campaignId"]);
    }

    function renderPayouts(payouts) {
      document.querySelector("#payoutCount").textContent = payouts.length + " payouts";
      renderTable("#payoutTable", payouts, ["batchId", "status", "amountAtomic", "createdAt"]);
    }

    function renderTable(selector, rows, columns) {
      const host = document.querySelector(selector);
      if (rows.length === 0) {
        host.innerHTML = '<div class="empty">No records loaded</div>';
        return;
      }
      host.innerHTML =
        "<table><thead><tr>" +
        columns.map((column) => "<th>" + escapeHtml(column) + "</th>").join("") +
        "</tr></thead><tbody>" +
        rows.map((row) => "<tr>" + columns.map((column) => "<td>" + escapeHtml(formatCell(row?.[column])) + "</td>").join("") + "</tr>").join("") +
        "</tbody></table>";
    }

    function findNumber(value, paths) {
      for (const path of paths) {
        const current = path.split(".").reduce((acc, key) => acc?.[key], value);
        if (typeof current === "number") return current;
      }
      return undefined;
    }

    function formatCell(value) {
      if (value === undefined || value === null) return "-";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    }

    function formatAssetBalance(asset) {
      const available = asset?.availableAmountAtomic ?? "0";
      const label = asset?.asset ?? "asset";
      return String(available) + " " + String(label);
    }

    function pretty(value) {
      return JSON.stringify(value ?? {}, null, 2);
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function setBusy(isBusy) {
      refreshButton.disabled = isBusy;
      refreshButton.textContent = isBusy ? "Loading" : "Refresh";
      if (isBusy) {
        connectionStatus.textContent = "Loading";
        connectionStatus.className = "status";
      }
    }

    initializeDashboard();
  </script>
</body>
</html>`;
}
