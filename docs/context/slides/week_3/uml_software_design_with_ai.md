---
title: "Week 3: UML Software Design with AI"
source: "docs/pdf/slides/week_3/UML-software-design-with-AI.pdf"
pages: 54
converted_by: "Docling v2"
---

# Week 3: UML Software Design with AI

> **Source**: `docs/pdf/slides/week_3/UML-software-design-with-AI.pdf` | **Pages**: 54
> **Target Audience**: AI Coding Agents & Pair Programmers

---

Guido Salvaneschi

## AI and Software Projects

Software Design with AI

1

## Models and software modelling

A model is a simplified representation of a system: an abstraction that captures the details relevant to a purpose and deliberately leaves out the rest.

## Engineers have always modelled before building:

- Civil engineering → blueprints and scale models
- Electronics → circuit diagrams
- Aeronautics → wind-tunnel prototypes and simulations
- Mechanical design → CAD models

## Why model first?

- Understand and analyse the system before committing resources
- Communicate the design unambiguously to others
- Predict behaviour and find errors while they are still cheap to fix

## Models and software modelling

Software is invisible and complex: models make it visible, discussable and checkable before a line of code is written.

## Why modelling matters in software:

- Manages complexity through abstraction
- Provides a common language for developers, analysts and stakeholders
- Documents architecture and design decisions
- Enables early validation, and even code generation (model-driven development)

## Kinds of software models:

- Structural (static): classes, objects, components, deployment
- Behavioural (dynamic): use cases, sequence, activity, state machines
- Usage modes: sketch, blueprint, or executable model

## Software architecture

Software architecture: the high-level structure of a system, its main components and responsibilities, and the rules governing how they interact.

It captures the decisions that are hardest to change later and shapes quality attributes such as performance, scalability, security and maintainability.

## Recurring architectural styles:

- Layered (n-tier): presentation, business logic and data layers, typical of enterprise applications
- Client-server: clients request services from a central server, as in most web applications
- Model-View-Controller (MVC): separates data, user interface and control logic
- Microservices: small, independently deployable services that communicate through APIs
- Event-driven: components publish and react to events, common in asynchronous systems
- Pipe-and-filter: data flows through a chain of processing steps, as in compilers and ETL pipelines

<!-- image -->

4

<!-- image -->

## A TOUR OF UML

## Why Model at All?

## A model is a deliberate simplification that answers a question.

To think: externalise a system so you can spot gaps and loops before building anything

To communicate: one picture replaces pages of prose and hours of meetings

To specify: give developers and vendors something precise enough to build from and test against

## As an AI Business Specialist, you are the bridge:

You take a promising AI use case, sketch first solution approaches, and develop them iteratively with IT developers and data specialists: diagrams are the language of that collaboration

## A Brief History of UML

Early 1990s: the "method wars": dozens of competing object-oriented methods, most notably the Booch method, OMT (Rumbaugh) and OOSE (Jacobson), each with its own notation and tools.

1994: James Rumbaugh joins Grady Booch at Rational Software, and they begin unifying the Booch method and OMT into a single notation.

1995: Ivar Jacobson joins Rational: the "Three Amigos" integrate OOSE, in particular use cases, and publish the first Unified Method draft.

1996: the effort is renamed Unified Modeling Language; a consortium of companies (the UML Partners) refines versions 0.9 and 1.0.

1997: UML 1.1 is adopted by the Object Management Group (OMG) as an official industry standard: one common notation replaces the competing methods.

2005: UML 2.0, a major revision: 13 diagram types, richer sequence diagrams and better support for component-based development. UML also becomes an ISO standard.

2015: UML 2.5 simplifies and reorganizes the specification into the 14 diagram types used today; the current version, UML 2.5.1, follows in 2017.

8

## What UML Is, and What It Is Not

## UML: Unified Modeling Language:

A standard visual language for specifying and documenting systems, maintained by the OMG (Object Management Group) since 1997

14 diagram types, one shared notation understood worldwide

## What UML is NOT (for us):

Not a programming language, and never a step towards code in this course

Not an all-or-nothing method: you can use 10% of UML and get 90% of the value

Not bureaucracy: a napkin sketch with correct notation beats a perfect diagram nobody draws

<!-- image -->

## The Reference Book for UML

## Martin Fowler

UML Distilled: A Brief Guide to the Standard Object Modeling Language

