---
title: "Course Project Requirements (2026)"
source: "docs/pdf/Project-Requirements-2026.pdf"
pages: 6
converted_by: "Docling v2"
---

# Course Project Requirements (2026)

> **Source**: `docs/pdf/Project-Requirements-2026.pdf` | **Pages**: 6
> **Target Audience**: AI Coding Agents & Pair Programmers

---

<!-- image -->

Coding with AI - WS 2026

## Project Requirements

## From AI-generated code to AI-assisted software engineering

University of St. Gallen - Institute of Computer Science - Prof. Dr. Guido Salvaneschi

## 1. Why this project

Today, AI tools are very good at one thing: generating code. Give them a prompt and they produce a function, a class, sometimes a whole application. But writing code is only a small part of software engineering. Before the code there are requirements to understand and a design to agree on. After the code there are tests to write and run, bugs to fix, deployments to prepare, and a system to keep consistent while it evolves. These are the phases where projects succeed or fail, and they are the phases where AI support is still unclear.

The goal of this course is that you gain confidence with AI tools for coding. The goal of this project is that you look beyond code generation and learn how AI can support the whole software engineering process. You will do this by building the tool yourself.

## 2. Your task

In groups of two, you build an AI-assisted software engineering environment: a multi agent-based system, powered by LLMs, that accompanies a developer through all the phases of a software project. The developer describes what they want; your environment helps them turn this into requirements, a design, code, tests, a deployment, and then helps them maintain the result over time.

Code generation is part of the system, but it is not the most important part. Think of it as the body of a bird: it is in the middle, but it does not fly without the wings. The wings are everything that comes before code generation (requirements, design, design refinement) and everything that comes after it (testing, deployment, bug fixing, maintenance). Your project will be evaluated mostly on the wings.

The environment is based on agent technology. You are free to choose the LLMs, the agent framework, the programming language, and the tools (for example MCP servers) that you want to use. You are encouraged to use AI tools intensively while building the environment itself, and to reflect on that experience in your final report.

## 3. What the environment must do

Your environment must support the developer in the following phases. For each phase, the developer must be able to see what the system produced, discuss it, and change it before the system moves on. The developer stays in control; the agents assist.

## P1 - Requirements

<!-- image -->

## Coding with AI - Project Requirements

The developer provides an initial, possibly vague, description of the software they want. The environment turns it into a structured set of requirements. When the description is incomplete or ambiguous, the environment must ask clarifying questions rather than guessing. The result is a requirements document that the developer can review, edit, and approve.

## P2 - Design

From the approved requirements, the environment produces design documents based on UML. Different diagrams should be used for different purposes, for example use case diagrams for the functionality, class diagrams for the structure, sequence or activity diagrams for the behaviour, and component or deployment diagrams for the architecture. The diagrams must be visible to the developer, ideally rendered in the interface, and the developer must be able to discuss them with the system, for example asking why a choice was made or requesting an alternative.

## P3 - Design refinement

Design is not done in one shot. The environment must support an interactive refinement loop: the developer comments on a diagram, asks for a change, or points out a problem, and the environment updates the design consistently across all the diagrams. The environment may also review its own design and propose improvements, for example missing classes, unclear responsibilities, or requirements that are not covered.

## P4 - Code generation

The code is generated from the approved design documents, not directly from the initial description. The structure of the code should reflect the design, for example the classes in the class diagram should appear in the code and the interactions in the sequence diagrams should be visible in the calls. Code generation is required, but keep it proportionate: it is the phase where existing tools already work best and where you will earn the least credit.

## P5 - Testing

The environment generates tests, runs them, and reports the results to the developer. Tests should be derived from the requirements and the design (for example one test per use case, or tests for the scenarios in the sequence diagrams), not only from the code. When tests fail, the environment should help the developer understand why and propose a fix, and it should be able to re-run the tests after the fix.

## P6 - Deployment

The environment prepares a way to run the software outside of the development environment. Cloud deployment is not required. Something simpler is fine, for example a Dockerfile and a docker-compose file, a start script with a configuration file, a packaged executable, or a local web server. What matters is that the deployment artefacts are generated by the environment, that they are consistent with the design, and that they work.

