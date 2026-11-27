---
title: "Week 2: Introduction to Coding with AI"
source: "docs/pdf/slides/week_2/intro-to-coding-with-AI-1.pdf"
pages: 22
converted_by: "Docling v2"
---

# Week 2: Introduction to Coding with AI

> **Source**: `docs/pdf/slides/week_2/intro-to-coding-with-AI-1.pdf` | **Pages**: 22
> **Target Audience**: AI Coding Agents & Pair Programmers

---

<!-- image -->

## Coding with AI

## Intro to Coding with AI

Prof. Dr. Guido Salvaneschi

From insight to impact.

<!-- image -->

He underlined how the infrastructure had come of age and primed global industries for a metamorphosis. The rise of cloud platforms like Amazon Web Services and the widespread growth of broadband internet were game changers. They had knocked down the traditional hurdles of server costs and network know-how. This had cleared the stage for disruptors like Uber, Netflix, and a slew of social media platforms to rewrite the rulebook of their respective industries.

Al-Assisted Programming, Tom Taulli WSJ OPINION

<!-- image -->

English Edition Print EditionVideoAudioLatest HeadlinesMore Sign In INTRO OFFER

<!-- image -->

ornds ots et oe esd s n eti Sor Lon o  tn o rn Lott  oresn Porn rtntc

<!-- image -->

COMMENTARY

Follow

## Software Ate the World, and Soon It Will Write Itself

Developers are in short supply, but their products may acquire the capacity to replace them.

By Daniel Kroening

Dec. 3, 2020 6:10 pm ET

<!-- image -->

## ChatGPT may be coming for our jobs. Here are the 10 roles that Al is most likely to replace.

Aaron Mok andJacob ZinkulaUpdatedSep4,2023,4:24 PMGMT+2

Insider compiled a list of the 10 jobs that could be disrupted by Al tools like ChatGPT, according to experts. Jens Schlueter/Getty Images

<!-- image -->

Advertisement HOME  TECH

<!-- image -->

## OpenAl's ChatGPT can write impressive code. Here are the prompts you should use for the best results, experts say.

Beatrice NolanAug 10, 2023, 1:07 PM GMT+2

<!-- image -->

OpenAl's ChatGPT has caused quite a stir in the tech community. Getty/Luis Alvarez

- OpenAl's ChatGPT has been able to produce working lines of code.
- The Al-powered bot has freaked out programmers and caught the attention of tech CEOs.

https://github.com/features/copilot 13.09.2023, modified Al Won't Replace Humans — But Humans With AI Will Replace Humans Without AI

<!-- image -->

The first step business leaders must take is to experiment, create sandboxes, run internal bootcamps, and develop Al use cases not just for technology workers, but for all employees.

## Haryard Business Review

## Coding with AI

## Unexpected: Convergence of AI and Formal Methods

<!-- image -->

Prof. Dr. Guido Salvaneschi

From insight to impact.

## When a Type System Becomes a Theorem Prover

- Ordinary type systems catch simple mistakes, such as adding a number to a string
- Make the type system expressive enough and a type can state any mathematical claim
- Checking that a program has a given type then becomes checking that a theorem has a proof
- Lean is the leading example: one language that is both a programming language and a proof assistant
- These slides trace why this works, and where it is taking mathematics

<!-- image -->

University Autor

```
-- an ordinary type def double (n : Nat) : Nat := n + n -- a type that is a theorem; -- its value is a proof theorem add_comm (a b : Nat) : a + b = b + a := by
```

```
omega
```

## Types That Can Say Anything: Dependent Types

- The key ingredient is dependent types: types that depend on values
- A type can now express a list of exactly n elements, or a proof that a is positive
- With them, a single type can encode an arbitrary mathematical proposition
- Prop is the universe of propositions; Type is the universe of ordinary data
- Once types can state theorems, the compiler can be asked to check them

<!-- image -->

```
-- length is part of the type def Vec (α : Type) : Nat → Type | 0 => Unit | n+1 => α × Vec α n -- the type demands a -- non-empty vector def head {α n} : Vec α (n+1) → α | (x, _) => x
```

Autor

## The Surprising Bridge: Curry-Howard

## Two readings of one structure:

| Logic       | Type theory        |
|-------------|--------------------|
| proposition | type               |
| proof       | program (term)     |
| P → Q       | function P → Q     |
| P ∧ Q       | product (pair)     |
| P ∨ Q       | sum                |
| ∀ x, P x    | dependent function |
| ∃ x, P x    | dependent pair     |

Historical note: Haskell Curry saw the link between logic and types in the 1930s (fully set out in 1958); William Howard extended it to proofs as programs in 1969, which is why it bears both their names.

<!-- image -->

```
-- a proof of P → Q → P -- is just a function theorem k (P Q : Prop) : P → Q → P := fun hp _ => hp -- a proof of P ∧ Q -- is just a pair example (hp : P) (hq : Q) : P ∧ Q := ⟨hp, hq⟩
```

