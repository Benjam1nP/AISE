# AI Context Knowledge Base & Course Reference Index

This directory contains structured Markdown translations of the course slides, case studies, and project requirements from `docs/pdf/`, generated with [Docling](https://github.com/docling-project/docling). Only the requirements PDF is in the repository; the slide PDFs (`docs/pdf/slides/`) are kept locally and gitignored.

These documents provide authoritative context for all phases of our AI-assisted software engineering environment.

---

## 🗺️ Phase-by-Phase Reference Guide

Use these documents during the respective phases of development:

| Phase | Relevant Materials | Core Topics Covered |
|-------|--------------------|---------------------|
| **P1 Requirements** | [`project_requirements.md`](project_requirements.md)<br>[`slides/week_3/software_engineering_basics.md`](slides/week_3/software_engineering_basics.md)<br>[`slides/week_3/velocity_case_study.md`](slides/week_3/velocity_case_study.md)<br>[`slides/week_6/lakeside_case_study.md`](slides/week_6/lakeside_case_study.md) | Structured requirements formulation, interactive clarifying questions, user stories, acceptance criteria, scope boundaries. |
| **P2 Design** | [`slides/week_3/uml_software_design_with_ai.md`](slides/week_3/uml_software_design_with_ai.md)<br>[`slides/week_6/software_design_and_deployment.md`](slides/week_6/software_design_and_deployment.md)<br>[`slides/week_3/velocity_case_study_solution.md`](slides/week_3/velocity_case_study_solution.md)<br>[`slides/week_6/lakeside_case_study_solution.md`](slides/week_6/lakeside_case_study_solution.md) | 4 UML diagram types (Use Case, Class, Sequence/Activity, Component/Deployment), conceptual class diagrams, sequence, component and deployment diagram elements, PlantUML & Mermaid syntax, structural vs. behavioral views. |
| **P3 Design Refinement** | [`slides/week_3/uml_software_design_with_ai.md`](slides/week_3/uml_software_design_with_ai.md)<br>[`slides/week_6/software_design_and_deployment.md`](slides/week_6/software_design_and_deployment.md)<br>[`slides/week_6/lakeside_case_study_solution.md`](slides/week_6/lakeside_case_study_solution.md)<br>[`project_requirements.md`](project_requirements.md) | Multi-diagram consistency (consistency rules across seven diagram types), interactive feedback loop, self-review of designs, finding missing classes/responsibilities. |
| **P4 Code Generation** | [`slides/week_1/ai_for_coding_landscape.md`](slides/week_1/ai_for_coding_landscape.md)<br>[`slides/week_2/hands_on_coding_with_ai_prompting.md`](slides/week_2/hands_on_coding_with_ai_prompting.md) | Aligning code structure directly to approved UML class/sequence diagrams, modular code generation. |
| **P5 Testing** | [`slides/week_5/lectures_testing_with_ai.md`](slides/week_5/lectures_testing_with_ai.md)<br>[`slides/week_3/software_engineering_basics.md`](slides/week_3/software_engineering_basics.md)<br>[`project_requirements.md`](project_requirements.md) | AI for software testing, coverage-guided testing, model-based testing, mutation testing, test derivation and execution. |
| **P6 Deployment** | [`slides/week_7/deployment_and_maintenance.md`](slides/week_7/deployment_and_maintenance.md)<br>[`project_requirements.md`](project_requirements.md)<br>[`slides/week_6/software_design_and_deployment.md`](slides/week_6/software_design_and_deployment.md)<br>[`slides/week_4/lectures_ai_agents_mcp_security.md`](slides/week_4/lectures_ai_agents_mcp_security.md) | Containerization (Docker, docker-compose), local launch scripts, sandbox environments, deployment diagrams (nodes, artifacts, data crossing boundaries), CI/CD with GitHub Actions. |
| **P7 Maintenance** | [`slides/week_7/deployment_and_maintenance.md`](slides/week_7/deployment_and_maintenance.md)<br>[`project_requirements.md`](project_requirements.md)<br>[`slides/week_6/lakeside_case_study_solution.md`](slides/week_6/lakeside_case_study_solution.md)<br>[`slides/week_3/software_engineering_basics.md`](slides/week_3/software_engineering_basics.md) | Change propagation across requirements -> design -> code -> tests, bidirectional drift detection and repair, maintenance kinds (ISO 14764), bug fix order (reproduce, failing test, fix, keep test), versioning and changelog, aligning the design document. |
| **Agent Architecture & Tools** | [`slides/week_4/lectures_ai_agents_mcp_security.md`](slides/week_4/lectures_ai_agents_mcp_security.md)<br>[`slides/week_2/intro_to_coding_with_ai.md`](slides/week_2/intro_to_coding_with_ai.md) | Multi-agent coordination, Model Context Protocol (MCP) servers/tools, sandboxing, prompt injection security, token budgeting. |

---

## 📚 Complete Document Catalog


### Requirements & Specifications

- **[Course Project Requirements (2026)](project_requirements.md)** (6 pages)
  - *Summary*: Full course project specifications, grading criteria (C1-C7), phases P1-P7, deliverables, and expectations.
  - *Original*: `docs/pdf/Project-Requirements-2026.pdf`

### Course Logistics

- **[Week 1: Course Introduction](slides/week_1/course_intro.md)** (18 pages)
  - *Summary*: Course structure, schedule, grading model, collaboration expectations, and showcase requirements.
  - *Original*: `docs/pdf/slides/week_1/course-intro-1.pdf`

### Foundations & State of the Art

- **[Week 1: AI for Coding Landscape](slides/week_1/ai_for_coding_landscape.md)** (56 pages)
  - *Summary*: Overview of AI code generation, benchmarks (HumanEval, SWE-bench), LLM architectures, coding assistants, and agentic workflows.
  - *Original*: `docs/pdf/slides/week_1/ai-for-coding-landscape-1.pdf`

### Foundations & Coding Techniques

- **[Week 2: Introduction to Coding with AI](slides/week_2/intro_to_coding_with_ai.md)** (22 pages)
  - *Summary*: Capabilities of code LLMs, completion vs. chat vs. agentic coding, context windows, and practical code generation techniques.
  - *Original*: `docs/pdf/slides/week_2/intro-to-coding-with-AI-1.pdf`

### Prompt Engineering & Interaction

- **[Week 2: Hands-on Prompting for Coding](slides/week_2/hands_on_coding_with_ai_prompting.md)** (10 pages)
  - *Summary*: System prompts, few-shot prompting, chain-of-thought, persona specification, and iterative refinement techniques for code generation.
  - *Original*: `docs/pdf/slides/week_2/hands-on-coding-with-AI-prompting-1.pdf`

### Pedagogy & Learning Strategies

- **[Week 2: Generative AI for Learning](slides/week_2/gen_ai_for_learning.md)** (15 pages)
  - *Summary*: Active learning, cognitive load, metacognition, and using AI as a tutor and reasoning companion.
  - *Original*: `docs/pdf/slides/week_2/gen-ai-for-learning-1.pdf`

### Software Engineering Lifecycle

- **[Week 3: Software Engineering Basics](slides/week_3/software_engineering_basics.md)** (42 pages)
  - *Summary*: Software lifecycle models, requirements engineering, modular design, architecture patterns, quality attributes, and automated testing.
  - *Original*: `docs/pdf/slides/week_3/software-engineering-basics.pdf`

### UML & Modeling

- **[Week 3: UML Software Design with AI](slides/week_3/uml_software_design_with_ai.md)** (54 pages)
  - *Summary*: Use case diagrams, class diagrams, sequence/activity diagrams, component/deployment diagrams, PlantUML/Mermaid generation, and AI-assisted modeling.
  - *Original*: `docs/pdf/slides/week_3/UML-software-design-with-AI.pdf`

### Case Study & Reference Requirements

- **[Week 3: VeloCity Case Study Problem](slides/week_3/velocity_case_study.md)** (3 pages)
  - *Summary*: Case study domain: electric bike subscription service in Zurich/Basel/Lausanne, user journeys, fleet management, and modeling requirements.
  - *Original*: `docs/pdf/slides/week_3/VeloCity-Case-Study.pdf`

### Case Study & Reference Architecture

- **[Week 3: VeloCity Case Study Solution](slides/week_3/velocity_case_study_solution.md)** (4 pages)
  - *Summary*: Reference UML solution for VeloCity: complete Use Case diagrams, Activity diagrams, Conceptual Class diagrams, and Sequence diagrams.
  - *Original*: `docs/pdf/slides/week_3/VeloCity-Case-Study-solution.pdf`

### Agent Architecture & MCP

- **[Week 4: AI Agents, MCP Protocol & Security](slides/week_4/lectures_ai_agents_mcp_security.md)** (83 pages)
  - *Summary*: Multi-agent systems, autonomous loops, tool use, Model Context Protocol (MCP) clients/servers, sandboxing, security, and prompt injection defense.
  - *Original*: `docs/pdf/slides/week_4/lectures-ai-agents-mcp-security.pdf`

### Testing & Quality Assurance

- **[Week 5: AI for Software Testing](slides/week_5/lectures_testing_with_ai.md)** (60 pages)
  - *Summary*: AI for software testing in academia and industry, coverage-guided testing, model-based testing, and mutation testing.
  - *Original*: `docs/pdf/slides/week_5/lectures-testing-with-AI.pdf`

### Software Design & Deployment

- **[Week 6: Software Design and Deployment](slides/week_6/software_design_and_deployment.md)** (44 pages)
  - *Summary*: Conceptual class, sequence, component and deployment diagrams with reading and design activities, VeloCity and Lakeside Insurance case studies, and cross diagram consistency rules.
  - *Original*: `docs/pdf/slides/week_6/software-design-and-deployment.pdf`

### Case Study & Consistency Rules

- **[Week 6: Lakeside Insurance Case Study Problem](slides/week_6/lakeside_case_study.md)** (4 pages)
  - *Summary*: Capstone case study: an insurer with two AI services (claims triage, RAG policy assistant) on top of an unchangeable legacy system, modelled with all seven diagram types plus five cross diagram consistency rules.
  - *Original*: `docs/pdf/slides/week_6/Lakeside-Case-Study.pdf`

- **[Week 6: Lakeside Insurance Case Study Solution](slides/week_6/lakeside_case_study_solution.md)** (9 pages)
  - *Summary*: Commentary on the sample solutions for all seven diagrams (diagram images are placeholders) with common mistakes, and a checklist for verifying the consistency rules across diagrams.
  - *Original*: `docs/pdf/slides/week_6/Lakeside-Case-Study-solution.pdf`

### Deployment & Maintenance

- **[Week 7: Deployment and Maintenance](slides/week_7/deployment_and_maintenance.md)** (37 pages)
  - *Summary*: Deployment diagrams and border crossing data, Piz Alva deployment case study, DevOps, CI and continuous delivery/deployment, maintenance kinds, bug fixing order, logging rules, and the Piz Alva maintenance case study (tickets, versioning, keeping design docs aligned).
  - *Original*: `docs/pdf/slides/week_7/deployment-and-maintenance.pdf`
