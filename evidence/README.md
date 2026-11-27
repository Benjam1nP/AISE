# Evidence

What we show for each grading criterion (requirements §5), and where it is. Showcase artefacts are in
[showcases/](../showcases/), the architecture in [ARCHITECTURE.md](../ARCHITECTURE.md).

| Criterion                     | Evidence                                                                                                        | Where                                                                            | Issue      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------- |
| C1 Phases beyond coding       | Each showcase through P1 to P7, with chats, gates and checks                                                    | `showcases/*/.aise/`                                                             | #3, #4, #5 |
| C2 Alignment under change     | One requirement, one design and one code change, each with its change report; how sync works and where it fails | `showcases/*/.aise/tickets.json`, [change-propagation.md](change-propagation.md) | #6         |
| C3 Usability                  | Live demo; developer workflow in the README                                                                     | [README.md](../README.md), [presentation/](../presentation/)                     | #10        |
| C4 Agent architecture         | Diagram of agents, tools and artefact flow                                                                      | [ARCHITECTURE.md](../ARCHITECTURE.md)                                            | #8         |
| C5 Requirement to code        | Navigation from a requirement to its diagram element, code and test                                             | live demo                                                                        | #2         |
| C6 End to end and scalability | Small, medium and larger compared                                                                               | [scaling-comparison.md](scaling-comparison.md)                                   | #9         |
| C7 Artefact quality           | A generated test failing on an injected bug and passing after the fix; review of sample artefacts               | [injected-bug.md](injected-bug.md), [artefact-quality.md](artefact-quality.md)   | #7         |

Files linked here that do not exist yet are written by their issue.
