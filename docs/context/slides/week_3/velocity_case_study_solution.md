---
title: "Week 3: VeloCity Case Study Solution"
source: "docs/pdf/slides/week_3/VeloCity-Case-Study-solution.pdf"
pages: 4
converted_by: "Docling v2"
---

# Week 3: VeloCity Case Study Solution

> **Source**: `docs/pdf/slides/week_3/VeloCity-Case-Study-solution.pdf` | **Pages**: 4
> **Target Audience**: AI Coding Agents & Pair Programmers

---

Institute of Computer Science

<!-- image -->

## Case Study: VeloCity AG

## VeloCity AG - Sample Solutions and Debrief Notes

One defensible model per diagram, not THE model. Groups will differ in layout, naming and scope; what must match is the logic: the boundary is argued, branches are labelled and complete, multiplicities are justified, and the order of messages honours the process described in the text. The use case and activity diagrams are the priorities; expect every group to reach those. The class and sequence sections apply to the groups that get that far. Use the notes under each diagram to steer the debrief.

## Priority 1 · Use Case Diagram: the Customer Portal

## VeloCity Customer Portal: Use Case Diagram (Sample Solution)

<!-- image -->

- Five actors: Customer, Payment Provider, AI Damage Assessor, Fleet Specialist, Customer Service. The provider and the assessor are systems, not people: a favourite blind spot. · «include» between Report damage and Get damage assessed: assessment always
- happens.

<!-- image -->

## Case Study: VeloCity AG

- The AI assessor OUTSIDE the boundary treats it as a bought service; inside means it is part of what VeloCity builds and runs. Both are correct with an argument; neither is correct without one. Compare two groups with different choices if possible.
- Common issues: job titles as actors, use cases named as nouns, missing boundary box, modeling portal clicks (log in, upload photo) instead of goals.

## Priority 2 · Activity Diagram: Damage Handling

## Damage Handling Process: Activity Diagram (Sample Solution)

<!-- image -->

- The confidence guard (minor AND confidence &gt;= 85%) and the human review lane are both AI patterns from the lecture: point them out explicitly.
- Three endings: successful swap, waiting list (a flow final: the report itself is not finished), and the customer service case. Groups that model only the happy path have missed half the text.
- The misuse branch and the stock check are the two unhappy paths the text mentions; both must appear in some form.

Institute of Computer Science

<!-- image -->

## Case Study: VeloCity AG

- Watch for unlabelled branches and actions in the wrong lane (the AI assessment belongs to the Portal / AI lane, not the customer).

## If Time Remains · Conceptual Class Diagram: VeloCity's Vocabulary

## VeloCity Concepts: Conceptual Class Diagram (Sample Solution)

<!-- image -->

- Seven concepts carry the whole text: Customer, Subscription, Plan, Bike, DamageReport, AIAssessment, SwapOrder. Five or eight are fine too if the relationships hold.
- AIAssessment as its own concept, with category, costEstimate, confidence and modelVersion: this is what makes the AI auditable, and the 1..* allows re-assessment history.
- Multiplicities worth discussing: a subscription uses at most one bike at a time (0..1), a damage report may or may not trigger a swap (0..1).
- Watch for plural class names, attributes that are really concepts (assessor name inside DamageReport), and associations without labels.

Institute of Computer Science

<!-- image -->

## Case Study: VeloCity AG

## If Time Remains · Sequence Diagram: One Damage Report

<!-- image -->

- Five lifelines carry it: Customer, Customer Portal, AI Damage Assessor, Fleet Specialist, Fleet System. The assessor is a call with a return value, not scenery at the edge of the picture.
- The order is the argument: assess first, decide second. A specialist who appears before the AI's answer has lost the confidence guard, and with it the point of the diagram.
- The manual review is conditional and must be marked as such: a guard on the message, an alt fragment, or a note. Any of the three is fine at this level; leaving it unmarked is not.
- Watch for returns drawn as ordinary calls, a missing stock check, and diagrams that stop at 'swap approved' instead of reaching the customer.

## Debrief Question

Ask each group which diagram was hardest and why. The usual answer, the class diagram, opens the bridge to the data-readiness discussion: the hardest diagram to draw is the one that decides whether the AI project is feasible at all.
