# Fix loop: the test agent and the code agent work together (design)

Date: 2026-11-26. Status: approved 2026-11-26.

## Intent

When the test agent finds a code bug, it should be able to tell the code agent to fix it, without the developer clicking Apply fix per finding. Today the handoff exists, but only through the developer: triage calls `report_code_bug`, the Tests tab shows the finding with Apply fix, and a click starts a code agent run with `fixBrief`. The fix loop automates that conversation between the agents and makes it visible as one. It serves C4 (documented agent communication), C1 (P5 beyond coding) and the demo path.

## Goals

- One P5 run, the **fix loop**, alternates the test agent and the code agent until the tests are green or a stop rule fires.
- Every handoff is visible: who told whom what, with the finding IDs, in the live run, the run's `events.jsonl` and the P5 chat.
- One Discard last run undoes the whole loop.
- Spend is bounded; no test is weakened silently.

## Non goals

- A general message bus or mailbox between all agents (design, deploy, maintenance).
- A tool that lets one agent call another agent.
- Design changes: when a fix needs a design change, the code agent says so and changes nothing (as in `fixBrief` today); the loop stops and the developer goes to P2.
- Changing Apply fix or Explain failures; both stay for single, manual steps.

## Anti goals

- A test bent to pass the code: the loop must never let triage rewrite the same test file again and again.
- Spending credit nobody expected.
- A fix that breaks the build or the design without showing it: the P4 checks run and show in the P4 gate, as after Apply fix.

## Approaches (chosen: A)

- **A. One fix loop run owning every round (chosen).** A plain code pipeline (`testgen/fix-loop.ts`, in the style of `generateTests`) runs triage, fix and checks per round, switching `ToolContext.agent` per step so each agent keeps its scope. One claim, one cost guard, one Discard. After test generation it starts as its own run on the same claim, so Discard undoes the fixes and keeps the tests.
- B. One run per step, chained by the orchestrator. Reuses Apply fix and Explain failures, but the claim is released between steps, Discard undoes one step only, and stop rules spread over `settle`.
- C. An `ask_code_agent` tool on the test agent, the code agent nested in triage. Reads like agents talking, but nests scopes, is hard to bound and to mock, and is hard to explain at the Q&A.

## Behaviour

### Triggers (developer decided)

1. **After test generation.** When a test generation run settles `done` and its final checks hold at least one open code bug finding, the orchestrator starts a fix loop run at once, on the same claim (no release and re claim in between). Approving P4 can therefore spend up to $2 (tests) plus $3 (loop) without another click; the CHANGELOG and README say so.
2. **Fix automatically** button in the Tests tab (form action `fixLoop`, orchestrator `fixLoop(name)`). Shown when no run is active, P5 is ready (`requireP5Ready`), the stored checks are current (`currentTestChecks`, else "Run tests first") and there is at least one open finding or one unexplained failure. Refused with a `ConflictError` otherwise ("No test fails, nothing to fix").

### One round (at most 3 rounds)

1. **Triage**, only when `unexplainedFailures(checks)` is not empty (so round 1 after generation usually skips it). The test agent (`ctx.agent = 'test'`, 30 turns) gets `triageBrief` with those failures and the log tail, wrapped in `snapshotTests` / `recordUnreportedFixes`. From round 2 the brief adds the list of test files triage already changed in this loop and forbids changing them again.
2. **Handoff.** The open code bug findings (`findingOpen`, test file exists, fewer than 2 fix attempts in this loop) go to the code agent. The orchestrator records the handoff (see Visibility).
3. **Fix.** One code agent call (`ctx.agent = 'code'`, 40 turns) with `fixLoopBrief(findings)`: the rules of `fixBrief` once, then per finding its test, file content and failure output, each fenced. A finding handed over a second time carries "the last attempt did not make this test pass".
   The code agent answers each finding with the new tool `report_fix_result { findingId, outcome: 'fixed' | 'needs_design_change' | 'test_looks_wrong', reason }` (developer decided). It is in the code agent's tool list only for fix loop runs, and results are stored in the run's `findings.json`. A finding with no result counts as `fixed`. A declined finding is never handed back to the code agent in this loop. `needs_design_change` stays open for the developer, and the chat names it. `test_looks_wrong` goes back to the test agent in the next round's triage, together with the code agent's reason. Triage then either corrects the test (`report_test_fix`) or reports the bug again, and in that case the finding stays open for the developer, with no further handoff.
4. **Checks.** `runCodeChecks` then `runTestChecks` under the loop run ID (merging is idempotent per run: the same run and test replaces itself).

### Stop rules (checked after each step)

- No test fails: status `done`.
- Nothing left to do: no unexplained failure, no open finding with attempts left that the code agent did not decline, and no `test_looks_wrong` reply waiting for triage: `done` (failing tests stay for the developer).
- A round changed no file: `done`.
- Round 3 finished: `done`.
- Cost guard $3, checked between steps (soft, like P4 and P5): `failed` with "Cost limit ... exceeded".
- A triage step changed a test file that an earlier triage in this loop already changed (detected from the snapshots, whatever the prompt said): stop, `done`, with a chat note that the test needs the developer. The change stays and is recorded like any triage change.
- A check timed out, Docker down, or an agent step failed with an error: `failed`.
- Broken build or drift after a fix (my call): the next round hands the code agent the typecheck errors and drift items with the findings, as an extra item in `fixLoopBrief`. If the last round still leaves them, the run ends `failed` ("The fix loop left the code with typecheck errors or drift"), never `done`.

