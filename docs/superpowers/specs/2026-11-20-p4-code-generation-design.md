# P4 code generation: design

Status: draft, 2026-11-20, builder check done. Extends section 7 and 8 of `2026-11-04-ai-se-environment-design.md`
for P4. Where the two disagree, this document wins for P4.

## 1. Intent

P4 turns the approved design into a TypeScript project whose structure mirrors the class diagram,
so a requirement can be followed from diagram to code (C5) and the code is visibly derived from
the design, not from the raw idea (C1). It is the first phase that writes code, and P5 to P7 build
on its output: tests read its API surface, deployment runs it, maintenance repairs drift against it.

Success: the to-do showcase goes from an approved design to code that type checks with a clean
drift check, in one run, with every design class in its own file tagged with its IDs. The
developer sees progress per file, can discuss the code in a chat, and approves at a gate.

## 2. Goals, non-goals, anti-goals

Goals
- Generate from `design.json` only: one file per design class, plus wiring in `src/app/`, a small
  static front end in `public/`, `package.json`, `tsconfig.json`.
- Gate: typecheck passes and drift is clean, both checked by code.
- `detect_drift` tool (ts-morph code model against the design's classes).
- P4 chat: the developer asks for changes; a run patches only the files involved.
- P4 staleness: a design change after P4 approval marks P4 stale, with Update and Still valid.
- Code tab: file tree, read only viewer, gate panel with errors and drift items that open the file
  at the line, live progress per file during a run.
- Discard last run works for P4 runs, like P1 and P2.

Non-goals (this slice)
- Editing code in the UI. The developer prefers agent driven changes; hand edits happen in an
  external editor or through Claude Code over the MCP server, and drift picks them up.
- Drift repair (P7), sequence drift, component level drift (dependency-cruiser).
- The `trace` tool and Trace tab (roadmap step 5).
- Tests (P5) and deployment files (P6).

Anti-goals
- An LLM decides the file list or order. The plan is computed from the design.
- Code that type checks but no longer matches the design (that is what the drift gate prevents).
- A run that silently overwrites hand edits outside the files it was asked to touch.

## 3. Approaches

| | Approach | Trade off |
|-|----------|-----------|
| A | **Chosen.** Plain code plans one file per class; Haiku 5.5 workers write one file each; typecheck and drift decide done; two failed Haiku attempts escalate the file to Sonnet; a Sonnet code agent then writes the wiring. Chat and Update runs use the Sonnet code agent directly. | Two paths (batch for generation, agent for patches). Cheap, deterministic plan, unit testable without an API key, matches "the orchestrator is plain code". |
| B | A Sonnet planner dispatches workers through a tool. | Looks more multi agent, but the plan is nondeterministic and the design already defines it. |
| C | One Sonnet code agent for everything (original spec section 5). | Least code, but all output at Sonnet price, and the auction showcase risks the turn limit (C6). Contradicts the 2026-11-09 decision. |

The developer picked A.

## 4. Developer workflow

1. Approving P2 starts a P4 generation run automatically when the project has no class or wiring
   file under `src/` (same pattern as P1 approval starting P2; a discarded first run therefore
   starts again on the next P2 approval). In the same state the P4 view shows a "Generate code"
   button. Once code exists there is no regenerate: changes go through the chat or Update, so hand
   edits and chat patches are never overwritten by a full run. P4 runs need P2 approved, not stale,
   and a design that passes `validateDesign` (a P2 approved over a failing gate blocks P4 with a
   ConflictError naming the issues).
2. During the run the Code tab lists every planned file with its state: planned, writing,
   checking, retrying (attempt n), escalated, ok, failed. Then a line for the wiring step.
3. When the run ends, P4 is awaiting approval. The gate panel shows "Typecheck passes" and "Code
   matches the design", each with its items. Clicking an item opens the file at its line.
4. The developer reads the code, asks for changes in the P4 chat ("store tasks in a Map instead of
   SQLite"), and approves. Approving over a failing gate is allowed and recorded as an override,
   like P2.
5. A hand edit outside the app changes the code hash; the gate shows "Checks out of date" and the
   UI runs the checks again when the project opens and on "Check again".
6. When the design changes and P2 is approved again, P4 turns stale and shows the changed IDs with
   Update (patch run) and Still valid.

## 5. Generation pipeline

A new module `src/lib/server/codegen/` (plain code, no SvelteKit imports) with three parts.

### 5.1 Plan (`plan.ts`, pure)

`planCode(design) -> FilePlan[]`, one entry per design class:
`{ classId, name, path: 'src/<component>/<Name>.ts', component, uses: classId[] }`.

- `<component>` is the component name in lower kebab case (`Task API` becomes `task-api`).
  `validateDesign` already guarantees every class has exactly one component.
- `uses`: targets of the class's relations plus every design class named in its attribute,
  parameter and return types.
- Two classes mapping to the same path is a plan error (cannot happen while class names are unique,
  checked anyway).

### 5.2 Scaffold (deterministic)

Before any worker runs, code writes `package.json` (from the runner's `package.json`: same
dependencies, the project's name, `start: tsx src/app/main.ts`) and `tsconfig.json` (the
`NO_TSCONFIG` example), unless they exist. Typecheck needs both from the first round on.

### 5.3 Workers and rounds (`generate.ts`)

- Round 1: every planned file gets a worker, run in parallel with a concurrency cap (4). Workers
  get the design signatures of every class in `uses`, so order does not matter: a file can import a
  class whose file is still being written.
- After each round: one `typecheck` for the whole project and one drift check. A file is ok when it
  has no tsc error and no drift item. tsc errors are routed to files by path.
- Following rounds: only files that are not ok, each with its errors and drift items, and with
  `read_file` access to the files it imports. Attempts 1 and 2 are Haiku; attempt 3 is Sonnet
  (escalated). A file still failing after attempt 3 is marked failed and the pipeline moves on.
- Worker = `runAgent` with a worker definition: model Haiku 5.5, tools `read_file` and
  `write_file`, at most 6 turns, and a write scope of exactly its one path (a new optional
  `ToolContext.writeOnly` checked by `write_file`). The escalated attempt uses the same definition
  with Sonnet 5.5.
- Worker input: the stack rules (section 6), its class as JSON, the signatures of its `uses`, the
  import path of each, the requirement texts of its `reqIds`, and on retries its current file plus
  errors.

### 5.4 Wiring step

The Sonnet code agent (section 6) runs once after the rounds with: the plan, the list of files
still failing, and the instruction to write `src/app/` (Express app, route registration from the
controller classes, SQLite setup with `node:sqlite` when the design has a database node, `GET
/health`, `src/app/main.ts` entry), `public/` (a small static page using the API), and to fix any
remaining tsc errors or drift items. It finishes when `typecheck` and `detect_drift` are clean or
the turn limit is hit.

### 5.5 Chat and Update runs

- Chat run: the Sonnet code agent with the P4 chat history (same `toHistory` as P1 and P2) and
  the developer's message. It changes only the files the request involves.
- Update run (stale P4): the code agent with the changed, added and removed design IDs and the
  instruction to patch only those files: write new class files, change changed ones, delete removed
  ones with a new `delete_file` tool (backed up, so discard restores it). Same write scope as
  `write_file`.
- Every P4 run, of any kind, ends with the checks (section 8) so the gate is current.
- Run status: a run whose pipeline finished is `done`, even when files failed or the wiring agent
  hit its turn limit; those failures show in the gate, not as a run error. A run is `failed` only
  for an infrastructure error (Docker down, typecheck timeout, API error) or the cost guard, which
  also skips the wiring step.

## 6. Agents

| Agent | Model | Tools | Writes |
|-------|-------|-------|--------|
| Code worker | Haiku 5.5; Sonnet 5.5 on attempt 3 | `read_file`, `write_file` | its one file |
| Code | Sonnet 5.5 | `read_design`, `list_files`, `read_file`, `write_file`, `delete_file`, `typecheck`, `detect_drift` | `src/`, `public/`, `package.json`, `tsconfig.json` |

Effort: the lowest each model supports that still passes the to-do run; Opus is not used. Turn
limit for the code agent 40.

Stack rules (shared by both prompts): TypeScript, ESM, Node 22, Express 5, `ws`, `node:sqlite`,
only packages from the runner image; relative imports with `.js` extensions; one exported
declaration per class file, named as in the design; JSDoc `@trace DSN-xxx REQ-xxx ...` on it;
attributes, methods, parameters and return types exactly as the design states them (extra private
members are fine); `kind: interface` becomes an `interface`, `kind: enum` an `enum` with the listed
values; inheritance relations become `extends` or `implements`.

## 7. Drift (`detect_drift`)

`detectDrift(design, codeModel) -> DriftItem[]`, pure, in `src/lib/server/core/drift.ts`; the
tool wraps it with `code_model`'s extraction (exported classes, interfaces, enums in `src/`
outside `src/app/`).

- Matching: by `@trace` DSN ID, then by name.
- Item: `{ kind: 'missing_in_code' | 'missing_in_design' | 'changed', id?, name, file?, line?, details: string[] }`.
- `changed` compares: declaration name (when matched by ID); file path against the plan's path;
  the REQ IDs of the `@trace` tag against the class's `reqIds`; declaration kind; attributes (name
  and type); methods (name, parameter names and types in order, return type); enum values;
  `extends` and `implements` against inheritance relations.
