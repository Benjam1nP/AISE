# P6 Deployment Implementation Plan

> **For agentic workers:** implement task by task; steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After P5 is approved, a deploy agent writes `Dockerfile`, `compose.yaml` and `RUN.md` from the design's service nodes and the project's start scripts, proves them with `deploy_check` (every service answers `/health`), and the developer approves a P6 gate read from `.aise/checks/deploy.json`.

**Architecture:** A pure `deployPlan(design, packageJson)` gives the expected compose services (name, command, port, env, volume, health url); the deploy agent's brief and the gate's consistency check both read it. `deploy_check` probes several urls, stores its result and counts checks per run. The orchestrator gains P6 as a fifth chat phase with staleness over `deployHashes` (service nodes, their links, start scripts, dependencies), Update, Still valid and Discard, mirroring P5.

**Spec:** `docs/superpowers/specs/2026-11-22-p6-deployment-design.md` (read it first). P5 counterparts to mirror: `core/test-state.ts`, `agents/test.ts`, `orchestrator/p5.ts`, `gates.ts` (`checkTestGate`), `components/TestsPanel.svelte`, `GenerateTests.svelte`. Showcase to get the rules right: `showcases/auction` (two service nodes, `start:live-update-server`, `LIVE_UPDATE_SERVER_PORT`, `API_SERVER_URL`, `/health` on both).

## Global Constraints

- Server code under `src/lib/server` uses relative imports and `process.env` only; no `$lib`, `#lib`, `$env`. UI imports `src/lib` with `#lib/*`.
- Deploy agent `claude-sonnet-5-5`, effort `medium`, turn limit 25. No Opus.
- Per deploy agent run: at most 3 `deploy_check` runs that reach `docker compose up`, cost guard $1 (run `failed`, reason `cost_limit`).
- Agent writes only `Dockerfile`, `compose.yaml`, `RUN.md` (existing scope row). The compose allowlist (`compose-check.ts`) stays unchanged.
- Stored check `.aise/checks/deploy.json`. Check hash covers `Dockerfile`, `compose.yaml`, `package-lock.json` and `CODE_ROOTS` (`src/`, `public/`, `package.json`, `tsconfig.json`); `RUN.md` is docs and not in it. P6 artefact hash (discard guard, run bookkeeping) covers the three deploy files.
- Compose service name is `nodeKebab(node)`; container port equals host port (`serviceNodes` port: primary 8080, then 8081, ...), published as `127.0.0.1:<port>:<port>`.
- No hyphens or dashes as punctuation in UI copy.
- Verification gate before every commit: `npm run check && npm run lint && npm test`; Tasks 1 and 10 also `npm run test:docker`.
- Decision entries in `docs/decisions.md` (date 2026-11-22, what, why) in the task that makes the decision.

## Review Focus

1. A check refused by the allowlist or hit by Docker down never uses up one of the 3 checks, and is still stored as failed with the message (Task 1).
2. A hand edit of `compose.yaml`, `Dockerfile`, `package.json` or a file under `src/` turns "Deploy check passed" to "out of date"; an edit of `RUN.md` does not (Tasks 1, 6).
3. The gate names the service: missing service, extra service, wrong command, missing `<PEER>_URL`, a failing health url (Task 6).
4. Staleness: link change, start script change, dependency change mark P6 stale; a description or class method change does not (Tasks 2, 7).
5. Discarding a P6 run restores the three files and the previous `deploy.json`, and refuses after a later edit of a deploy file (Task 7).
6. The deploy agent cannot write outside its three files (existing scope; one test in Task 4).

---

### Task 1: deploy_check with several urls, stored check, check budget

Model: `sonnet`, effort `high`.

