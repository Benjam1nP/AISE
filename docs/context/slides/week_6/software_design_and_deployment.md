---
title: "Week 6: Software Design and Deployment"
source: "docs/pdf/slides/week_6/software-design-and-deployment.pdf"
pages: 44
converted_by: "Docling v2"
---

# Week 6: Software Design and Deployment

> **Source**: `docs/pdf/slides/week_6/software-design-and-deployment.pdf` | **Pages**: 44
> **Target Audience**: AI Coding Agents & Pair Programmers

---

Guido Salvaneschi

## Coding with AI

Software Design and Deployment

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

<!-- image -->

Association with multiplicities: 1 customer places * orders

<!-- image -->

Inheritance: Manager IS AN Employee

## More Elements of the Class Diagram

<!-- image -->

<!-- image -->

<!-- image -->

<!-- image -->

exactly one

optional: none or one

any number, including none

at least one

The four multiplicities worth memorising a concept can relate to itself: one employee manages many Self-association: a concept relating to itself

<!-- image -->

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

## Ticket Triage: What Data Does the AI Need?

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

## AI-Supported Leave Requests: Conceptual Class Diagram (Sample Solution)

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

Alt fragment: either-or paths, the confidence branch in sequence form Asynchronous message: fire and forget, nobody waits

<!-- image -->

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

## Activity: case study 1 on UML diagrams

## VeloCity AG: a Zurich e-bike subscription company (handout in the course folder)

Read the company description, then model VeloCity in groups. Start with the two priority diagrams:

Priority 1 · Use case diagram the customer portal: actors, goals, boundary. Decide: is the AI damage assessor inside or outside?

Priority 2 · Activity diagram the damage-handling process: swimlanes, the confidence guard, every unhappy path If time remains · Class diagram the company's vocabulary, with an auditable concept for the AI's assessment If time remains · Sequence diagram one damage report end to end: who calls whom, in which order, and where a human enters

## Organisation

- Work in groups · one shared draw.io file, one page per diagram · note every assumption on the diagram
- Export each page as PNG to the shared board; be ready to present ONE diagram and name one question your model left open

## COMPONENT DIAGRAMS

## Diagram Type: Component Diagram

## Goal

- Show the high-level STRUCTURE of the software: which building blocks exist, what each offers, and what each needs

## The question it answers

- "What are the parts, what does each promise, and what happens if we swap one?"

## Typical use cases

- Architecture conversations with vendors and IT: what do we build, what do we buy?
- Impact analysis: which parts are touched if we change the LLM provider?
- Making an AI solution's dependencies on legacy systems explicit

Components hide HOW they work and expose WHAT they offer. That information hiding is the whole idea.

## Elements of the Component Diagram

<!-- image -->

<!-- image -->

## More Elements of the Component Diagram

<!-- image -->

Port: a defined interaction point on the component's boundary

<!-- image -->

big components are built from smaller ones

Nested components: big blocks are built from smaller ones the outer port forwards its work to an inner component Delegation: the outer port forwards its work to an inner component

<!-- image -->

<!-- image -->

## Example of a Component Diagram

## RAG Knowledge Assistant: Component Diagram

## The RAG assistant as building blocks:

The Chat UI only knows the Ask API: it has no idea a vector index exists

The LLM provider is one dependency: swap it and exactly one arrow changes

Document Sync is the only component touching the existing DMS

This diagram answers the vendor question 'what would replacing X cost?' before anyone writes an email.

<!-- image -->

## Activity: Read a Component Diagram

## Individually, answer:

- 1 · Which component PROVIDES the Search API, and which one uses it?
- 2 · Which components would be affected if the Legacy Directory API changed its format?
- 3 · Does the AI Agent depend on the legacy system? How can you tell?
- 4 · You want to swap the AI agent for a different product: what must the new one support?

## MedFinder Voice Agent: Component Diagram

<!-- image -->

## Activity Solution: Reading the Component Diagram

## 1 · Who provides Search API?