## Programming and Proving Are the Same Act

- In Lean you build a proof the same way you build a program
- Tactics automate the construction: intro, apply, rw, simp, induction, ring
- A tiny trusted kernel re-checks every finished proof term
- If it type-checks, the result is guaranteed: no gaps and no hand-waving
- The tools that compile code now also certify mathematics

<!-- image -->

Autor

```
example (a b : ℝ) : (a + b)^2 = a^2 + 2*a*b + b^2 := by ring theorem sqrt2_irrational : Irrational (Real.sqrt 2) := by exact irrational_sqrt_two
```

## A Living Library of Checked Mathematics: Mathlib

- Mathlib is a single, unified library of formalized mathematics
- Over one million lines, from basic algebra to modern research topics
- Every theorem in it is machine-checked, and all of it composes together
- Contributors build on each other's proofs like a shared codebase
- Mathematics becomes collaborative, searchable, and version-controlled

<!-- image -->

```
import Mathlib -- reuse verified results open Nat in #check @Nat.add_comm -- thousands of lemmas, -- all checked and composable example (n : Nat) :
```

```
n + 0 = n := by simp
```

## Why This Is Driving Advances in Mathematics

- Fields Medalist Terence Tao formalized his PFR theorem in Lean in weeks
- Teams verify results too large or intricate to check reliably by hand
- Proofs proposed by AI can be handed to the kernel and certified as correct
- The same technology verifies real software, compilers, and hardware
- Backed by the Lean FRO since 2023, adoption in mathematics is accelerating
- -- Tao's PFR theorem,
- -- formalized in Lean 4 import Mathlib import PFR
- -- the whole proof stated -- and checked as theorems,

<!-- image -->

## On the Navier-Stokes Millennium Prize Problem

- OpenAI reports an internal AI system resolved the Navier-Stokes problem, a Millennium Prize Problem
- It produced both a written proof and a Lean formalization, so the result is machine-checked by Lean's kernel
- It shows a smooth, finite-energy 3D fluid can blow up in finite time despite viscosity
- The mechanism is an inward-spiraling vortex that stretches and speeds up while keeping finite energy
- The pattern in these slides: an AI proposes the mathematics, and a proof assistant certifies it

<!-- image -->

Autor

## kes Equation

<!-- image -->

## Navier-Stokes equations for a Newtonian fluid with constant ρ and μ.

<!-- image -->

ρ

∂v

∂t

∆z∆ + d∆ − d =

+ (V·v)v)

<!-- image -->

## Coding with AI

## Is Software Engineering Prompting?

Prof. Dr. Guido Salvaneschi

From insight to impact.

<!-- image -->

## Benefits of AI for Coding

## Productivity boost

- Speedup code generation
- Automate repetitive processes
- Concentrate on higher-level jobs that demand greater creativity and problem solving skills.

## Improved quality of the code

- Point out possible problems
- Providing suggestions for changes

## Integration with preexisting processes

- Coupling with tools and frameworks such as IDEs and code editors

Capability of understanding numerous programming languages

## Individualization

- AI may be adapted to particular development areas (e.g., data science)

## Increased creativity

- AI may assist developers in generating new ideas and coming up with inventive solutions

ChatGPT for Coders Unlock the Power of AI with ChatGPT A Comprehensive Guide to Efficient and Effective Coding - Sean A Williams, 2023 (adapted)

## Prompt (engineering)

Context, the persona or role to take in the response.

- Prompt: You are an experienced software engineer specializing in debugging Java applications.
- Prompt: You are a senior software developer with expertise in algorithm optimization.

Instructions, such as to summarize, translate, or classify.

<!-- image -->

## Prompt (engineering)

## Input of content if you want the LLM to process information

- it's helpful to use special symbols like ### or """ to clearly separate your instructions from the data

```
Prompt: Extract the key implementation steps for the API from the text below: Documentation: """ {API documentation text here} """
```

## Prompt (engineering)

How you want the output formatted

Prompt: Create a Python function that takes a list of user objects (each object contain- ing a user's ID and name) and returns a JSON object that maps user IDs to names. For- mat the output as JSON.

```
ChatGPT: { "code": "def map_user_ids_to_names(users):\n return user_map", "example_usage": { "input": [ {"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}, Format type Table List Markdown/HTML Text hierarchy
```

```
user_map = {user['id']: user['name'] for user in users}\n …. Sample prompt "Create a table comparing the syntax, performance, and use cases of Python, Java, and C++." "List the steps to troubleshoot a slow-loading web page." "Explain the differences between GET and POST HTTP methods in Markdown." "Provide a structured outline of the software development life cycle (SDLC), including its phases and key activities in each phase."
```

| LaTeX formatting   | “Express the time complexity of the binary search algorithm in LaTeX notation."   |
|--------------------|-----------------------------------------------------------------------------------|
