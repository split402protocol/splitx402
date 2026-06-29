import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { createPhase7StagingArtifactManifest } from "./phase7StagingArtifactManifest.js";

const proofPath =
  process.argv[2] ?? process.env.SPLIT402_PHASE7_STAGING_PROOF;
const outputPath = process.argv[3] ?? process.env.SPLIT402_PHASE7_MANIFEST_OUTPUT;

if (proofPath === undefined || proofPath.trim().length === 0) {
  console.error(
    "Usage: corepack pnpm phase7:staging:manifest <phase7-staging-proof.txt> [artifact-manifest.json]",
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
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  if (outputPath === undefined || outputPath.trim().length === 0) {
    process.stdout.write(manifestJson);
  } else {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, manifestJson, "utf8");
  }
}