Third Edition, Addison-Wesley, 2003. ISBN 978-0321193681

- The reference for the UML part of this course
- A deliberately short guide (about 160 pages): it covers the parts of UML you will actually use, not the whole standard
- Updated for UML 2.0, with chapters on class, sequence, activity, state machine, use case and deployment diagrams
- Explains how to use UML in practice, distinguishing UML as sketch, as blueprint and as programming language
- Forewords by Grady Booch, Ivar Jacobson and Jim Rumbaugh, the original creators of UML

<!-- image -->

## We focus on a subset of UML

Use Case diagrams: actors, goals, and system scope

Activity diagrams: business processes, decisions, parallel activities, and AI workflows

Class diagrams: business concepts, information, and relationships

Sequence diagrams: interactions among users, applications, AI services, and external systems

## Introduction to draw.io

## app.diagrams.net: free, browser-based, no account needed Supports realtime collaboration

## A desktop version is also available

- Save target: 'Device' is fine, you get a .drawio file you can reopen anytime
- Left panel: search 'UML' shape libraries, actor, use case, system boundary are all there
- Drag shapes on the canvas; hover a shape edge and drag to connect: exactly like Figma
- Double-click a shape to rename; double-click empty canvas for a quick shape picker

https://app.diagrams.net/

<!-- image -->

## Follow along: your first diagram in draw.io

Follow along: the instructor shares the screen and builds a small diagram in draw.io; you replicate every step in your own file.

The diagram: a mini concept map of AI topics (for example: machine learning, neural networks, NLP, computer vision, ethics)

## Steps:

Open draw.io (app.diagrams.net) and create a new blank diagram

Save the file into the course Google Drive folder, named after you

Mirror the instructor: add the topic nodes, then the labelled connections between related concepts

Check that your file appears in the shared folder

This doubles as our technical check: if anything fails here (access, saving, editing), we fix it now, before the first modeling activity.

16

Guido Salvaneschi

## AI and Software Projects

## Software Modeling

## USE CASE DIAGRAMS

## Diagram Type: Use Case Diagram

## Goal

- Show WHAT the system offers, WHO uses it, and WHERE the system ends: the contract of the system on one page

## The question it answers

- "Who can do what with the system, and what stays outside?"

## Typical use cases

- Scoping a new system or AI use case before anything is built
- Aligning stakeholders on what is (and is not) part of the project
- Briefing a vendor or development team: goals, not screens or steps

Level of detail: goals only. If you are drawing clicks and screens, you have gone too deep.

## Elements of the Use Case Diagram

Actor: a role (person or external system), never a name or job title

<!-- image -->

Use case: a goal, named verb + object

<!-- image -->

System boundary: inside is built, outside is not

<!-- image -->

Association: this actor participates in this goal

<!-- image -->

«include»: always part of. «extend»: optional addition

<!-- image -->

## More Elements of the Use Case Diagram

<!-- image -->

Actor generalization: a Premium Customer can do everything a Customer can

<!-- image -->

University of St.Gallen Use case generalization: specific ways of achieving the same goal Note: free-text commentary, attachable to any element

<!-- image -->

## Example of a Use Case Diagram

## A webshop, seen as goals:

Two human actors (Customer, Warehouse Staff) and one system actor (Payment Provider)

Place order «include» Pay order: paying is always part of ordering

The boundary makes scope explicit: payment processing is OUTSIDE, done by the provider

Count the words: eleven words inside the boundary describe the whole system. That is the power of this diagram type.

## Webshop: Use Case Diagram

<!-- image -->

## Activity: Read a Use Case Diagram

## Customer Service Chatbot: Use Case Diagram

<!-- image -->

## Individually, write short answers:

- 1 · Who or what can interact with the chatbot system?
- 2 · Which use cases involve the Customer?
- 3 · What does «include» between "Ask a question" and "Receive AI answer" mean?
- 4 · The AI model itself is not shown as an actor. Why could that be?

## Activity Solution: Reading the Use Case Diagram

## 1 · Who can interact?

- Customer, Support Agent, Administrator: three roles. Roles, not job titles or names, and actors can also be external systems.

## 2 · Which use cases involve the Customer?

- Ask a question, Escalate to human agent, Rate the answer (and, via «include», Receive AI answer).

## 3 · What does «include» mean?

