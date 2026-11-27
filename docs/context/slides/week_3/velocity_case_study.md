---
title: "Week 3: VeloCity Case Study Problem"
source: "docs/pdf/slides/week_3/VeloCity-Case-Study.pdf"
pages: 3
converted_by: "Docling v2"
---

# Week 3: VeloCity Case Study Problem

> **Source**: `docs/pdf/slides/week_3/VeloCity-Case-Study.pdf` | **Pages**: 3
> **Target Audience**: AI Coding Agents & Pair Programmers

---

<!-- image -->

## Case Study: VeloCity AG

## VeloCity AG - Modeling a Company with UML

VeloCity AG is a Zurich-based company that rents electric bikes by monthly subscription. In this group case study you will read how the company works and translate what you read into the four diagram types from the lecture: a use case diagram, an activity diagram, a conceptual class diagram and a sequence diagram. The first two are the priority; the other two follow if time remains. Everything you need is in the text below; where the text is silent, make a reasonable assumption and write it down.

## The Company

VeloCity operates about 15'000 e-bikes in Zurich, Basel and Lausanne and serves 12'000 active subscribers. Customers do not buy bikes: they subscribe to a plan (city bike, cargo bike or longrange bike) and receive a bike, insurance, and all repairs for a monthly fee. The promise that makes the offer attractive is simple: if your bike has a problem, a working replacement arrives quickly and the broken one disappears.

Keeping that promise at scale is the company's main operational challenge, and the reason it recently introduced an AI service into its damage-handling process.

## Systems and Architecture

Customers interact with VeloCity through the customer portal (web and app). In the portal they subscribe to a plan, manage their subscription (for example pausing it for up to three months, or cancelling), report damage to their bike, and track the courier when a swap is on its way. Payments are not processed by VeloCity itself: an external payment provider handles the charge when a subscription is created and every month thereafter.

When a customer reports damage, they attach photos. The photos are analysed by an AI damage assessor, an external service that returns three things: a damage category (minor or major), an estimated repair cost, and a confidence value for its own judgement. Inside the company, fleet specialists work with an operations dashboard where flagged damage cases appear for manual review, and the customer service team handles cases where something about a report looks wrong.

The portal holds these pieces together, and the order in which it talks to them matters. When a report arrives, the portal first sends the photos and the bike identifier to the AI damage assessor and waits for its answer; only then does it decide whether a human is needed at all. A manual review is a second, separate exchange: the case appears on the operations dashboard University of St.Gallen

<!-- image -->

## Case Study: VeloCity AG

and the fleet specialist's verdict comes back to the portal. Once a swap is approved, the portal asks the fleet system whether a replacement of the right type is free in the customer's city, books the courier if it is, and only then confirms to the customer with a tracking link.

## Process: Handling a Damage Report

When a damage report with photos arrives, the AI assessor evaluates it. If the damage is minor and the AI's confidence is at least 85 percent, the portal approves a bike swap automatically. In every other case (major damage, or an unsure AI) a fleet specialist reviews the report manually. If the specialist finds the damage plausible, the swap is approved after all; if the photos suggest misuse (for example damage from an obvious crash the customer did not mention), the case goes to customer service, which may charge the customer for the repair.

An approved swap is only half the story: a replacement bike of the right type must be in stock in the customer's city. If it is, a courier swap is scheduled; the courier brings the replacement and takes the damaged bike to the workshop. If not, the customer is put on a waiting list and notified, and the swap happens as soon as a bike becomes available.

## Rules: The Life of a Subscription

Every subscription starts with a trial month. If the customer sets up payment during that month, the subscription becomes active; if not, it ends. Active customers may pause their subscription for up to three months, and they can of course cancel. When a monthly payment fails, the subscription is not cancelled immediately: it enters an overdue phase in which the system sends a payment reminder every seven days. A received payment restores the subscription; after the third ignored reminder, VeloCity cancels it. A cancellation only becomes final once the bike has been returned.

## Assignment: Model VeloCity

Work in groups. Create one shared draw.io file with one page per diagram. Everyone models; agree on your assumptions out loud and note them on the diagram as a comment. Start with the two priority diagrams; prepare the other two if time remains:

- Priority 1 · Use case diagram: the customer portal as seen from outside: actors, goals, and the system boundary. Decide deliberately whether the AI damage assessor is inside or outside your boundary, and be ready to defend the decision.
- Priority 2 · Activity diagram: the damage-handling process from report to swap, with swimlanes, labelled decisions, and every unhappy path the text mentions.

<!-- image -->

## Case Study: VeloCity AG

- If time remains · Conceptual class diagram: the concepts VeloCity must keep data about, with attributes, labelled relationships and multiplicities. Model the AI's assessment as a concept of its own and ask yourselves what it must store to make the AI's decisions auditable; give the subscription whatever it needs to carry the states described in the rules.
- If time remains · Sequence diagram: one damage report, from the customer's tap to the confirmed swap. Show who calls whom and in which order, draw what comes back differently from what goes out, and make visible the moment where the process either does or does not need a human.

## Before You Hand In

- Every actor is a role, every use case a goal, and the boundary is drawn and defensible.
- Every decision branch is labelled and every path in the activity diagram reaches an end.
- Every association has a label and multiplicities; concepts are singular nouns.
- Every message in the sequence diagram has a sender, a receiver and a place in time; returns are drawn differently from calls.
- Export each page as PNG to the shared board. Choose one diagram your group will present, and one question your model left open.
