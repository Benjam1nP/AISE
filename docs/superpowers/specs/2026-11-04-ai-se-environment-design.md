# AI-assisted SE environment: design

Date: 2026-11-04. Status: draft for approval. Authors: Arthur and Benjamin, with Claude.

This is the frozen design record. Once building starts, `ARCHITECTURE.md` becomes the living
version and is updated in every PR that changes the architecture. Visual summary:
`docs/diagrams/design-summary.html`. Course brief:
`docs/context/project_requirements.md`. Kickoff answers: `docs/questions/answers.json`.

## 1. Intent

A local web workspace where a developer takes a software project from a vague idea to tested,
deployed code, and then maintains it. An orchestrator walks the project through seven phases (P1
requirements to P7 maintenance) and stops after each one for the developer to review, discuss,
change and approve. LLM agents do the work through one MCP tool server. Every artefact is a file
in the project folder.

What sets it apart is alignment: requirements, diagrams, code and tests share IDs, the diagrams
are generated from one typed design model, and the system detects drift between that model and
the code and offers to repair it in either direction. This targets C2 and C5, the two criteria we
want to be clearly best at.

## 2. Goals, non-goals, anti-goals

Goals

- All seven phases work end to end on three showcases: to-do app (small), room booking system
  (medium), real time auction platform with an external API (large).
- Requirements first: the requirements agent keeps asking until nothing is vague or missing.
- Every requirement can be followed to its diagram elements, code and tests, and back.
- All three change kinds (requirement, design, hand edit to code) and a bug report propagate on
  the to-do app, with change reports committed; the system shows which artefacts changed. The live
  demo shows a design change (P3), a requirement change and a hand edit (P7). Booking and auction
  each get at least one committed maintenance change.
- Both of us can explain every part of the system. Minimal beats clever.

Non-goals

- Auth, multiple users, cloud hosting.
- Generated code in languages other than TypeScript.
- A WYSIWYG diagram editor. Diagrams change through chat.
- Git integration inside generated projects.
- A second LLM provider before the deadline (only if time is left, see section 11).

Anti-goals (failure even if every phase technically works)

- A demo that looks like a fixed script with prompts in it (C4).
- Diagrams that do not match the code (C5).
- A system so large or clever that one of us cannot explain a part of it at the Q&A.

## 3. Developer workflow

1. The developer opens the workspace, creates a project (name only) and describes the idea in the
   chat.
2. P1: the requirements agent asks at most 5 questions per round, in the chat. The requirements
   panel fills in as answers arrive. "Approve" is enabled when no open questions are left; "Approve
   anyway" turns the open questions into recorded assumptions.
