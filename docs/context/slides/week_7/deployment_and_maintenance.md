---
title: "Week 7: Deployment and Maintenance"
source: "docs/pdf/slides/week_7/deployment-and-maintenance.pdf"
pages: 37
converted_by: "Docling v2"
---

# Week 7: Deployment and Maintenance

> **Source**: `docs/pdf/slides/week_7/deployment-and-maintenance.pdf` | **Pages**: 37
> **Target Audience**: AI Coding Agents & Pair Programmers

---

Guido Salvaneschi

## Coding with AI

Deployment and Maintenance

## Software Engineering and Software lifecycle

- Architecture writing assistance
- Sequence, flow diagram generation
- Data Model authoring
- UX design assistance
- Test cases writing
- Testing code generation
- Performance monitoring and remedy suggestion
- Document generation
- AI-assisted support
- Requirements writing and analysis
- Ambiguity and gap detection
- Code generation
- Debugging
- Explain code
- Improve consistency
- Code translation
- Continuous integration / Continuous deployment generation
- Infrastructure as Code script writing support
- Automation script writing assistance

<!-- image -->

Software Deployment

## · Deployment

- Installing a specified version of the software in a given environment: install, configure, start, check

## · Release

- Making it available to the users, or to some of them: once it is deployed, releasing is a business decision

## · Environments

- Development: your laptop
- Test (staging): a copy of production for the last checks
- Production: where the users work

## What Is Deployment?

## DEPLOYMENT DIAGRAMS

## Diagram Type: Deployment Diagram

## Goal

- Show WHERE the software runs: which artifact executes on which machine, and which data travels over which connection

## The question it answers

- "Where does the code run, where does the data live, and what crosses which border?"

## Typical use cases

- Cloud vs on-premises decisions, made visible and discussable
- Data protection reviews: exactly which data leaves the company network?
- Locating external AI providers: for AI systems, 'where does the LLM run?' is THE deployment question

For Swiss organisations this diagram is where nFADP/GDPR conversations become concrete.

## Elements of the Deployment Diagram

## «device» Server

«executionEnvironment» Docker

Execution environment: the runtime inside a node (Docker, browser, JVM)

«device» Application Server

Node: a machine, physical or virtual («device»)

<!-- image -->

Communication path: who talks to whom, and over what protocol

<!-- image -->

University of St.Gallen

«artifact» chatbot-app.jar

Artifact: the deployable piece of software

<!-- image -->

External service: the cloud you use but do not control

## More Elements of the Deployment Diagram

<!-- image -->

same meaning as drawing the artifact inside the node: pick one style and stay with it the configuration that governs HOW the artifact runs there

<!-- image -->

«deploy» dependency: same meaning as nesting the artifact in the node Deployment specification: the configuration that governs how it runs Node instances [3]: identical machines, e.g. behind a load balancer

<!-- image -->

<!-- image -->

University of St.Gallen

## Example of a Deployment Diagram

## The chatbot, physically:

The widget runs in the customer's browser; app and conversation data run in a Swiss cloud VM

The LLM is an external SaaS in an EU region: an explicit, visible decision

Every line carries data: the interesting question is always what data, and across which border

Nothing in this picture is technical decoration: region labels are legal decisions.

## Customer Chatbot: Deployment Diagram

<!-- image -->

The deployment diagram answers WHERE: which code runs on which machine, and which data crosses which border. For Al systems the critical question is usually: where does the LLM run, and what data is sent to it?

## Activity: Read a Deployment Diagram

## Individually, answer:

- 1 · Which artifacts run inside the company data center, and which outside?
- 2 · Which patient data crosses the company boundary, and on which path?
- 3 · Why does the search index live on the middleware VM and not in the cloud?
- 4 · What still works, and what breaks, if the cloud platform is down?

## MedFinder Voice Agent: Deployment Diagram

<!-- image -->

## Activity Solution: Reading the Deployment Diagram

## 1 · Inside vs outside?

- Inside: middleware with search index, legacy server with directory API. Outside: the voice app on the phone and the AI agent + speech-to-text on the cloud platform.

## 2 · What crosses the boundary?

- Voice recordings and the extracted request (symptoms, city) travel to the cloud platform: exactly the data a review must assess.

## 3 · Why is the index on-premises?

- It is derived from the full 383 MB directory: keeping it inside means the complete dataset never leaves the company; only small search results do.

## 4 · Cloud down?

- Voice requests fail (agent unreachable); the directory, the index, and any internal consumers keep working. The diagram shows the blast radius.

