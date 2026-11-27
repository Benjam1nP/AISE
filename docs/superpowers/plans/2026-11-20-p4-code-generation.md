# P4 Code Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a TypeScript project from the approved design (one file per class, wiring, front end), gated by typecheck and drift, with a P4 chat, staleness and a read only Code tab.

**Architecture:** Plain code plans one file per design class; Haiku workers write the files in parallel rounds, typecheck and drift decide done, attempt 3 escalates to Sonnet; a Sonnet code agent writes `src/app/` and `public/`. The orchestrator gains P4 as a third chat phase with its own gate read from a stored checks file.

**Tech Stack:** TypeScript, SvelteKit, Anthropic SDK (own loop in `agents/loop.ts`), zod, ts-morph, Vitest, Docker runner, CodeMirror 6.

**Spec:** `docs/superpowers/specs/2026-11-20-p4-code-generation-design.md` (read it first; section numbers below refer to it).

## Global Constraints

- Server code under `src/lib/server` uses relative imports and `process.env` only; no `$lib`, `#lib`, `$env`.
- UI imports `src/lib` with `#lib/*`.
- Opus is never used by P4. Worker model `claude-haiku-5-5`, escalation and code agent `claude-sonnet-5-5`. Check effort values against the `claude-api` skill before choosing.
- Worker concurrency cap 4. Attempts per file: 2 Haiku, then 1 Sonnet. Code agent turn limit 40, worker 6.
- Cost guard: stop starting workers above $3, skip wiring, run `failed`.
- Class file path `src/<component kebab>/<ClassName>.ts`; wiring in `src/app/`, entry `src/app/main.ts`; `start` script `tsx src/app/main.ts`.
- Generated code may only use packages in `runner/package.json` and `node:sqlite`.
- Code hash covers `src/`, `public/`, `package.json`, `tsconfig.json`. Checks file `.aise/checks/P4.json`.
- No hyphens or dashes as punctuation in UI copy (repo copy style); write plain sentences.
- Verification gate before every commit: `npm run check && npm run lint && npm test`; Task 9 also `npm run test:docker`.
- Update `docs/decisions.md` (date 2026-11-20, what, why) in the task that makes a decision listed in spec sections 5 to 8.

## Review Focus

1. A class in a cycle of relations (`Task` uses `TaskList`, `TaskList` uses `Task`) must plan and generate without deadlock: workers get design signatures, not files. Test in Task 3.
2. A tsc error in `src/app/main.ts` or a file outside the plan must not be routed to a class file or crash routing. Test in Task 5.
3. A hand edit after a run (code hash changed) must turn the P4 gate to "out of date", never show the stale green result. Test in Task 6.
4. A P4 run discarded after the developer approved P4 must refuse when files changed since the run (same guard as P1 and P2). Test in Task 6.
5. A worker that writes to any path other than its own must get a tool error and the file must not change. Test in Task 2.

---

### Task 1: Code model details and drift

Model: `sonnet`, effort `high`.

**Files:**
- Modify: `src/lib/server/core/tools/code-model.ts` (add `line` to `Decl`; add structured fields to `Member`)
- Modify: `src/lib/server/core/types.ts` (code side normaliser)
- Create: `src/lib/server/core/drift.ts`, `src/lib/server/core/drift.test.ts`
- Create: `src/lib/server/core/tools/drift.ts` (tool), register in `core/tools/index.ts`
- Modify: `src/lib/server/core/tools/code-model.test.ts`, `tools.test.ts`

