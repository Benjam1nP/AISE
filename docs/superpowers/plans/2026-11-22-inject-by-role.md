# Plan: injection by role (#37)

Spec: `docs/superpowers/specs/2026-11-22-inject-by-role-design.md`.

1. **Rule and drift** (`src/lib/server/core/drift.ts`, `drift.test.ts`): `injectable(c, design)` per
   the spec (class or interface with methods, not used as a type in any design attribute, parameter
   or return type). Update callers (`relationDiffs`, `code-worker.ts` `ctorParams`). New drift item:
   a constructor that lacks a parameter for an injected dependency target. Tests first.
2. **Prompts** (`stack-rules.ts`, `agents/code.ts`, `agents/design.ts`, `agents.test.ts`): new
   injection sentence, wiring creates one shared instance and never wraps or replaces methods, drop
   the #14 "no attributes" design rule, add the socket attribute rule.
3. **Fixture** (`test/fixtures/p4`): migrate constructors to the new shape; `npm run test:docker`
   stays clean.
4. **Auction**: design edit (LiveGateway socket attribute), live P4 rerun, check outbox and wrapper
   are gone, two watchers receive a bid. Drift over booking and arthur.
5. Docs: CHANGELOG, ARCHITECTURE, `docs/decisions.md`.
