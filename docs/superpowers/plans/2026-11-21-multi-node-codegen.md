# Plan: multi node code generation (#14)

Spec: `docs/superpowers/specs/2026-11-21-multi-node-codegen-design.md`. One commit per task, tests first.

1. **Validation.** `core/validate.ts`: cross node dependency issue (replaces the #12 warning for dependencies), dependency cycle issue with its path. Tests: `validate.test.ts`. All committed designs except auction keep 0 issues and 0 warnings; auction is fixed in task 5.
2. **Node roles.** A `core` helper for primary node, extra service nodes, entry file, port variable and default port, peer URL variables, links per node. Tests for each rule.
3. **Briefs and prompts.** `agents/design.ts` stack and boundary rules; `agents/code.ts` wiring and update briefs per node, `/api/config` for browser links to other nodes, internal endpoints; `codegen/generate.ts` passes them. Tests: `agents.test.ts`, brief tests, `generate.test.ts`.
4. **Scaffold, README, gate.** `codegen/scaffold.ts` `start:<node>` scripts; `readmeMarkdown` run line per node; P4 `App entry exists` checks every entry (`orchestrator/p4.ts`, `gates.ts`). Tests for each.
5. **Auction acceptance (paid).** P2 change request run removing the cross node dependency pair (cap $0.30), then P4 Generate with no chat fixes (cap $1.00); smoke script: API node plus two live node instances, one bid over HTTP reaches ws clients on both. Commit the showcase result.
6. **Docs.** `docs/decisions.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `AGENTS.md` if commands change.