**Interfaces:**
- Produces:
  - `Decl.line: number` (1 based, line of the declaration name).
  - `Member` gains `type?: string` (property, getter return), `optional?: boolean`, `params?: { name: string; type: string; optional: boolean }[]`, `returnType?: string` (declared text; for `async` without annotation, the inferred `Promise<...>` text).
  - `normaliseCodeType(type: string, classNames: Set<string>): string` in `core/types.ts`: like `normaliseType` but any identifier is allowed; on failure returns the text with whitespace removed.
  - `type DriftItem = { kind: 'missing_in_code' | 'missing_in_design' | 'changed'; id?: string; name: string; file?: string; line?: number; details: string[] }`
  - `detectDrift(design: DesignDoc, code: CodeModel, paths: Record<string, string>): DriftItem[]` in `core/drift.ts`; `paths` maps class ID to its planned path (Task 3 provides `planPaths`; until then the test passes a literal map).
  - Tool `detect_drift` (input `{}`), returns `{ clean: boolean; items: DriftItem[] }`; already listed for `code` and `maintenance` in `scope.ts`.

- [ ] **Step 1: Write failing tests in `drift.test.ts`**, one `it` per rule of spec section 7, on a two class design (`Task` DSN-001 in component `Tasks`, `TaskStatus` enum DSN-002) and a hand built `CodeModel`:
  - clean code gives `[]`
  - class absent in code: `missing_in_code` with `id: 'DSN-001'`
  - exported class `Helper` absent in design: `missing_in_design` with file and line
  - matched by `@trace DSN-001` under name `Todo`: `changed`, details mention the name
  - file at `src/other/Task.ts`: `changed`, details mention the expected path
  - `@trace DSN-001 REQ-009` when design says `REQ-001`: `changed`, details mention REQ IDs
  - attribute type `Array<string>` against `string[]`: clean
  - optional property `due?: Date` against `Date | undefined`: clean
  - method param name or order differs: `changed`
  - enum values differ: `changed`
  - inheritance relation without `extends`: `changed`
  - private member not in design: clean; design method present only as private: clean
  - `readonly`, `static`, constructor: ignored
  - non exported class: ignored; class under `src/app/`: ignored

- [ ] **Step 2: Run `npx vitest run src/lib/server/core/drift.test.ts`**. Expected: FAIL, module not found.

- [ ] **Step 3: Extend `code-model.ts`** with `line` and the `Member` fields, add assertions for them to `code-model.test.ts` (one class with a getter, an optional property, an async method).

- [ ] **Step 4: Implement `normaliseCodeType` and `detectDrift`**. Match by `@trace` DSN ID (first `DSN-\d{3}` in a tag starting `@trace`), else by name. Compare normal forms on both sides.

- [ ] **Step 5: Add the `detect_drift` tool**: `buildCodeModel(ctx.store.dir)`, design from `read_design`'s source, `planPaths(design)` (stub in this task as a local helper with the same rule, moved to Task 3's module there). Add one `tools.test.ts` case: tool returns `clean: true` on a matching fixture.

- [ ] **Step 6: Run `npm test`**. Expected: PASS.

- [ ] **Step 7: Decision entry** for drift rules (spec section 7), then commit `feat(core): detect_drift against the design`.

---

### Task 2: Code state, checks, write scope, delete_file

Model: `sonnet`, effort `high`.

**Files:**
- Create: `src/lib/server/core/code-state.ts`, `code-state.test.ts`
- Modify: `src/lib/server/core/tools/registry.ts` (`ToolContext.writeOnly?: string`)
- Modify: `src/lib/server/core/tools/files.ts` (enforce `writeOnly`; add `delete_file`), `scope.ts` (`delete_file` for `code`), `index.ts`, `files.test.ts`
- Modify: `src/lib/server/core/store.ts` if a backed up delete helper is needed

**Interfaces:**
- Consumes: `detectDrift`, `DriftItem` (Task 1), `runTypecheck`, `TypecheckResult` (`check.ts`).
- Produces:
  - `CODE_ROOTS = ['src/', 'public/', 'package.json', 'tsconfig.json']`
  - `codeHash(store: ProjectStore): Promise<string | null>` (null when no file under `src/`)
  - `hasCode(store: ProjectStore): Promise<boolean>` (at least one file under `src/`)
  - `listCodeFiles(store: ProjectStore): Promise<string[]>` sorted project relative paths under `CODE_ROOTS`
  - `designHashes(design: DesignDoc): Record<string, string>` over the fields in spec section 8
  - `type CodeChecks = { at: string; codeHash: string | null; typecheck: TypecheckResult | null; drift: DriftItem[] }`, `readChecks(store)`, `writeChecks(store, c)` at `.aise/checks/P4.json`
  - `runCodeChecks(ctx: ToolContext, opts?: { typecheck?: typeof runTypecheck }): Promise<CodeChecks>` (runs both, writes the file, returns it; typecheck `null` when there is no `package.json`)
  - Tool `delete_file` (input `{ path }`), backs the file up under the run, same write scope as `write_file`.

