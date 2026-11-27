# MCP server, file tools and Docker runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file tools, `code_model`, `typecheck`, `run_tests` and `deploy_check` to the tool registry, run generated code only in Docker, and serve the whole registry over MCP stdio.

**Architecture:** One registry (`src/lib/server/core/tools`), two transports: agents keep calling `executeTool` in process; `src/lib/server/mcp/server.ts` exposes the same `TOOLS` over stdio (option A, approved 2026-11-20). Docker work goes through one helper (`core/docker/`), with the fixed stack preinstalled in a runner image.

**Tech Stack:** TypeScript, zod 4, ts-morph, `@modelcontextprotocol/server` (MCP SDK v2), Docker CLI via `node:child_process`, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-11-20-mcp-server-and-runner-design.md` (parent: `2026-11-04-ai-se-environment-design.md` sections 5, 8, 9, 10).

## Global Constraints

- Node 22.9 or newer. Server code under `src/lib/server` uses relative imports and `process.env` only (no `#lib`, `$lib`, `$env`).
- Generated code never runs on the host. `code_model` only parses with ts-morph.
- `typecheck` and `run_tests` containers: `--network none`, `--cpus 1`, `--memory 1g`, 120 s timeout, `--rm`.
- `deploy_check`: network allowed, 180 s timeout, `docker compose down -v` always runs.
- Log tails capped at 200 lines.
- Docker missing or stopped: `ToolError("Docker is not running. Start Docker Desktop and retry.")`.
- Write scopes: code `src/`, `public/`, `package.json`; test `test/`; deploy `Dockerfile`, `compose.yaml`, `RUN.md`; others none. Read: test agent not `src/`; everyone else the whole project.
- Always rejected for file tools: absolute paths, `..`, symlinks resolving outside the root, `.aise/`, `.env*`, `node_modules/`.
- Generated stack: TypeScript, Node 22, Express, Vitest, `node:sqlite`, `ws`. No native modules.
- Tool errors the agent can fix are `ToolError`; a `PathError` from the store must be turned into a `ToolError` inside the file tools, because `executeTool` rethrows anything else.
- Run `npm run check`, `npm run lint`, `npm test` before every commit.

## Review Focus

- Windows host paths (`C:\Users\...`, WSL `/mnt/c/...`) passed to `docker -v`: must work unchanged on Docker Desktop. Test `hostPathForDocker` in Task 3.
- A symlink inside the project pointing outside it (`src/x -> /etc`): `read_file` and `write_file` reject it. Test in Task 1.
- A large or binary file read by an agent: `read_file` refuses files over 200 KB and non UTF-8 content with a clear message. Test in Task 1.
- A test that never finishes (`while (true)`): the container is killed at the timeout and the result says `timedOut`. Integration test in Task 4.
- `compose up` failing half way (bad Dockerfile): containers are still removed and the build log tail is returned. Integration test in Task 5.

---

### Task 1: Agent scopes and file tools

**Files:**
- Create: `src/lib/server/core/tools/scope.ts`, `src/lib/server/core/tools/files.ts`, `src/lib/server/core/tools/files.test.ts`, `runner/package.json`
- Modify: `src/lib/server/core/tools/registry.ts` (add `agent` to `ToolContext`), `src/lib/server/core/tools/index.ts` (register), `src/lib/server/orchestrator/orchestrator.ts:542` (pass `agent: def.name`), existing tests that build a `ToolContext`

**Interfaces:**
- Produces:
  - `type AgentName = 'requirements' | 'design' | 'code' | 'test' | 'deploy' | 'maintenance' | 'mcp'`; `AgentDef.name` becomes `AgentName`.
  - `ToolContext = { store; runId: string; projectName: string; agent: AgentName }`
  - `canRead(agent: AgentName, rel: string): boolean`, `canWrite(agent: AgentName, rel: string): boolean` in `scope.ts`. `mcp` reads everything and writes the union of all write scopes.
  - `safePath(ctx: ToolContext, rel: string, mode: 'read' | 'write'): Promise<string>` returns the absolute path or throws `ToolError` (wraps `PathError`, checks always rejected paths, scope, and `realpath` of the nearest existing ancestor staying inside `store.dir`).
  - `listFiles` (`list_files`, input `{ dir?: string }`, returns sorted relative paths, skips `node_modules`, `.aise`, `.git`, and paths the agent cannot read).
  - `readFile` (`read_file`, input `{ path }`, returns `{ path, content }`).
  - `writeFile` (`write_file`, input `{ path, content }`, writes via `store.writeFile(rel, content, runId)`, returns `{ ok: true, path, bytes }`).
  - `RUNNER_DEPS: Set<string>` read once from `runner/package.json` (`dependencies` plus `devDependencies`); `write_file` on `package.json` rejects unparsable JSON and any dependency name not in the set, listing the offenders.