- Asking a question ALWAYS includes receiving an AI answer: the included use case is a mandatory part of the including one.

## 4 · Why is the AI not an actor?

- The AI is inside the system boundary: a component of the chatbot, not an external party using it. Actors live outside the boundary.

## Activity: Design a Use Case Diagram

## Scenario: AI-supported leave request system

Employees submit leave requests and check their remaining balance. An AI assistant suggests optimal dates using team calendars and project deadlines. Managers approve or reject requests; employees are notified. HR configures the leave policies.

## Your task (draw.io): model this as a use case diagram.

- Identify the actors: roles, not names
- Name use cases as verb + object, 4-6 are plenty
- Draw the system boundary, and decide: is the AI assistant inside or outside?
- Be ready to defend your boundary decision

## Activity Solution: One Possible Use Case Diagram

## Al-Supported Leave Request System: Sample Solution

<!-- image -->

## One defensible model, not THE model:

Four actors, five use cases, boundary drawn around the leave system including the AI

Placing the AI assistant OUTSIDE is equally defensible: then it is an actor, an external service the system calls

The consequences differ: build vs buy, data flows, responsibility

The discussion about the boundary is the learning outcome. Both answers are correct; unexamined answers are not.

## ACTIVITY DIAGRAMS

## Diagram Type: Activity Diagram

## Goal

- Show HOW a process runs from start to end: the order of steps, the decisions, and who does what

## The question it answers

- "What happens first, what happens next, and what happens when things go wrong?"

## Typical use cases

- Documenting a business process before automating or improving it
- Designing AI workflows: every n8n workflow you will build is an activity diagram in disguise
- Finding the unhappy paths that everyone forgot to mention

This is the workhorse diagram of your profession: if you master one type, master this one.

## Elements of the Activity Diagram

<!-- image -->

Start (filled dot) and end (circled dot): normally one start, one or more ends Action: one step, verb + object

<!-- image -->

Decision: a question, every branch labelled

<!-- image -->

Swimlane (UML 2 name: partition): WHO performs the actions in it Fork and join: activities that run in parallel

<!-- image -->

## More Elements of the Activity Diagram

<!-- image -->

Merge: paths come together again, same diamond but no question Object node: the DATA passed between steps

<!-- image -->

Time event (UML: time signal): a flow triggered by time, not by a previous action Activity final vs flow final: stop everything vs stop this branch

<!-- image -->

## Example of an Activity Diagram

## Placing an online order:

Two decisions, each branch labelled, each path reaches an end

The unhappy paths (out of stock, payment failed) are modeled, not hidden

Reading rule: follow every arrow until it ends somewhere

A process diagram that only shows the happy path is a brochure, not a model.

<!-- image -->

## Activity: Read an Activity Diagram

## Individually, answer:

- 1 · Which swimlanes exist, and what does each represent?
- 2 · What happens when the AI's confidence is below the threshold?
- 3 · Which paths do NOT end in an automatic reply?
- 4 · Where exactly does a human take over, and what triggers it?

<!-- image -->

## Activity Solution: Reading the Activity Diagram

## 1 · Which swimlanes?

- AI / System and Human Agent (plus the customer as source): lanes show who acts, and the lane split IS the automation decision.

## 2 · Confidence below threshold?

- The ticket leaves the automatic path and goes to the Human Agent lane for review before routing: the human-in-the-loop pattern.

## 3 · Paths without automatic reply?

- Low-confidence tickets and severe complaints: both require a human decision before the customer hears anything.

## 4 · Where does a human take over?

- At the confidence decision and at the severity escalation: both are explicit decision diamonds, not vague intentions.

## Activity: Design an Activity Diagram

## Scenario: invoice approval

Invoices arrive by email. Accounting checks the details (supplier, amount, match with purchase order). Incorrect invoices go back to the supplier. Invoices above CHF 5'000 need manager approval; the manager approves or rejects with a comment; rejected invoices are corrected and re-checked. Approved and small invoices are booked and paid.

## Your task (draw.io, in groups):

- At least 2 swimlanes, 2 decision points, and 1 unhappy path that does not end in success
- Label every branch of every decision
- Every path must reach an end node
- Bonus: is there anything that could run in parallel?

## Activity Solution: One Possible Activity Diagram

Invoice Approval with Swimlanes: Sample Solution

<!-- image -->

## What a good solution shows:

