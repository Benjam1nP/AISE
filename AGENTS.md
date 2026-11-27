# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

Group project for the course "Coding with AI" (WS 2026, University of St. Gallen, Prof. Dr. Guido Salvaneschi).

We are building an **AI-assisted software engineering environment**: a multi-agent, LLM-based system that guides a developer through every phase of a software project. Full spec: `docs/pdf/Project-Requirements-2026.pdf` (and structured markdown at `docs/context/project_requirements.md`). Read it before making architectural decisions.

Code generation is the baseline, not the goal. Most of the grade comes from the phases before and after it.

## Phases the environment must support

At every phase the developer must be able to see, discuss, and change the output before the system moves on.

| Phase                | What it does                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| P1 Requirements      | Turns a vague description into structured requirements. Asks clarifying questions instead of guessing.                              |
| P2 Design            | Produces UML (use case, class, sequence/activity, component/deployment) from approved requirements, rendered in the UI.             |
| P3 Design refinement | Interactive loop; changes stay consistent across all diagrams. May self-review the design.                                          |
| P4 Code generation   | Generated from the approved design, not the raw description. Code structure mirrors the diagrams.                                   |
| P5 Testing           | Tests derived from requirements and design, run automatically, failures explained, fixes proposed, re-run.                          |
| P6 Deployment        | Generates working local deployment artefacts (Dockerfile, compose, start script, etc.).                                             |
| P7 Maintenance       | Propagates change requests through all artefacts. Detects drift between code and diagrams and offers to repair in either direction. |

## Grading criteria (equal weight)

C1 phases beyond coding, C2 artefact alignment under change, C3 usability, C4 documented agent architecture, C5 traceability from requirement to diagram to code, C6 end-to-end showcases and scalability, C7 artefact quality. When choosing between features, favour what produces visible evidence for these.

## Deliverables

- Three showcase projects (small, medium, larger), each taken end to end plus one maintenance change, with generated artefacts committed to the repo.
- README with the architecture: agents and responsibilities, tools/MCP servers, LLMs and why, agent communication, artefact storage and sync.
- Code submission: 2026-12-16. Presentations: 2026-12-07 / 2026-12-14 (12 min, live demo).

## Repository layout

- `docs/superpowers/specs/2026-11-04-ai-se-environment-design.md` the design. Read it before architectural work.
- `docs/pdf/` the requirements PDF; the course slides in `docs/pdf/slides/` are gitignored (local copy only). Reference material only; do not modify.
- `docs/context/` structured Markdown translations and master cross-reference index (`docs/context/INDEX.md`) for AI agents.
- `docs/assets/` README banner. `docs/questions/` kickoff questions and answers; `docs/diagrams/` overview diagram and visual design summary (`design-summary.html`).

- `src/` one TypeScript package: SvelteKit UI and server code. Server code goes in `src/lib/server/` (`core/`, `agents/`, `orchestrator/`, `mcp/`) as it lands.
- `test/` tests outside `src/`.
- `showcases/<name>/` the three hand in projects (todo, booking, auction) with their `.aise/` artefacts; index in `showcases/README.md`. Tickets (`.aise/tickets.json` and the ticket chats) are committed with the showcase they belong to. Any other folder under `showcases/` is gitignored scratch.
- `evidence/` the evidence per grading criterion (index in `evidence/README.md`): scaling comparison, change propagation, injected bug, artefact quality.
- `presentation/` slide and demo instructions.
- `test/fixtures/projects/todo/` a to do project at P2 (requirements and design) for tests.

## Commands

Node 22.9 or newer. Run `npm ci`, then copy `.env.example` to `.env` (gitignored) and add the API key.