- [ ] **Step 1: Create `runner/package.json`** with `"type": "module"`, scripts `test` (`vitest run`) and `typecheck` (`tsc --noEmit`), dependencies `express`, `ws`, devDependencies `typescript`, `vitest`, `tsx`, `@types/node`, `@types/express`, `@types/ws`, `supertest`, `@types/supertest`, pinned to current majors. Run `npm install --package-lock-only` inside `runner/` to produce `runner/package-lock.json`.
- [ ] **Step 2: Write failing tests in `files.test.ts`** (temp project like `tools.test.ts`):
  - `canWrite` table: `code` may write `src/a.ts`, `public/i.html`, `package.json`, not `test/a.test.ts`; `test` may write `test/a.test.ts`, not `src/a.ts`; `deploy` may write `Dockerfile`, `compose.yaml`, `RUN.md`, not `src/a.ts`; `design` writes nothing.
  - `test` agent: `read_file` on `src/a.ts` is an error result naming its scope; `list_files` omits `src/`.
  - rejected for every agent: `/etc/passwd`, `../x`, `.aise/state.json`, `.env`, `.env.local`, `node_modules/x/index.js`; each returns `isError: true`, never throws.
  - symlink `src/out -> <tmpdir outside>`: read and write through it are errors.
  - `read_file` of a 300 KB file and of a file with a NUL byte: error mentioning the size limit or binary content.
  - `write_file` creates parent folders, backs up under the run (assert `touchedFiles(store, runId)` is true), returns `{ ok: true, path: 'src/a.ts', bytes: 5 }` for `'hello'`.
  - `write_file` `package.json` with dependency `left-pad`: error containing `left-pad`; with `express`: ok.
