## Summary

-

## Validation

List exact commands run and mark the relevant checks.

- [ ] `corepack pnpm lint`
- [ ] `corepack pnpm product:public-surface-check --brief`
- [ ] `corepack pnpm typecheck`
- [ ] `corepack pnpm test`
- [ ] `corepack pnpm build`
- [ ] `corepack pnpm vectors:check`
- [ ] `corepack pnpm audit --audit-level high`
- [ ] `corepack pnpm product:local-proof --brief`
- [ ] `corepack pnpm test:postgres` when `SPLIT402_TEST_DATABASE_URL` is available

Commands run:

- 

`product:local-proof` intentionally fails when the source worktree is dirty; run
it after committing or from a clean checkout.

## Protocol / Security Notes

-

## Docs Updated

- [ ] README, package docs, phase docs, or decision records were updated when the
      public behavior changed.
