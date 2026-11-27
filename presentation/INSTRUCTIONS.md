# Presentation: what goes on the slides

Source: `docs/context/project_requirements.md` (§5 grading criteria, §10 presentation). Architecture facts: `ARCHITECTURE.md`.

## Rules

- In person, December 7 or 14, 2026. **About 12 minutes**, then Q&A. The limit is strict: overrunning costs points.
- **Live demo required** on at least one showcase project. A recorded video is a fallback only, and must be announced as such.
- Graded on clarity, timing, the live demo and the answers to questions. The criteria C1 to C7 have equal weight.
- Most of the demo time goes to the phases **before and after** code generation. Code generation earns no credit on its own.

## Slide plan (about 12 minutes)

| #   | Slide                       | Time | Content                                                                                                                                                                                             |
| --- | --------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Title                       | 0:15 | Project name, one line description, both names, course, date                                                                                                                                        |
| 2   | Problem and idea            | 0:45 | AI writes code well; the "wings" (requirements, design, tests, deployment, maintenance) are the hard part. Our answer: design first, developer approves every phase, every artefact traceable by ID |
| 3   | Architecture (required, C4) | 1:30 | One diagram, see below                                                                                                                                                                              |
| 4   | Workflow P1 to P7           | 0:30 | The seven phases as one strip with the approval gate between them; this slide is the map for the demo                                                                                               |
| 5   | Live demo                   | 7:30 | Switch to the app, see the demo script below. No slides during the demo                                                                                                                             |
| 6   | Showcases and limits (C6)   | 0:45 | Small / medium / larger (to do, booking, auction): what worked, where it broke and why                                                                                                              |
| 7   | Lessons learned             | 0:30 | Two or three honest points: where AI helped, where it failed                                                                                                                                        |
| 8   | Thanks / Q&A                | 0:15 | Repo link, names                                                                                                                                                                                    |

Keep a hidden backup slide after slide 8 with screenshots of every demo step, in case the live demo breaks.

## Slide 3: architecture (required content)

One diagram plus short labels, no paragraphs. It must answer:

- **Which agents exist and what each one does**: requirements (P1), design (P2/P3), code agent and code workers (P4), test agent and test workers (P5), deploy (P6), maintenance (P7), gate summary
- **Which LLMs and why**: Sonnet 5.5 for the phase agents, Haiku 5.5 for the parallel workers and the gate summary (cheap, one file each, escalates to Sonnet on attempt 3), Opus 5.5 for maintenance (reasons over all artefacts at once)
- **Tools / MCP**: one tool registry with zod-validated tools and per-agent scopes, served in process to our agents and over stdio as an MCP server
- **How agents communicate**: through the orchestrator and the shared artefacts in `.aise/`, not by chatting with each other; events go to the UI over SSE
- **Artefact storage and sync**: JSON design model as the source of truth, Mermaid rendered from it (agents never write Mermaid), shared IDs (REQ, UC, SEQ, DSN) and `@trace` comments in the code, hashes that mark phases stale, `detect_drift` for code vs. design

## Demo script (slide 5): what the graders want to see

Prepare the project up to the start so nobody waits for code generation live. Each step names the criterion it proves.

1. **Clarifying questions** (P1, C1): enter a vague description and show the agent asking instead of guessing; approve the requirements.
2. **UML diagrams in the UI** (P2, C1): use case, class, sequence and deployment diagrams rendered; ask "why" about one choice.
3. **Change a diagram** (P3, C2): request a design change and show it update consistently across all diagrams.
4. **Requirement → diagram → code** (C5): pick one requirement and follow its ID into the diagrams, the code (`@trace`) and its test, then back.
5. **Tests running** (P5, C1): show tests derived from use cases, grouped by use case, running green.
6. **Injected bug** (C7): break the code by hand, Run tests, a test fails, Explain failures, Apply fix, green again.
7. **Deployment** (P6, C1): show the generated Dockerfile, `compose.yaml` and `RUN.md`, and the passing deploy check.
8. **Maintenance change** (P7, C2): open a ticket and show the change propagate through requirements, diagrams, code and tests, ending with the change report.
9. **Drift** (C2): edit the code by hand and show the environment detect the drift and offer to fix it in either direction.

C2 needs **one change of each kind**: requirement (step 8), design (step 3), code (step 9).

## Before the presentation

- Start Docker Desktop (tests and deploy need it) and the dev server. Check the API key, and set up a fallback key (`ANTHROPIC_API_KEY_FALLBACK`).
- Rehearse with a timer. Every demo step must fit its slot; skip, never rush.
- Record the fallback video of the full demo.
- Prepare answers for the Q&A: why our own agent loop instead of a framework, why JSON design model instead of Mermaid, cost per run, what breaks on the larger showcase.

## Slide style

- One message per slide, few words, large font. The diagram on slide 3 must be readable from the back of the room.
- Show the product, not the code: screenshots of the UI beat code listings.

## Rebuilding the deck

`AISE-presentation.pptx` is generated by `build_deck.py` from the HSG template, which is gitignored: copy `PPM_Talk_HSG_final.pptx` into `presentation/template/` first. Then, from `presentation/`:

```sh
python3 -m venv ../.venv && ../.venv/bin/pip install python-pptx
../.venv/bin/python build_deck.py template/PPM_Talk_HSG_final.pptx AISE-presentation.pptx
```

Edits made by hand in PowerPoint (screenshots, final numbers) are lost on a rebuild; change the script instead, or stop rebuilding once the hand edits start.