<!-- image -->

## Coding with AI - Project Requirements

## P7 - Maintenance and consistency

Software changes. The developer must be able to come back to the environment with a change request, a bug report, or a new requirement, and the environment must propagate the change through all the artefacts: requirements, diagrams, code, tests, and deployment. In particular, the environment must keep the diagrams aligned with the code. This includes detecting when they have diverged, for example after the developer edited the code by hand, and offering to fix the inconsistency in one direction or the other.

## 4. Showcase projects

You must demonstrate your environment on at least three example software projects of increasing complexity, developed end to end with your environment (from the initial description to a deployed and tested system, plus at least one maintenance change). For example:

- Small: a to-do list application with a command-line or simple web interface.
- Medium: an application with several interacting components and persistent data, for example a small library management system, a booking system, or an expense tracker with a database and a web front end.
- Larger: something that stresses your environment, for example a system with multiple services, a real-time component, an external API integration, or a domain that requires non-trivial design decisions.

You can choose the showcase projects yourself. Choose the larger one so that it exposes the limits of your environment: it is fine, and interesting, if some parts do not work. Document what failed and why.

## 5. Grading criteria

The project is graded against the following criteria. Use them while you plan and, above all, while you prepare the demo and the report: for each criterion, ask yourself what evidence you will show us.

| Criterion                                | What we look for                                                                                                                                                                                                                     | How to show it                                                                                                                                                |
|------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| C1. Support for the phases beyond coding | The environment supports requirements, design, design refinement, testing, deployment, and maintenance, not only code generation. The phases are connected: requirements drive the design, the design drives the code and the tests. | Walk through one showcase project end to end in the demo. Show the clarifying questions, the diagrams, the generated tests running, the deployment artefacts. |

<!-- image -->

## Coding with AI - Project Requirements

| Criterion                                                   | What we look for                                                                                                                                                                                                                                                                                                                                                                                | How to show it                                                                                                                                                                                                                       |
|-------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| C2. Alignment of the artefacts under change                 | When something changes, the change propagates. A change in the requirements updates the diagrams and the code. A change in the design is reflected in the code. A change in the code is reflected in the design. The environment detects drift and helps to repair it.                                                                                                                          | Demo at least one change of each kind (requirement, design, code) on a showcase project and show which artefacts were updated. Explain in the report how synchronisation works and where it fails.                                   |
| C3. Usability for programmers                               | The environment is pleasant and practical to use for a developer: clear workflow, the artefacts are visible and editable, the developer can intervene at every step, the system explains what it is doing, and errors are handled gracefully.                                                                                                                                                   | A live demo that runs smoothly. In the report, describe the workflow from the point of view of a developer and what you did to make it usable.                                                                                       |
| C4. Agent-based architecture and its documentation          | The environment is a multi-agent, LLM- based system, not a fixed script with a few prompts in it. The design of the environment itself is explained: which agents exist and what each one is responsible for, which skills or tools they use (for example MCP servers), which LLMs are used and why, how the agents communicate, and how the artefacts are stored and synchronised.             | An architecture section in the report with a diagram of the agents and the artefact flow. A short architecture slide in the presentation. A README in the repository.                                                                |
| C5. Connection between the developer and the generated code | The environment counters the "vibe coding" effect, where the developer writes a prompt and is completely detached from the resulting code. The intermediate artefacts, in particular the UML diagrams, help the developer understand and control what is generated: the code visibly follows the design, and the developer can navigate from a requirement to the diagram to the code and back. | In the demo, pick a requirement and show how it appears in the design and in the code. In the report, discuss how the intermediate artefacts helped (or did not help) you understand the generated code.                             |
| C6. End-to-end showcase and scalability                     | The environment really produces working software on the three showcase projects, from the initial description to a tested and deployed system plus a maintenance change. It holds up when the project grows from the to-do list to the larger one; where it breaks, the limits are identified and explained rather than hidden.                                                                 | A live demo on at least one showcase project, with the others available in the repository with their generated artefacts. In the report, a short comparison of how the environment behaved on the small, medium, and larger project. |
| C7. Quality of the generated artefacts                      | It is not enough that artefacts are produced; they must be good. The requirements are precise and complete, the UML diagrams are correct and meaningful, the code follows the design, the tests really check the requirements and can catch bugs, and the deployment runs.                                                                                                                      | Show a generated test failing on an injected bug and passing after the fix. Include sample artefacts (requirements, diagrams, tests) in the report or the repository, and comment on their quality.                                  |