- [ ] **Step 3: Run** `npx vitest run src/lib/server/core/tools/files.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement** `scope.ts`, `files.ts`, the `ToolContext.agent` field, registration in `TOOLS`, and `agent: def.name` in the orchestrator. Update existing tests to pass `agent`.
- [ ] **Step 5: Run** `npm run check && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(tools): file tools with per agent path scopes`.

### Task 2: `code_model`

**Files:**
- Create: `src/lib/server/core/tools/code-model.ts`, `src/lib/server/core/tools/code-model.test.ts`, `test/fixtures/projects/shop/src/{cart.ts,item.ts,index.ts}`
- Modify: `package.json` (add `ts-morph`), `src/lib/server/core/tools/index.ts`

**Interfaces:**
- Consumes: `ToolContext`, `safePath` (read scope applies to `src/`; the test agent may still call `code_model`, which is the point: signatures without bodies).
- Produces:
  ```ts
  type Member = { name: string; kind: 'constructor' | 'method' | 'property'; signature: string; static: boolean; visibility: 'public' | 'protected' | 'private' };
  type Decl = { name: string; kind: 'class' | 'interface' | 'function' | 'type' | 'enum'; file: string; signature?: string; tags: string[]; members: Member[] };
  type CodeModel = { decls: Decl[] };
  function buildCodeModel(dir: string): CodeModel; // exported declarations under <dir>/src, sorted by file then name
  ```
  Tool `code_model`, input `{}`, returns `CodeModel`. `tags` holds JSDoc tags as written, e.g. `"@trace REQ-3"`. Private members are omitted.

- [ ] **Step 1: Fixture** `shop`: `Item` interface, `Cart` class with constructor, public `add(item: Item): void`, private `items`, static `empty()`, JSDoc `@trace UC-2` on `Cart`, exported function `total(c: Cart): number`, a non exported helper, an enum `Currency`.
- [ ] **Step 2: Failing tests:** model lists `Cart`, `Currency`, `Item`, `total` and not the helper; `Cart.members` has `constructor`, `add` with signature `add(item: Item): void`, `empty` with `static: true`, and no `items`; `Cart.tags` equals `['@trace UC-2']`; no output string contains a method body (`{` after `):` ); a project without `src/` returns `{ decls: [] }`.
- [ ] **Step 3: Run** the test file. Expected: FAIL.
- [ ] **Step 4: Implement** with `new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: false } })`, `addSourceFilesAtPaths('src/**/*.ts')`, excluding `*.test.ts`. Signatures from declaration text up to the body.
- [ ] **Step 5: Run** the full gate. Expected: pass.
- [ ] **Step 6: Commit** `feat(tools): code_model from ts-morph`.

### Task 3: Docker helper, runner image and output parsers

**Files:**
- Create: `runner/Dockerfile`, `src/lib/server/core/docker/run.ts`, `src/lib/server/core/docker/image.ts`, `src/lib/server/core/docker/parse.ts`, `src/lib/server/core/docker/docker.test.ts`, `test/fixtures/output/{tsc-errors.txt,vitest-report.json}`

**Interfaces:**
- Produces:
  ```ts
  type DockerResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };
  function docker(args: string[], opts: { timeoutMs: number; killName?: string }): Promise<DockerResult>; // throws ToolError(DOCKER_DOWN) on ENOENT or "Cannot connect to the Docker daemon"
  function runInRunner(projectDir: string, cmd: string[], opts: { network: boolean; readOnly: boolean; timeoutMs: number }): Promise<DockerResult>;
  function ensureRunnerImage(): Promise<string>; // returns tag "aise-runner:<first 12 hex of sha256 over runner/Dockerfile, package.json, package-lock.json>", builds when missing, also tags aise-runner:latest
  function hostPathForDocker(p: string): string;
  function parseTsc(out: string): { file: string; line: number; col: number; message: string }[];
  function parseVitestJson(json: string): { passed: number; failed: number; tests: { name: string; file: string; status: 'passed' | 'failed' | 'skipped'; error?: string }[] };
  function tail(text: string, lines?: number): string; // default 200
  const DOCKER_DOWN = 'Docker is not running. Start Docker Desktop and retry.';
  ```
- Layout decision: the image holds deps in `/opt/aise/node_modules`; the project is bind mounted at `/opt/aise/app` and the working dir is that folder. Node, tsc and Vitest find packages by walking up to `/opt/aise/node_modules`, so nothing is copied or written into the project. (Replaces the spec's anonymous volume idea; record in `docs/decisions.md`.)
- Runner dir: `process.env.AISE_RUNNER_DIR ?? path.resolve('runner')`.

- [ ] **Step 1: `runner/Dockerfile`**: `FROM node:22-slim`, `WORKDIR /opt/aise`, copy `package.json` and `package-lock.json`, `npm ci`, `USER node`, `WORKDIR /opt/aise/app`. Use the multi-stage-dockerfile skill only if it shrinks the image without breaking the layout.
- [ ] **Step 2: Failing unit tests** (no Docker needed): `parseTsc` on the recorded output gives `{ file: 'src/cart.ts', line: 4, col: 10, message: ... }` entries; `parseVitestJson` on the recorded report gives the right counts and the first failure message; `tail` keeps the last 200 of 500 lines; `hostPathForDocker('C:\\Users\\a\\p')` returns `'C:/Users/a/p'` and POSIX paths unchanged; `docker` with `PATH` emptied rejects with `ToolError` `DOCKER_DOWN`.
- [ ] **Step 3: Run** `npx vitest run src/lib/server/core/docker`. Expected: FAIL.
- [ ] **Step 4: Implement.** `runInRunner` args: `run --rm --name aise-<random> [--network none] --cpus 1 --memory 1g -v <host>:/opt/aise/app[:ro] <tag> ...cmd`. On timeout run `docker kill <name>` and return `timedOut: true`.
- [ ] **Step 5: Run** the full gate. Expected: pass.
- [ ] **Step 6: Commit** `feat(docker): runner image and docker helper`.

### Task 4: `typecheck`, `run_tests`, Docker test project and CI job

**Files:**
- Create: `src/lib/server/core/tools/check.ts` (both tools), `test/docker/check.test.ts`, `test/docker/fixtures/{ok,type-error,failing-test,hangs}/` (each with `package.json` copied from `runner/package.json`, `tsconfig.json`, `src/`, `test/`)
- Modify: `src/lib/server/core/tools/index.ts`, `vite.config.ts` (project `docker`, `include: ['test/docker/**/*.test.ts']`, `testTimeout: 300_000`; exclude `test/docker/**` from `node`), `package.json` scripts (`test`: `vitest run --project node --project jsdom`; `test:docker`: `vitest run --project docker`), `.github/workflows/ci.yml` (new job `docker`: checkout, setup-node, `npm ci`, `npm run test:docker`; the `verify` job unchanged)

**Interfaces:**
- Consumes: `runInRunner`, `ensureRunnerImage`, `parseTsc`, `parseVitestJson`, `tail`, `safePath`.
- Produces:
  - `typecheck`, input `{}`, returns `{ ok: boolean; errors: TscError[]; timedOut: boolean }`. Runs `node_modules/.bin/tsc --noEmit -p .` resolved as `/opt/aise/node_modules/.bin/tsc`, read only mount.
  - `run_tests`, input `{ filter?: string }`, returns `{ ok: boolean; passed: number; failed: number; tests: TestResult[]; timedOut: boolean; logTail: string }`. Runs `/opt/aise/node_modules/.bin/vitest run --reporter=json --outputFile=.aise/tmp/vitest-<runId>.json [filter]`, reads then deletes the report. Missing report: `ok: false`, `tests: []`.
  - Both: a project without `package.json` gives `ToolError('No package.json in the project. Generate code first (P4).')` before Docker is touched.
  - `timeoutMs` is an internal option on the run function (default 120 000) so the hang test can use 10 000.

- [ ] **Step 1: Fixtures**: `ok` (one class, one passing test), `type-error` (assigns string to number in `src/a.ts` line 2), `failing-test` (one pass, one `expect(1).toBe(2)`), `hangs` (test with `while (true) {}`).
- [ ] **Step 2: Failing integration tests**: `ok` → typecheck `{ ok: true, errors: [] }`, run_tests `ok: true, passed: 1`; `type-error` → one error at `src/a.ts` line 2; `failing-test` → `passed: 1, failed: 1` and the failure's `error` contains `expected 1 to be 2`; `hangs` with 10 s timeout → `timedOut: true, ok: false` and no container named `aise-*` left (`docker ps -a`); no `.aise/tmp` report left behind; fixture folder unchanged except `.aise/` (no `node_modules` created).
- [ ] **Step 3: Unit test** (node project): project without `package.json` gives the `ToolError` text and never calls Docker (inject a spy for `runInRunner`).
- [ ] **Step 4: Run** `npm run test:docker`. Expected: FAIL.
- [ ] **Step 5: Implement**, then run `npm run test:docker` and the full gate. Expected: pass. Push the branch and confirm the new CI job is green.
- [ ] **Step 6: Commit** `feat(tools): typecheck and run_tests in the runner image`.

### Task 5: `deploy_check`

**Files:**
- Create: `src/lib/server/core/tools/deploy.ts`, `test/docker/deploy.test.ts`, `test/docker/fixtures/{hello-deploy,broken-deploy}/`
- Modify: `src/lib/server/core/tools/index.ts`

**Interfaces:**
- Consumes: `docker`, `tail`, `safePath`.
- Produces: `deploy_check`, input `{ url?: string /* default http://localhost:3000/health */; timeoutMs?: number /* default 180000 */ }`, returns `{ ok: boolean; status: number | null; body?: string; logTail: string }`. Compose project name `aise-<projectName>` (lowercase, `[a-z0-9-]`). Steps: `docker compose -p <name> up -d --build`, poll the URL every second until 2xx or timeout, collect `docker compose logs --no-color` tail, `docker compose down -v --remove-orphans` in `finally`. Missing `compose.yaml`: `ToolError('No compose.yaml in the project. Run P6 first.')`. Only `http://localhost` and `http://127.0.0.1` URLs are accepted.

