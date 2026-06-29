import { writeCliTextOutput } from "./cliOutput.js";
import { createPhase7CommandEvidenceTemplate } from "./phase7CommandEvidence.js";

writeCliTextOutput({
  text: createPhase7CommandEvidenceTemplate(),
  outputPath: process.argv[2],
});
