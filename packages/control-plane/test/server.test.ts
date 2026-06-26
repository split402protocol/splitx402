import { describe, expect, it } from "vitest";

import { readControlPlaneServerPort } from "../src/server.js";

describe("control-plane server entrypoint", () => {
  it("reads the HTTP port from hosted runtime environment", () => {
    expect(readControlPlaneServerPort({ PORT: "8080" })).toBe(8080);
    expect(
      readControlPlaneServerPort({ SPLIT402_CONTROL_PLANE_PORT: "4021" }),
    ).toBe(4021);
    expect(readControlPlaneServerPort({})).toBe(4021);
  });

  it("rejects invalid HTTP ports", () => {
    expect(() => readControlPlaneServerPort({ PORT: "0" })).toThrow(
      "PORT must be a positive integer",
    );
    expect(() => readControlPlaneServerPort({ PORT: "localhost" })).toThrow(
      "PORT must be a positive integer",
    );
  });
});