- The Middleware provides it (solid line to the circle); the AI Agent uses it (dashed arrow).

## 2 · Legacy format change?

- Only the Middleware: it is the single component with a dependency on the legacy API. That isolation is deliberate.

## 3 · Agent depend on legacy?

- No. There is no arrow from the agent to the legacy component: the agent only knows the Search API.

## 4 · Swapping the agent?

- The new product must use the Search API (and accept voice requests from the app). Everything else is hidden behind interfaces.

## Activity: Design a Component Diagram

## Scenario: the email triage system

Design the component structure for the AI email triage system: emails arrive at a gateway, an AI classifies them, high-confidence results are routed automatically, low-confidence ones go to a human review UI, and routed cases are created in the CRM. The LLM is an external service.

## Your task (draw.io):

- 5-6 components with «component» stereotypes
- At least one named provided interface (circle) with its users
- The LLM as an external dependency, clearly outside your building blocks
- Design question: do the AI path and the human path converge, and where?

## Activity Solution: One Possible Component Diagram

## Email Triage System: One Possible Model

<!-- image -->

Both the AI path and the human path end at the SAME Route API: the interface does not care who calls it.

## One possible structure:

Both the AI path and the human path end at the SAME Route API: the interface does not care who calls it

The classifier is the only component touching the LLM: swap the provider, change one arrow

The CRM connector isolates the external CRM exactly like the middleware isolated the legacy API

Patterns repeat: wrap the thing you do not control behind an interface you do.

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

## Example of a Deployment Diagram

## The chatbot, physically:

The widget runs in the customer's browser; app and conversation data run in a Swiss cloud VM

The LLM is an external SaaS in an EU region: an explicit, visible decision

Every line carries data: the interesting question is always what data, and across which border

Nothing in this picture is technical decoration: region labels are legal decisions.

## Customer Chatbot: Deployment Diagram

<!-- image -->

The deployment diagram answers WHERE: which code runs on which machine, and which data crosses which border. For AI systems the critical question is usually: where does the LLM run, and what data is sent to it?

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

Documents, permissions, index, and RAG service all stay onpremises

Only the question plus the retrieved passages cross to the EU-region LLM, under a no-training contract

The alternative (local LLM, zero egress, lower answer quality) is a trade-off you can now present, not just feel

Seven diagram types, one system family: you can now describe an AI solution from goals to hardware.

## CASE STUDY 2

## Recap

## Diagram types seen so far in the course:

- Use case diagram: the functionality of the system from the users' point of view, actors and their goals
- Activity diagram: the flow of actions in a process, including decisions, parallel paths and synchronisation
- Class diagram: the static structure of the system, classes, attributes, operations and relationships
- State machine diagram: the states of an object and the transitions triggered by events during its lifetime
- Sequence diagram: who calls whom over time, the exact conversation between users, applications and external systems
- Component diagram: the high-level building blocks of the software, the interfaces they offer and the ones they need
- Deployment diagram: where the software runs, which artifact executes on which machine and which data crosses which connection

## Activity: case study 2 on UML diagrams

## Lakeside Insurance AG: two AI services on top of a 30-year-old legacy system (handout in the course folder)

The capstone: describe ONE company with the seven diagram types, and make the diagrams agree. Each part names its priorities; add the rest if time remains.

Part A · Business view priorities: activity and state machine diagrams (the claims process and lifecycle); if time remains: use case and class diagrams

Part B · Architecture view priorities: sequence (claim submission), component, and deployment diagrams; if time remains: a second sequence for the RAG policy question. This is the part you present

Consistency pass five rules in the handout: rules 1-3 apply to the priority diagrams, rules 4-5 to full sets. Auto-approval appears identically in three diagrams, sequence participants exist as components, components run on nodes, and nothing ever calls the legacy system live

## Organisation

- Each group splits into two sub-teams: one takes Part A, the other Part B, each starting with its priorities; swap and review before the consistency pass
- Present ONE Part B diagram, prove one consistency rule on your own set, and name the design decision you are least sure about

## THANK YOU!