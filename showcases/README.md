# Showcases

Three projects of increasing size, each taken from the first description to a tested and deployed
system plus one maintenance change (requirements §4, criterion C6). Every artefact the environment
produced is committed: `.aise/` holds the requirements, design, chats, run logs, checks and tickets;
the rest of each folder is the generated project.

| Showcase              | Size    | Maintenance change (C2)                                     | Issue |
| --------------------- | ------- | ----------------------------------------------------------- | ----- |
| [todo](todo/)         | small   | requirement change, propagated to design, code, tests, deploy | #3    |
| [booking](booking/)   | medium  | design change, reflected in code and tests                  | #4    |
| [auction](auction/)   | larger  | hand edit of the code, drift detected and repaired          | #5    |

The live demo runs on `todo`. How the three compare, and where the environment breaks as the
project grows: [evidence/scaling-comparison.md](../evidence/scaling-comparison.md).

## Where to look in a showcase

- `.aise/requirements.json`, `.aise/design.json`: the approved requirements and design (rendered in `docs/`)
- `.aise/chat/`: the conversation per phase, including the clarifying questions
- `.aise/tickets.json`: maintenance tickets and their change reports
- `src/`, `public/`: the generated code, `test/`: the generated tests
- `Dockerfile`, `compose.yaml`, `RUN.md`: the deployment