Definitions (my calls): an attempt is counted per file plus test name, not per finding ID, since a report again for the same test gets a new ID. "A round changed no file" compares one hash over `src/` and `test/` before and after the round (`p5Hash`); a `package.json` change from `syncStartScripts` does not count. The triage guard counts only triage inside this loop: the generation run's own triage may have changed a file once before.

The run returns `checked: true` only when the last step was the checks, so `finalChecks` does not run them twice.

### Visibility

- A new bus event `agent_message { runId, from, to, text, findingIds }` for every handoff (test to code: "Please fix F-1, F-2: …" with the one line explanations; code to test: one line per finding from `report_fix_result` ("F-1 fixed", "F-2 needs a design change: …", "F-3 test looks wrong: …"); checks: "Round 2: 14 passed, 1 failed"). It is published, written to `events.jsonl`, and shown in the live run as a message between two agents, not as tool output.
- Each handoff is also appended to the P5 chat as an `auto` entry with optional `from` and `to` fields (chat schema gains two optional fields; old files still read). The chat renders it as "Test agent → Code agent". The test agent's history in later P5 chat runs keeps these lines.
- The run summary lists rounds, fixed findings, open findings and test changes.

### Run identity and state

- `RunMeta` gains optional `fixLoop: true`; `run.agent` is `test`. `isCodeRun` is true for a fix loop run, so it syncs the start scripts, renders the README and runs both checks, like Apply fix.
- A fix loop run never adopts `reqHashes` or `useCaseHashes` (no hashes passed), and leaves P4 approved (as Apply fix).
- Every P5 run already saves `checks-before.json`; Discard last run restores `src/`, `test/` and both checks files, guarded by the P5 artefact hash.
- Runs during a ticket in progress belong to it (`openRun` does this already).

## Interfaces

- `src/lib/server/testgen/fix-loop.ts`: `fixLoop(opts: { ctx, run, codeChecks, testChecks, onEvent, onMessage, costLimitUsd? }): Promise<RunResult & { checked: boolean }>`.
- `src/lib/server/agents/test.ts`: `fixLoopBrief(items)`; `triageBrief` gets an optional list of files not to change and of disputed findings with the code agent's reason.
- `core/tools/`: `report_fix_result` (code agent, fix loop runs only); `RunFindings` gains `fixResults`.
- Orchestrator: `fixLoop(name)`, `startFixLoop(store, name, claim)`, a follow up hook in `execute` so a settled generation run can start the loop before `release`.
- `core/runs.ts`: `RunMeta.fixLoop?`. `core/chat.ts`: optional `from`, `to`. `bus.ts`: `agent_message`.
- UI: `TestsPanel.svelte` Fix automatically button; the live run and the chat render `agent_message` entries; `+page.server.ts` action `fixLoop`.

## Tests (mocked agent loop and checks, as today)

- Loop: green after round 1; triage skipped when nothing is unexplained; new failure after a fix triggers triage in round 2; stop at 3 rounds; stop when a round changes nothing; a finding gets at most 2 attempts; second triage change to the same test file stops the loop; cost guard stops between steps; scopes (`ctx.agent`) per step.
- Orchestrator: generation with an open code bug starts a loop run on the same claim (no window for another action); generation without one starts nothing; `fixLoop` refusals (not ready, out of date checks, nothing to fix, run active); Discard restores `src/`, `test/` and the checks.
- Events and chat: handoffs published, logged and recorded with `from` and `to`; old chat files parse.
- UI: button visibility; `agent_message` renders in the live run and chat.
- Live smoke: `scripts/smoke-p5.ts` gets an optional `--fix-loop` flag (costs credit, not in CI).

## Docs

README (agent communication), ARCHITECTURE (P5 section), CHANGELOG, `docs/decisions.md` entry.

## Left to the builder

Exact copy of the handoff lines, the visual style of an agent message (within `docs/design-system.md`), and how `execute`'s follow up hook is shaped.

## Amendments after review

Recorded 2026-11-26 after the code reviews; the body above stays as approved.

- Cost guard: hard per step instead of soft between steps. Each agent step gets what is left of the $3 as its own limit, no step starts with less than $0.10 left, and the loop stops (`failed`) when a step hits its limit or the total reaches $3.
- Baselines: problems the loop caused are judged against the stored P4 and P5 checks only when their hashes match the current files; otherwise the checks run once at the start, without an LLM, and a timeout there ends the loop `failed`. Problems are compared by file and message (drift by kind, name and file), with counts, so a problem that only moved is not new and a second identical one is.
- New typecheck errors outside `test/` and new drift go to the code agent in the next round; the loop never ends `done` while they remain. Typecheck errors under `test/` and errors without a file are never the code agent's.
- A test file that stops loading or gains typecheck errors under `test/` after any step ends the loop at once, `failed` ("The fix loop left test files that no longer load or type check"), with a checks to test message naming the files and no further agent step, because the code agent cannot change `test/`. The chat points to the Tests tab and the P5 chat, never to Fix automatically or Retry.
- A disputed test that triage corrects without reporting the bug again goes back to the code agent (within the 2 attempts), with "The test agent corrected the test; fix the code for the corrected test." instead of the retry line.
- The file of a disputed test is left out of triage's "do not change again" list and out of the changed twice guard for that triage step, so triage can correct it even when an earlier triage of the loop changed the same file.
- Fix automatically and the start after generation need stored checks with a test result; without one no finding counts as confirmed.
- Each handoff carries `seq`, its position in the run from 1, in the `agent_message` event and the chat entry; the chat drops a live handoff whose `seq` a stored entry of the active run has, instead of matching by text.
