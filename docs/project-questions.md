# Project questions

Questions for both of us to work through before and during the build. They do two jobs: make the
environment fit how we work, and make sure we can each explain every part of it (the presentation
Q&A and the individual reports depend on that).

How to use it: run `node docs/questions/server.mjs` and open http://localhost:4321 to answer in
the browser. Answers save to `docs/questions/answers.json`; commit that file to share them. This
Markdown file stays the source of the questions, so edit questions here. If the current proposal
is fine, click "Use proposal". Questions marked **[blocks design]** must be answered before the
design document is final; the rest can be answered as we go.

Overview diagram: [`docs/diagrams/project-overview.html`](diagrams/project-overview.html).

---

## 1. Us and how we work

**1.1 [blocks design]** Who owns which part? A natural split is one person on the workspace UI,
orchestrator and P1 to P3, the other on the MCP tools, P4 to P7 and drift detection. Both of us
need to be able to demo and explain everything.
> Proposal: split as above, swap reviewing each other's PRs.

**1.2** When do we sync, and where do we track work (GitHub issues, Notion, chat)?
> Proposal: GitHub issues plus a short sync twice a week.

**1.3** How do we use AI to build the environment itself (Claude Code, Command Code, other)? The
report asks which tools we used, in which mode, and where they helped. Who keeps notes on that?
> Proposal: each of us keeps a short log in `docs/reflection/<name>.md` while building.

**1.4** What is our git workflow: branch per issue, PRs reviewed by the other person, squash merge?
> Proposal: yes to all three; `main` must always run.

## 2. Goal and scope

**2.1** What does "a good grade" look like in concrete terms? Which two of the seven criteria (C1
to C7) do we want to be clearly the best at?
> Proposal: C2 (alignment under change) and C5 (requirement to diagram to code), via drift repair.

**2.2** What is out of scope? Things that would cost time without earning credit.
> Proposal: no auth, no multi-user, no cloud hosting, no languages other than TypeScript for
> generated code, no WYSIWYG diagram editor.

**2.3** What would make the project a failure even if every phase technically works?
> Proposal: a demo that looks like a fixed script with prompts in it (C4), or diagrams that do
> not actually match the code (C5).

## 3. The developer's experience (C3)

**3.1 [blocks design]** Walk through the first five minutes: the developer opens the workspace,
creates a project, types a vague idea. What do they see, and what do they click?

**3.2** How should approval gates feel: a hard "Approve and continue" button per phase, or can the
developer jump back to an earlier phase at any time?
> Proposal: approve per phase, and going back is always allowed; later phases are then marked stale.

**3.3** How much of the agents' work should be visible: every tool call (like Claude Code), a
summary, or both with a toggle?
> Proposal: collapsed tool calls in chat, expandable.

**3.4** Which artefacts must be editable by hand in the UI, and which only through chat?
> Proposal: requirements and code by hand and by chat; diagrams by chat or a form, since the
> design model is the source of truth.

**3.5** What happens when an agent fails (rate limit, invalid output, test run crashes)? What
does the developer see?

## 4. Phases: understanding each one

For each phase, both of us should be able to answer: what goes in, what comes out, which agent
and model, what the developer can change, and how we know the output is good.

**4.1 P1 Requirements.** How does the agent decide a description is too vague? How many
clarifying questions are too many? What format is the requirements document (IDs, acceptance
criteria, priority)?
> Proposal: Markdown with `REQ-n` IDs, each with acceptance criteria; at most 5 questions per round.

**4.2 P2 Design.** Which UML diagrams do we generate for every project, and which only when
useful?
> Proposal: always use case, class, one sequence per key use case, and deployment; activity
> only when there is real branching logic.

**4.3 P3 Refinement.** When the developer changes one diagram, how do the others stay
consistent? Can you explain why a shared JSON design model makes this easier than editing
Mermaid text directly?

**4.4 P4 Code.** What rules force the code to mirror the design (one file per class, method
names from the class diagram, trace tags in comments)?

**4.5 P5 Testing.** How do we derive tests from use cases and sequence diagrams rather than from
the code? How do we show that a test catches an injected bug (C7)?

**4.6 P6 Deployment.** What is the minimum that counts as "works": `docker compose up` and the
app answers on a port? Who checks that automatically?

**4.7 P7 Maintenance.** For each kind of change (requirement, design, code), which artefacts get
updated, in which order, and who approves?

## 5. Traceability and drift (our differentiator)

**5.1** Can each of us explain, in two sentences, how a requirement ID travels from the
requirements doc into a diagram, the code and a test?

**5.2** What counts as drift? Only structural differences (classes, fields, methods, relations),
or also behaviour (a sequence diagram no longer matching the calls)?
> Proposal: structure first; sequence drift as a stretch goal, documented as a limit if we skip it.

**5.3** When code and design disagree, who decides the direction? Can the agent suggest one?
> Proposal: the agent suggests, the developer decides.

**5.4** How do we detect "suspect" links after a requirement's text changes?
> Proposal: store a content hash of the requirement on each link, as Doorstop does.

## 6. Agent architecture (C4)

**6.1** Why is this a multi-agent system and not one big prompt? Each of us should be able to
answer this at the presentation.

**6.2** Which model per agent, and why? What is our monthly budget split, and what do we do if a
showcase run gets expensive?
> Proposal: Opus for design and drift, Sonnet for requirements, code, tests and deploy, Haiku for
> summaries and checks; log token cost per phase so we can report it.

**6.3** How do agents communicate: only through artefacts on disk, through the orchestrator, or
directly?
> Proposal: through artefacts and the orchestrator only, so every hand off is inspectable.

**6.4** Do we want the MCP server usable from Claude Code as well? It is cheap to support and
shows the tools are real, reusable tools.

## 7. Showcases (C6)

**7.1 [blocks design]** Are the three showcases right for us: to-do app, room booking system,
real time auction platform? Is there a domain either of us knows well that would make a better
medium or large showcase?

**7.2** What maintenance change do we run on each showcase? One should be a requirement change,
one a design change, one a hand edit to code.

**7.3** For the large showcase, what do we expect to break? Writing the guess down now makes the
report's "limits" section honest and easy.

## 8. Demo and presentation

**8.1** Which of us presents which part, and who drives the laptop?

**8.2** What is our fallback if the live LLM is slow or down: a recorded run, cached responses,
the Command Code provider, or all three?
> Proposal: Command Code fallback plus a recorded run, announced as such.

**8.3** When do we do the first full dress rehearsal?
> Proposal: by Dec 3, with a stopwatch.

## 9. Reports

**9.1** What should each of us write down while building, so the individual report is easy:
decisions, failures, surprising AI behaviour, costs?
> Proposal: decisions in `docs/decisions/`, personal reflections in `docs/reflection/<name>.md`.

**9.2** Which failures are we willing to show openly? The brief rewards honest reflection on
where AI did not work.
