---
title: "Week 5: AI for Software Testing"
source: "docs/pdf/slides/week_5/lectures-testing-with-AI.pdf"
pages: 60
converted_by: "Docling v2"
---

# Week 5: AI for Software Testing

> **Source**: `docs/pdf/slides/week_5/lectures-testing-with-AI.pdf` | **Pages**: 60
> **Target Audience**: AI Coding Agents & Pair Programmers

---

<!-- image -->

## AI for Software Testing

## Software Testing

<!-- image -->

## Agenda

- AI for Software Testing in Academia and Industry
- Demo of AI for Software Testing guided by Coverage
- Practical Session for students
- Model-based Testing Example
- Demo of AI for Software Testing guided by Mutation Testing
- Practical Session for students
- Conclusion

<!-- image -->

## Software Testing

Does the software do what we said it should?

## Why Test Software?

## AI writes plausible code, not always correct code

- -A model is trained to produce likely output, not output that is guaranteed to be correct

## Testing answers one question

- -"Does my software actually do what I think it does?"

## Without tests, your users find the bugs

- -Wrong answers, security bugs, refunds, and hours of debugging in production

## What AI-Generated Code Gets Wrong

## Invented functions and packages

- -Calls to functions or libraries that do not exist

## Edge cases

- -Unusual inputs at the limits of a rule: empty lists, negative numbers, exactly CHF 100, leap years, time zones

## Silent logic errors

- -The code runs without crashing, and returns the wrong answer

## Security problems

- -Secrets written into the code, missing checks on what users type

## Verification and validation

Verification: "Are we building the product right?"

- The software does what its specification says

Validation: "Are we building the right product?"

- The software does what its users really need: checked with the users

## Testing

- Runs the program with test data, and compares what it does with what it should do
- "Testing shows the presence, not the absence of bugs" (Dijkstra, 1969)

<!-- image -->

## What Is a Test Case?

## A small, repeatable check:

- Input: what you give the program
- Action: what the program does with it
- Expected: what must come back
- It passes when what comes back is what was expected

Arrange, act, assert: the same in every language.

<!-- image -->

Pass when the output matches the expected value; fail otherwise.

Correctness Is Still Your Job: Testing

```
# AI-generated def discount(price, percent): return price * (100 - percent / 100)
```

A test case = one specific input + the output you expect.

INPUT discount(100, 20)

ACTION run the function

```
def test_discount(): assert discount(100, 20) == 80.0
```

<!-- image -->

```
EXPECTED
```

```
result == 80.0
```

<!-- image -->

Correctness Is Still Your Job: Testing

```
# AI-generated def discount(price, percent): return price * (100 - percent / 100)
```

A test case = one specific input + the output you expect.

INPUT discount(100, 20)

ACTION run the function

```
def test_discount(): assert discount(100, 20) == 80.0 # FAILS: our bug
```

<!-- image -->

```
EXPECTED
```

```
result == 80.0
```

<!-- image -->

Correctness Is Still Your Job: Testing

```
# AI-generated def discount(price, percent): return price * (100 - percent) / 100
```

A test case = one specific input + the output you expect.

INPUT discount(100, 20)

ACTION run the function

```
def test_discount(): assert discount(100, 20) == 80.0 # PASS
```

<!-- image -->

```
EXPECTED
```

```
result == 80.0
```

<!-- image -->

Correctness Is Still Your Job: Testing

```
# AI-generated def discount(price, percent): return price * (100 - percent) / 100
```

A test case = one specific input + the output you expect.

INPUT discount(50, 0)

ACTION run the function EXPECTED result == 50

```
def test_discount(): assert discount(100, 20) == 80.0 # PASS assert discount(50, 0) == 50.0 # boundary
```

<!-- image -->

## Correctness Is Still Your Job: Testing

```
# AI-generated def discount(price, percent): return price * (100 - percent) / 100
```

A test case = one specific input + the output you expect.

```
INPUT
```

```
discount(50, -10)
```

ACTION run the function

