# MCP server, file tools and Docker runner: design

Status: approved 2026-11-20 (option A). Parent design: `2026-11-04-ai-se-environment-design.md` (sections 5, 8, 9, 10).

## Goal

Give P4 to P6 the tools they need, behind one registry, reachable in process by our agents and over
MCP (stdio) by any client: Claude Code, MCP Inspector, the demo.

## Non-goals

- `detect_drift` and the `@trace` tag convention (issue 2, P4 code generation).
- `trace` query (issue 5, trace view).
- Stryker (issue 3, P5).
- Agents that use the new tools (code, test, deploy agents come with their phases).
- Dependencies outside the fixed stack in generated projects.

## Decision: one registry, two transports

| Option | How | Trade off |
|---|---|---|
| A (chosen) | Agents keep calling `executeTool` in process. A thin stdio entry exposes the same `TOOLS` over MCP. | No process lifecycle, run ID and agent scope stay plain arguments. The MCP server is real and demoable but our own agents do not go through it. |
| B | Orchestrator spawns one MCP server per project and agents call it as an MCP client. | Matches section 9 literally. Run ID and agent identity must be smuggled through each call, plus process supervision and restarts. About two extra days. |

A is a change from section 9 ("the orchestrator starts one server process per open project") and
gets a `docs/decisions.md` entry. Why it still satisfies C4: one tool definition, validated once,
served over both paths; the README shows both.

## Behaviour

### MCP server

- `npm run mcp -- --project <dir> [--agent <name>]` starts a stdio server for one project.
- Without `--agent` it exposes every tool with the widest scope; with it, only that agent's tools
  and path scope (section 9 table).
- The first write of a session creates one run (phase P7, agent `mcp`, marked done at once), so
  writes are backed up and Discard last run can undo them. Read only sessions create no run.
- `.mcp.json` in the repo points Claude Code at `showcases/todo`.
- Errors: validation and `ToolError` come back as MCP tool errors with the same text agents see.

### File tools

- `list_files`, `read_file`, `write_file`, all relative to the project root.
- `ToolContext` gains `agent`. Scope per agent:

| Agent | write | read |
|---|---|---|
| code | `src/`, `public/`, `package.json` | whole project |
| test | `test/` | whole project except `src/` |
| deploy | `Dockerfile`, `compose.yaml`, `RUN.md` | whole project |
| others | none | whole project |

- Always rejected: absolute paths, `..`, paths through a symlink leaving the root, `.aise/`,
  `.env*`, `node_modules/`. Rejections are `ToolError`s naming the allowed scope.
- `write_file` backs up through the store, so Discard last run restores code like artefacts.
- `package.json` writes are rejected when they add dependencies outside the runner image.

### Runner image

- `runner/Dockerfile`: `node:22` slim, non root user, fixed stack preinstalled in
  `/work/node_modules` (express, ws, vitest, typescript, `@types/*`, tsx). Persistence uses the
  built in `node:sqlite`, so no native modules.
- `runner/package.json` is also the template P4 starts from, so generated projects and the image
  cannot disagree.
- Deps live in `/opt/aise/node_modules`; the project is bind mounted at `/opt/aise/app`. Node, tsc
  and Vitest find packages by walking up, so no `npm install` per run and nothing written into the
  project.
- Built on first use (`docker build -t aise-runner:<hash of runner/>`), reused after.

### Docker tools

| Tool | Runs | Returns |
|---|---|---|
| `typecheck` | `tsc --noEmit` | `{ ok, errors: [{ file, line, col, message }] }` |
| `run_tests` | `vitest run --reporter=json`, optional `filter` | `{ ok, passed, failed, tests: [{ name, file, status, error? }], logTail }` |
| `deploy_check` | `docker compose -p aise-<project> up -d --build`, poll health URL, `down -v` always | `{ ok, status, body?, logTail }` |
| `code_model` | ts-morph on the host (reads, never runs code) | exported classes, interfaces, functions with signatures and JSDoc tags, no bodies |

- Containers for `typecheck` and `run_tests`: `--network none`, 1 CPU, 1 GB, 120 s timeout, removed
  after the run.
- `deploy_check` gets network, since the app must answer on a host port; timeout 180 s.
- Docker missing or not running gives one clear `ToolError`: "Docker is not running. Start Docker
  Desktop and retry."
- Outputs are capped (about 200 lines of log tail) so tool results stay small.

## Edge cases

- Project without `package.json`: `typecheck` and `run_tests` say so instead of failing in Docker.
- Vitest crash (no JSON report): `ok: false`, empty tests, log tail shown.
- Timeout: container killed, result says which limit was hit.
- Two runs on one project cannot happen (orchestrator runs one at a time); compose project names
  are per project, so two projects can deploy check side by side if their ports differ.
- Windows with WSL: paths given to Docker are absolute host paths; tested on both machines.

## Tests

- Unit (default `npm test`): path scope table and every rejection rule; `package.json` dependency
  check; Vitest JSON and `tsc` output parsers on recorded output; `code_model` on a fixture
  project; MCP server over the SDK's in memory transport (lists tools, calls `read_requirements`,
  returns a validation error as a tool error, respects `--agent`).
- Docker integration (`npm run test:docker`, `test/docker/`): typecheck with one error, a
  passing and a failing test run, a deploy check on a fixture hello world, Docker down message.
  Runs in a new CI job, so the existing job stays fast and unchanged.
- Manual: MCP Inspector lists and calls the tools; Claude Code uses `.mcp.json`.

## Docs

README (tools and MCP section), ARCHITECTURE.md (diagram line and status), CHANGELOG,
`docs/decisions.md` (transport decision, runner image, `node:sqlite`), AGENTS.md (new commands).
