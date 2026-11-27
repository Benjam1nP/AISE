# P6 deployment

Status: draft, 2026-11-22. Tier: Large (new agent, new phase workflow).

## Goal

After P5 is approved, a deploy agent writes `Dockerfile`, `compose.yaml` and `RUN.md` from the
design's deployment nodes and the project's start scripts, proves them with `deploy_check`, and
the developer approves a gate that says the stack starts and every service answers its health
check. Evidence for C1 (deployment phase), C6 (deployed showcases) and C7 (the deployment runs).

## Non goals

- No cloud deployment, registry push or production hardening.
- No Dockerfile allowlist (accepted known limit, ARCHITECTURE.md); the compose allowlist stays.
- No tickets: P7 drives P6 through the staleness rules below, nothing more (see
  `2026-11-22-p7-tickets-design.md`).

## User visible behaviour

1. Approving P5 with a passing gate starts the deploy run (as P4 starts P5). "Generate deployment"
   does it by hand when P5 was approved with an override.
2. The deploy agent (Sonnet 5.5, medium effort) gets a brief built from the design: one compose
   service per `service` node, using that node's start script (`npm start` or
   `npm run start:<node>`) and port variable, a named volume for `DB_PATH` when the node has a
   storing class, peer URLs (`<PEER>_URL`) from the links using compose service names, the browser
   facing service published on `127.0.0.1:8080`, others on the next ports. External and database
   nodes get no service (SQLite runs in process). It writes the three files and calls
   `deploy_check`; on failure it reads the log tail, fixes and tries again (at most 3 checks; a run
   stops above $1).
3. A **Deploy tab** shows the three files read only, the last check (passed or failed, per service
   health result, log tail, duration) and a "Run deploy check" button (no LLM).
4. The **P6 gate**:
   - files exist,
   - consistent with the design: a compose service per service node, no extra service, each with
     its node's start command, every link between service nodes has its URL variable,
   - deploy check passed on the current files (out of date after a change to the deploy files,
     `package.json` or `src/`).
   Approve with override is allowed as in P4 and P5.
5. P6 has its own chat ("why port 8081?", "add a troubleshooting section to RUN.md"), Discard last run, and goes
   **stale** when what it was made from changes: the service nodes, their links, the start scripts
   in `package.json` or the dependencies. Update patches the files; Still valid keeps them.
6. `RUN.md` says how to start (`docker compose up --build`), which URL to open, the ports and the
   volume, and how to stop and reset data. The generated `README.md` links to it.

## Data and interfaces

- `deploy_check` takes `urls: string[]` (default `[http://localhost:8080/health]`) and probes each
  one; the result lists every url with its status. Existing single `url` input stays as an alias.
- Stored check: `.aise/checks/deploy.json` `{ at, filesHash, passed, services: [{ url, status }],
  logTail }`, written by the deploy run and by "Run deploy check".
- `PhaseState.deployHashes`: per service node, the hash of its links and start script, plus one for
  the dependencies. Staleness compares them as P4 does with `designHashes`.
- Pure helpers `core/deploy-plan.ts`: `deployPlan(design, packageJson)` gives the expected services,
  ports, volumes and env, used by both the agent brief and the gate's consistency check.
- New agent `agents/deploy.ts`; scope row and paths already exist in `tools/scope.ts`.
- Orchestrator: `P6` joins `ChatPhase` and `StalePhase`; `generateDeployment`, `checkDeploy`;
  `approve('P6')` with `deployGate`.
- UI: `DeployPanel.svelte`, `GenerateDeployment.svelte`, page actions.

## Edge cases

- Docker not running: the check fails with a clear message, the gate shows it, the run does not
  burn retries on it.
- Port 8080 taken on the host: the check reports the bind error from the log tail; RUN.md names the
  port to change.
- Several service nodes: every one gets probed; one failing fails the gate and names the service.
- Design changes nodes after P6 approval: P6 stale, Update brief lists added, removed and changed
  services.
- Hand edit of `Dockerfile` or `compose.yaml`: check goes out of date, gate asks for a new check.

## Tests

- `deployPlan` for to do (one node), booking (two nodes) and auction (several nodes, links, ws).
- Gate consistency check: missing service, extra service, wrong command, missing URL variable.
- Staleness: link change, start script change, dependency change, unrelated change stays fresh.
- Orchestrator: auto start after P5, generate by hand, check, approve, override, stale, Update,
  Discard.
- `deploy_check` with several urls (docker project `test/docker/deploy.test.ts`).
- Component tests for `DeployPanel`.
- Live smoke `scripts/smoke-p6.ts` on the to do fixture (API credit, not in CI).

## Parallel work with P7

P6 adds `P6` to `ChatPhase` and `StalePhase` and the `deployHashes` staleness. The P7 ticket branch
treats phases generically, so a ticket walk includes P6 once this merges; whichever lands second
resolves the small conflicts in `orchestrator.ts` and the project page.