```
def test_discount(): assert discount(100, 20) == 80.0 # PASS assert discount(50, 0) == 50.0 # boundary assert discount(50, -10) == ?
```

<!-- image -->

```
EXPECTED
```

```
result == ?
```

<!-- image -->

## Correctness Is Still Your Job: Testing

```
# AI-generated def discount(price, percent): return price * (100 - percent) / 100
```

A test case = one specific input + the output you expect.

INPUT discount(50, 10)

ACTION run the function

```
EXPECTED
```

```
result == 55
```

```
def test_discount(): assert discount(100, 20) == 80.0 # PASS assert discount(50, 0) == 50.0 # boundary assert discount(50, -10) == 55 # PASS, but is it the expected behavior?
```

<!-- image -->

Correctness Is Still Your Job: Testing

```
# AI-generated def discount(price, percent): if percent < 0 : return "error" return price * (100 - percent) / 100
```

A test case = one specific input + the output you expect.

INPUT

discount(100, 20)

ACTION

run the function

```
EXPECTED result == 80.0
```

```
def test_discount(): assert discount(100, 20) == 80.0 # PASS assert discount(50, 0) == 50.0 # boundary assert discount(50, -10) == "error" # AI often misses this
```

Tests can catch the bug before any user sees it.

Tests are evidence, not proof.

<!-- image -->

<!-- image -->

## Levels of Testing

## From one function to the whole app:

- Unit: one function alone
- Integration: parts wired together
- System: the whole app
- Acceptance: the users check it

Many fast tests at the bottom, few slow ones at the top.

<!-- image -->

## The oracle problem

An oracle tells you whether an output is right. Without one, you can run the code, but not test it.

## Easy oracle

"sort([3, 1, 2]) gives [1, 2, 3]."

- You know the answer in advance
- Write it down as the expected value
- Compare exactly: ==
- Most business rules: prices, dates, totals

## Hard oracle

"Is this AI answer to a customer good?"

- There is no single right answer
- Check properties: cites a source, stays short, refuses what it must
- Or relations: the same question in other words gets the same refusal
- Designing it is the hard part of testing AI

## Traditional Software Testing

## ACM Comm. 1963

<!-- image -->

## IEEE Computer 1978

<!-- image -->

## IEEE TSE 1996

<!-- image -->

## Code Coverage

## Mutation Testing

Regression Testing

## Software Testing with AI

What is the state of the research?

## AI in Software Testing perspectives from students

- The Responsibility Dilemma: "If a Generative AI model is used to automatically generate unit tests, and a critical bug still makes it to production, who is fundamentally responsible: the AI developer, the software engineer, or the software tester?"
- The Evolution of the Role: Do you believe GenAI will eventually replace traditional software testers, or will it simply elevate the role?
- Positive side: What are the positive effect of AI for software testing?

<!-- image -->

<!-- image -->

## Research in AI for Software Testing

## Software Testing with Large Language Models: Survey, Landscape, and Vision

Junjie Wang, Yuchao Huang, Chunyang Chen, Zhe Liu, Song Wang, Qing Wang

