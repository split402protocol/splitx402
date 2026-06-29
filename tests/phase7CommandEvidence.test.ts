import { describe, expect, it } from "vitest";

import {
  PHASE7_COMMAND_EVIDENCE_ALTERNATIVES,
  PHASE7_REQUIRED_COMMAND_EVIDENCE,
  createPhase7CommandEvidenceTemplate,
} from "../src/phase7CommandEvidence.js";

describe("Phase 7 command evidence template", () => {
  it("lists every required command as a commented transcript checklist", () => {
    const template = createPhase7CommandEvidenceTemplate();

    expect(template).toContain("# Split402 Phase 7 command evidence transcript");
    expect(template).toContain("Do not paste secrets");
    expect(template).toContain("git status --short --branch");
    expect(template).toContain("no changed-file rows");
    for (const command of PHASE7_REQUIRED_COMMAND_EVIDENCE) {
      expect(template).toContain(`# $ ${command}`);
      expect(template).not.toContain(`\n$ ${command}`);
    }
    for (const alternative of PHASE7_COMMAND_EVIDENCE_ALTERNATIVES) {
      expect(template).toContain(`# $ ${alternative.required}`);
      for (const command of alternative.alternatives) {
        expect(template).toContain(`# $ ${command}`);
      }
    }
  });
});
