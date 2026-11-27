# Plan: deployment links (#12)

Spec: `docs/superpowers/specs/2026-11-21-deployment-links-design.md`. One commit per task, tests first.

1. **Schema and validation.** `core/schemas/design.ts` (`client` kind, `NodeLink`, `DesignDoc.links` default `[]`), `core/validate.ts` (link issues, external without link, cross node relation warning). Tests: `schemas/schemas.test.ts`, `validate.test.ts`.
2. **Renderer.** `core/render/mermaid.ts` `renderDeployment` (link edges only, client shapes, `classDef client`), `core/render/markdown.ts` link lines. Tests: `render/render.test.ts`, markdown test.
3. **Agents.** `agents/design.ts` prompt (node kinds, links, no classes on external nodes), `agents/code-worker.ts` storing rule and `agents/code.ts` prompt (client takes no `db`). Tests: `code-worker` storing rule, `agents.test.ts` if it pins prompt content.
4. **Migration.** `showcases/fixture`, `test/fixtures/p4`, `showcases/booking`, `showcases/auction` `design.json` and regenerated `docs/design.md`; a test that every committed design validates with no issues.
5. **Docs.** `docs/decisions.md`, `ARCHITECTURE.md`, `CHANGELOG.md`.
