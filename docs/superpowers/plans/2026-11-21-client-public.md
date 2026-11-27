# Plan: browser client maps to public/ (#15)

Spec: `docs/superpowers/specs/2026-11-21-client-public-design.md`. One commit per task, tests first.

1. **Validation and prompt.** `core/validate.ts` issue for classes in a client component; `agents/design.ts` browser rule. Tests: `validate.test.ts`, `agents.test.ts`.
2. **Code generation.** `codegen/plan.ts` skips classes on client nodes; `agents/code.ts` wiring brief names the client component and the `@trace` comment in `public/index.html`, update mode keeps it current. Tests: `plan.test.ts`, wiring brief test.
3. **Trace.** `core/trace.ts` maps a client component to `public/index.html` (comment line, else 1) when it exists. Tests: `trace.test.ts`.
4. **Migration.** Scratch script over booking and auction `design.json`, validate, regenerate `docs/design.md`; P4 Update on both (paid, cap $0.5 each); commit the regenerated code.
5. **Docs.** `docs/decisions.md`, `ARCHITECTURE.md`, `CHANGELOG.md`.
