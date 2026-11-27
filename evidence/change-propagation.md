# C2: alignment under change

Requirements §5 C2: demo a requirement, a design and a code change on a showcase, show which
artefacts each one updated, and explain how synchronisation works and where it fails. Every change
below except the pending booking one is a closed P7 ticket. Its change report (`report` in the ticket) and its chat
(`.aise/chat/TCK-*.jsonl`) are committed with the showcase.

| Change kind                       | Showcase | Ticket  | Entry | Report                                                  |
| --------------------------------- | -------- | ------- | ----- | ------------------------------------------------------- |
| Requirement                       | to do    | TCK-001 | P1    | [tickets.json](../showcases/todo/.aise/tickets.json)    |
| Requirement                       | auction  | TCK-001 | P1    | [tickets.json](../showcases/auction/.aise/tickets.json) |
| Code (hand edit adopted)          | auction  | TCK-002 | P2    | [tickets.json](../showcases/auction/.aise/tickets.json) |
| Code (hand edit repaired in code) | auction  | TCK-003 | P4    | [tickets.json](../showcases/auction/.aise/tickets.json) |
| Design                            | booking  | pending | P2    | waits for #4: booking has not reached P7 yet            |

## The changes and what they updated

**To do TCK-001 "Tasks need a due date" (requirement).** Entry at P1, then P2, two P3 reviews, P4
and P5. Updated: REQ-001, REQ-005, new REQ-009 and REQ-010; UC-001 to UC-004; SEQ-001, SEQ-002 and
SEQ-004; DSN-003 to DSN-008, new DSN-009 (`TaskView`); `src/tasks-app/*`, `src/app/app.ts`,
`public/index.html`; `test/UC-001` to `UC-005`; `docs/requirements.md`, `docs/design.md`, `README.md`.
Tests 48 passed, 0 failed.

**Auction TCK-001 "Sellers can set a reserve price" (requirement).** Entry at P1, then P2, P4 and
P5. Updated: REQ-001, REQ-004, new REQ-012; UC-002 to UC-006; SEQ-002, SEQ-003, SEQ-005 and SEQ-006;
13 design elements, new DSN-044 (`PublicItem`); 11 files under `src/` plus `public/index.html`; 6 test files.
Tests 57 passed, 0 failed.

**Auction TCK-002 (drift, code to design).** A method `Item.timeLeftMs(now)` added by hand to
`src/auction-api/Item.ts`. The P4 check found one difference (`method timeLeftMs: in code, not in
design`), the gate failed, and a drift ticket opened from it. Repaired in the design direction: the
design agent added the method to DSN-015, P4 turned stale and Update confirmed no code change was
needed. Updated: the design model and its rendering `docs/design.md` (DSN-015, plus five click links in the overview diagram; see Noise in a diff below). Tests 57 passed.

**Auction TCK-003 (drift, design to code).** The parameter of `Item.isOpen` renamed by hand from
`now` to `at`. The check found `method isOpen: parameters (now: Date) in design, (at: Date) in code`.
Repaired in the code direction: the code agent renamed it back, the design stayed as it was.
Updated: `src/auction-api/Item.ts` only. Tests 57 passed.

All gates (P4, P5, P6) passed after the last ticket; the deploy check answered 200 on both services.
Reproduce: `npx tsx scripts/run-showcase.ts auction drift` (about $0.66 of API credit for both tickets).

## How the artefacts stay aligned

- **Staleness by hashes.** Each approved phase stores hashes of what it was built from: P2 the
  requirement hashes, P4 the design element hashes, P5 the code and test hashes, P6 the service
  plan and the code. A changed upstream artefact marks the downstream phase stale, so the walk
  through a ticket follows from data and is not left to the model.
- **Drift check.** `detect_drift` compares the design classes with the code (ts-morph, signatures
  only) by the `@trace DSN-*` tags: missing in code, missing in design, or changed. Its result is
  stored with the code and design hash, so a hand edit makes the P4 gate show "out of date" and
  never an old green result.
- **Tickets.** The maintenance agent triages with `trace` and `detect_drift` and writes a plan (entry
  phase, affected IDs, steps); the developer approves it, then approves each phase it makes stale.
  A drift ticket asks the developer for the direction: adopt the code into the design (P2) or
  restore the design in the code (P4). The close run writes the report from the runs, diffs and
  stored test result, not from memory.
- **Traceability IDs.** REQ, UC, SEQ and DSN IDs are shared by requirements, diagrams, `@trace`
  tags and test names, so a report can name what changed in each layer.

## Where it fails

- **Behaviour is not compared.** Drift covers signatures, attributes and relations. A changed
  method body (for example `timeLeftMs` returning a negative number) passes as aligned; only a test
  can catch it, and TCK-002 added none.
- **Wiring is outside the design.** `src/app/` (routes, `createApp`) is ignored by drift, and event
  payloads are not designed: in auction TCK-001 the test named the `reserveMet` field from
  `PublicItem` because the design does not define the payload.
- **Criteria without a design element.** Visual criteria (to do REQ-002 AC3, REQ-007 AC1) and
  "no admin role" (auction REQ-008) have no class or method covering them, so coverage reports them
  as gaps, and they stay checked by hand.
- **Noise in a diff.** TCK-002's design run also added click links for five unrelated nodes to the
  overview diagram in `docs/design.md`. The links change no element, but the report has to explain
  them.
- **Report limits.** The close brief clips walk notes at 300 characters (#24; the to do TCK-001
  report says of a P1 note that "the brief cuts it off"), and plan steps can name the wrong phase (#25).
- **One ticket at a time.** A second ticket waits until the one in progress closes; two concurrent
  changes are never merged.