- [ ] **Step 1: Failing tests**:
  - `codeHash` changes when a file under `src/` changes and not when `.aise/` or `test/` changes; null for an empty project
  - `designHashes` unchanged when only a `description` changes; changed when an attribute type changes; includes node IDs
  - `runCodeChecks` with a fake typecheck writes `.aise/checks/P4.json` with the current `codeHash`
  - `write_file` with `writeOnly: 'src/tasks/Task.ts'` writing `src/tasks/Other.ts`: tool error naming the allowed path; file absent
  - `delete_file` then `restoreRun` brings the file back

- [ ] **Step 2: Run them**. Expected: FAIL.

- [ ] **Step 3: Implement** the interfaces above.

- [ ] **Step 4: `npm test`**. Expected: PASS.

- [ ] **Step 5: Commit** `feat(core): code hash, P4 checks file, delete_file, single file write scope`.

---

### Task 3: Plan and scaffold

Model: `haiku`, effort `xhigh`.

**Files:**
- Create: `src/lib/server/codegen/plan.ts`, `plan.test.ts`, `src/lib/server/codegen/scaffold.ts`, `scaffold.test.ts`
- Modify: `src/lib/server/core/tools/drift.ts` (use `planPaths` from here, drop the Task 1 stub)

**Interfaces:**
- Produces:
  - `type FilePlan = { classId: string; name: string; path: string; component: string; uses: string[] }`
  - `planCode(design: DesignDoc): FilePlan[]` (throws `Error` on duplicate path)
  - `planPaths(design: DesignDoc): Record<string, string>`
  - `kebab(name: string): string`
  - `scaffold(ctx: ToolContext): Promise<string[]>` writes `package.json` and `tsconfig.json` through `write_file` when missing; returns written paths

- [ ] **Step 1: Failing tests**:
  - `kebab('Task API') === 'task-api'`, `kebab('TaskService') === 'task-service'`
  - path `src/task-api/TaskController.ts` for a class in component `Task API`
  - `uses` contains relation targets and classes named in `Promise<Task[]>` and `TaskStatus | undefined`, without itself, sorted
  - two classes in a relation cycle both plan, each listing the other in `uses`
  - duplicate path throws
  - `scaffold` writes `package.json` with the runner dependencies, the project name and `start: tsx src/app/main.ts`, and `tsconfig.json` equal to the `NO_TSCONFIG` example; existing files are left untouched

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: `npm test`, expect PASS.**

- [ ] **Step 5: Commit** `feat(codegen): file plan and scaffold`.

---

### Task 4: Code agent and worker definitions

Model: `sonnet`, effort `high`.

**Files:**
- Create: `src/lib/server/agents/code.ts`, `src/lib/server/agents/code-worker.ts`, `src/lib/server/agents/stack-rules.ts`
- Modify: `src/lib/server/agents/index.ts` (`AGENTS` gains `code`), `agents.test.ts`

**Interfaces:**
- Produces:
  - `STACK_RULES: string` (spec section 6 stack rules, verbatim in substance)
  - `codeAgent: AgentDef` (Sonnet, tools `TOOLS_BY_AGENT.code` plus `delete_file`, system prompt covering wiring, chat and update modes)
  - `workerDef(model: 'claude-haiku-5-5' | 'claude-sonnet-5-5'): AgentDef` (tools `read_file`, `write_file`)
  - `workerBrief(design: DesignDoc, reqs: RequirementsDoc, plan: FilePlan, retry?: { content: string; errors: string[] }): string`: the user message for a worker
  - `wiringBrief(plans: FilePlan[], failing: string[]): string`, `updateBrief(changed: string[], added: string[], removed: string[]): string`