**Files:**
- Create: `src/lib/server/core/deploy-state.ts`, `deploy-state.test.ts`
- Create: `src/lib/server/core/tools/deploy.test.ts` (unit, `vi.mock('../docker/run')`)
- Create: `test/docker/fixtures/two-services/` (`Dockerfile`, `compose.yaml`, `package.json`, `server.js`: one image, two services `web` on 3917 and `api` on 3918, each answers `/health`; `api` exits with code 1 when `FAIL=1`)
- Modify: `src/lib/server/core/tools/deploy.ts`, `core/tools/registry.ts`, `core/code-state.ts` (export a hash helper without the `src/` null rule if needed), `test/docker/deploy.test.ts`

**Interfaces:**
- `ToolContext.deployChecks?: { left: number }`: a mutable counter set by the orchestrator for deploy agent runs; absent means no limit (MCP, Run deploy check).
- `deploy_check` input `{ urls?: string[] (1 to 8); url?: string; timeoutMs }`: `urls`, else `[url]`, else `[DEFAULT_URL]`; both given is a ToolError. Every url passes `checkUrl` and `checkPort`.
- Result `type DeployCheckResult = { ok: boolean; services: { url: string; ok: boolean; status: number | null; body?: string }[]; logTail: string }`; `ok` when every url answered 2xx. Urls are polled one after the other against one deadline. The old top level `status` and `body` go away (only `test/docker/deploy.test.ts` reads them).
- `core/deploy-state.ts`:
  - `DEPLOY_FILES = ['Dockerfile', 'compose.yaml', 'RUN.md']`, `DEPLOY_CHECK_PATH = '.aise/checks/deploy.json'`
  - `listDeployFiles(store): Promise<string[]>` (the ones that exist as plain files), `hasDeployFiles(store)`
  - `deployArtefactHash(store): Promise<string | null>` over `DEPLOY_FILES`, null when none exists
  - `deployCheckHash(store): Promise<string | null>` over `Dockerfile`, `compose.yaml`, `package-lock.json` and `listCodeFiles`; null without `compose.yaml`
  - `type DeployCheck = { at: string; filesHash: string | null; passed: boolean; services: { url: string; status: number | null }[]; logTail: string; durationMs: number }` (zod), `readDeployCheck`, `writeDeployCheck`
- The tool computes `filesHash` before it starts, then always writes a `DeployCheck`: the probe result, or on a ToolError (no compose.yaml, allowlist refusal, compose config error, port refusal, `DOCKER_DOWN`, budget used up) `passed: false`, `services` with `status: null` per url, `logTail` the message; then rethrows.
- Budget: `ctx.deployChecks.left === 0` is a ToolError `This run has used its 3 deploy checks. Stop and report what still fails.` before any Docker call; `left` drops by one right before `upAndProbe`, so refusals and Docker down cost nothing.

- [ ] Failing unit tests (`deploy.test.ts`, docker mocked; `deploy-state.test.ts`): `url` alias and `urls` give the same probe list; both given refused; an unpublished port in the second url refused before `up`; budget 1 allows one `up`, the second call is refused and leaves `left` at 0; an allowlist refusal and `DOCKER_DOWN` leave `left` unchanged and store a failed check with the message (Review Focus 1); `deployCheckHash` changes on `compose.yaml`, `Dockerfile`, `package.json` and `src/` edits, not on `RUN.md` or `.aise/` (Review Focus 2); `deployArtefactHash` null without files.
- [ ] Docker tests: update the existing cases to the new result shape; `two-services` with both urls passes and lists two services; with `FAIL=1` (a second compose file variant passed as `compose` text) `ok` is false and the `api` url has `status: null`; `.aise/checks/deploy.json` written after each.
- [ ] Implement; `npm test` and `npm run test:docker` pass.
- [ ] Decision entry (check hash covers code and deploy files but not RUN.md; refusals and Docker down do not count against the 3 checks), commit `feat(core): deploy_check probes several urls and stores its result`.

---

### Task 2: Deploy plan, compose consistency, deploy hashes

Model: `sonnet`, effort `high`.

**Files:**
- Create: `src/lib/server/core/deploy-plan.ts`, `deploy-plan.test.ts`

