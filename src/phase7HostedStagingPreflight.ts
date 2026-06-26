export interface Phase7HostedStagingPreflightInput {
  controlPlaneUrl: string;
  dashboardUrl: string;
  outputDir: string;
  dashboardViewerToken?: string;
  fetch: Phase7HostedStagingPreflightFetch;
  writeArtifact: (path: string, text: string) => void;
  joinPath?: (directory: string, fileName: string) => string;
}

export interface Phase7HostedStagingPreflightFetch {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface Phase7HostedStagingPreflightCheck {
  name:
    | "control_plane_health"
    | "dashboard_health"
    | "dashboard_session"
    | "dashboard_config_without_viewer"
    | "dashboard_config_with_viewer";
  url: string;
  status: number;
  ok: boolean;
  expectedStatus: number;
}

export interface Phase7HostedStagingPreflightReport {
  schema: "split402.phase7_hosted_staging_preflight.v1";
  controlPlaneUrl: string;
  dashboardUrl: string;
  outputDir: string;
  artifactPath: string;
  checks: Phase7HostedStagingPreflightCheck[];
}

interface PreflightSpec {
  name: Phase7HostedStagingPreflightCheck["name"];
  url: string;
  expectedStatus: number;
  headers?: Record<string, string>;
  validateBody?: (body: unknown) => string | undefined;
}

export async function runPhase7HostedStagingPreflight(
  input: Phase7HostedStagingPreflightInput,
): Promise<Phase7HostedStagingPreflightReport> {
  const controlPlaneUrl = normalizeBaseUrl(input.controlPlaneUrl, "controlPlaneUrl");
  const dashboardUrl = normalizeBaseUrl(input.dashboardUrl, "dashboardUrl");
  const specs = createPreflightSpecs(input, controlPlaneUrl, dashboardUrl);
  const checks: Phase7HostedStagingPreflightCheck[] = [];
  const responses: unknown[] = [];

  for (const spec of specs) {
    const response = await input.fetch(spec.url, {
      headers: spec.headers ?? { accept: "application/json" },
    });
    const text = await response.text();
    const body = parseBody(text);
    responses.push({
      name: spec.name,
      status: response.status,
      body,
    });
    const bodyError = spec.validateBody?.(body);
    const ok = response.status === spec.expectedStatus && bodyError === undefined;
    checks.push({
      name: spec.name,
      url: spec.url,
      status: response.status,
      ok,
      expectedStatus: spec.expectedStatus,
    });
    if (!ok) {
      throw new Error(
        `${spec.name} failed: expected HTTP ${spec.expectedStatus}, got ${response.status}${
          bodyError === undefined ? "" : ` (${bodyError})`
        }`,
      );
    }
  }

  const artifactPath = joinPath(input, "hosted-preflight.json");
  const report: Phase7HostedStagingPreflightReport = {
    schema: "split402.phase7_hosted_staging_preflight.v1",
    controlPlaneUrl,
    dashboardUrl,
    outputDir: input.outputDir,
    artifactPath,
    checks,
  };
  input.writeArtifact(
    artifactPath,
    `${JSON.stringify({ ...report, responses }, null, 2)}\n`,
  );
  return report;
}

function createPreflightSpecs(
  input: Phase7HostedStagingPreflightInput,
  controlPlaneUrl: string,
  dashboardUrl: string,
): PreflightSpec[] {
  const token = input.dashboardViewerToken?.trim();
  const dashboardAuthHeaders =
    token === undefined || token.length === 0
      ? undefined
      : {
          accept: "application/json",
          "x-split402-dashboard-token": token,
        };
  return [
    {
      name: "control_plane_health",
      url: `${controlPlaneUrl}/v1/health`,
      expectedStatus: 200,
      validateBody: (body) =>
        readString(body, "service") === "split402-control-plane"
          ? undefined
          : "control-plane service marker is missing",
    },
    {
      name: "dashboard_health",
      url: `${dashboardUrl}/health`,
      expectedStatus: 200,
      validateBody: (body) =>
        readString(body, "service") === "split402-dashboard"
          ? undefined
          : "dashboard service marker is missing",
    },
    {
      name: "dashboard_session",
      url: `${dashboardUrl}/api/session`,
      expectedStatus: 200,
      validateBody: (body) => {
        const required = readBoolean(body, "required");
        if (token !== undefined && token.length > 0 && required !== true) {
          return "dashboard viewer auth is not required";
        }
        return undefined;
      },
    },
    {
      name: "dashboard_config_without_viewer",
      url: `${dashboardUrl}/api/config`,
      expectedStatus: token === undefined || token.length === 0 ? 200 : 401,
    },
    ...(dashboardAuthHeaders === undefined
      ? []
      : [
          {
            name: "dashboard_config_with_viewer" as const,
            url: `${dashboardUrl}/api/config`,
            expectedStatus: 200,
            headers: dashboardAuthHeaders,
            validateBody: (body: unknown) =>
              readBoolean(body, "viewerAuthRequired") === true
                ? undefined
                : "dashboard viewer auth flag is missing",
          },
        ]),
  ];
}

function normalizeBaseUrl(value: string, label: string): string {
  const trimmed = value.trim().replace(/\/+$/u, "");
  if (trimmed.length === 0) {
    throw new Error(`${label} is required`);
  }
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must be an http(s) URL`);
  }
  return url.toString().replace(/\/$/u, "");
}

function joinPath(
  input: Phase7HostedStagingPreflightInput,
  fileName: string,
): string {
  return input.joinPath === undefined
    ? `${input.outputDir}/${fileName}`
    : input.joinPath(input.outputDir, fileName);
}

function parseBody(text: string): unknown {
  if (text.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readString(value: unknown, key: string): string | undefined {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[key] === "string"
    ? ((value as Record<string, unknown>)[key] as string)
    : undefined;
}

function readBoolean(value: unknown, key: string): boolean | undefined {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[key] === "boolean"
    ? ((value as Record<string, unknown>)[key] as boolean)
    : undefined;
}