- [ ] **Step 1: Failing tests in `agents.test.ts`**:
  - `workerBrief` contains the class JSON, the signature and import path of every class in `uses` (relative, `.js` extension), the texts of its `reqIds`, and on retry the current content and every error
  - `codeAgent.tools` contains `typecheck`, `detect_drift`, `delete_file`; `workerDef('claude-haiku-5-5').tools` equals `['read_file', 'write_file']`
  - neither definition uses `claude-opus-5-5`

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: `npm test`, expect PASS.**

- [ ] **Step 5: Commit** `feat(agents): code agent and code worker`.

---

### Task 5: Generation pipeline

Model: `sonnet`, effort `high`.

**Files:**
- Create: `src/lib/server/codegen/generate.ts`, `generate.test.ts`

**Interfaces:**
- Consumes: `planCode`, `scaffold` (Task 3), `workerDef`, `workerBrief`, `codeAgent`, `wiringBrief` (Task 4), `runCodeChecks` (Task 2), `runAgent`.
- Produces:
  - `type FileStatus = 'planned' | 'writing' | 'checking' | 'retrying' | 'escalated' | 'ok' | 'failed'`
  - `type GenerateEvent = { type: 'file'; path: string; status: FileStatus; attempt: number } | { type: 'wiring'; event: AgentEvent }`
  - `generateCode(opts: { ctx: ToolContext; design: DesignDoc; reqs: RequirementsDoc; onEvent: (e: GenerateEvent) => void; run?: typeof runAgent; checks?: typeof runCodeChecks; costLimitUsd?: number }): Promise<RunResult & { files: Record<string, FileStatus> }>`

Algorithm (spec 5.3 and 5.4): scaffold; round 1 all files (cap 4); after each round `checks`; a file is ok with no tsc error whose `file` equals its path and no drift item whose `id` equals its class ID; failing files retry with their errors; attempt 3 uses `workerDef('claude-sonnet-5-5')` with `writeOnly` set to the path; after attempt 3 failing files are `failed`; then the code agent with `wiringBrief` (turn limit 40); final `checks`. Usage and cost summed over every call. Status `done` unless an exception or the cost guard.

- [ ] **Step 1: Failing tests** with a fake `run` that writes files through `executeTool` and a fake `checks`:
  - three classes, all ok in round 1: three workers, one wiring call, `files` all `ok`, events in order planned, writing, checking, ok
  - at most 4 workers run at once (eight classes, fake run counts concurrent calls)
  - a file with a tsc error is retried with the error text in the brief; attempt 3 uses Sonnet; still failing gives `failed` and the run is `done`
  - a tsc error in `src/app/main.ts` affects no class file
  - cost above `costLimitUsd` after round 1: no further worker, no wiring, status `failed`, error names the limit
  - a thrown typecheck error (Docker down) ends `failed` with its message
  - a worker that writes nothing counts as a failed attempt
  - a design with no classes plans nothing, still runs wiring, ends `done`

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: `npm test`, expect PASS.**

- [ ] **Step 5: Decision entry** (parallel rounds instead of dependency order, cost guard), commit `feat(codegen): generation pipeline with escalation`.

---

### Task 6: Orchestrator P4

Model: `opus`, effort `medium` (state transitions; repo rule: Opus at medium only).

