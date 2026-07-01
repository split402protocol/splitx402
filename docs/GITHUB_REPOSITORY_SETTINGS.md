# GitHub Repository Settings

This file records the launch-facing GitHub settings expected for
`split402protocol/splitx402`. It is a checklist for maintainers because some
settings live in GitHub rather than in tracked source files.

## Repository Metadata

Keep these values aligned with [`docs/GITHUB_PUBLIC_PROFILE.md`](GITHUB_PUBLIC_PROFILE.md):

- About description: `Agent payment routing and verifiable referral accounting for x402 APIs.`
- Website: blank until a hosted public docs or demo URL is live and proof-gated.
- Topics: `agents`, `mcp`, `payments`, `protocol`, `solana`, `typescript`,
  `usdc`, `x402`.
- License: Apache-2.0.
- Releases and packages: do not publish supported artifacts until
  [`docs/RELEASE_POLICY.md`](RELEASE_POLICY.md) is satisfied.

## Branch Protection For `main`

Before launch-facing announcements, protect `main` with:

- require pull request before merging;
- require at least one approving review;
- require review from Code Owners;
- dismiss stale approvals when new commits are pushed;
- require conversation resolution before merge;
- require status checks to pass before merge;
- require branches to be up to date before merge;
- block force pushes;
- block branch deletion;
- include administrators unless a documented emergency override is approved.

Required status checks:

- `Lint`
- `Public surface check`
- `Typecheck`
- `Test`
- `Build`
- `Check vectors`
- `Audit`
- `Local public-alpha proof`
- `PostgreSQL integration tests`
- CodeQL
- Secret scan

## Merge Policy

Use reviewable pull requests. Squash, merge commit, and rebase can remain
enabled while the project is pre-release, but every merge must preserve:

- exact validation commands in the PR body;
- protocol/security notes for signed-object, receipt, settlement, payout,
  custody, CI, or release-surface changes;
- documentation updates when public behavior changes.

Do not rewrite public history without a written migration plan. Existing clones,
forks, and downloaded copies cannot be reliably pulled back.

## Public Issue Intake

Keep blank issues disabled. Use structured issue forms for public bug reports,
integration questions, and phase tasks. Security-sensitive reports must go
through GitHub Security Advisories, not public issues.

## Release And Package Posture

Do not publish releases, packages, or production-facing images until the release
policy is satisfied. Workspace packages stay `"private": true` until a package
has an intentional release decision, versioning plan, registry policy, and
support statement.

## Periodic Review

Run this before launch-facing updates:

```bash
corepack pnpm product:github-settings-review --template --output split402-launch-evidence/github-settings-review.txt
corepack pnpm product:github-settings-review --from-github --output split402-launch-evidence/github-settings-review.txt
corepack pnpm product:public-surface-check --brief
corepack pnpm product:local-proof --brief
```

Then confirm the GitHub UI still matches this file.

The local checks prove the tracked repository surface. The `--from-github`
review captures live GitHub API state for repository metadata, branch
protection, required checks, issue intake, releases, and readable package
visibility, but it still leaves `review_decision: no-go` until a human reviewer
confirms UI-only settings such as security advisories and attached evidence.

After fixing live GitHub blockers, regenerate the API review record with:

```bash
corepack pnpm product:github-settings-review --from-github --output split402-launch-evidence/github-settings-review.txt
```

The generated record must include the evidence source:

- `SPLIT402_GITHUB_SETTINGS_EVIDENCE_SOURCE`, for example
  `attached: github-settings-review-YYYY-MM-DD.md`.

Do not set `SPLIT402_GITHUB_SETTINGS_REVIEW_DECISION=approved` while reviewers,
review method, or evidence source still contain placeholders.

Keep the generated record with private launch evidence if it contains reviewer
names, screenshots, or operational context that should not be public. The
default local launch-evidence path is
`split402-launch-evidence/github-settings-review.txt`.
Use `--output` instead of shell redirection so the evidence file is written as
UTF-8 on Windows PowerShell and remains parseable by launch preflight.
