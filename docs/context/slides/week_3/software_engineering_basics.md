---
title: "Week 3: Software Engineering Basics"
source: "docs/pdf/slides/week_3/software-engineering-basics.pdf"
pages: 42
converted_by: "Docling v2"
---

# Week 3: Software Engineering Basics

> **Source**: `docs/pdf/slides/week_3/software-engineering-basics.pdf` | **Pages**: 42
> **Target Audience**: AI Coding Agents & Pair Programmers

---

<!-- image -->

## Coding with AI

## Software Engineering Basics

Prof. Dr. Guido Salvaneschi

From insight to impact.

## Literature and References

<!-- image -->

Software Engineering A Practitioners Approach by Pressman &amp; RogerMaxim Mc Graw Hill, 2020 (Also a previous edition, e.g., 7th or 8th).

Engineering Software Products: An Introduction to Modern Software Engineering Ian Sommerville, 2020, Pearson.

## What do we want to have from Engineering?

Producing vending machines, cars, bridges

- Estimable costs and risks
- Expected results
- High quality

Separation between plan and production Simulation before construction Quality assurance through measurement Potential for automation

<!-- image -->

## Origin of "Software Engineering"

The term 'software engineering' was suggested at conferences organized by NATO in 1968 and 1969 to discuss the 'software crisis'.

The software crisis was the name given to the difficulties encountered in developing large, complex systems in the 1960s.

It was proposed that the adoption of an engineering approach to software development would reduce the costs of software development and lead to more reliable software.

<!-- image -->

## Defining the Discipline

The IEEE* definition of Software Engineering:

The application of a systematic, disciplined, quantifiable approach to the development, operation, and maintenance of software; that is, the application of engineering to software.

*The Institute of Electrical and Electronics Engineers (IEEE) is a professional association for electronic engineering and electrical engineering (and associated disciplines) with its corporate office in New York City

5

## SOFTWARE PROCESSES

## What is a software process?

## "The set of activities and associated results that produce a software product"

Examples of aspects that belong to a software process: Writing all requirements Require approval for all changes to requirements Use version control for all changes Track all reported bugs Review requirements and code Break down development into smaller tasks Schedule and monitor task progress Planning and conducting quality assurance Have daily status meetings

<!-- image -->

## Waterfall Process Model

<!-- image -->

- Analysis and testing are straightforward.

## Cons

- It does not accommodate change well.
- Testing occurs late in the process.
- Customer approval is at the end.

8

## Unified Process Model

## Pros

- Quality documentation emphasized.
- Continuous customer involvement.
- Accommodates requirements changes.
- Works well for maintenance projects.

## Cons

- Use cases are not always precise.
- Tricky software increment integration.
- Overlapping phases can cause problems.
- Requires expert development team.

Copyright  MicOranv-Hill Etlucation. All rights reserved. No reproduction or

distribuiion without the prior vitten coneent of McGrasv-Hill Etducation.

<!-- image -->

Production

9

## THE Book: Essential Scrum

Agile project management Easy read, highly recommended!

Essential Scrum: A Practical Guide to the Most Popular Agile Process Kenneth S. Rubin

## Recommended read:

https://innolution.com/uploads/misc/Essential\_Scrum\_Chapter\_2.pdf

<!-- image -->

## The Scrum Agile Framework

Scrum is an agile framework for developing, delivering, and sustaining complex products, with an initial emphasis on software development.

## In a nutshell, (from Wikipedia):

- Designed for teams of ten or fewer members.
- Work is broken down into goals that can be completed within timeboxed iterations, called sprints, no longer than one month and most commonly two weeks.
- The Scrum Team track progress in 15-minute time-boxed daily meetings (daily scrums).
- At the end of the sprint, the team holds sprint review, to demonstrate the work done, and sprint retrospective to continuously improve.

## Overview of Scrum

<!-- image -->

## REQUIREMENTS

## "Problem solving is an art form not fully appreciated by some'

<!-- image -->

wing.htm 2013 Tree Swing graphic by S Hogh 1993 - from Busine

## Requirements engineering

The process of establishing the services that a customer requires from a system and the constraints under which it operates and is developed.

<!-- image -->

Testing

## Requirements elicitation and analysis

Sometimes called requirements elicitation or requirements discovery.

Involves technical staff working with customers to find out about the application domain, the services that the system should provide and the system's operational constraints.

May involve end-users, managers, engineers involved in maintenance, domain experts, trade unions, etc. These are called stakeholders.

## Various methods:

- Interviews
- Ethnography

AN

<!-- image -->

## User and system requirements

## User requirements definition

- The Mentcare system shall generate monthly management reports showing the cost of drugs prescribed by each clinic during that month.

## System requirements specification

- 1.1 On the last working day of each month, a summary of the drugs prescribed, their cost and the prescribing clinics shall be generated.
- 1.2 The system shall generate the report for printing after 17.30 on the last working day of the month.
- 1.3 A report shall be created for each clinic and shall list the individual drug names, the total number of prescriptions, the number of doses prescribed and the total cost of the prescribed drugs.
- 1.4 If drugs are available in different dose units (e.g. 10mg, 20mg, etc) separate reports shall be created for each dose unit.
- 1.5 Access to drug cost reports shall be restricted to authorized users as listed on a management access control list.

<!-- image -->

## Requirements imprecision

Problems arise when functional requirements are not precisely stated.

Ambiguous requirements may be interpreted in different ways by developers and users.

Consider the term 'search' in requirement 1

