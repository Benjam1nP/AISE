# P5 testing: design

Status: approved, 2026-11-20. Extends section 8 of `2026-11-04-ai-se-environment-design.md` for P5 and
reuses the pipeline of `2026-11-20-p4-code-generation-design.md`. Where they disagree, this
document wins for P5.

## 1. Intent

P5 derives tests from the requirements and the design, runs them in Docker, explains failures and
fixes them, so every acceptance criterion can be followed to a test and its last result (C5) and
the generated code is shown to work (C7). The demo moment: a hand edit breaks a method, a test
fails, the test agent explains why and proposes a fix, Apply fix patches `src/`, the run is green.

Success: the to-do showcase goes from approved code to a green suite with one test per must
acceptance criterion, in one run, and the hand edit demo works end to end.

## 2. Goals, non-goals, anti-goals

Goals
- One test file per use case, one test per acceptance criterion, one scenario test per sequence.
- Tests derived from requirements, design and the code's API surface, never from `src/` bodies
  (enforced by the test agent's read scope).
- Triage: every failing test is classified as a test bug (fixed by the test agent) or a code bug
  (explanation plus proposed fix, shown in the UI).
- Apply fix: the code agent patches `src/` from a finding; tests and P4 checks re-run.
- Gate checked by code: tests exist, every must criterion has a test, tests type check, all pass.
- P5 chat, Run tests (no LLM), staleness on requirement or use case change with Update and Still
  valid, discard of every P5 run kind.
- `code_model` also lists the HTTP routes registered in `src/app/`.

Non-goals (this slice)
- Stryker mutation score (follow-up PR: runner image plus an on demand button).
- A diff approval step before a fix is written (apply, then Discard; diffs come with P7).
- Bug reports and the Trace tab (P7, roadmap step 5).
- Coverage reports.

Anti-goals
- A test changed to match buggy code. The acceptance criterion is the truth; the test agent may
  only change a test that contradicts the requirements, the design or the API surface.
- An LLM decides which test files exist. The plan is computed.
- A full regeneration that overwrites tests the developer asked for in the chat.

## 3. Approach

The developer picked A: the P4 pattern.

| | Approach | Trade off |
|-|----------|-----------|
| A | **Chosen.** Plain code plans one test file per use case; Haiku workers write them in parallel; one test run; a Sonnet test agent triages failures; Apply fix hands a finding to the code agent. | Same shape as P4, cheap, plan unit testable without an API key. |
| B | One Sonnet test agent writes, runs and fixes everything. | Less code, Sonnet price for all output, turn limit risk on the auction showcase. |
| C | Sonnet planner dispatching workers through a tool. | Nondeterministic plan; rejected for P4 already. |

## 4. Developer workflow

1. Approving P4 starts a P5 generation run when the project has no file under `test/` (P1 to P2
   and P2 to P4 pattern). In the same state the Tests tab shows "Generate tests". Once tests exist
   there is no regenerate: changes go through the chat or Update.
2. During the run the Tests tab lists every planned test file with its state (planned, writing,
   checking, retrying, escalated, ok, failed), then a line for triage.
3. The run ends with P5 awaiting approval. The Tests tab shows tests grouped by use case with pass,
   fail or manual, each labelled with its `REQ-xxx ACn`. Clicking a test opens its file at its line.
4. Findings: each code bug shows the failing test, the explanation and the proposed fix, with an
   "Apply fix" button. Tests the triage corrected are listed as "test corrected" with the reason.
5. Apply fix starts a code agent run; it ends with typecheck, drift and the full suite. Discard
   last run restores `src/`.
6. "Run tests" re-runs the suite without an LLM, also after a hand edit; the gate shows "out of
   date" until then.
7. The developer approves (override allowed over a failing gate, like P2 and P4).
8. A requirement or use case change after approval marks P5 stale with Update and Still valid.

## 5. Generation pipeline

New module `src/lib/server/testgen/`, plain code, no SvelteKit imports.

### 5.1 Plan (`plan.ts`, pure)

`planTests(reqs, design) -> TestFilePlan[]`:
`{ ucId, name, path: 'test/UC-001.test.ts', criteria: { reqId, n, text, manualHint }[], sequenceIds, classIds }`.

- One entry per use case. Its criteria are the acceptance criteria of its `reqIds`, numbered from
  1 per requirement (`REQ-003 AC2` is the second criterion of REQ-003).
- A requirement linked to several use cases is tested in the first one by ID order only.
- Requirements linked to no use case go to `test/REQ-xxx.test.ts`, one file each.
- `classIds`: classes linked to the same REQ IDs plus the classes the use case's sequences call.
- `manualHint` is true for non functional criteria; the worker decides, see 5.3.

### 5.2 Test naming (the trace contract)

`describe('UC-001 Add task', ...)`, `it('REQ-003 AC1: <criterion text>', ...)`,
`it('SEQ-002 scenario: <name>', ...)`. A criterion without a practical automated test becomes
`it.todo('REQ-007 AC2: manual: <reason>')` and counts as "verified manually". `parseTestName`
(pure) reads the IDs back from Vitest results; coverage is computed from it.

### 5.3 Workers and rounds (`generate.ts`)

- Worker: `runAgent` with Haiku 5.5, tools `read_file` (test agent scope, no `src/`) and
  `write_file` with `writeOnly` its one path, at most 8 turns. Attempt 3 uses Sonnet 5.5.
- Brief: test rules (section 6), the plan entry, the requirement texts, the use case and its
  sequences, the `code_model` declarations of `classIds`, `createApp`'s signature and the routes.
  `code_model` is computed once per run.
- Round 1: every planned file in parallel, cap 4. After each round one `typecheck` and one
  `run_tests`.
- A file is ok when it has no tsc error, no suite level error (import or syntax failure), and a
  test or todo named for every criterion in its plan. Assertion failures do not make a file
  retry; they go to triage. Retries get the file and its problems; after attempt 3 it is failed.
- Cost guard: $2 per generation run; above it no new worker starts and triage is skipped.

### 5.4 Triage

The Sonnet test agent runs once after the rounds when tests fail, with the failing tests (name,
message, log tail), the requirement texts and the API surface. Per failure it either:
- fixes the test with `write_file`, when the test contradicts the requirements, design or API
  (wrong import, signature, route, setup), and records it with `report_test_fix`; or
- records a code bug with `report_code_bug { test, reqId, explanation, proposedFix }`, without
  touching the test.

It re-runs the tests (`run_tests`) before finishing; turn limit 30. The two report tools store
findings for the run; the orchestrator writes them to the checks file. A run whose pipeline
finished is done even with failing tests (P4 rule); failed means infrastructure error or cost guard.

### 5.5 Chat, Update and Apply fix runs

- Chat run: the test agent with the P5 chat history; changes only the tests the request involves;
  may report findings.
- Update run (stale P5): the test agent with the changed REQ and UC IDs; patches only their test
  files, writes files for new use cases, deletes files of removed ones (`delete_file` with the
  test scope).
- Apply fix: the code agent (Sonnet, P4 tools) with the finding, the failing test's file and
  output. Run phase P5, agent `code`. It must not touch `test/`; its scope already forbids it.
- Every P5 run ends with the P5 checks; Apply fix runs also refresh the P4 checks.

## 6. Agents

| Agent | Model | Tools | Writes |
|-------|-------|-------|--------|
| Test worker | Haiku 5.5; Sonnet 5.5 on attempt 3 | `read_file`, `write_file` | its one test file |
| Test | Sonnet 5.5 | `read_requirements`, `read_design`, `code_model`, `list_files`, `read_file`, `write_file`, `delete_file`, `run_tests`, `typecheck`, `report_test_fix`, `report_code_bug` | `test/` |
| Code (Apply fix) | Sonnet 5.5 | P4 tools | `src/`, `public/`, `package.json`, `tsconfig.json` |

Test rules (shared prompt): Vitest with explicit imports from `vitest`; ESM, `.js` import
extensions; HTTP through `supertest` on `createApp()` (fresh app and `:memory:` database per test,
no listening, no network); classes imported from the paths `code_model` gives; one assertion
focus per test; expected values come from the criterion, never from guessing the implementation;
error cases check the status code (404 for not found, 400 otherwise, from the wiring contract).

## 7. `code_model` routes

`code_model` gains `routes: { method, path, file, line }[]`: calls of `get`, `post`, `put`,
`patch`, `delete` on any object in `src/app/` whose first argument is a string literal. Pure
extraction with ts-morph, unit tested.

## 8. Gate, checks and state

- Test hash: sha256 over the paths and contents of `test/`, like the code hash.
- Checks file `.aise/checks/P5.json`: `{ at, codeHash, testHash, typecheck, result: RunTestsResult, findings, testFixes }`.
- `checkGate('P5', ...)`:
  - "Tests exist": at least one file under `test/`.
  - "Every must criterion has a test": every must requirement's criteria appear as a test or a
    manual todo; detail lists the missing `REQ-xxx ACn`.
  - "Tests type check": no tsc error in `test/`.
  - "All tests pass": `result.ok`.
  - The last two fail "out of date" when the stored code or test hash differs from the current one.
- Approval needs P4 approved and not stale. It stores `reqHashes` (P2 pattern) and the hashes of
  the use cases and sequences (name, reqIds, messages).
- Staleness: approved P5 turns stale when those hashes change. Code changes do not make P5 stale;
  they make the checks out of date.
- `checkTests(name)`: runs typecheck and tests, writes the checks file, no LLM.

## 9. Orchestrator, events, UI

- `ChatPhase` gains P5. New actions `generateTests`, `checkTests`, `applyFix(name, findingId)`;
  `sendMessage`, `approve`, `stillValid`, `updateStale`, `discardLastRun` accept P5.
- `codegen_file` events are reused for test files; the snapshot's `codegen` covers both.
- Snapshot gains `gates.P5`, `chat.P5`, `testChecks`, `staleTestIds`, and `files` includes `test/`.
- Tests tab (enabled once tests exist or a P5 run is active): results grouped by use case, findings
  panel with Apply fix, test file viewer (existing CodeViewer), gate panel, chat, stale banner.
- Phase rail: P5 enabled once P4 is approved. `recover()` settles P5.

## 10. Edge cases

- Code has no `createApp` (wiring failed): workers get only the classes; HTTP criteria become
  failing tests, triage reports them as code bugs.
- Test run timeout or Docker down: run failed with the reason; files written stay (discard removes).
- A test file loops forever: the run timeout ends it; the file is reported failed.
- Findings refer to a test that no longer exists after a later run: shown as resolved, Apply fix hidden.
- Apply fix that does not make the test pass: the finding stays open with the new output.
- Use case without criteria (all its requirements tested elsewhere): it gets only its scenario tests.
- MCP writes to `test/` do not mark P5 stale (known limit, as in P1 to P4).

## 11. Tests

- `plan.ts`: per use case files, criteria numbering, shared requirement tested once, orphan
  requirements, class selection.
- `parseTestName` and coverage: AC, scenario and manual names, missing criteria.
- `generate.ts` with fake model and fake checks: parallel round, retry on tsc or suite error, no
  retry on assertion failure, escalation, failed after 3, cost guard, triage only on failures.
- Report tools: stored per run, schema validated.
- `code_model` routes extraction.
- Orchestrator: auto start on P4 approval, gate and out of date, approve with override, staleness
  on requirement and use case change, Update, Still valid, Apply fix refreshes P4 and P5 checks,
  discard, recovery.
- UI component tests: results by use case, findings with Apply fix, progress list, P5 gate.
- Docker: one `test:docker` case running a generated test file against the to-do fixture.
- `scripts/smoke-p5.ts`: live run on the to-do fixture, not in CI.

## 12. Docs

ARCHITECTURE.md (testgen pipeline, triage, agents table), README agents table,
`docs/decisions.md` (approach A, apply then discard, Stryker as follow-up, test naming contract),
CHANGELOG.

## 13. Left to the builder

Prompt wording, turn limits and caps within reason, effort values, UI layout within the design
system, event and file names not fixed above.