<!-- image -->

## Coding with AI - Project Requirements

The seven grading criteria have equal weight. In addition, as in the course introduction, the presentation itself (clarity, timing, live demo, answers to the questions) counts for the project grade, and the individual report is graded separately, with particular attention to an honest reflection on what failed and on the limits of AI in each phase. Code generation is expected to work, but it does not earn credit on its own: it is the baseline on which C1 to C7 are built.

## 6. Technical choices

You are free to choose your stack. Some suggestions, not requirements:

- Agent frameworks: any of the common frameworks for multi-agent LLM applications, or your own lightweight orchestration.
- LLMs: any provider or local model; make sure your demo does not depend on a single fragile API key and mind rate limits and costs.
- UML: a textual notation that can be generated and rendered by tools (for example PlantUML or Mermaid or desktop app of Draw.io) is a practical choice, because the agents can read and write it and the developer can see it.
- Interface: a chat plus artefact view (requirements, diagrams, code, test results) in a web page or notebook is enough. A polished UI is nice but secondary.
- Tools and MCP: wrap external actions (rendering diagrams, running tests, building containers, reading files) as tools or MCP servers so that the agents can call them.

The project is the same for all groups this year, so there is no project description to submit. You are free in how you design and build the environment; explain your choices, and any change of direction along the way, in the final report.

## 7. Deliverables and deadlines

All submissions by email to the course instructors. Dates below are to be confirmed and will be announced in the lecture and on the forum.

| Deliverable          | Who        | What                                                                    | Deadline and Dates                     |
|----------------------|------------|-------------------------------------------------------------------------|----------------------------------------|
| Group composition    | Group      | Email with the names and email addresses of the two group members       | October 14, 23:59 (CEST)               |
| Code submission      | Group      | Link to the GitHub repository (environment + showcase projects)         | December 16, 23:59 (CET)               |
| Project presentation | Group      | In presence, in the last two lectures of the course; live demo required | - December 7, 2026 - December 14, 2026 |
| Final report         | Individual | PDF, 6 pages, A4, 12 pt, Times                                          | December 30, 23:59 (CET)               |

Grade structure, as in the course introduction: 25% active participation, 40% project (group work, individual grade, based on the presentation and the demo), 35% individual report.

<!-- image -->

## 8. Group composition

Since the project is fixed this year, there is no project description to write. Instead, each group sends one email with the names and email addresses of its two members by the deadline above. Groups are of two people; if the number of participants is odd, one group of three is allowed after agreement with the instructors. If you have not found a partner by the deadline, write to us and we will match you with another student.

## 9. Final report (individual, 6 pages)

Describe the environment you built and the results, organised along the phases P1 to P7, including the design choices you made and the ones you changed along the way. Then reflect on the experience. Some questions to guide you:

- For which phases did the AI agents work well, and where did they fail?
- How did the quality of the requirements and of the design affect the quality of the generated code and tests?
- How did you keep the developer in the loop, and was it worth it?
- How did you handle consistency between diagrams and code, and what broke?
- Which AI tools did you use to build the environment itself, in which interaction mode (prompting, code completion, agentic coding), and for which tasks were they effective?
- What would you do differently?

Each group member writes their own report. Reports may describe the same system, but the reflection must be your own.

## 10. Presentation and demo

Each group presents in presence. Plan for about 12 minutes of presentation followed by questions; the exact timing will be announced with the schedule. The time limit is strict and overrunning costs points. The presentation must include a live demo of the environment on at least one showcase project. A pre-recorded video is only a fallback in case something breaks and must be announced as such. Spend most of the demo time on the phases before and after code generation: show the clarifying questions, show the diagrams and change one of them, show the tests running, show a maintenance change propagating.
