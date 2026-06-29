import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { writeCliTextOutput } from "../src/cliOutput.js";

describe("CLI text output", () => {
  it("writes stdout when no output path is provided", () => {
    let captured = "";
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        captured += String(chunk);
        callback();
      },
    });

    expect(writeCliTextOutput({ text: "proof\n", stdout })).toBeUndefined();
    expect(captured).toBe("proof\n");
  });

  it("writes relative output paths from pnpm INIT_CWD as UTF-8", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-cli-output-"));
    try {
      const writtenPath = writeCliTextOutput({
        text: "proof_id: phase7\n",
        outputPath: "evidence/phase7-staging-proof.txt",
        env: { INIT_CWD: directory },
        cwd: join(directory, "package"),
      });

      const outputPath = join(directory, "evidence", "phase7-staging-proof.txt");
      expect(writtenPath).toBe(outputPath);
      const bytes = readFileSync(outputPath);
      expect([...bytes.subarray(0, 2)]).not.toEqual([0xff, 0xfe]);
      expect(readFileSync(outputPath, "utf8")).toBe("proof_id: phase7\n");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