- Type comparison: both sides are normalised with the design's normaliser, extended for code with
  any identifier allowed (so `DatabaseSync` or `Express.Request` normalise instead of failing). A
  type that still does not normalise is compared as text with whitespace removed. An optional
  property `x?: T` equals `T | undefined`. `async m(): Promise<T>` is compared by its declared
  return type. `readonly` and `static` are ignored. A getter counts as an attribute of its return
  type.
- Code members that are private or protected and not in the design are ignored; design members
  must exist in code with any visibility. Constructors are ignored.
- Non exported declarations are ignored (section 7 of the main spec).

## 8. Gate, checks and state

- Code hash: sha256 over the sorted paths and contents of `src/`, `public/`, `package.json`,
  `tsconfig.json`. It is P4's artefact hash for run bookkeeping (`prevArtefactHash`,
  `postArtefactHash`, keep approved state after a run that changed nothing, discard guard).
- Checks file `.aise/checks/P4.json`: `{ at, codeHash, typecheck: TypecheckResult, drift: DriftItem[] }`,
  written by every P4 run's final check and by the new `checkCode(name)` action.
- `checkGate('P4', ...)` reads the checks file: "Code exists", "App entry exists", "Typecheck
  passes", "Code matches the design". When the stored `codeHash` differs from the current one, the last two fail with
  "out of date". The snapshot never runs Docker.