## Activity: Design a Deployment Diagram

## Scenario: deploying the RAG assistant

Decide and draw where the RAG knowledge assistant runs. Constraints: the documents and their permissions must stay inside the company; employees use a browser; the LLM is an external service; the company wants to send it as little as possible.

## Your task (draw.io):

- Nodes for laptop, servers, and the external LLM; artifacts placed on the right nodes
- Label every communication path, and mark the company boundary
- Decide: what exactly is allowed to cross the boundary to the LLM?
- Bonus: what would change with a fully local LLM?

## Activity Solution: One Possible Deployment Diagram

## RAG Assistant Deployment: One Possible Model

<!-- image -->

## One defensible deployment:

Documents, permissions, index, and RAG service all stay on-premises

Only the question plus the retrieved passages cross to the EU-region LLM, under a no-training contract

The alternative (local LLM, zero egress, lower answer quality) is a trade-off you can now present, not just feel

Seven diagram types, one system family: you can now describe an AI solution from goals to hardware.

## CASE STUDY 3

## Recap

## Diagram types seen so far in the course:

- Use case diagram: the functionality of the system from the users' point of view, actors and their goals
- Activity diagram: the flow of actions in a process, including decisions, parallel paths and synchronisation
- Class diagram: the static structure of the system, classes, attributes, operations and relationships
- State machine diagram: the states of an object and the transitions triggered by events during its lifetime
- Sequence diagram: who calls whom over time, the exact conversation between users, applications and external systems
- Component diagram: the high-level building blocks of the software, the interfaces they offer and the ones they need
- Deployment diagram: where the software runs, which artifact executes on which machine and which data crosses which connection

## Activity: case study 3 on deployment diagrams

## Piz Alva Bergbahnen AG: a ski resort, one system, three deployments (handout in the course folder)

One diagram type only, the deployment diagram, drawn three times: the resort today, after a change that adds an AI component, and after a change that moves everything. The components stay almost the same; where they run does not.

AI first, review second for each phase, let an AI tool draft the diagram (PlantUML, Mermaid or draw.io) from the text and, in Phases 2 and 3, from your previous diagram; then review it against the text and the five consistency rules, and keep an AI log of every mistake: wrong node, missing or unlabelled path, invented node, ignored constraint

Consistency pass five rules in the handout: every component on exactly one node; every path labelled with protocol and data, nothing personal leaving the resort; the storm question answered in every phase; every change marked and justified; in Phase 3 no validation over the internet and nothing left in the valley

## Organisation

- Groups of three or four; the phases are released one at a time: 30 minutes for Phase 1, 20 minutes each for Phases 2 and 3. Do not read ahead
- Hand-in: one PNG per phase on the shared board, the component-to-node table, the AI log
- Present Phase 3 and the table, prove rule 3 or rule 5 on your own diagram, and read the two most instructive entries of your AI log aloud

## Case study 3: the three phases

Phase 1 · The resort today web shop at a Swiss hosting provider; ticketing and access control in the valley server room; six lift stations with gate controllers on fibre and radio links that drop in storms; an external payment provider. Ten named components to place; a storm note on what still works when a link is down

Phase 2 · Change 1: Smart Slopes an AI Forecast Service for waiting times and dynamic prices at a hyperscaler (GPU training node, serving node, event broker); gate passages must stream out within seconds, but the data protection officer forbids anything personal leaving the resort network. Decide where pseudonymisation runs; mark every element unchanged, changed, new or removed

Phase 3 · Change 2: the Alliance, and no servers in the valley the resort joins a pass alliance: validation in under 300 ms, 48 hours offline, lists from a central registry. The valley server room closes; stations get 5G. Same components, different places: cloud for what can move, the stations for what must survive a cut link. Deliverable: the component-to-node table across the three phases

The lesson: the component diagram tells you what the pieces promise each other; the deployment diagram tells you where those promises have to be kept, and it changes far more often. The AI log tells you how much of that an AI notices on its own.

Continuous Integration

## · One team

- The same people develop, deploy and support the software: no hand-over to a separate operations team
- Automate what can be automated
- Building, testing, deploying, and the machines themselves (infrastructure as code)
- Measure first, change later
- Decide from data on deployments and failures, not from impressions

## DevOps

## Continuous Integration

## · Everyone merges often

- Each member merges their changes into the shared main branch at least daily
- Every push is built and tested
- A server runs the build and every test, automatically, for each push
- A broken build is fixed at once
- Usually by undoing the commit that broke it, so the rest of the team can keep working