**Interfaces:**
```ts
export type PlannedService = {
	name: string; // compose service: nodeKebab(node), 'app' without service nodes
	nodeId: string | null;
	primary: boolean;
	script: string; // 'start' | `start:${kebab}`
	command: string; // 'npm start' | `npm run start:${kebab}`
	portVar: string; // 'PORT' | `${NODE}_PORT`
	port: number; // container port = published host port
	env: Record<string, string>; // portVar, DB_PATH, peer and public urls
	peerVars: string[]; // `<PEER>_URL` the gate requires, sorted
	volume: { name: 'data'; target: '/data' } | null;
	healthUrl: string; // `http://localhost:${port}/health`
};
export type DeployPlan = { services: PlannedService[]; volumes: string[]; missingScripts: string[] };
export function deployPlan(design: DesignDoc, packageJson: unknown): DeployPlan;
export function composeProblems(plan: DeployPlan, composeText: string): string[];
export function deployHashes(design: DesignDoc | null, packageJson: unknown): Record<string, string>;
```

Rules:
- One service per `serviceNodes(design)` entry, same order; external, database and client nodes get none. A design without service nodes gets one service `app` with `start`, `PORT`, 8080 (as `startScripts` does).
- `env[portVar] = String(port)`.
- A node with a class where `storesData(cls, design)` (from `agents/code-worker.ts`) gets `DB_PATH=/data/app.db` and the volume `data` at `/data`; every storing node shares the one volume (the local run shares one file too). `volumes` is `['data']` or `[]`.
- Per outgoing link to another service node: `peerUrl(design, link)` gives the variable; the value is its fallback with `localhost` replaced by the peer's service name (`API_SERVER_URL=ws://api-server:8080`). These variables are `peerVars`.
- The primary gets `<NODE>_PUBLIC_URL` from `publicUrl` for each `browserLinks` entry, value the fallback (published ports equal container ports). Not gated.
- `missingScripts`: planned `script` names absent from `packageJson.scripts`.
- `composeProblems`: YAML parse failure gives one problem; per planned service missing → `service "x" is missing`; extra service → `service "x" is not a service node of the design`; `command` (string, or list joined by spaces) unequal to the planned one or absent → `service "x" runs "...", expected "npm run start:x"`; `environment` (map or `KEY=value` list) without a peer var → `service "x" lacks API_SERVER_URL`. Problems sorted.
- `deployHashes`: per service node ID the sha256 of `{ name, primary, port, stores, links (ends and protocol of links touching the node), script: scripts[script] ?? null }`, plus key `dependencies` over `{ dependencies, devDependencies }` of package.json. `{}` without a design.

- [ ] Failing tests: to do (`test/fixtures/todo-design.json`, `test/fixtures/p4/package.json`): one service `app-server`, `npm start`, 8080, volume `data`; booking (`showcases/booking/.aise/design.json` and `package.json`): client plus one service, no extra service; auction (`showcases/auction`): `api-server` on 8080 with `LIVE_UPDATE_SERVER_PUBLIC_URL=ws://localhost:8081`, `live-update-server` on 8081 with `npm run start:live-update-server`, `LIVE_UPDATE_SERVER_PORT=8081` and `API_SERVER_URL=ws://api-server:8080`, external node absent; `missingScripts` names a removed `start:` script; `composeProblems` for a correct auction compose (`[]`), missing service, extra service, wrong command, command as list, missing URL variable, invalid YAML; `deployHashes` changes on a link change, a start script change, a dependency change, not on a description or method change (Review Focus 4).
- [ ] Implement; `npm test` passes.
- [ ] Decision entry (one shared `data` volume, explicit `command` per service, container port equals host port), commit `feat(core): deploy plan from the design`.

---

### Task 3: Plumbing: P6 hashes in state and runs, cost guard in the agent loop

Model: `haiku`, effort `high`.

**Files:**
- Modify: `src/lib/server/core/state.ts`, `core/runs.ts`, `agents/types.ts`, `agents/loop.ts`, `agents/loop.test.ts`