- `npm run dev` SvelteKit dev server; Node loads `.env` into `process.env` (`--env-file-if-exists`), because `src/lib/server` reads `process.env` and SvelteKit only loads `.env` for `$env/*`
- `npm run build` production build (adapter-node)
- `npm start` run the built server (`build/`) with `.env` loaded
- `npm run check` `svelte-kit sync` and `svelte-check` (warnings fail)
- `npm run lint` Prettier check and ESLint
- `npm run format` Prettier write
- `npm test` Vitest, two projects: `node` (`src/**/*.test.ts`, `test/**/*.test.ts`) and `jsdom` (component tests `src/lib/ui/**/*.svelte.test.ts`, `src/lib/components/**/*.svelte.test.ts` and `src/routes/**/*.svelte.test.ts`, Testing Library)
- `npm run test:docker` Vitest project `docker` (`test/docker/`, files one at a time): typecheck, tests and deploy check against real containers; needs Docker, builds the runner image on first use; own CI job
- `npm run mcp -- --project <dir> [--agent <name>]` stdio MCP server over the tool registry
- `/dev/ui` (dev server only, 404 in builds) shows every design system component and token
- `npx tsx scripts/smoke-p1.ts` live smoke run of the requirements agent; needs `ANTHROPIC_API_KEY`, costs API credit, not run in CI
- `npx tsx scripts/smoke-p4.ts` live smoke run of P4 code generation on the to do design; needs `ANTHROPIC_API_KEY` and Docker, costs API credit (up to the $3 guard), not run in CI
- `npx tsx scripts/smoke-p5.ts [--fix-loop]` live smoke run of P4 code generation and then P5 test generation on the to do design; needs `ANTHROPIC_API_KEY` and Docker, costs API credit (up to the $3 guard for the code plus the $2 guard for the tests, and up to $3 more because test generation starts the fix loop by itself when a code bug finding stays open), not run in CI; `--fix-loop` starts the loop through the orchestrator when none started by itself and findings or unexplained failures remain
- `npx tsx scripts/smoke-p6.ts` live smoke run of P6 deployment on the to do design and the P4 fixture code; needs `ANTHROPIC_API_KEY` and Docker, costs API credit (up to the $1 guard), not run in CI
- `npx tsx scripts/smoke-p7.ts` live smoke run of P7: one change ticket ("Tasks need a due date") from triage to the change report on the to do fixture project; needs `ANTHROPIC_API_KEY` and Docker, costs API credit (stops above the $6 guard), not run in CI; `--setup-only` checks the starting point without an LLM
- `npx tsx scripts/run-auction.ts [approve|p6|p7|drift|check] [--override P4] [--anyway]` drives the committed auction showcase in place: P4 and P5 approval, P6, the reserve price P7 ticket (resumes an open one, also one stopped after triage) and final checks; `drift` (only when named) makes two hand edits in `src/` and takes each through a drift ticket, one repaired into the design and one in the code; it stops at P1 open questions unless `--anyway` turns them into assumptions, and rejects an unknown step; needs `ANTHROPIC_API_KEY` and Docker, costs API credit, not run in CI

CI runs `check`, `lint` and `test` (job `verify`) and `test:docker` (job `docker`) on pull requests and on pushes to `main`. Run all four before committing.

## Stack

TypeScript, SvelteKit, Mermaid, Anthropic TypeScript SDK with our own agent loop, MCP TypeScript SDK, zod, ts-morph, Docker. Generated projects: TypeScript, Node 22, Express, Vitest, SQLite, `ws`.

## Docs to keep current

Update these in the same PR as the change they describe. Keep them concise and correct.

- `README.md` setup and architecture summary.
- `ARCHITECTURE.md` living architecture; the spec above is the frozen record.
- `CHANGELOG.md` user visible changes.
- `docs/decisions.md` one entry per decision: date, what, why.
- `docs/design-system.md` tokens, theme, components and guardrails of `src/lib/ui/`.
- `docs/reflection/<name>.md` personal notes for the individual report.

## Working agreements

- Minimal beats clever: we must be able to explain every part at the Q&A.
- Branch per issue, PR, squash merge; review by the other person optional; `main` must always pass CI.

## Conventions

- Import `src/lib` with `#lib/*` subpath imports, not `$lib` (removed in SvelteKit 3). Plan text that says `$lib/...` means `#lib/...`.
- Server code under `src/lib/server` uses relative imports and `process.env` only (no `$lib`/`#lib` aliases, no `$env`), so tsx scripts and the MCP entry can import it.
- Python virtualenvs live in `.venv/` (gitignored).
- Diagrams are Mermaid, generated from the JSON design model; agents never write Mermaid directly.
- Wrap external actions (render diagrams, run tests, build containers, file I/O) as tools or MCP servers.
- Do not hard depend on a single API key or provider for the demo; keep rate limits and cost in mind.
- Never commit secrets. Use environment variables or a gitignored `.env`.
- Keep traceability explicit: link requirements to diagram elements to code (for example via shared IDs).
- Record notable design decisions and changes of direction; they are needed for the final report.