Labelled branches at every diamond, including the CHF 5'000 threshold

The rejection loop crossing back over the lane boundary: a visible handover

An unhappy ending for incorrect invoices

Layout differences are irrelevant. The test: could someone else run the process from your diagram?

## CLASS DIAGRAMS

## Diagram Type: Class Diagram (Conceptual)

## Goal

- Show WHICH concepts the system works with, what it knows about them, and how they relate: the shared vocabulary of the project

## The question it answers

- "What data does this system need, and how does it hang together?"

## Typical use cases

- Building the shared dictionary before a project ("what exactly is a 'customer' here?")
- Checking data readiness for an AI use case: does the data the AI needs even exist?
- Briefing data specialists precisely instead of by email thread

We stay conceptual: no methods, no types, no database design. Business vocabulary only.

## Elements of the Class Diagram

<!-- image -->

Class: a concept (singular noun) with its attributes

<!-- image -->

Aggregation (empty diamond) vs composition (filled: parts die with the whole)

<!-- image -->

Association with multiplicities: 1 customer places * orders

<!-- image -->

Inheritance: Manager IS AN Employee

## More Elements of the Class Diagram

<!-- image -->

exactly one

optional: none or one

any number, including none

at least one

The four multiplicities worth memorising a concept can relate to itself: one employee manages many Self-association: a concept relating to itself

<!-- image -->

## «enumeration» TicketStatus

open in progress resolved closed

Enumeration: a fixed list of allowed values, the natural home of every status field

## Example of a Class Diagram

## The webshop's vocabulary:

Four concepts, each a singular noun with 2-3 attributes

Relationships are labelled and carry multiplicities

No methods, no technical types: this is a dictionary, not a database schema

Test for any concept model: could a colleague reconstruct what data the system needs, just from this picture?

## Webshop: Conceptual Class Diagram

<!-- image -->

## Activity: Read a Class Diagram

## Individually, answer:

- 1 · Which concept stores what the AI produced, and which attributes does it carry?
- 2 · Why does the model store a modelVersion attribute?
- 3 · What is the multiplicity between Ticket and Classification, and what does it imply?
- 4 · Which attributes would you need to audit the AI's decisions a year later?

## Ticket Triage: What Data Does the Al Need?

<!-- image -->

## Activity Solution: Reading the Class Diagram

## 1 · Where does AI output live?

- In Classification: category, confidence, and the model version. AI output is data like any other, and modeling it explicitly is what makes it governable.

## 2 · Why modelVersion?

- To audit and retrain: 'which model made this decision?' is the first question in any incident, bias review, or regulator conversation.

## 3 · Ticket to Classification multiplicity?

- 1 to *: a ticket can be classified several times (re-runs, model updates, human corrections). History is kept, not overwritten.

## 4 · Audit attributes?

- confidence, modelVersion, timestamps, and who acted on the classification: together they reconstruct any decision.

## Activity: Design a Class Diagram

## Scenario: the leave request system, one level deeper

Return to the AI-supported leave request system. The system must know about employees, their requests, their remaining balance, the manager's decisions, and the AI's date suggestions.

## Your task (draw.io or paper):

- 4-6 concepts, singular nouns, with 2-3 attributes each
- Labelled relationships with rough multiplicities (1, *)
- Model the AI's suggestion as its own concept: what must it carry?
- Strictly conceptual: no technical details

## Activity Solution: One Possible Class Diagram

## One possible vocabulary:

Employee, LeaveRequest, LeaveBalance, Decision, and AISuggestion as its own concept

AISuggestion carries a confidence attribute: remember it, it returns in every AI diagram

Watch for: plural class names, attributes that are really other concepts, unlabelled relationships

## Al-Supported Leave Requests: Conceptual Class Diagram (Sample Solution)

<!-- image -->

## SEQUENCE DIAGRAMS

## Diagram Type: Sequence Diagram

## Goal

- Show WHO calls WHOM over time: the exact conversation between users, applications, AI services, and external systems

## The question it answers

- "Who calls whom, in what order, with what, and what comes back?"

## Typical use cases

- Understanding an integration before buying or building it
- Talking to developers with precision: 'what exactly do we send to the AI service?'
- Spotting where latency, cost, and data protection bite: every arrow is a call that takes time, costs money, and carries data

For you the goal is reading fluency: you will read many of these and draw few.