Full code:

```ts
// core/state.ts, PhaseState, after useCaseHashes
	/** P6: per service node ID and `dependencies`, the hash of what the deployment depends on. */
	deployHashes: z.record(z.string(), z.string()).optional()
```

```ts
// core/runs.ts, RunMeta, after useCaseHashes
	/** P6 generation and Update runs: deploy hashes the deployment was made from. */
	deployHashes: z.record(z.string(), z.string()).optional()
```

```ts
// agents/types.ts, RunResult.reason
	reason?: 'turn_limit' | 'refused' | 'max_tokens' | 'cost_limit' | 'error';
```

```ts
// agents/loop.ts: new option and check right after `cost += ...`
	/** Stops the run, failed, once its cost passes this many USD (P6: $1). */
	costLimitUsd?: number;
// ...
			if (opts.costLimitUsd !== undefined && cost > opts.costLimitUsd)
				return failed('cost_limit', `cost limit ($${opts.costLimitUsd}) reached`);
```

The check sits before the tool calls of that turn run, so no tool runs after the limit.

- [ ] Failing test in `loop.test.ts`: a fake `call` returning `tool_use` with usage that costs more than the limit on turn 1: result `failed`, reason `cost_limit`, the tool never ran; without `costLimitUsd` the same run goes on.
- [ ] Implement; `npm run check && npm test` pass. Commit `feat(agents): cost limit per run; P6 hashes in state`.

---

### Task 4: Deploy agent and briefs

Model: `sonnet`, effort `high`.

**Files:**
- Create: `src/lib/server/agents/deploy.ts`, `deploy.test.ts`
- Modify: `src/lib/server/agents/index.ts` (`deployAgent`, `deployBrief`, `deployUpdateBrief`; `AGENTS` gains `deploy`)

**Interfaces:**
- `deployAgent: AgentDef` (`name: 'deploy'`, Sonnet, `medium`, tools `TOOLS_BY_AGENT.deploy`), system prompt with modes `generate`, `update` and chat, and the rules:
  - Dockerfile: `FROM node:22-slim`, `WORKDIR /app`, copy `package.json` (and `package-lock.json` when it exists, then `npm ci`, else `npm install`) before the rest; dev dependencies stay (tsx runs the app); copy only `tsconfig.json`, `src/`, `public/` (no `.aise/`, no `.env`); no `USER` switch (the named volume must be writable); `CMD ["npm", "start"]`.
  - compose.yaml: exactly the planned services with `build: .`, `command` as written in the brief, the planned `environment` as literal values, `ports: ["127.0.0.1:<port>:<port>"]`, the `data` volume where planned and declared at the top level, `depends_on` from caller to peer; only the allowed keys (list them from `compose-check.ts`: no `restart`, `image`, `env_file`, `networks`, no `$`).
  - Call `deploy_check` with every health url of the brief; on failure read the log tail, fix, retry; at most 3 checks. A result saying Docker is not running: stop at once and say so. A port bind error: say which host port is taken.
  - RUN.md: `docker compose up --build`, the URL to open (`http://localhost:8080`), a table of services with ports, the `data` volume, stop (`docker compose down`) and reset (`docker compose down -v`), and which port to change when 8080 is taken.
  - Chat: change only what the request needs, then check again; a request the allowlist refuses (a restart policy, a bind mount) is answered with the reason, not written.
- `deployBrief(plan: DeployPlan, projectName: string): string`: `Mode generate.`, per service its name, node, command, port, env, volume, health url; the list of health urls for `deploy_check`; `missingScripts` as a warning line when not empty.
- `deployUpdateBrief(plan: DeployPlan, changed: string[], added: string[], removed: string[], design: DesignDoc | null): string`: `Mode update.`, IDs named with their service names (`dependencies` as such), then the full current plan.

