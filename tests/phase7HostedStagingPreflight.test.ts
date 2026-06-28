import { describe, expect, it } from "vitest";

import {
  runPhase7HostedStagingPreflight,
  type Phase7HostedStagingPreflightFetch,
} from "../src/phase7HostedStagingPreflight.js";

describe("Phase 7 hosted staging preflight", () => {
  it("checks control-plane health and locked dashboard access", async () => {
    const writes = new Map<string, string>();
    const calls: Array<{ url: string; token?: string }> = [];

    const report = await runPhase7HostedStagingPreflight({
      controlPlaneUrl: "https://control.example/",
      dashboardUrl: "https://dashboard.example/",
      sourceCommit: "cdf4f45",
      dashboardViewerToken: "viewer-secret",
      outputDir: "evidence",
      fetch: fakePreflightFetch(calls),
      writeArtifact: (path, text) => writes.set(path, text),
      joinPath: (directory, fileName) => `${directory}/${fileName}`,
    });

    expect(report).toMatchObject({
      schema: "split402.phase7_hosted_staging_preflight.v1",
      controlPlaneUrl: "https://control.example",
      dashboardUrl: "https://dashboard.example",
      sourceCommit: "cdf4f45",
      artifactPath: "evidence/hosted-preflight.json",
    });
    expect(report.checks.map((check) => check.name)).toEqual([
      "control_plane_health",
      "dashboard_health",
      "dashboard_session",
      "dashboard_config_without_viewer",
      "dashboard_config_with_viewer",
    ]);
    expect(calls).toContainEqual({
      url: "https://dashboard.example/api/config",
      token: "viewer-secret",
    });
    expect(writes.get("evidence/hosted-preflight.json")).toContain(
      "split402.phase7_hosted_staging_preflight.v1",
    );
    expect(writes.get("evidence/hosted-preflight.json")).toContain(
      '"sourceCommit": "cdf4f45"',
    );
  });

  it("fails when dashboard viewer auth is not enabled for hosted staging", async () => {
    await expect(
      runPhase7HostedStagingPreflight({
        controlPlaneUrl: "https://control.example",
        dashboardUrl: "https://dashboard.example",
        sourceCommit: "cdf4f45",
        dashboardViewerToken: "viewer-secret",
        outputDir: "evidence",
        fetch: fakePreflightFetch([], { dashboardRequiresAuth: false }),
        writeArtifact: () => undefined,
      }),
    ).rejects.toThrow("dashboard viewer auth is not required");
  });

  it("requires a source commit for same-commit proof evidence", async () => {
    await expect(
      runPhase7HostedStagingPreflight({
        controlPlaneUrl: "https://control.example",
        dashboardUrl: "https://dashboard.example",
        sourceCommit: "main",
        outputDir: "evidence",
        fetch: fakePreflightFetch([]),
        writeArtifact: () => undefined,
      }),
    ).rejects.toThrow("sourceCommit must be a 7-40 character git SHA");
  });
});

function fakePreflightFetch(
  calls: Array<{ url: string; token?: string }>,
  options: { dashboardRequiresAuth?: boolean } = {},
): Phase7HostedStagingPreflightFetch {
  const dashboardRequiresAuth = options.dashboardRequiresAuth ?? true;
  return async (url, init) => {
    calls.push({
      url,
      ...(init?.headers?.["x-split402-dashboard-token"] === undefined
        ? {}
        : { token: init.headers["x-split402-dashboard-token"] }),
    });
    if (url === "https://control.example/v1/health") {
      return jsonResponse(200, {
        service: "split402-control-plane",
      });
    }
    if (url === "https://dashboard.example/health") {
      return jsonResponse(200, {
        service: "split402-dashboard",
      });
    }
    if (url === "https://dashboard.example/api/session") {
      return jsonResponse(200, {
        required: dashboardRequiresAuth,
        authenticated: false,
      });
    }
    if (url === "https://dashboard.example/api/config") {
      if (init?.headers?.["x-split402-dashboard-token"] === "viewer-secret") {
        return jsonResponse(200, {
          viewerAuthRequired: true,
        });
      }
      return jsonResponse(dashboardRequiresAuth ? 401 : 200, {
        viewerAuthRequired: dashboardRequiresAuth,
      });
    }
    return jsonResponse(404, {});
  };
}

function jsonResponse(status: number, body: unknown): {
  ok: boolean;
  status: number;
  text(): Promise<string>;
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}