Abse aa         (  o e  sag processing and artificial intelligence, with the ability to handle large-scale datasets and exhibit remarkable performance across a wide range of tasks. Meanwhile, software testing is a crucial undertaking that serves as a cornerstone for ensuring the quality and reliability of software products. As the scope and complexity of software systems continue to grow, the need for more effective software testing techniques becomes increasingly urgent, making it an area ripe for innovative approaches such as the use of LLMs. This paper provides a comprehensive review of the utilization of LLMs in software testing. It analyzes 102 relevant studies that have used LLMs for software tes   n      sd    d s       sor whi        m  o     s    zes the commonly used LLMs, the types of prompt engineering that are employed, as well as the accompanied techniques with these LLMs. It also summarizes the key challenges and potential opportunities in this direction. This work can serve as a roadmap for future research in this area, highlighting potential avenues for exploration, and identifying gaps in our current understanding of the use of LLMs in software testing.

Index Terms—Pre-trained Large Language Model, Software Testing, LLM, GPT

- Survey on LLMs for Testing tasks
- IEEE TSE, January 2024
- Number of Analyzed Papers: 102

<!-- image -->

<!-- image -->

## Tasks and Performance using LLMs on Testing

<!-- image -->

## Tasks and Performance using LLMs on Testing

Fig. 4: Distribution of testing tasks with LLMs (aligned with software testing life cycle [134]–[136], the number in bracket indicates the number of collected studies per task, and one paper might involve multiple tasks)

<!-- image -->

TABLE 3: Performance of unit test case generation

| Dataset                        | Correctness   | Coverage                                   | LLM     | Paper   |
|--------------------------------|---------------|--------------------------------------------|---------|---------|
| 5 Java projects from Defects4J | 16.21%        | 5%-13% (line coverage)                     | BART    | [26]    |
| 10 Jave projects               | 40%           | 89% (line coverage), 90% (branch coverage) | ChatGPT | [36]    |
| CodeSearchNet                  | 41%           | N/A                                        | ChatGPT | 171     |
| HumanEval                      | 78%           | 87% (line coverage), 92% (branch coverage) | Codex   | [39]    |
| SF110                          | 2%            | 2% (line coverage), 1% (branch coverage)   | Codex   | [39]    |

Nxo    od  t  '   'x  dde e et de.

<!-- image -->

## Tasks and Performance using LLMs on Testing

<!-- image -->

7

TABLE 3: Performance of unit test case generation

| Dataset                        | Correctness   | Coverage                                   | LLM     | Paper   |
|--------------------------------|---------------|--------------------------------------------|---------|---------|
| 5 Java projects from Defects4J | 16.21%        | 5%-13% (line coverage)                     | BART    | [26]    |
| 10 Jave projects               | 40%           | 89% (line coverage), 90% (branch coverage) | ChatGPT | [36]    |
| CodeSearchNet                  | 41%           | N/A                                        | ChatGPT | 171     |
| HumanEval                      | 78%           | 87% (line coverage), 92% (branch coverage) | Codex   | [39]    |
| SF110                          | 2%            | 2% (line coverage), 1% (branch coverage)   | Codex   | [39]    |

Nxo    od  t  '   'x  dde e et de.

Figure 7: Test generation of E-TEsT for Defects4J's 673 bugs

<!-- image -->

## LLM models and Inputs

Fig. 6: LLMs used in the collected papers

<!-- image -->

## LLM models and Inputs

Fig. 6: LLMs used in the collected papers

<!-- image -->

Fig. 9: Input of LLM

<!-- image -->

## Testing Tasks and Incorporated techniques

- Using LLMs with traditional techniques is a new trend
- Few-shots learning less used than fine-tuning

<!-- image -->

Fig. 8: Mapping between testing tasks and how LLMs are used

<!-- image -->

## Testing Tasks and Incorporated techniques

- Using LLMs with traditional techniques is a new trend
- Few-shots learning less used than fine-tuning

Fig. 8: Mapping between testing tasks and how LLMs are used

<!-- image -->

Fig. 10: Distribution about other techniques incorporated with LLMs (Note that, a study can involve multiple types)

<!-- image -->

## Research Opportunities

- Use LLMs for Integration testing
- Explore different Prompt Engineering respect to Zero-Shots and Few-Shots
- Multimodal models with UI images

<!-- image -->

<!-- image -->

## Research Opportunities

- Use LLMs for Integration testing
- Explore different Prompt Engineering respect to Zero-Shots and Few-Shots
- Multimodal models with UI images

<!-- image -->

<!-- image -->

## Testing with AI in Industry

## Google

OSS-Fuzz + LLM

- LLMs auto-generate fuzz targets for C/C++ projects
- 370K+ lines of new coverage across 272 projects
- Found CVE-2024-9143 in OpenSSL (20-year-old bug)

## Microsoft

Copilot Testing

- Auto-creates, builds &amp; runs unit tests for .NET
- Supports MSTest, xUnit, NUnit frameworks
- @Test natural language prompts in Visual Studio

## Amazon

## Q Developer

- Q Developer auto-generates unit tests from project context
- Agent-based approach
- Parallelized agentic testing across scenarios

```
[1] Google Security Blog -AI-Powered Fuzzing (2023) [2] .NET Blog -GitHub Copilot Testing for .NET (2025) [3] AWS -Amazon Q Developer Automatic Unit Test Generation (Dec 2024)
```

[4] AWS Blog -Agentic QA Automation Using AgentCore Browser and Amazon Nova Act

<!-- image -->

## Software Testing with AI Practical exercise

## Create and run tests in Python

<!-- image -->

## Generate Unit Tests with LLMs

<!-- image -->

## Test Coverage

## Line coverage

- -The lines the tests ran, divided by all the lines

## Branch coverage

- -Every if, taken both ways: when the condition is true, and when it is false

## What it is for

- -A line no test runs is a line no test checks: coverage shows what is untested

## How

- -pytest --cov measures it; add --cov-report=term-missing to list the lines no test ran

## Coverage, Visualized

## function classify(score):

if score &gt;= 90:

return "A"

if score &gt;= 60:

return "PASS"

if score &lt; 0:

return "INVALID"

return "FAIL"

<!-- image -->

University of St.Gallen Legend executed by tests never executed

<!-- image -->

## One test

- assert classify(95) == "A"

## Coverage, Visualized

## function classify(score):

if score &gt;= 90:

return "A"

if score &gt;= 60:

return "PASS"

if score &lt; 0:

return "INVALID"

return "FAIL"

<!-- image -->

University of St.Gallen Legend executed by tests never executed

<!-- image -->

## Two tests

- assert classify(95) == "A"
- assert classify(65) == "PASS"

## Coverage, Visualized

## function classify(score):

if score &gt;= 90:

return "A"

if score &gt;= 60:

return "PASS"

if score &lt; 0:

return "INVALID"

return "FAIL"

<!-- image -->

University of St.Gallen Legend executed by tests never executed

<!-- image -->

## Three tests

- assert classify(95) == "A"
- assert classify(65) == "PASS"
- assert classify(59) == "FAIL"

5 of 7 lines executed.

Line coverage = 71%.

Red lines: "you never tested negative scores!"

## Compute And Increase Coverage

<!-- image -->

## Students: Your turn

Clone from GitHub:

[https://github.com/luca-digrazia/CoffeeMachineExample.git](https://github.com/luca-digrazia/CoffeeMachineExample.git)

Get Familiar with the project and generate tests to increase coverage

<!-- image -->

<!-- image -->

## startBrewing(): Coverage

<!-- image -->

University of St.Gallen All the lines covered by junit test cases. However, there is a problem with this function. What is it?

<!-- image -->

## startBrewing(): (Simplified) Finite State Machine (Model-Based Testing)

Edges for all possible states for startBrewing()

<!-- image -->

## startBrewing(): (Simplified) Finite State Machine (Model-Based Testing)

Edges for all possible states for startBrewing()

<!-- image -->

## startBrewing(): Missing State

<!-- image -->

## startBrewing(): Tests generated from FSM

<!-- image -->

## Summary until now

- Code coverage is a good starting point to improve software quality
- 100% code coverage does not mean you have a bug free software
- Different testing strategies can be used in a complementary way
- LLMs can help to write test quickly, but human evaluation is essential
- Many research opportunities available to use LLMs for software testing

<!-- image -->

## Mutation Analysis: Key Idea

- Introduce 'fake' errors (mutations) into your code.
- Check that your tests can detect faults in the executed code.

● If a test fails the mutated code, the mutation is "killed" (good).

<!-- image -->

● If a test passes the mutated code, it may not be effective (needs improvement).

- Goal: Make your test suite more robust in combination with other testing techniques.

<!-- image -->

## Mutation Analysis with MutPy

## Commands:

- pip install mutpy
- mut.py --target coffee\_machine.py --unit-test test\_coffee\_machine.py -m

<!-- image -->

MutPy is a mutation testing tool for Python 3.3+ source code. MutPy supports standard unittest module, generates YAML/HTML reports and has colorful output. It applies mutation on AST level. You could boost your mutation testing process with high order mutations (HOM) and code coverage analysis.

<!-- image -->

## Some Active Mutations

| Mutation            | Description                               |
|---------------------|-------------------------------------------|
| NULL_RETURNS        | Changes return values to null             |
| FALSE_RETURNS       | Changes return values to false            |
| NEGATE_CONDITIONALS | Negates conditional expressions           |
| MATH                | Alters arithmetic operations              |
| PRIMITIVE_RETURNS   | Modifies return values of primitive types |

<!-- image -->

## Mutation Analysis: Killed vs Survived

<!-- image -->

## Mutation Analysis: Killed vs Survived

<!-- image -->

MUTATION: NULL\_RETURNS return null;

<!-- image -->

## Mutation Analysis: Killed vs Survived

<!-- image -->

## Mutation Analysis: Killed vs Survived

<!-- image -->

## MUTATION: NULL\_RETURNS

return null;

## Killed

<!-- image -->

## Mutation Analysis: Killed vs Survived

<!-- image -->

MUTATION: NULL\_RETURNS return null;

## Killed

<!-- image -->

MUTATION: NULL\_RETURNS return 0;

## Mutation Analysis: Killed vs Survived

<!-- image -->

MUTATION: NULL\_RETURNS return null;

## Killed

<!-- image -->

MUTATION: NULL\_RETURNS return 0;

Survived

## Generative AI for Mutation Analysis?

<!-- image -->

University of St.Gallen PIT report me a survived mutation if in the following code I change the return with O. Write a test case to kill this mutant: public static int getNumberCoffees() { return numberCoffees;

<!-- image -->

- You {
- ChatGPT To kill the mutant introduced by changing the return statement to O in the `getNumberCoffees`

method, you can write a test case that asserts the expected behavior of the method. Here's a sample test case using JUnit:

<!-- image -->

This test case retrieves the original number of coffees using the getNumberCoffees`method and asserts that it matches the expected value "he mutant changes the return statement to O, the test will fail, indicating that the mutant has ueen killed by the test.

## Mutation Analysis: Your Turn

<!-- image -->

## [https://github.com/luca-digrazia/CoffeeMachineExample.git](https://github.com/luca-digrazia/CoffeeMachineExample.git)

## Tasks:

- Install and run MutPy
- pip install mutpy
- mut.py --target coffee\_machine.py --unit-test test\_coffee\_machine.py -m
- Kill at least one surviving mutation:
- Killed mutation: Test exposes the bug (fails)
- Surviving mutation: Test might not be thorough enough
- Improve 'Test Strength' score

<!-- image -->

- all: 26
- killed: 0 (0.0%)
- survived: 26 (100.0%)
- incompetent: 0 (0.0%)
- timeout: 0 (0.0%)

## Mutation Analysis: Summary

● Improves test suite

<!-- image -->

● Increases confidence in code quality

● Helps write more effective tests

<!-- image -->

● Indicates potential bugs

<!-- image -->

● Computationally expensive (large codebases)

<!-- image -->

● Not a silver bullet (combine with other testing techniques)

● Interpret scores carefully

<!-- image -->

## Putting It Together: Strategies for Quality

- 1 Many small tests

Cheaper than one giant one. Run them on every change.

- 2 Coverage

If/else paths are where bugs live.

- 3 Mutation score

It tells you whether your tests really check anything.

- 4 Don't trust 100% 100% coverage with weak oracles is false confidence.
- 5 Combine techniques

Unit + integration + coverage + mutation → layered safety.

<!-- image -->

## Conclusion with good news

- Coverage, mutation testing, model-based testing remain the foundations. AI just makes them scalable. Every successful tool builds on SE principles.
- AI are tools that you as software engineer can use. Now a startup can go very fast with a very small team. A lot of opportunities are possible.
- Very active research field with practical and industrial collaborations

<!-- image -->

<!-- image -->