- [ ] **Step 1: Fixtures**: `hello-deploy` (Dockerfile `FROM node:22-slim`, a zero dependency `server.js` answering `/health` with 200 `ok` on port 3000, `compose.yaml` mapping `3000:3000`); `broken-deploy` (Dockerfile with `RUN exit 1`).
- [ ] **Step 2: Failing integration tests**: hello → `{ ok: true, status: 200, body: 'ok' }`, and afterwards `docker compose -p aise-hello-deploy ps -a` is empty; broken → `ok: false`, `logTail` mentions the failed step, nothing left running; URL `http://example.com` → error result.
- [ ] **Step 3: Run** `npm run test:docker`. Expected: FAIL.
- [ ] **Step 4: Implement**, run `npm run test:docker` and the full gate. Expected: pass.
- [ ] **Step 5: Commit** `feat(tools): deploy_check with compose`.

### Task 6: MCP server, docs

**Files:**
- Create: `src/lib/server/mcp/server.ts`, `src/lib/server/mcp/main.ts`, `src/lib/server/mcp/server.test.ts`, `.mcp.json`
- Modify: `package.json` (dependency `@modelcontextprotocol/server`, script `mcp`: `tsx src/lib/server/mcp/main.ts`), `README.md`, `ARCHITECTURE.md`, `AGENTS.md` (commands), `CHANGELOG.md`, `docs/decisions.md`