**Files:**
- Modify: `src/lib/server/orchestrator/orchestrator.ts`, `gates.ts`, `staleness.ts`, `bus.ts`, `src/lib/server/core/state.ts`, `core/runs.ts`
- Modify: `orchestrator.test.ts`, `gates.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 4, 5.
- Produces:
  - `PhaseState.designHashes?: Record<string, string>`; `RunMeta.designHashes?` (taken at the start of Generate and Update runs only)
  - `ChatPhase = 'P1' | 'P2' | 'P4'`
  - `checkGate('P4', reqs, design, checks: CodeChecks | null, currentHash: string | null)` with checks labelled `Code exists`, `Typecheck passes`, `Code matches the design`; the last two fail with detail `out of date` when `checks.codeHash !== currentHash`
  - `Orchestrator.generateCode(name): Promise<{ runId: string }>`, `Orchestrator.checkCode(name): Promise<void>`; `sendMessage`, `approve`, `stillValid`, `updateStale` accept `'P4'`
  - `ProjectSnapshot` gains `files: string[]`, `gates.P4`, `chat.P4`, `staleDesignIds: string[]`, `codegen: Record<string, FileStatus> | null` (progress of the active run)
  - `WorkspaceEvent` gains `{ type: 'codegen_file'; runId: string; path: string; status: FileStatus; attempt: number }`
  - `Deps.generate?: typeof generateCode`, `Deps.checks?: typeof runCodeChecks` for tests

- [ ] **Step 1: Failing tests in `orchestrator.test.ts`** (fake `generate`, fake `checks`, fake `run`):
  - approving P2 on a project without code starts a P4 run; with code it does not
  - `generateCode` refuses (ConflictError) when P2 is not approved, stale, or its design fails `validateDesign`, and when code exists
  - P4 run end writes the checks file; gate passes on clean checks
  - editing a file under `src/` afterwards: gate shows `out of date` (Review Focus 3)
  - approve P4 with failing gate needs `override`, recorded
  - after approval, a design change on a class (P2 re approved) makes P4 `stale` with that ID in `staleDesignIds`; a description only change does not
  - a P4 chat run on stale P4 does not refresh `designHashes`, so P4 stays stale after it
  - `updateStale(name, 'P4')` starts a code agent run whose message lists changed, added and removed IDs
  - `stillValid(name, 'P4')` re approves with the current hashes
  - discarding a P4 run restores files; refuses when the code hash differs from the run's `postArtefactHash` (Review Focus 4)
  - a restart with a P4 run left `running` marks it failed and settles P4
  - `codegen_file` events are published and `snapshot().codegen` reflects the latest status per path

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** Keep P1 and P2 behaviour unchanged (existing tests stay green). P4 artefact hash is `codeHash`. Generation runs go through `generate` instead of `run`; chat and update runs use `run` with `codeAgent`. Every P4 run ends with `checks` before `settle`.

- [ ] **Step 4: `npm test`**. Expected: PASS, including all existing orchestrator tests.

- [ ] **Step 5: Decision entries** (P4 staleness hashes, run status rule, auto start), commit `feat(orchestrator): P4 phase, gate and staleness`.

---

### Task 7: Routes

Model: `haiku`, effort `xhigh`.

**Files:**
- Modify: `src/routes/p/[name]/+page.server.ts`, `routes.test.ts`
- Create: `src/routes/p/[name]/file/+server.ts`

**Interfaces:**
- Consumes: Task 6 orchestrator methods; `safePath`, `canRead` from `core/tools`.
- Produces:
  - form actions `generate`, `checkCode`; `send`, `approve` accept `phase=P4`; `stillValid` and `update` take a `phase` field (`P2` default)
  - `GET /p/[name]/file?path=<rel>` returns `text/plain` content; 400 for a path outside `CODE_ROOTS` or refused by `rejectReason`; 404 when missing

- [ ] **Step 1: Failing tests in `routes.test.ts`**: `generate` calls `generateCode`; `update` with `phase=P4` calls `updateStale(name, 'P4')`; file endpoint returns content of `src/tasks/Task.ts`, 400 for `.env` and `.aise/state.json`, 404 for a missing file.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: `npm test`, expect PASS.**
- [ ] **Step 5: Commit** `feat(routes): P4 actions and file endpoint`.

---

### Task 8: Code tab and P4 UI

Model: `sonnet`, effort `high`. Use the `svelte:svelte-file-editor` agent conventions and the Svelte MCP autofixer on every component.

**Files:**
- Create: `src/lib/components/CodePanel.svelte`, `CodeViewer.svelte`, `CodegenProgress.svelte` and a `.svelte.test.ts` for each
- Modify: `src/routes/p/[name]/+page.svelte`, `PhaseBar.svelte`, `GatePanel.svelte`, `StaleBanner.svelte`, `Chat.svelte` (phase type), `GatePanel.svelte.test.ts`, `StaleBanner.svelte.test.ts`
- Modify: `package.json` (`codemirror`, `@codemirror/lang-javascript`, `@codemirror/state`, `@codemirror/view`)
- Modify: `docs/design-system.md` (new components)

**Interfaces:**
- Consumes: snapshot fields from Task 6, routes from Task 7, `codegen_file` events via `WorkspaceStream`.
- Produces:
  - `CodePanel` props `{ snapshot: ProjectSnapshot; open?: { path: string; line?: number } }`: file tree from `snapshot.files`, viewer for the selected file, `@trace` IDs above a class file
  - `CodeViewer` props `{ content: string; line?: number }`: CodeMirror read only, TypeScript, scrolls to and highlights `line`
  - `CodegenProgress` props `{ files: Record<string, FileStatus> }`: one row per path with status
  - `GatePanel` and `StaleBanner` accept `phase: 'P1' | 'P2' | 'P4'`; P4 gate items (tsc errors, drift items) are buttons that open the file at the line; "Check again" submits `checkCode`

- [ ] **Step 1: Failing component tests**:
  - `CodePanel` lists `src/tasks/Task.ts` and loads it via `fetch('/p/todo/file?path=src%2Ftasks%2FTask.ts')` on click
  - `CodeViewer` renders content, no editable content (`contenteditable="false"`)
  - `CodegenProgress` shows `retrying (attempt 2)` for a retrying file
  - `GatePanel` with `phase="P4"` shows the three checks, a drift item as a button, `out of date` detail, and a "Check again" button
  - `StaleBanner` with `phase="P4"` lists `staleDesignIds`
  - P4 view without code shows a "Generate code" button that submits `generate`; with code it does not
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Code tab enabled when `snapshot.files.length > 0` or a P4 run is active; during a generation run it shows `CodegenProgress`. P4 rail entry enabled once P2 is approved. The page picks P4 as the attention phase when P2 is approved and P4 is not. Load the `ui-craft` skill for layout within the existing design system.
- [ ] **Step 4: `npm run check && npm run lint && npm test`**. Expected: all pass, no svelte-check warnings.
- [ ] **Step 5: Run the app** (`run` skill) on a fixture project with generated files and confirm the tab, viewer and gate visually.
- [ ] **Step 6: Commit** `feat(ui): Code tab, generation progress and P4 gate`.

---

### Task 9: Smoke run, Docker test, docs

Model: `sonnet`, effort `high`.

**Files:**
- Create: `scripts/smoke-p4.ts`, `test/docker/codegen.test.ts`, `test/fixtures/p4/` (small design plus generated files)
- Modify: `README.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `AGENTS.md` (command list)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Docker test**: on `test/fixtures/p4/`, `runCodeChecks` returns `typecheck.ok === true` and `drift === []`; editing one method signature in a temp copy gives one `changed` item.
- [ ] **Step 2: `npm run test:docker`**. Expected: PASS.
- [ ] **Step 3: `scripts/smoke-p4.ts`**: creates a temp project from the fixture design, approved P1 and P2, runs `generateCode` live, prints per file status, gate and cost. Not in CI.
- [ ] **Step 4: Run the smoke script once** (needs `ANTHROPIC_API_KEY`, costs credit; ask the user before running). Record cost and result in the PR description.
- [ ] **Step 5: Docs**: agents table and codegen pipeline in `ARCHITECTURE.md` and `README.md`; CHANGELOG entry; `npm run` and smoke command in `AGENTS.md`.
- [ ] **Step 6: Full gate**: `npm run check && npm run lint && npm test && npm run test:docker`. Quote the output.
- [ ] **Step 7: Commit** `test(p4): docker check and smoke run; docs`.
