import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { createPhase7StagingArtifactManifest } from "./phase7StagingArtifactManifest.js";

const proofPath =
  process.argv[2] ?? process.env.SPLIT402_PHASE7_STAGING_PROOF;

if (proofPath === undefined || proofPath.trim().length === 0) {
  console.error(
    "Usage: corepack pnpm phase7:staging:manifest <phase7-staging-proof.txt>",
  );
  process.exitCode = 1;
} else {
  const resolvedProofPath = resolve(proofPath);
  const artifactBaseDir = dirname(resolvedProofPath);
  const proofText = readFileSync(resolvedProofPath, "utf8");
  const manifest = createPhase7StagingArtifactManifest(proofText, {
    artifactBaseDir,
    readArtifact: (path) => readFileSync(path),
    resolveArtifactPath: (artifactPath, baseDir) =>
      isAbsolute(artifactPath) ? artifactPath : resolve(baseDir, artifactPath),
  });
  console.log(JSON.stringify(manifest, null, 2));
}