## A CI Workflow on GitHub

## A file in the repository tells GitHub what to run:

- on: every push and every pull request
- runs-on: a fresh Linux machine for every run (ubuntu-latest names GitHub's current one)
- steps: get the code, install Python 3.13 and the pinned packages, run every test

A red cross on the commit: nobody merges.

`.github/workflows/tests.yml`

```yaml
name: tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-python@v7
        with:
          python-version: "3.13"
      - run: pip install -r requirements.txt
      - run: python -m pytest
```

## Continuous Delivery and Deployment

## From a push to the users:

- Continuous integration: every push is built and tested
- Continuous delivery: every green build could be released; a person decides when
- Continuous deployment: every green build goes to the users by itself

<!-- image -->

Software Maintenance

## Software Evolution

## · Software in use must keep changing

- Lehman's first law (1974): a program used in the real world must be adapted, or it becomes less and less satisfactory
- Change adds complexity
- Unless work is done to reduce it: refactoring is maintenance too
- Maintenance costs more than development
- Sommerville: usually 2 to 100 times more, depending on the application
- Understanding comes first
- Much of maintenance effort goes into understanding the code before changing it (SWEBOK)

## Kinds of Maintenance

| Kind       | What it does                                     |
|------------|--------------------------------------------------|
| Corrective | Fixes a problem found after delivery             |
| Preventive | Fixes a hidden fault before it causes a failure  |
| Adaptive   | Keeps it usable in a changed environment         |
| Additive   | Adds functions or features                       |
| Perfective | Improves it for users and maintainers            |
| Emergency  | Keeps it running until the proper fix            |

ISO/IEC/IEEE 14764:2022. Corrections: corrective, preventive. Enhancements: adaptive, additive, perfective. Emergency: the stopgap.

## Fixing a Bug, in Order

## Four steps, in this order, every time:

- Reproduce: the exact input, on purpose, until it fails every time
- A failing test: red, for the reason in the bug report
- Fix the code until the test is green, and every other test too
- Keep the test: it fails if the bug ever comes back

A bug fixed without a test is a bug that can return.

<!-- image -->

Never the reverse: a test written after the fix may only confirm the fix.

## Logging: What to Write, What Never

## A log answers "what happened?" weeks later:

- Levels: DEBUG, INFO, WARNING, ERROR, CRITICAL; Python writes WARNING and up unless set, as here, to INFO
- Write the event, the time, the model version, the duration
- Never passwords, keys or private data: "sensitive personal data"

Log the event and the folder ID, never the name or the question.

## example.log

```
2026-10-12 22:57:40,819 INFO question refused patient=P-007 rule=dose
2026-10-12 22:57:40,819 INFO question answered patient=P-007 model=granite4.2:3b seconds=2.9
2026-10-12 22:57:40,819 WARNING model server not reachable host=http://192.168.1.20:11434
```

## Agent-written code to reject

```python
# never: the question is health data
log.info(f"Question from {patient.name}: {question}")
```

Project maintenance example

## Activity: case study 4 on software maintenance

The Edge Access Agent: the program on the gate controller of each lift station (repository pizalva-gate-service in the course folder)

Version 1.2.0, in production at six stations. Eighteen green tests, a runbook, a changelog, a design document with the class and deployment diagrams and decisions AD-1 to AD-7, and a simulator that plays the turnstile and the cloud

Four open tickets in tickets/, from the station chief, the data protection review, IT and operations. Your group is the maintenance team for the afternoon

The rules for every ticket, the four steps of the lecture (reproduce · a failing test · fix · keep the test), then two more: classify and version · align the design document. The AI agent types, you think, and you keep the AI log

## Organisation

- Groups of three or four; about 75 minutes for the four tickets, 20 minutes of debrief
- Hand-in: the repository with one commit per ticket, CHANGELOG.md and docs/design.md updated, the tests green, and your AI log

## Case study 4: the backlog

TICKET-101 Expired day pass opened gate G2 at Crap Sogn at 07:02, before the morning sync. Station chief; priority high

TICKET-102 Review finding: the same card gives the same pseudonym on consecutive days, although the design promises a daily salt. Nothing has gone wrong yet. Data protection review; priority medium

TICKET-103 The Alpine Pass Alliance switches the hourly list format from CSV to JSON on 1 December and switches CSV off; a sample of the new format is in fixtures/. IT; priority high, hard deadline

TICKET-104 Operations want a WARNING in the log when a station has been offline for more than a configurable number of hours, and the offline duration in the status command. Operations; priority normal

The order is a decision. Who first, and why? Priority as written, deadline, blast radius, promises already made. You will be asked

## Case study 4 · Step 1: Reproduce

## Make the problem happen on purpose, before anyone touches the code

The exact input that produces the exact wrong output, until it fails every time. The simulator is your turnstile: python -m pizalva_gate.cli --at <time> sync, then validate <pass id>; a Python shell for the functions behind it

For a feature request there is nothing to reproduce: write down instead what the system should do that it does not do yet, precisely enough to test

Ask the agent 'Show me the reproduction before you change anything.' Refuse a fix that comes without one. Reading the code is not reproducing

Why a fix without a reproduction is a guess; the reproduction is also the first half of the test you are about to write

AI log did the agent go straight to a fix? Did it 'reproduce' by explaining the code instead of running it? Did its reproduction match the ticket, or a ticket it invented?

## Case study 4 · Step 2: A failing test

## Pin the ticket down with a test that fails for the reason in the ticket

tests/test_ticket_NNN.py: the reproduction as a test. Run the suite and watch it go red, for the right reason, not for an import error or a typo The test defines what 'done' means for this ticket, and it stays in the suite forever: the bug cannot come back unnoticed Ask the agent for the test first, and refuse the fix until you have seen the test fail yourself

Keep the old tests honest if a ticket contradicts an existing test, the ticket wins only after you understand why the old test was written

AI log did the agent write the test after the fix and present it as test-first? Did it make a test pass by weakening the assertion? Did it test the fix it had in mind rather than the ticket?

## Case study 4 · Step 3: Fix

## The smallest change that turns the new test green and keeps all eighteen old ones green

Run the whole suite, not only the new test. If an old test turns red, the ticket has told you something about the system you did not know yet Stay inside the ticket: the agent will offer refactorings, renames, 'while we are here' improvements and a nicer log format. Make it undo everything the ticket did not ask for

Ask the agent to explain the root cause in one sentence before it edits; if the sentence does not match your reproduction, stop Sometimes the fix is not code data already written with the old behaviour, a configuration at six stations, a deletion. Note it in the ticket even if you cannot do it today

AI log unrequested changes; files touched that the ticket does not concern; the test changed instead of the code; a fix that treats the symptom (more syncs, a bigger cache) instead of the cause

## Case study 4 · Step 4: Classify and version

## Say what kind of change this was and what it means for the version number

Kind the six kinds of the lecture: corrective (a fault found after delivery), preventive (a hidden fault, before it causes harm), adaptive (the environment changed), additive (a new function), perfective (better for users or maintainers), emergency (a stopgap). One per ticket, with the argument

Version PATCH: a fix and nothing else. MINOR: something new, all that worked still works. MAJOR: something that worked stops working for someone. The question is never 'how big was the diff' but 'who has to do something'

Changelog one entry: the ticket, what changed for the user, what the operator must do. Bump __version__ in pizalva_gate/__init__.py and version in pyproject.toml

Commit one commit per ticket: 'TICKET-NNN (kind): what, → x.y.z'

AI log did the agent choose a version number? Would it have been right? Did it update one of the two version strings and forget the other?

## Case study 4 · Step 5: Align the design document

## Open docs/design.md and ask: did this change touch a class, a method, a node, a communication path or a decision?

Yes: change the diagram or the decision table in the same commit as the code (AD-7). No: say so in the commit message, so that the next maintainer knows you looked

Two of the four tickets change a diagram; three change or add a design decision. Finding out which is part of the exercise Ask the agent to list the artefacts the change affects before it edits any of them; then check the list against the diagrams yourself Why this matters this is your project's criterion C2 in miniature: a change either propagates through requirements, design, code and tests, or the artefacts drift and the diagrams become fiction

AI log did the agent open the design document on its own? (It will not, unless told.) Did it update the diagram, or only the prose next to it? Did it invent a decision that nobody took?

## Case study 4: hand-in and debrief

Hand in the repository with one commit per ticket, CHANGELOG.md and docs/design.md updated, all tests green, and the AI log

Each group reports the order it chose and why; the kind and the version bump of each ticket; which tickets changed the design document and how; two entries from the AI log, one step the agent tried to skip and one thing it did better than you expected

## One question per ticket

- 101: why did eighteen green tests not catch it?
- 102: what about the events already in the broker?
- 103: MINOR or MAJOR, and when do you delete the CSV code?
- 104: what does the warning not solve?

## THANK YOU!
