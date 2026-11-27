---
title: "Week 6: Lakeside Insurance Case Study Problem"
source: "docs/pdf/slides/week_6/Lakeside-Case-Study.pdf"
pages: 4
converted_by: "Docling v2"
---

# Week 6: Lakeside Insurance Case Study Problem

> **Source**: `docs/pdf/slides/week_6/Lakeside-Case-Study.pdf` | **Pages**: 4
> **Target Audience**: AI Coding Agents & Pair Programmers

---

<!-- image -->

## Case Study: Lakeside Insurance AG

## Lakeside Insurance AG - Modeling an AI-Integrated System

Lakeside Insurance AG is a Lucerne-based household and personal liability insurer with about 300'000 policies. It has just rebuilt its claims handling around two AI services, and had to do so on top of a policy administration system that is thirty years old and cannot be changed. In this group case study you will describe the resulting platform with the seven diagram types of the course: the four business-view diagrams from the first lecture, and the three architecture-view diagrams from this one. Each part names its priority diagrams: produce those first, and add the others as time allows. This is the capstone exercise of the course: at the end, your group will have described one company from customer goals down to physical infrastructure. Where the text is silent, make a reasonable assumption and note it on the diagram.

## The Company and Its Constraint

Lakeside's promise is a decision on simple claims within minutes, without lowering the bar for difficult ones. The obstacle is its legacy policy administration system: it runs on-premises in the company's own data center, it is the only authoritative source for policies and coverage, it cannot be modified before its planned replacement, and its only interface to the outside world is a nightly batch export of all policy data. Any modern system that needs policy information has to live with that constraint.

## Systems and Architecture

Customers use the customer portal (web and mobile) to report a claim with photos, ask questions about their policy, upload requested documents, and track the status of a claim. Behind the portal, the new Claims Hub runs in a Swiss cloud region and orchestrates everything: it creates the claim, checks coverage, calls the AI triage, applies the auto-approval rule, and routes everything else to the right people.

Two AI services are involved, and they are deliberately different. The AI triage service classifies a submitted claim from its text and photos and returns a damage category (minor or major), a cost estimate, and a confidence value. It runs Lakeside's own model in the same Swiss cloud region: claim photos and personal data never leave it. The policy assistant answers customers' policy questions using retrieval-augmented generation: it searches an index of Lakeside's policy documents, sends the question together with the retrieved passages (and nothing else) to an external LLM provider in an EU region under a no-training contract, and answers with citations to the exact clauses. If it finds no reliable source, it says so instead of guessing, and every answer is marked as non-binding.

Because the legacy system cannot be queried live, a legacy adapter runs on a VM in the Lakeside data center. Every night it imports the batch export into its own policy replica; during the day it answers coverage checks from that replica in milliseconds. The document store and its search index also live on-premises, next to the legacy server. Claim adjusters and the fraud team work with the Claims Hub through an internal dashboard on their laptops in the Lucerne office.

## Process: From Claim to Decision

When a claim arrives, the Claims Hub first checks coverage with the adapter; only covered claims are sent to the AI triage (there is no point paying for an assessment of an uncovered claim). If the claim is covered, the damage is minor with an estimate below CHF 2'000, and the triage confidence is at least 90 percent, the payout is approved automatically and the customer sees the decision immediately. Every other claim goes to a claim adjuster.

The adjuster examines the claim in the dashboard. If information is missing, they request documents from the customer; the claim then waits, and the system reminds the customer every five days until the documents arrive. If the adjuster notices fraud indicators (inconsistent photos, repeated similar claims, damage that does not match the description), the fraud team investigates: a confirmed fraud is rejected, a cleared claim returns to normal assessment. Approved claims are paid out. Rejected customers receive a written explanation and may appeal; only when the appeal window has passed is a rejected claim closed. Paid claims are closed once the payout is made.

## What the System Remembers

