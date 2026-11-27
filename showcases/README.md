# Showcases

Three projects of increasing size, each taken from the first description to a tested and deployed
system plus one maintenance change (requirements §4, criterion C6). Every artefact the environment
produced is committed: `.aise/` holds the requirements, design, chats, run logs, checks and tickets;
the rest of each folder is the generated project.

| Showcase            | Size   | Maintenance change (C2)                                                              | Issue |
| ------------------- | ------ | ------------------------------------------------------------------------------------ | ----- |
| [todo](todo/)       | small  | requirement change (due date), propagated to design, code, tests and deploy          | #3    |
| [booking](booking/) | medium | design change (one overlap check), reflected in code and tests                       | #4    |
| [auction](auction/) | larger | requirement change (reserve price) and two drift tickets from hand edits of the code | #5    |

How each change propagated is in [evidence/change-propagation.md](../evidence/change-propagation.md).

The live demo runs on `todo`. How the three compare, and where the environment breaks as the
project grows: [evidence/scaling-comparison.md](../evidence/scaling-comparison.md).

## Where to look in a showcase

- `.aise/requirements.json`, `.aise/design.json`: the approved requirements and design (rendered in `docs/`)
- `.aise/chat/`: the conversation per phase, including the clarifying questions
- `.aise/tickets.json`: maintenance tickets and their change reports
- `src/`, `public/`: the generated code, `test/`: the generated tests
- `Dockerfile`, `compose.yaml`, `RUN.md`: the deployment
