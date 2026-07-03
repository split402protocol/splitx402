import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const compose = readFileSync("deploy/phase7-staging/compose.yaml", "utf8");

describe("Phase 7 staging compose stack", () => {
  it("healthchecks the hosted proof services", () => {
    expect(compose).toContain("http://127.0.0.1:4021/v1/health");
    expect(compose).toContain("http://127.0.0.1:4027/health");
    expect(compose).toContain("http://127.0.0.1:4023/health");
  });

  it("waits for the control plane before dependent public surfaces start", () => {
    expect(compose).toMatch(
      /dashboard:[\s\S]*?depends_on:[\s\S]*?control-plane:[\s\S]*?condition: service_healthy/u,
    );
    expect(compose).toMatch(
      /demo-merchant:[\s\S]*?depends_on:[\s\S]*?control-plane:[\s\S]*?condition: service_healthy/u,
    );
  });
});