- [ ] Failing tests: brief for the auction plan contains `npm run start:live-update-server`, `API_SERVER_URL=ws://api-server:8080`, both health urls; update brief names an added and a removed service; definition uses Sonnet and only the deploy tools; `write_file` to `src/app/main.ts` with `agent: 'deploy'` is refused (Review Focus 6).
- [ ] Implement; `npm test` passes. Commit `feat(agents): deploy agent`.

---

### Task 5: Generated README links RUN.md

Model: `haiku`, effort `high`.

**Files:**
- Modify: `src/lib/server/core/render/markdown.ts`, its test; `src/lib/server/orchestrator/p4.ts` (`writeReadme`)

Full code:

```ts
// markdown.ts: readmeMarkdown gains a last parameter
export function readmeMarkdown(
	d: DesignDoc,
	title: string,
	paths: Record<string, string>,
	db: string | null,
	runDoc = false
): string {
// ... after the "Generated by AISE ..." line and its blank line:
		...(runDoc ? ['Run it with Docker: see [RUN.md](RUN.md).', ''] : []),
```

```ts
// p4.ts writeReadme: pass whether RUN.md exists
	const text = readmeMarkdown(design, projectName, paths, db, await store.exists('RUN.md'));
```

- [ ] Failing test: `readmeMarkdown(..., true)` contains `[RUN.md](RUN.md)`; default output unchanged (existing snapshot or string tests stay green).
- [ ] Implement; `npm test` passes. Commit `feat(render): README links RUN.md`.

---

### Task 6: P6 helpers and gate

Model: `sonnet`, effort `high`.

**Files:**
- Create: `src/lib/server/orchestrator/p6.ts`, `p6.test.ts`
- Modify: `src/lib/server/orchestrator/gates.ts`, `gates.test.ts`

**Interfaces:**
- `gates.ts`:
  - `type DeployGateInput = { files: string[]; problems: string[] | null; check: DeployCheck | null; checkHash: string | null }` (`problems` null when the plan cannot be made: no design or no package.json)
  - `checkDeployGate(t: DeployGateInput): GateResult` with checks `Deployment files exist` (detail: missing files), `Consistent with the design` (detail: problems joined with `; `, or `no design or package.json`), `Deploy check passed` (`not run yet`; `out of date` when `check.filesHash !== checkHash`; failed: the urls with status not 2xx, named by service, else the first log line).
- `p6.ts`:
  - `GENERATE_DEPLOY_MESSAGE = 'Generate the deployment from the approved design and code.'`
  - `p6NotReady(state, action): string | null`: `p5NotReady`, then P5 approved and not stale.
  - `readPackageJson(store): Promise<unknown | null>` (parsed object or null)
  - `deployBlocked(store, design): Promise<string | null>`: needs the design and package.json; refuses when a deploy file exists (`change them through the chat or Update`).
  - `deployGate(store, design): Promise<GateResult>` from `listDeployFiles`, `composeProblems(deployPlan(...), compose text)`, `readDeployCheck`, `deployCheckHash`.
  - `deployHashesOf(design, pkg)`, `staleDeployIds(state, design, pkg): string[]` (from `state.phases.P6.deployHashes` whatever the status), `markP6Stale(state, design, pkg)` (as `markP5Stale`).

- [ ] Failing tests: gate passes with files, no problems and a current passed check; `out of date` after a check hash change (Review Focus 2); a failing check names the failing service url; each `composeProblems` case shows in the detail (Review Focus 3); `p6NotReady` refusals for P5 not approved and stale; `deployBlocked` without package.json and with an existing `compose.yaml`; `staleDeployIds` and `markP6Stale` on a start script change, back to approved after reverting.
- [ ] Implement; `npm test` passes. Commit `feat(orchestrator): P6 gate and staleness helpers`.

---

### Task 7: Orchestrator P6

