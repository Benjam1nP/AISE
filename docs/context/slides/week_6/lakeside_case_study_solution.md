---
title: "Week 6: Lakeside Insurance Case Study Solution"
source: "docs/pdf/slides/week_6/Lakeside-Case-Study-solution.pdf"
pages: 9
converted_by: "Docling v2"
---

# Week 6: Lakeside Insurance Case Study Solution

> **Source**: `docs/pdf/slides/week_6/Lakeside-Case-Study-solution.pdf` | **Pages**: 9
> **Target Audience**: AI Coding Agents & Pair Programmers

---

<!-- image -->

## Case Study: Lakeside Insurance AG - Sample Solutions

## Lakeside Insurance AG - Sample Solutions and Debrief Notes

One defensible model per diagram, not THE model. Layout, naming and scope will differ between groups; the consistency rules are where correctness is objective, so give the consistency pass real weight in the debrief. The priority diagrams (activity and state machine in Part A; claim sequence, component and deployment in Part B) are what every group should reach; the use case, class and policy-question sections apply to the groups that get that far.

## Part A · Priority 1 · Activity Diagram: Claim to Decision

Claim Handling: Activity Diagram (Sample Sketch)

<!-- image -->

- Must be visible: coverage check before triage, the auto-approval guard with all its conditions, the adjuster path, the fraud branch with both outcomes, payout and rejection endings.
- The document-request wait and five-day reminder may be a single 'request documents' action here, with the repetition left to the state machine: that division of labour is the intended answer to the 'which diagram owns this fact' question. Groups that model the reminder loop here are not wrong, but ask them what the state machine then adds.

- Watch for: unlabelled branches, the appeal missing entirely, AI actions in the customer lane.

## Part A · Priority 2 · State Machine Diagram: the Claim Lifecycle

## Claim Lifecycle: State Machine Diagram (Sample Sketch)

<!-- image -->

- Eight states carry the full text: Submitted, Triaged, In Assessment, Waiting for Documents (with the five-day reminder as a self-transition), Under Investigation, Approved, Rejected, Closed.
- The guarded split after Triaged is the auto-approval rule again (consistency rule 1); the appeal window is why Rejected is not yet Closed.
- Watch for: states named as activities, the investigation detour missing its 'cleared' return, no final state.

## Part A · If Time Remains · Use Case Diagram: the Customer Portal

## Customer Portal: Use Case Diagram (Sample Sketch)

<!-- image -->

- Policyholder and Claim Adjuster as roles; document upload can be its own use case or part of tracking, both defensible.
- The LLM provider as a system actor on 'Ask a policy question' treats it as external infrastructure; hiding it inside the boundary is defensible only if the group argues the assistant is fully Lakeside's own system. The «include» from Report a claim to Get instant triage mirrors 'assessment always happens for covered claims'.
- Watch for: portal clicks as use cases, missing boundary, the fraud team as an actor of the PORTAL (they work on the internal dashboard: a scope decision worth one sentence).

## Part A · If Time Remains · Class Diagram: What the System Remembers

## Lakeside Concepts: Class Diagram (Sample Sketch)

<!-- image -->

- Core concepts: Policyholder (1..* policies), Policy (type, deductible), Claim (against exactly one policy), TriageResult (1..* per claim, keeping category, estimate, confidence, modelVersion forever), Payout (0..1).
- Expect a ClaimStatus enumeration matching the state machine's states: that is consistency rule 4, and the most common failure.
- Watch for: triage fields flattened into Claim (destroys the audit history), missing multiplicities, plural names.

## Part B · Priority 1 · Sequence Diagram: Submitting a Claim

<!-- image -->

- The adapter answers coverage from its daily replica; no live legacy call at claim time. An arrow to the legacy system during submission fails consistency rule 3.
- Coverage before triage, and the auto-approval check as a self-message in the Claims Hub: the business rule lives in Lakeside's code, not in the AI.
- Watch for: missing returns, the portal talking directly to the triage service (it must go through the hub), time flowing sideways.

## Part B · Priority 2 · Component Diagram: the Claims Platform

## Lakeside Claims Platform: Component Diagram (Sample Solution)

<!-- image -->

- Exactly one component touches the legacy system (the adapter) and exactly one touches the external LLM (the policy assistant). The AI triage has NO arrow to the LLM provider: absent arrows carry the compliance story.
- Swap the LLM provider and exactly one dependency moves: the substitutability argument in the wild.
- Watch for: unnamed interfaces, the portal wired directly to the adapter or index, the dashboard forgotten (fine, if stated as an assumption).

## Part B · Priority 3 · Deployment Diagram: Where Everything Runs

## Lakeside Claims Platform: Deployment Diagram (Sample Solution)

<!-- image -->

- Four zones plus the customer device: Swiss cloud (hub, triage, assistant), Lakeside data center (adapter + replica, legacy, documents + index), external LLM (EU), and the office laptops if the group models the dashboard.
- The only line to the external provider carries 'question + retrieved passages': the deployment diagram IS the data-protection argument. Ask what breaks when the cloud region is down, and what a failed nightly batch means for coverage checks.
- Watch for: unlabelled communication paths, claim photos drawn as crossing to the LLM (they never do).

## Part B · If Time Remains · Second Sequence Diagram: a Policy Question

<!-- image -->

- Retrieval before generation; only question + passages cross the boundary; citations attached and checked; the no-reliable-source refusal and the non-binding marker are self-messages in the assistant.
- Nice contrast to the claim sequence: same notation, completely different integration shape (RAG vs orchestration).

## The Consistency Pass: What to Verify

- The auto-approval rule appears in activity guard, state machine guard, and sequence self-message, with the same four conditions (rule 1).
- Sequence participants ⊂ components ⊂ deployed artifacts (rule 2): pick one participant and trace it through all three diagrams in front of the class.
- The legacy system is never called live anywhere (rule 3).
- For full sets: states = status enumeration (rule 4): read both lists aloud; they must match word for word. Every use case actor reappears in a lane or lifeline (rule 5).

## Closing the Debrief

The seven diagrams describe the same platform at increasing depth: goals (use case), work (activity), vocabulary (class), lifecycles (state machine), conversations (sequence), promises (component), and places (deployment). One company, seven views, no contradictions: that is what 'modeling a system' means, and it is exactly the capability the course promised at the start. Groups that only reached the priority diagrams have still described the system end to end: process, lifecycle, conversation, promises and places.