3. P2 to P6: after each approval the next phase runs. Its output appears in the artefact panel,
   the developer discusses it in the chat ("why is Booking a separate class?", "add a waiting
   list"), and approves, asks for changes, or discards the run.
4. Going back is always allowed. Changing an approved artefact marks every later phase stale.
5. P7: the developer files a change request or bug report in the chat, or edits code by hand. The system shows
   the impact, updates the artefacts phase by phase with a gate each, and writes a change report.

Screen: phase bar on top (status per phase: not started, running, awaiting approval, approved,
stale). Chat on the left, bound to the current phase. Artefact tabs on the right: Requirements,
Diagrams, Code, Tests, Deploy, Trace, Changes. Agent tool calls show collapsed in the chat and
expand on click. Token cost per phase shows in the footer. Clicking a diagram element inserts its
ID into the chat, which is how the developer comments on a diagram without a diagram editor.

## 4. Architecture

```
Browser (SvelteKit UI) <-- SSE events / HTTP actions --> SvelteKit server
                                                          ├─ Orchestrator (plain code: phases, gates, staleness)
                                                          ├─ Agents (LLM loop: prompt + model + tool subset)
                                                          └─ MCP client ──stdio──> MCP tool server
                                                                                    ├─ core (schemas, render, trace, drift)
                                                                                    ├─ project files (.aise/, src/, test/)
                                                                                    └─ Docker (tests, compose)
```

- One TypeScript package. SvelteKit hosts the UI and the server side (orchestrator, agents). The
  MCP server is a second entry point in the same package (`npm run mcp`) that imports the same
  core code. Claude Code can use it too via `.mcp.json`.
- The orchestrator is deterministic code, not an LLM. It owns phase state, gates and staleness,
  starts agent runs, and streams their events to the UI.
- Agents never call each other. They communicate only through artefacts on disk, handed over by
  the orchestrator, so every hand off is inspectable.
- Our own agent loop (about 100 lines) on the Anthropic TypeScript SDK: send messages with the
  agent's tools, execute tool calls through the MCP client, repeat until the model stops or a turn
  limit (30) is hit. Prompt caching on system prompt and artefacts.
- Tools are defined once in core (name, zod input schema, handler). In week 1 the agent loop calls
  this registry in process; in week 2 the MCP server wraps the same registry and the loop switches
  to the MCP client. Agents and prompts do not change.

Why not an agent framework (LangGraph, Claude Agent SDK): a small loop we wrote is easier to
explain, to scope per agent and to log, and the brief explicitly allows lightweight
orchestration.

## 5. Agents

| Agent | Phases | Model | Tools | Output |
|-------|--------|-------|-------|--------|
| Requirements | P1 | Sonnet | requirements | `requirements.json` |
| Design | P2, P3 | Opus | requirements (read), design, trace | `design.json`, review findings |
| Code | P4, code side repairs | Sonnet | design (read), files, trace, typecheck, detect_drift | `src/`, `package.json` |
| Test | P5, bug reports | Sonnet | requirements and design (read), code_model, files, run_tests | `test/`, explanations, fix proposals |
| Deploy | P6 | Sonnet | design (read), files, deploy_check | `Dockerfile`, `compose.yaml`, `RUN.md` |
| Maintenance | P7 | Opus | all read tools, trace, detect_drift | impact list, drift repair plan |

The maintenance agent writes nothing. Its final message is a structured impact list or repair
plan (zod validated), which the orchestrator stores under the run and turns into update mode
runs of the other agents.

Haiku writes the short summary shown at each gate and the summary paragraph of a change report.
It is a helper call, not an agent. The rest of the change report (artefacts touched, diffs) is
computed by code from the run backups.

Why multiple agents (C4): each one has its own instructions, model, and a narrow tool set, which
keeps prompts small, lets us pick the cheapest model that works per phase, and limits damage (the
requirements agent cannot touch code). Opus goes where reasoning across artefacts matters
(design, maintenance); Sonnet where output follows a clear spec.

Each agent is one file: system prompt, model, allowed tools, and the output it must produce.

## 6. Artefacts

Per project folder (showcases live in `showcases/<name>/` in this repo):

```
.aise/
  state.json            phase status, approval time, hashes of inputs at approval
  requirements.json     P1 source of truth
  design.json           P2/P3 source of truth
  chat/<phase>.jsonl    conversation per phase
  runs/<runId>/         agent events, token use, cost, backups of files touched
  changes/CR-001.md     change reports
docs/                   generated, read only: requirements.md, design.md, trace.md
src/  test/  package.json  Dockerfile  compose.yaml  RUN.md
```

- JSON files are validated with zod schemas on every write. An invalid write fails the tool call,
  and the agent gets the validation errors back to fix them.
- `docs/*.md` are generated from the JSON so graders can read the artefacts on GitHub, which
  renders Mermaid. They carry a "generated, do not edit" header.
- Before an agent run touches a file, the write tool backs it up under the run. "Discard run"
  restores the backups; the Changes tab diffs backups against current files.

### Requirements model

`REQ-001`: title, text ("The system shall ..."), type (functional, non-functional), priority
(must, should, could), acceptance criteria (list). Plus open questions, assumptions and out of
scope items. Editable by hand in the panel and through chat.

### Design model

One JSON model, all diagrams derived from it.

- Actors and use cases (`UC-001`): name, actors, linked REQ IDs.
- Classes (`DSN-001`): name, kind (class, interface, enum), attributes, methods (name, params,
  return type), relations (association, composition, inheritance, dependency, with multiplicity),
  linked REQ IDs.
- Sequences (`SEQ-001`): one per key use case. Messages reference a class and one of its methods.
- Components and deployment nodes (`DSN-0xx`): component, the classes it contains, the node it
  runs on. HTTP routes are classes too (for example `TaskController`), so they appear in the class
  and sequence diagrams.
- Activity diagrams: optional, only for use cases with real branching.

Types use TypeScript syntax (`string`, `Date`, `Task[]`, `Promise<Booking>`). `update_design`
parses each type with the TypeScript parser, rejects anything that does not parse ("list of
Task"), and resolves every identifier against built in types and the design's classes, so `date`
or `task` is rejected too. Types are stored in a normal form (`Array<T>` becomes `T[]`), and drift
compares normal forms, so writing style never turns into false drift.

Non functional requirements link to components or deployment nodes instead of classes. Where no
practical automated test exists, the requirement is marked "verified manually" in the trace.

The LLM never writes Mermaid. Diagrams are rendered from the model by plain code, so they are
valid by construction. Consistency across diagrams comes from references: a sequence message
points at a method in the class model, so a rename or removal that breaks a reference fails
validation and the design agent must fix every diagram in the same change. This is the P3
consistency mechanism.

Mermaid has no use case diagram type; use cases render as a flowchart with actor and ellipse
nodes. Deployment renders as a flowchart with subgraphs. We accept this over PlantUML because
Mermaid renders in the browser and on GitHub without a Java server.

## 7. Traceability and drift

IDs travel like this: `REQ-003` is linked from `UC-002` and `DSN-004` in `design.json`. The code
agent writes one file per class (`src/<component>/<ClassName>.ts`) with a JSDoc tag
`@trace DSN-004 REQ-003` on the class. Wiring that is not in the design (server setup, route
registration, database connection, the `/health` endpoint, entry points) lives in `src/app/`, and
the static front end in `public/`; both are outside drift detection. Tests live in `test/UC-002.test.ts` with `describe("UC-002 ...")` and
`it("REQ-003 AC1: ...")`.

- Trace query (deterministic): from any ID, return linked requirements, design elements, files
  with line numbers, tests and their last result. The Trace tab and `docs/trace.md` show this as a
  table. A requirement with no design element or no test is flagged.
- Suspect links: on design approval, `state.json` stores a hash of each requirement object
  (text, type, priority, acceptance criteria). If a requirement changes later, every element
  linked to it is marked suspect until reviewed.
- Drift detection (deterministic): ts-morph extracts a class model from the exported classes,
  interfaces and enums in `src/` outside `src/app/` (fields, methods with signatures, extends and implements, field
  types that point at other classes). This is compared with the class part of `design.json`,
  matched by `@trace` ID, then name. Each difference is one drift item: missing in code, missing in
  design, or changed. Non-exported helpers are ignored.
- Drift repair: the maintenance agent explains each item and suggests a direction; the developer
  picks per item. "Update design" hands the item to the design agent in update mode, which changes
  `design.json` (fills in descriptions and REQ links) and may propose a new requirement for the
  developer to add. "Update code" hands the item to the code agent.

  | Drift item | Update design | Update code |
  |------------|---------------|-------------|
  | missing in code | remove the element from the design | implement it |
  | missing in design | add it to the design, link REQs | delete it from the code |
  | changed | take the code's version | change the code to match the design |

- Drift check runs after every code edit in the UI, when a project opens, and on demand.
- Sequence drift (basic): for each sequence message, check that the calling method's body
  contains a call to the target method. Second in the cut order.
- Known limit: a class renamed in code without its `@trace` tag shows as one item missing and one
  added. Listed under "where it fails" in the report.

## 8. Phase details

| Phase | Input | Output | Gate passes when |
|-------|-------|--------|------------------|
| P1 | idea, answers | `requirements.json` | no open questions, or approved anyway |
| P2 | requirements | `design.json` with use case, class, sequence, deployment | schema and references valid, every must REQ linked |
| P3 | design, developer comments | updated design, optional self review findings | same as P2 |
| P4 | design | code mirroring the class model | typecheck passes, drift check is clean |
| P5 | requirements, design, code | tests, results, explanations | full test suite passes |
| P6 | design, code | Dockerfile, compose, run docs | `docker compose up` answers the health check |
| P7 | change request, bug report or hand edit | updated artefacts, change report | each affected phase passed its own gate again |

Gates are checked by code and shown next to the Approve button. The developer can still approve
with a failing check; the override is recorded in `state.json`.

- P3 self review is on request: uncovered requirements (computed) plus an LLM review for missing
  classes and unclear responsibilities. First to cut.
- P5: one `describe` per use case, one test per acceptance criterion, plus scenario tests from
  sequences. The test agent works from the requirements, the design and the code's API surface
  (`code_model`: exported signatures, no method bodies), so tests follow the requirements, not the
  implementation. Its `read_file` scope excludes `src/` (section 9), so this is enforced, not just
  asked for. It explains failures from the test output, stack traces and `code_model`; the code
  agent, which can read `src/`, turns the proposed fix into a diff. The Stryker mutation score is
  the evidence; Stryker runs in the same container as the tests and is part of the base image.
- Tests run in Docker (generated code never runs on the host), in a prebuilt base image with the
  fixed stack's dependencies plus a cached `node_modules` volume, so a run does not pay for
  `npm install`.
- On failure the test agent explains the cause and proposes a fix. If the fix is in `src/`, the
  orchestrator hands it to the code agent; after the developer approves the diff, the tests
  re-run. The C7 demo is a hand edit that breaks a method, a failing test, the explanation, the
  fix, a green run.
- P6: services in `compose.yaml` follow the deployment nodes in the design. `deploy_check` builds,
  starts, polls the health URL, and stops the stack.
- P7 propagation: the maintenance agent computes impact from the trace links, then the
  orchestrator re-runs the affected phases in order (requirements, design, code, tests, deploy) in
  update mode, each with its gate. The change report lists every artefact touched, with diffs.
- Bug report: the test agent writes a failing test linked to the affected REQ and UC IDs, the P5
  fix loop runs until it passes, and the change report records it.
- Update mode patches, it never regenerates: the agent gets the list of affected IDs and changes
  only the elements and files linked to them. Hand edits elsewhere survive.
- A stale phase shows a banner with two actions: "Update" (runs update mode) or "Still valid"
  (re-approves without changes). A later phase cannot be approved while an earlier one is stale.

Generated project stack (fixed, so prompts stay narrow): TypeScript, Node 22, Express, Vitest,
SQLite where persistence is needed, `ws` for real time, a small static front end in `public/`.
Every project is one codebase. Several deployment nodes (the auction showcase) become several
entry points in `src/app/`, built into one image and run as several compose services.

## 9. MCP tool server

| Tool | Does |
|------|------|
| `read_requirements`, `write_requirements` | read and validated write of `requirements.json` |
| `read_design`, `update_design` | read and validated write of `design.json`, regenerates `docs/` |
| `list_files`, `read_file`, `write_file` | file access scoped to the project folder, with run backups |
| `trace` | trace query for an ID |
| `typecheck` | `tsc --noEmit` in the test container, returns errors with file and line |
| `code_model` | exported classes and signatures extracted from `src/`, no method bodies |
| `detect_drift` | code model diffed against the design |
| `run_tests` | Vitest in Docker, returns a structured result |
| `deploy_check` | compose up, health check, compose down |

Each agent gets only the tools in its row of section 5. `write_file` also checks a path scope per
agent: code agent `src/`, `public/`, `package.json`; test agent `test/`; deploy agent `Dockerfile`,
`compose.yaml`, `RUN.md`. `read_file` and `list_files` are scoped too: the test agent cannot read
`src/`; other agents read the whole project.

The server serves one project. It is started with the project root as an argument
(`npm run mcp -- --project showcases/todo`), and every path, backup and tool call is relative to
that root. The orchestrator starts one server process per open project; `.mcp.json` points Claude
Code at one project.

## 10. Errors, cost, safety

- Tool errors and validation errors go back to the agent as tool results, so it can fix them.
- API errors (rate limit, overload) retry 3 times with backoff, then the UI shows what failed and
  offers Retry or Retry with Sonnet. A crashed test run shows as a failed run with the log tail.
- An optional second API key (`ANTHROPIC_API_KEY_FALLBACK`) is used after an auth or rate limit
  error. It only helps with rate limits if it belongs to a different Anthropic organisation,
  because limits apply per organisation.
- Every run logs tokens and cost per phase in `.aise/runs/`. The UI shows the total per phase;
  the report uses the numbers. Budget: $500 per month of Anthropic credit.
- Secrets live in `.env` (gitignored). File tools reject paths outside the project folder.

## 11. Repo, docs, process

- Layout: `src/` (SvelteKit app; server code under `src/lib/server/`: `core/`, `agents/`,
  `orchestrator/`, `mcp/`), `showcases/`, `docs/`. AGENTS.md gets the stack and commands once the
  skeleton exists.
- CI (GitHub Actions) on every PR and on main: typecheck, lint, unit tests of the core (schemas,
  rendering, trace, drift). Main must always pass.
- Docs we keep current: `README.md` (setup and the architecture summary the course asks for),
  `ARCHITECTURE.md` (living), `CHANGELOG.md`, `docs/decisions.md` (one entry per decision: date,
  what, why), `docs/reflection/<name>.md` (personal notes for the report, including how we used
  Claude Code). No `PRODUCT.md` or `PRD.md`: this spec covers their content.
- Git: branch per issue, PR, squash merge, review by the other person optional. Work tracked in
  GitHub issues, chat on WhatsApp. No fixed split; both of us must be able to demo everything.
- Demo fallback: a recorded run, announced as such. A Command Code provider fallback only if time
  is left; LLM calls go through one function so it can be added without touching the agents.
- Setup check in week 1: Docker works on both machines (Docker Desktop with WSL on Windows).

## 12. Live demo (12 minutes, strict)

On the to-do app. Checkpoints are plain copies of the project folder taken at each gate by a
script (`todo@P2`, `todo@P5`, ...); the workspace lists them as projects, so a slow run can be
skipped while every phase is still shown. No checkpoint feature in the product.

| Time | What we show | Criteria |
|------|--------------|----------|
| 0:00 | Problem, architecture slide | C4 |
| 1:00 | P1: vague idea, one question round, approve | C1 |
| 2:30 | P2/P3: diagrams, a design change through chat (all diagrams update) | C1, C2 |
| 4:00 | P4 from checkpoint: trace a requirement to diagram, code and test | C5 |
| 5:00 | P5: tests run; inject a bug by hand, test fails, explanation, fix, green | C7 |
| 6:30 | P6: `docker compose up`, app answers | C1 |
| 7:15 | P7: requirement change propagates, change report with diffs | C2, C5 |
| 8:45 | P7: hand edit adds a method, drift found, design updated | C2 |
| 10:00 | Booking and auction artefacts in the repo, what broke on the large one | C6 |
| 11:00 | Wrap up, buffer | |

The bug injection and the hand edit stay separate: a bug changes behaviour but not structure, so
it produces no drift and cannot show "code change reflected in the design". The full script goes
in `docs/demo.md` in week 3.

## 13. Timeline and cuts

- Week 1 (Nov 4 to 10): skeleton, schemas, rendering, tool registry, agent loop, P1, P2.
  Milestone: to-do idea to approved diagrams.
- Week 2 (Nov 11 to 17): MCP server, P3 to P6, trace view. Milestones: to-do app tested and
  running in Docker; booking taken through P1 to P4, so scaling problems show up early.
- Week 3 (Nov 18 to 24): P7 (all change kinds, bug reports) and drift repair, booking and auction
  end to end, docs, demo script, slides, recorded run.
- Nov 25 to Dec 1: buffer. Dress rehearsal by Dec 3. Presentations Dec 7 / 14, code Dec 16.

Cut order if late: P3 self review, sequence drift, activity diagrams, trace view as a plain list,
smaller auction showcase.

Auction external API (proposal, confirm in week 1): Frankfurter, a free exchange rate API with no
key, to show bids in several currencies. It appears as an external node in the deployment
diagram and is mocked in tests.

Expected limits for the report (our guess now): the auction showcase will stress real time
tests, sequence diagrams for concurrent bidding, and the external API; renames without `@trace`
tags show as remove plus add.

## 14. Open source we build on

Besides the stack (SvelteKit, Mermaid, Anthropic and MCP SDKs, zod, ts-morph, Vitest, Docker):

| Project | Use | Criterion | When |
|---------|-----|-----------|------|
| Stryker Mutator | mutation score for the generated tests, on demand in P5 (too slow for the gate) | C7 | now |
| CodeMirror 6 with `@codemirror/merge` | editor in the Code tab, diffs in the Changes tab | C3, C2 | now |
| MCP Inspector | inspect and demo the MCP server on its own (`npx @modelcontextprotocol/inspector`) | C4 | now |
| dependency-cruiser | component level drift: rules generated from the design's components | C2, C5 | after ts-morph drift works |
| xyflow (Svelte Flow) | clickable trace graph next to the trace table | C5, C3 | stretch |

Rejected: Langfuse and Arize Phoenix (heavy services; our run log covers cost), tplant and tsuml2
(unmaintained), Doorstop, StrictDoc and OpenFastTrace (Python or Java), Kroki and mermaid-cli
(need a server or a headless browser), promptfoo (a Vitest eval file is enough).

Prior art to cite in the report: GitHub Spec Kit (spec to code, no diagrams or drift), BMAD
(role based agents), OpenFastTrace (origin of ID tags in code), Doorstop (origin of suspect links).

## 15. Left to the builder

Prompt wording, UI styling and components, exact Mermaid styling, schema field names beyond those
above, the external API for the auction, retry timings.