- User intention - search for a patient name across all appointments in all clinics;
- Developer interpretation - search for a patient name in an individual clinic. User chooses clinic then search.

<!-- image -->

## Non-functional requirements

These define system properties and constraints e.g. reliability, response time and storage requirements. Constraints are I/O device capability, system representations, etc.

Process requirements may also be specified mandating a particular IDE, programming language or development method.

Non-functional requirements may be more critical than functional requirements. If these are not met, the system may be useless.

<!-- image -->

## Types of nonfunctional requirement

E.g., is data allowed to be stored outside, say Europe?

<!-- image -->

## Use cases

Use-cases are a kind of scenario.

Often describe in natural language.

Use cases identify the actors in an interaction and describe the interaction itself.

A set of use cases should describe all possible interactions with the system.

UML has a notation for use case diagrams.

<!-- image -->

## Use cases for the Mentcare system

<!-- image -->

## SOFTWARE DESIGN

## System modeling

System modeling is the process of developing abstract models of a system, with each model presenting a different view or perspective of that system.

System modeling has now come to mean representing a system using some kind of graphical notation, which is now almost always based on notations in the Unified Modeling Language (UML).

System modelling helps the analyst to understand the functionality of the system and models are used to communicate with customers.

<!-- image -->

<!-- image -->

## Order processing

<!-- image -->

## State machine models

These model the behaviour of the system in response to external and internal events. They show the system's responses to stimuli so are often used for modelling real-time systems.

State machines model show system states as nodes and events as arcs between these nodes. When an event occurs, the system moves from one state to another.

Statecharts are an integral part of the UML and are used to represent state machine models.

<!-- image -->

## SOFTWARE QUALITY

<!-- image -->

## Ariane 5, first test flight (1996)

<!-- image -->

"The problem was caused by an `Operand Error' in converting data in a subroutine from 64-bit floating point to 16-bit signed integer. One value was too large to be converted, creating the Operand Error. This was not explicitly handled in the program (although other potential Operand Errors were) and so the computer, the Inertial Reference System (SRI) halted, as specified in other requirements. There are two SRIs, one `active', one `hot back-up' and the active one halted just after the backup, from the same problem. […]" ─ Peter B. Ladkin

## Software quality assurance

## Dynamic: Testing

Code executed to identify defects

Unit Testing

Integration Testing

System Testing

Performance Testing

## Static: Analysis

Code examined to find defects

Code review (manual) Static analysis (automated)

<!-- image -->

## Software Testing and Analysis

Analysis that provides information about the quality of the software product or service under test

Detect issues to fix them as early as possible Sometimes a different organization is responsible

## A practical example

```
class Adder { public int add(int a, int b) { return a + b; } } public class TestAdder { @Test public void testSumPositiveNumbersOneAndOne() { Adder adder = new AdderImpl(); assert(adder.add(1, 1) == 2); } // can it add the positive numbers 1 and 2? @Test public void testSumPositiveNumbersOneAndTwo() { Adder adder = new AdderImpl(); assert(adder.add(1, 2) == 3); } // can it add the positive numbers 2 and 2? @Test public void testSumPositiveNumbersTwoAndTwo() { Adder adder = new AdderImpl(); assert(adder.add(2, 2) == 4); } What is the issue?
```

…

## Test corner cases

// is zero neutral? @Test public void testSumZeroNeutral() { Adder adder = new AdderImpl(); assert(adder.add(0, 0) == 0);

// can it add a positive and a negative? @Test public void testSumPositiveAndNegative() { Adder adder = new AdderImpl(); assert(adder.add(-1, 1) == 0);

} }

// how about larger numbers? @Test public void testSumLargeNumbers() { Adder adder = new AdderImpl(); assert(adder.add(1234, 988) == 2222);

// can it add the negative numbers -1 and -2? @Test public void testSumNegativeNumbers() { Adder adder = new AdderImpl(); assert(adder.add(-1, -2) == -3); } }

## (Dynamic) Testing: Summary

Testing cannot guarantee the absence of defects.

Testing reveals the presence of defects.

The number of test cases is usually limited.

The number of test cases is often bounded by time/resources.

However, once a test fails, we can be sure that there is a bug (no false positive). In many cases there is also a way to reproduce it!

## Code Reviews

A constructive review of a fellow developer's code. A required sign-off from another team member before a developer is permitted to check in changes or new code.

Analogy: writing for a newspaper. Effectiveness of:

- Spell-check/grammar check
- Author editing own article
- Others editing others' articles

<!-- image -->

## Results of Code Review

## More than 1 person has seen every piece of code

- Peer pressure raises quality

Learning experience (beginners)

- Pairing with expert developers

Members see different system parts

- Better overall understanding

<!-- image -->

## Checklists

<!-- image -->

## Code Reviews in Industry

Code reviews very common in industry

## Made easier by tools:

- Integrate with IDEs
- Highlight changes (i.e., diff)

<!-- image -->

## Code Review in Practice

## Large corporations adopt code reviews

- E.g. Microsoft, Facebook, Google

## The case of Google

- Very lightweight process (80% at most one iteration)
- Single reviewer
- Small changes (~24 LOC)
- Importance as an educational tool

Sadowski, Caitlin; Söderberg, Emma; Church, Luke; Sipko, Michal; Bacchelli, Alberto (2018). Modern Code Review: A Case Study at Google. International Conference on Software Engineering, Software Engineering in Practice track.

<!-- image -->

Google