For every claim, Lakeside stores the date, description, photos and current status. Every AI triage produces a result that is kept forever: category, estimate, confidence, and the version of the model that produced it, because re-triaged claims keep their full history and auditors ask exactly these questions. Policies belong to policyholders (one person can hold several), each policy has a type and a deductible, and a claim is always filed against exactly one policy. A payout, when it happens, records amount and date; not every claim leads to one.

## Assignment Part A: the Business View

Model the business layer with the diagram types from the first lecture. These are full diagrams, not sketches: everything the text states must be visible. The activity and state machine diagrams are the priorities of this part: they carry the auto-approval rule and the claim lifecycle that the consistency pass checks against Part B. Prepare the use case and class diagrams if time remains.

- Priority 1 · Activity diagram: the complete claim-to-decision process with swimlanes, the auto-approval guard, the document request, the fraud branch, and the appeal. Decide consciously which time-driven detail you leave to the state machine instead: choosing the right diagram for a fact is part of the task.
- Priority 2 · State machine diagram: the full life of one claim, from submission to closure: the guarded auto-approval exit, waiting for documents with the five-day reminder, the investigation detour, and the appeal window before a rejection becomes final.
- If time remains · Use case diagram: the customer portal from outside: actors, goals, system boundary. Decide where the external LLM provider belongs, and whether 'get instant triage' is a goal of its own or included in reporting a claim.
- If time remains · Conceptual class diagram: everything the section 'What the System Remembers' states, as concepts with attributes, labelled associations and multiplicities. Add an enumeration for the claim status and keep it consistent with your state machine.

## Assignment Part B: the Architecture View

Model the platform itself with the three diagram types from this lecture. This is the part your group presents, and its first three diagrams are the priorities of the whole case study. Prepare the second sequence diagram if time remains.

- Priority 1 · Sequence diagram (claim submission): one claim is submitted and instantly triaged: who calls whom, in what order, with what? Show where the nightly-batch constraint forces a design decision, where the auto-approval rule is evaluated, and justify the order of the coverage check and the triage call.
- Priority 2 · Component diagram: the whole platform as building blocks with named provided and required interfaces. Make visible which single component touches the legacy system, which single component touches the external LLM, and what would have to change if the LLM provider were swapped.
- Priority 3 · Deployment diagram: where everything runs: customer device, Swiss cloud, Lakeside data center, external LLM, and the adjusters' office laptops. Label every communication path with the data it carries; this diagram is your data-protection argument and will be read as one.
- If time remains · Second sequence diagram (policy question): a customer asks whether water damage from a washing machine is covered. Show the retrieval-augmented flow end to end, including what exactly crosses to the external provider and what happens when no reliable source is found.

## The Consistency Pass

A set of diagrams describes one system only if the diagrams agree. Before you finish, check your set against these five rules and fix what fails. Rules 1 to 3 apply to the priority diagrams, so every group runs them; rules 4 and 5 involve the if-time diagrams and apply once you have built those:

- The auto-approval rule (covered, minor, below CHF 2'000, confidence at least 90 percent) appears three times and identically: as a guard in the activity diagram, as a guarded transition in the state machine, and as a self-message in the sequence diagram.
- Every participant in your sequence diagrams exists as a component in the component diagram, and every component runs on some node in the deployment diagram.
- Nothing in any diagram contradicts the nightly-batch constraint: no live call to the legacy system appears anywhere.
- The states of your state machine and the status enumeration in your class diagram are the same list.
- Every actor of the use case diagram appears somewhere in the dynamic diagrams: as a swimlane, a lifeline, or an explicit assumption why not.

## Organisation and Hand-In

- Work in groups. Split each group into two sub-teams: one takes Part A, the other Part B, each starting with its part's priority diagrams; swap and review each other's diagrams against the text before the consistency pass.
- One shared draw.io file with one page per diagram; note every assumption on the diagram itself.
- Export each page as PNG to the shared board. Present ONE Part B diagram, walk through one consistency rule and show that your set passes it, and name the design decision your group is least sure about.
