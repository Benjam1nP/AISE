# Plan: P3 design review (#1)

Spec: `docs/superpowers/specs/2026-11-27-p3-design-review-design.md`. Two PRs.

## PR 1: server

1. **Proposals store and tool** (`src/lib/server/core/tools/proposals.ts`, new)
   - `ID_PATTERNS.PRP` in `core/ids.ts`.
   - zod `Proposal`, `DesignProposals` (`designHash`, `proposals`), `PROPOSALS_PATH =
     '.aise/design-proposals.json'`, `readDesignProposals(store)` (null when missing or unparsable).
   - `report_design_proposals` tool (only agent `review`, run only): input `{ proposals: [{ kind,
     title, change, elementIds, reqIds }] }`, max 5; checks every ID against design (DSN, UC, SEQ,
     ACT) and requirements; all problems at once as ToolError; stores open proposals with fresh PRP
     IDs (`nextId` over all stored IDs), keeps accepted and rejected ones, drops old open ones.
   - Pure helpers: `p3Status(proposals, designHash)`, `resolveProposal(doc, id, status, at)`.
   - Register in `tools/index.ts`, add `review` to `scope.ts` (`read_requirements`, `read_design`,
     `report_design_proposals`) and to `RUN_ONLY_TOOLS`.
   - Tests `proposals.test.ts`: stored with hash; unknown IDs; more than 5; history kept and numbering
     continues; `p3Status` per spec table.
2. **Review agent** (`agents/review.ts`, new): Sonnet 5.5, effort medium, prompt for the five kinds,
   at most 5, concrete changes only, reply short. `reviewBrief(uncovered)` lists computed uncovered
   criteria. Export from `agents/index.ts`; turn limit and cost limit in the orchestrator tables.
3. **Orchestrator** (`orchestrator/orchestrator.ts`)
   - P3 becomes a run phase with its own chat (`ChatPhase` gains P3 for runs, not for sendMessage,
     approve or stale actions); `AGENT_OF.P3 = 'review'`; backups of `PROPOSALS_PATH` via the store.
   - `reviewDesign(name)`: needs a design, 409 when busy; starts a P3 run with the brief.
   - P2 runs get a `FollowUp`: when status `done`, not `fromProposal`, and the design hash differs
     from `prevArtefactHash`, start the review.
   - `acceptProposal(name, id)`: open proposal required; marks accepted; starts a P2 run (`auto`,
     `fromProposal: id` on `RunMeta`) with message `Apply review proposal <id>: <title>. <change>`.
     On settle of such a run with status done, set `designHash` of the proposals file to the new
     design. Discard of it reopens the proposal (`prevProposal` restored through the backup).
   - `rejectProposal(name, id)`: marks rejected, no run.
   - P3 state derived with `p3Status` after every settle, accept and reject, and when P2 settles
     (stale on a changed design). Snapshot gains `proposals`.
   - Tests in `orchestrator.test.ts` with fake agents, per spec list.
4. **Routes**: form actions `reviewDesign`, `acceptProposal`, `rejectProposal` in
   `src/routes/p/[name]/+page.server.ts`, tests in `routes.test.ts`.
5. **Docs**: ARCHITECTURE (modules, P3), `docs/decisions.md` entry (P3 review layer, no gate).

## PR 2: UI, docs, evidence

- `src/lib/components/ProposalsPanel.svelte` with test; P3 panel in `+page.svelte` (diagrams,
  Review design, proposals); `PhaseBar` opens P3 once P2 has a design; Discuss prefills P2 composer.
- README status table, CHANGELOG, landing text.
- Browser check with screenshots; live run on the to do showcase, artefacts committed.
