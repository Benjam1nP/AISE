# P3 design review with proposals the developer accepts (#1)

## Goal

The environment reviews its own design and proposes concrete improvements. The developer accepts,
rejects or discusses each one; accepting changes the design through the design agent, so every
diagram updates. P3 is visible on the rail with a real state.

## Non goals

- P3 does not gate P4. Code generation still starts from P2 approval (decision 2026-11-27).
- No automatic acceptance and no review of code, tests or deployment.
- No change to the ticket walk (P7) order.

## Shape

P3 is a review layer on top of P2:

| P3 status           | When                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `not_started`       | no review yet                                                        |
| `running`           | a review run is active                                               |
| `awaiting_approval` | the latest review has at least one open proposal                     |
| `approved`          | the latest review has no open proposal (all accepted or rejected, or none found) |
| `stale`             | the design changed after the review and no new review ran yet        |

P3 has no Approve button and no gate: its status follows the proposals.

## Review run

- New agent `review` (Sonnet 5.5, effort medium, low turn limit), tools `read_requirements`,
  `read_design` and the new `report_design_proposals` (run only, not offered over MCP).
- Its brief contains the computed uncovered acceptance criteria from `.aise/design-review.json`
  (coverage, already built), so those proposals rest on code, not on the model.
- It proposes 0 to 5 improvements of the kinds: `missing_class`, `missing_method`,
  `unclear_responsibility`, `uncovered_criterion`, `sequence_mismatch`. Each proposal has a title,
  a concrete change in one or two sentences, the element IDs (DSN, UC, SEQ) and REQ IDs it touches.
- `report_design_proposals` checks every ID exists in the design or requirements and stores
  `.aise/design-proposals.json`: `{ designHash, proposals: [{ id: PRP-001, kind, title, change,
  elementIds, reqIds, status: open | accepted | rejected, resolvedAt? }] }`. A new review replaces
  the open proposals and keeps accepted and rejected ones as history; PRP numbers are never reused.
- Runs as a P3 run with its own chat key, backups and Discard like other runs.

## Triggers

- Review design button in the P3 panel, whenever a design exists and no run is active.
- Automatically after every P2 run that ends `done` and changed the design, except a run that
  applies a proposal (so the review cannot loop on itself). Implemented as a `FollowUp` of the P2 run.

## Accept, Reject, Discuss

- **Accept** (`acceptProposal`): marks the proposal accepted and starts a P2 design run with the
  proposal as its message (`Apply review proposal PRP-003: ...`, `auto`, `fromProposal` set). The
  design agent saves the full model, so all diagrams change together. After the run settles the
  review's `designHash` is moved to the new design, so the remaining proposals stay current.
  Discarding that run puts the proposal back to open.
- **Reject** (`rejectProposal`): marks it rejected, no LLM call.
- **Discuss**: client only. Switches to the P2 chat with the proposal prefilled in the composer, so
  the developer edits it and sends it as an ordinary change request.
- Accepting after P2 was approved behaves like any P2 chat change today (P2 back to awaiting
  approval, P4 marked stale).

## UI

- P3 rail station opens once P2 has started (not `not_started`) or P3 holds a state of its own; the Review design button needs a design, and without one the panel says so. The P3 panel shows the diagrams (existing
  `DiagramsPanel`), the Review design button, the open proposals as cards (kind badge, title,
  change, linked IDs, Accept, Reject, Discuss) and a collapsed list of resolved ones.
- Landing page and README status table: P3 built.

## Edge cases

- Review with zero proposals: stored, P3 `approved`, panel says "No improvements proposed".
- A proposal whose IDs no longer exist after a later design change: the next review replaces it;
  until then Accept still works (the design agent decides) and P3 shows `stale`.
- Accept while a run is active: 409 as for every action today.
- `report_design_proposals` with unknown IDs or more than 5 proposals: ToolError listing every problem.
- Review run fails or is discarded: P3 returns to its previous state (as other runs). The UI has no Discard button for review runs (decision 2026-11-27); a failed or unwanted review is rerun with Review design.

## Tests

- Tool: valid proposals stored with the design hash; unknown IDs rejected; open proposals replaced
  and resolved ones kept; numbering continues.
- State: P3 status derivation for each row of the table above, including stale.
- Orchestrator (fake agents): auto review after a P2 run that changed the design, none after a
  proposal run or an unchanged design; accept starts a P2 run and marks accepted; discard of that run
  reopens the proposal; reject needs no run; 409 while busy.
- Components: proposals list renders open and resolved, buttons post the right actions, Discuss
  prefills the P2 composer.
- Live evidence (not CI): on the to do showcase, a review proposes at least one improvement, it is
  accepted, and the class and sequence diagrams change; artefacts committed with the showcase.

## Delivery

Two PRs to stay under about 400 changed lines each: (1) server: schema, tool, agent, orchestrator,
state, tests, ARCHITECTURE and decisions; (2) UI panel, rail, README, CHANGELOG and the showcase run.