**Interfaces:**
- Consumes: `TOOLS`, `executeTool`, `scope.ts`, `createRun`, `updateRun`, `AgentName`.
- Produces:
  - `createMcpServer(opts: { projectDir: string; agent: AgentName }): McpServer` registers every tool the agent may use (`mcp` gets all) with the tool's zod input schema; each call goes through `executeTool`, an error result becomes `{ isError: true, content: [{ type: 'text', text }] }`.
  - Run handling: the first `write_file`, `write_requirements` or `update_design` of a session creates a run `createRun(store, 'P7', 'mcp')` and immediately sets it `done`, so the orchestrator's restart recovery and Discard treat it like a finished hand edit; read only sessions create no run.
  - `main.ts` parses `--project <dir>` (required) and `--agent <name>` (default `mcp`), connects `StdioServerTransport`. Logs only to stderr.
  - `.mcp.json`: server `aise` running `npm run mcp -- --project showcases/todo`.

- [ ] **Step 1: Load the mcp-builder skill** and read the TypeScript SDK v2 README it points to; confirm `McpServer`, `registerTool` and the in memory transport names before writing code.
- [ ] **Step 2: Failing tests** over the in memory transport with a client: lists `read_requirements` and `write_file` for agent `mcp`; for `--agent test` lists no `write_requirements` and `read_file` of `src/a.ts` is an error; `update_design` with an invalid design returns `isError: true` with the validation text; a `write_file` creates exactly one run with phase `P7`, agent `mcp`, status `done`; a session with only reads creates no run.
- [ ] **Step 3: Run** `npx vitest run src/lib/server/mcp`. Expected: FAIL.
- [ ] **Step 4: Implement.** Then manual check: `npx @modelcontextprotocol/inspector npm run mcp -- --project test/fixtures/projects/shop` lists the tools and `code_model` returns `Cart`.
- [ ] **Step 5: Docs**: README tools and MCP section (one registry, two transports), ARCHITECTURE diagram line and status, AGENTS.md commands (`npm run mcp`, `npm run test:docker`), CHANGELOG entries, `docs/decisions.md` entries dated 2026-11-20: transport option A and why; runner image layout with deps above the mount; `node:sqlite` instead of a native SQLite module; MCP sessions recorded as P7 runs.
- [ ] **Step 6: Run** `npm run check && npm run lint && npm test && npm run test:docker`. Expected: all pass; quote the summary lines in the PR.
- [ ] **Step 7: Commit** `feat(mcp): stdio MCP server over the tool registry`, then open the PR. Ask the teammate to run `npm run test:docker` once on the Windows machine with WSL.
