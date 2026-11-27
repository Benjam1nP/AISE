# Deployment model: client nodes and links between nodes (#12)

Status: draft for approval. Source: `docs/reflection/showcase-scaling.md`, findings 7 and 14.

## Goal

The deployment diagram shows how nodes talk to each other, from explicit links in the design, and
a browser is a node of its own kind. #14 (one entry per server node) and #15 (browser maps to
`public/`) build on both.

## Non-goals

- Code generation per node and network calls between nodes (#14).
- Mapping the client component to `public/`, removing client classes from `src/` (#15).
- P4 health check (#13). Per component class diagrams (finding 14, only if the demo needs it).

## Data model

`src/lib/server/core/schemas/design.ts`:

- `DeploymentNode.kind`: `service | database | client | external` (adds `client`).
- New `NodeLink = { from: DSN id, to: DSN id, protocol: 'http' | 'https' | 'ws' | 'wss' | 'sql', label?: string }`;
  `sql` is for a link to a database node.
- `DesignDoc.links: NodeLink[]`, `.default([])`, so a `design.json` without links still parses.
  The `update_design` input requires `links`, so a model that leaves them out gets an error
  instead of a design that silently lost them.
  `from` is the side that opens the connection (browser to API, API to Frankfurter).

## Validation (`core/validate.ts`)

Issues (block saving):

- `links[i].from` and `.to` name existing nodes; `from !== to`.
- No duplicate link with the same `from`, `to` and `protocol`.
- A node of kind `external` has at least one link (either end).

Warnings (save goes through, agent fixes or explains):

- A component on a `database` or `external` node: such a node holds no components.
- A `dependency` relation whose two classes sit on different nodes, neither of them a `database`
  node, with no link between those nodes in either direction:
  `class X (node A) relates to Y (node B), but no link connects A and B`. Inheritance,
  association and composition do not warn (they are not calls; same rule as the generator's
  injection and drift).

`designHash` changes with links, and each node's P4 element hash covers its links (both ends and
protocol, not the label), so a link edit makes P4 stale like any other design edit.

## Renderer (`core/render/mermaid.ts`)

- Edges come only from `links`: `A -->|"HTTP"| B`, label `PROTOCOL` or `PROTOCOL: label`.
  Edges derived from class relations are removed.
- A node with components stays a subgraph; a client subgraph gets a dashed border through a
  `classDef client stroke-dasharray` (no colour, so both themes work).
- A node without components: database `[( )]`, external `{{ }}`, client `([ ])`, service `[ ]`.
- `docs/design.md` (`render/markdown.ts`) lists links under the nodes: `DSN-006 Browser to DSN-001 API Server (HTTP)`.

## Design agent prompt (`agents/design.ts`)

- Node kinds: `service` runs our code, `client` is the browser, `external` is a system we call and
  do not build, `database` only when the developer asks for one (SQLite runs in the app process).
- Every pair of nodes that talk has a link with its protocol; the browser reaches servers over
  `http` or `ws`.
- An external system gets no classes: no component on an external node. The class that calls it
  (for example `FrankfurterClient`) sits on the calling node, and the link carries the protocol.

## Other consumers

- `agents/code-worker.ts` storing rule and the `code.ts` prompt: a storing class on a `client` node
  does not take `db` either (today only `external` is excluded). No other code generation change.
- Trace: links are not traced elements (no ID); nodes keep their trace rows.

## Migration

Edit by hand and validate with `validateDesign`; regenerate `docs/design.md` and any committed
diagrams through the renderer. Every committed design ends with no issues and no warnings.

| Design | Change |
| --- | --- |
| `showcases/fixture`, `test/fixtures/todo-design.json` | Persistence moves onto App server (DSN-008); the SQLite database node (DSN-009) is removed, since SQLite runs in the app process. |
| `test/fixtures/p4` | No change (one node). |
| `showcases/arthur` (tracked; only `.aise/design.json` and `docs/design.md`) | Local Persistence (DSN-024) moves onto the app node DSN-026; links DSN-026 to DSN-028 (`https`) and DSN-026 to DSN-027 (`sql`). |
| `showcases/booking` | Browser to `client`; links Browser to API (`http`). |
| `showcases/auction` | Browser (DSN-006) to `client`; remove component FrankfurterService (DSN-043) and its `FrankfurterApi` class, and the relations that point at it; links Browser to API (`http`), Browser to Live (`ws`), Live to API (`ws`), API to Frankfurter (`https`). |

Booking and auction P4 code is left as it is and shows as stale (and auction drift reports the
removed `FrankfurterApi`) until #14 and #15 regenerate it. Agreed with the developer.

## Edge cases

- Old `design.json` without `links`: parses with `[]`; an external node then fails validation on
  the next save, which the agent fixes from the issue text.
- Two links between the same nodes with different protocols (HTTP and ws): allowed, two edges.
- A link to a `database` node: allowed, protocol `sql`.
- A client node without components: allowed now; #15 decides what it holds.

## Tests

- Schema: `client` kind parses; a doc without `links` parses to `[]`; an unknown protocol fails.
- Validation: unknown `from` and `to`, self link, duplicate link, http and ws between the same
  nodes allowed, external without link (issues); component on a database or external node
  (warning); cross node dependency without link (warning), with a link in either direction, of
  another relation kind or to a database node (no warning).
- `update_design`: input without `links` fails; its JSON schema lists `links` as required.
- Hashes: a link edit changes both nodes' P4 hashes, a label edit does not.
- Renderer: labelled link edge, label with text, client shape with and without components, no
  edge from a class relation.
- Markdown: link lines.
- Code worker: a `...Store` class on a client node takes no `db`.
- Every committed `design.json` validates with no issues and no warnings.

## Acceptance

The auction deployment diagram shows Browser to API, Browser to Live, Live to API (ws) and API to
Frankfurter (HTTPS), with no `FrankfurterApi` class. Full gate (`check`, `lint`, `test`,
`test:docker`) green.

## Docs

`docs/decisions.md` entry, `ARCHITECTURE.md` design model section, `CHANGELOG.md`.