## Elements of the Sequence Diagram

<!-- image -->

Participant with its lifeline: time flows down

<!-- image -->

Self-message: the participant does something internally

<!-- image -->

Solid arrow: request. Dashed arrow: response

<!-- image -->

Loop fragment: repeated interaction, condition in brackets

<!-- image -->

## More Elements of the Sequence Diagram

<!-- image -->

Activation bar: when a participant is busy

<!-- image -->

University of St.Gallen Alt fragment: either-or paths, the confidence branch in sequence form Asynchronous message: fire and forget, nobody waits

<!-- image -->

## Example of a Sequence Diagram

## The chatbot, one question deep:

The app assembles context BEFORE calling the AI: prompts are built, not typed

The AI returns an answer AND a confidence

The confidence check is a selfmessage in the app: that is where your business rule lives

## Three questions for any AI integration:

Who calls whom? What exactly is sent? What comes back?

## Asking the Chatbot a Question: Sequence Diagram

<!-- image -->

## Activity: Read a Sequence Diagram

## Individually, answer:

- 1 · Why does the middleware call the legacy API at night instead of per request?
- 2 · What exactly does the agent send to the middleware, and what comes back?
- 3 · Which participant never talks to which, and why is that a feature?
- 4 · Where would the 40-90 second latency bite if the middleware did not exist?

<!-- image -->

## Activity Solution: Reading the Sequence Diagram

## 1 · Why nightly?

- The legacy endpoint returns all 28'000 entries as one 383 MB file in 40-90 s and cannot filter. Nightly sync + local index turns an unusable API into a fast one.

## 2 · Agent to middleware?

- A small, structured search request (specialty, city); back comes a small, fast JSON with top matches. The heavy data never crosses this line.

## 3 · Who never talks?

- The agent never touches the legacy API. Only the middleware does: one place absorbs the legacy constraints, and the agent stays clean.

## 4 · Where would latency bite?

- Between question and answer: a voice user will not wait 90 seconds. The sequence diagram makes the bite point visible as a specific arrow.

## Activity: Design a Sequence Diagram

## Scenario: asking the RAG knowledge assistant

An employee asks the internal knowledge assistant a question. The assistant checks the employee's permissions, searches the vector index for relevant passages, sends the question plus passages to the LLM, attaches citations to the draft answer, and shows the result. If no reliable sources are found, it answers 'no reliable answer' instead.

## Your task (draw.io):

- Participants: Employee, Assistant UI, RAG Service, Vector Index, LLM API
- Time flows down; solid arrows for requests, dashed for responses
- Show WHERE the permission check happens: before or after retrieval matters
- What exactly is sent to the LLM? Only what is needed

## Activity Solution: One Possible Sequence Diagram

Asking the RAG Assistant: One Possible Model

<!-- image -->

## The design choices, made visible:

Permissions are checked BEFORE retrieval: the assistant cannot even see forbidden passages

Only the question and the retrieved passages go to the LLM, never whole documents

Citations are verified before display: the no-reliable-answer path is a first-class outcome

Every one of these choices is invisible in prose and unmissable in the diagram.

## CASE STUDY 1

## Recap

## Diagram types seen so far in the course:

- Use case diagram: the functionality of the system from the users' point of view, actors and their goals
- Activity diagram: the flow of actions in a process, including decisions, parallel paths and synchronisation
- Class diagram: the static structure of the system, classes, attributes, operations and relationships
- Sequence diagram: who calls whom over time, the exact conversation between users, applications and external systems

55

## Activity: case study 1 on UML diagrams

## VeloCity AG: a Zurich e-bike subscription company (handout in the course folder)

Read the company description, then model VeloCity in groups. Start with the two priority diagrams: Priority 1 · Use case diagram the customer portal: actors, goals, boundary. Decide: is the AI damage assessor inside or outside?

Priority 2 · Activity diagram the damage-handling process: swimlanes, the confidence guard, every unhappy path If time remains · Class diagram the company's vocabulary, with an auditable concept for the AI's assessment If time remains · Sequence diagram one damage report end to end: who calls whom, in which order, and where a human enters

## Organisation

- Work in groups · one shared draw.io file, one page per diagram · note every assumption on the diagram
- Export each page as PNG to the shared board; be ready to present ONE diagram and name one question your model left open

56

## THANK YOU!