Model: `sonnet`, effort `high` (P5's counterpart ran on `opus` medium; move there if it stalls).

**Files:**
- Modify: `src/lib/server/orchestrator/orchestrator.ts`, `orchestrator.test.ts`

**Interfaces:**
- `ChatPhase` and `StalePhase` gain `'P6'`; `AGENT_OF.P6 = 'deploy'`; `AgentName` gains `deploy`; `AGENT_TURNS.deploy = 25`; `AGENT_COST_LIMIT = { deploy: 1 }` passed as `costLimitUsd`; `CHECK_FILES` for P6 is `['.aise/checks/deploy.json']`.
- `Deps.deployCheck?: (ctx: ToolContext, input: { urls: string[]; timeoutMs?: number }) => Promise<DeployCheckResult>` (default calls `deployCheck.run`).
- `Orchestrator.generateDeployment(name)`, `checkDeploy(name)`; `sendMessage`, `approve`, `stillValid`, `updateStale`, `discardLastRun` accept P6.
- Snapshot gains `gates.P6`, `chat.P6`, `deployCheck: DeployCheck | null`, `staleDeployIds: string[]`; `files` includes the existing deploy files.

Rules:
- `keptHashes('P6')` keeps `deployHashes`; `reopen` P6 exists when `hasDeployFiles`; `artefactHash('P6')` is `deployArtefactHash`; `afterRun` adopts `run.deployHashes` for P6 like P5 (while a deploy file exists).
- Every deploy agent run (`startRun` with def `deploy`) gets `ctx.deployChecks = { left: 3 }`.
- `generateDeployment`: `p6NotReady`, `deployBlocked`; `startRun(store, name, claim, 'P6', GENERATE_DEPLOY_MESSAGE, true, { deployHashes }, { def: this.agents.deploy, brief: deployBrief(plan, name) })`.
- Approving P5 with `failed.length === 0`, P6 ready and not blocked auto starts it (`autoStart`, as P4 starts P5).
- `checkDeploy`: needs `compose.yaml` and the plan (ConflictError otherwise); calls `deps.deployCheck` with the plan's health urls; a ToolError is swallowed (the tool stored the failed check); publishes `changed`. No approval needed, as `checkTests`.
- `approve('P6')`: `requireP6Ready`, stale refused, gate `deployGate`, override allowed; records kept or current `deployHashes`.
- `stillValid('P6')`, `updateStale('P6')` with `designDiff(stored, current)` and `deployUpdateBrief` as the agent brief (`agent` option), hashes `{ deployHashes: current }`.
- `sendMessage('P6')`: `requireP6Ready` and deploy files exist (`Generate the deployment first`).
- After a P6 run that touched files: `writeReadme` (link to RUN.md), errors logged only. No final checks for P6: the tool already stored them.
- `refreshStale` also runs `markP6Stale` with the design and package.json (an unreadable one leaves P6 as it is).
- `openRun` saves `deploy.json` before a P6 run; `discardLastRun` of a P6 run that touched files restores it.

- [ ] Failing tests with fake `run` and `deployCheck`: auto start after approving P5 with a passing gate, not after an override, not when `compose.yaml` exists; generate by hand refused before P5 approval, when stale, when files exist; the run gets `deployChecks.left === 3` and `costLimitUsd: 1`; `checkDeploy` stores and the gate turns green, a ToolError leaves a failed gate and no exception; approve and approve with override; stale on a start script change in package.json and a link change, not on a description change; Update brief lists the changed node; Still valid; discard restores files and `deploy.json` and refuses after a later edit of `compose.yaml` (Review Focus 5); recovery settles a running P6; all existing tests stay green.
- [ ] Implement; `npm test` passes.
- [ ] Decision entries (P6 staleness sources; the deploy run's checks are the tool's stored result, no extra final check), commit `feat(orchestrator): P6 phase, gate, staleness and deploy check`.

---

### Task 8: Routes

Model: `haiku`, effort `xhigh`.

**Files:**
- Modify: `src/routes/p/[name]/+page.server.ts`, `src/routes/p/[name]/routes.test.ts`, `src/routes/p/[name]/file/+server.ts`

**Interfaces:**
- `Phase` and `StalePhase` gain `'P6'`; `stalePhase` accepts P6; `badPhase` message `The phase must be P2, P4, P5 or P6.`
- Actions `generateDeployment`, `checkDeploy` via `perform`.
- File endpoint `SHOWN` adds `DEPLOY_FILES` (import from `core/deploy-state.ts`).

- [ ] Failing tests per new action, `phase=P6` for `update` and `stillValid`, and `compose.yaml` on the file endpoint; implement; `npm test` passes. Commit `feat(routes): P6 actions`.

---

### Task 9: Deploy tab and P6 UI

Model: `sonnet`, effort `high`. Svelte MCP autofixer on every component; load `ui-craft`.

**Files:**
- Create: `src/lib/components/DeployPanel.svelte`, `GenerateDeployment.svelte` and a `.svelte.test.ts` each
- Modify: `src/lib/code-files.ts` (`hasDeployFiles(files)`), `src/routes/p/[name]/+page.svelte`, `PhaseBar.svelte`, `GatePanel.svelte`, `StaleBanner.svelte`, `Chat.svelte` (phase type), `src/lib/components/fixtures.ts`, `docs/design-system.md`

**Interfaces:**
- `DeployPanel` props `{ snapshot: ProjectSnapshot; form: FormResult }`: the three files as a list, the chosen one read only in `CodeViewer`; last check with a passed or failed badge, one row per url with its status, duration, the log tail in a collapsed block, `out of date` note when the gate says so; "Run deploy check" button (`?/checkDeploy`), disabled while a run is active.
- `GenerateDeployment` props `{ snapshot; form }`: shown without deploy files and without an active run; note to approve the tests first while P5 is not approved; submits `?/generateDeployment`.
- `PhaseBar`: P6 opens once P5 is approved or P6 has a state of its own. `GatePanel` and `StaleBanner` accept P6 (StaleBanner lists `staleDeployIds`). Deploy tab opens once a deploy file exists or a P6 run is active; phase P6 selects it.

- [ ] Failing component tests: DeployPanel lists the files, shows a failed service url, the out of date note, and the button; GenerateDeployment shown only without deploy files; PhaseBar opens P6 after P5 approval.
- [ ] Implement; `npm run check && npm run lint && npm test` pass.
- [ ] Run the app (`run` skill) on a project with a stored `deploy.json`; check the tab at desktop and mobile widths, console clean.
- [ ] Commit `feat(ui): Deploy tab and P6 gate`.

---

### Task 10: Smoke run

Model: `sonnet`, effort `high`.

**Files:**
- Create: `scripts/smoke-p6.ts`

- [ ] `scripts/smoke-p6.ts`: temp project from `test/fixtures/todo-*.json` and the code of `test/fixtures/p4/` with P1 to P5 approved (state written directly), live `generateDeployment`, waits for the run, prints the three files, the stored check per url, the P6 gate and the cost. Usage line as in `smoke-p5.ts`. Ask the user before running it (costs credit, needs Docker).
- [ ] Full gate `npm run check && npm run lint && npm test && npm run test:docker`, quote output. Commit `test(p6): smoke run`.

---

### Task 11: Docs

Model: `sonnet`, effort `medium`.

**Files:**
- Modify: `README.md` (phase table P6 to `built`, agents and tools), `ARCHITECTURE.md` (status line, deploy agent, `deploy-plan.ts`, `deploy-state.ts`, P6 gate and staleness, check budget and cost guard), `CHANGELOG.md` (Deploy tab, P6 gate, deploy agent), `docs/decisions.md` (any decision not yet recorded in Tasks 1, 2, 7; the `restart` key stays refused), `AGENTS.md` (smoke command `npx tsx scripts/smoke-p6.ts`)

- [ ] Docs as listed, concise; no hyphens or dashes as punctuation in new prose.
- [ ] `npm run lint` (Prettier covers Markdown) passes. Commit `docs(p6): architecture, readme, changelog, decisions`.