- "Code exists": at least one file under `src/` (the scaffold alone does not count).
- "App entry exists": `src/app/main.ts` is among the code files. A wiring step that stops on its
  turn limit still ends the run done (section 5.5), and neither drift (which ignores `src/app/`)
  nor tsc notices a missing entry, so the gate does.
- Approval: P4 needs P2 approved and not stale. It records `designHashes`: per class, component and
  deployment node ID, the hash of the fields code depends on (classes: name, kind, attributes,
  methods, values, relations, reqIds, component; components: name, classIds, nodeId; nodes: name,
  kind), so a description edit never makes P4 stale. Hashes are taken at the start of the last
  Generate or Update run, the P2 pattern; chat runs do not refresh them, so a chat run cannot clear
  staleness.
- Staleness: an approved P4 turns stale when the current design's element hashes differ from
  `designHashes`; `staleDesignIds` lists them. Update and Still valid work as for P2. Since P2 must
  be approved before P4 can act, a design edit that reopens P2 blocks P4 actions until P2 is
  approved again.

## 9. Orchestrator and events

- `ChatPhase` becomes `P1 | P2 | P4`; artefact hash, reopen and approve gain a P4 branch.
- New actions: `generateCode(name)`, `checkCode(name)`. `sendMessage`, `approve`, `stillValid`,
  `updateStale` and `discardLastRun` accept P4.
- A generation run is one `RunMeta` (phase P4, agent `code`); worker and wiring costs and usage add
  up into it. All writes go through `write_file` with the run ID, so backups and discard work as
  they do now.
- New event `{ type: 'codegen_file', runId, path, status, attempt }` for the progress list. Worker
  tool calls are logged to the run's events file but not streamed; the wiring agent streams like
  any agent.
- `recover()` also settles P4.

## 10. UI

- Phase rail: P4 enabled once P2 is approved.
- Code tab (enabled once code exists or a P4 run is active): file tree on the left, CodeMirror 6
  read only viewer with TypeScript highlighting on the right (CodeMirror because P7 needs
  `@codemirror/merge` for diffs). A header above a class file shows its `@trace` IDs.
- During a generation run the tab shows the progress list instead of the viewer.
- Gate panel for P4 with the three checks, the items under each, "Check again", Approve.
- P4 chat uses the existing `Chat` component; stale banner reuses `StaleBanner`.
- Snapshot gains `files` (paths under the code roots), `gates.P4`, `chat.P4`, `staleDesignIds`.
  File contents load on demand through a `GET /p/[name]/file?path=` endpoint that uses the
  `read_file` scope rules.

## 11. Edge cases

- Design with no classes: the plan is empty, the wiring step still runs; gate shows the result.
- Name clash between a design class and a wiring file is impossible: wiring lives in `src/app/`.
- Typecheck times out or Docker is down: the run ends failed with the reason; files written so far
  stay (discard removes them).
- A worker writes nothing: counts as a failed attempt.
- Cost guard: a generation run stops starting new workers above $3 and ends failed with the reason.
- Hand edit during a run: not prevented; the final check reflects whatever is on disk.
- MCP writes do not mark P4 stale or reopen it (known limit, same as P1 and P2).

## 12. Tests

- `plan.ts`: paths, kebab case, `uses` from relations and types, duplicate path error.
- `drift.ts`: each item kind, type normal form, private member rule, enum values, inheritance.
- `generate.ts` with a fake model and fake typecheck: parallel round, error routing, escalation on
  attempt 3, failed after 3, cost guard, writeOnly scope enforced.
- Orchestrator: auto start on P2 approval, gate from checks file and out of date, approve with
  override, staleness on design change, Update and Still valid, discard of a P4 run, recovery.
- UI component tests: Code tab file tree and viewer, progress list, P4 gate items.
- `scripts/smoke-p4.ts`: live run on a fixture design (needs the API key, not in CI).
- Docker tests: one `test:docker` case that runs typecheck and drift on a small generated fixture.

## 13. Docs

ARCHITECTURE.md (codegen pipeline, agents table), README agents table, `docs/decisions.md`
entries for the choices above, CHANGELOG.

## 14. Left to the builder

Prompt wording, concurrency cap and turn limits within reason, exact effort values, UI layout and
styling within the design system, event and file names not fixed above.
