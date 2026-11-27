# Code generation for designs with several deployment nodes (#14)

Status: draft for approval. Source: `docs/reflection/showcase-scaling.md`, findings 2 and 8.
Builds on #12 (node links) and #15 (client component without classes).

## Goal

A design with several service nodes generates one runnable process per node, and nodes talk only
over the links the design names. A call across nodes is never a constructor parameter.

## Non-goals

- Generated network proxies for cross node relations (rejected: code drift cannot check).
- P6 compose with one service per node (P6 work); P4 health check (#13).
- Message brokers or a database server: the stack has SQLite in one app process and `ws`.

## Design rules (validation, `core/validate.ts`)

Issues:

- A `dependency` between classes on two different nodes. Message: model the call as a client
  class on the calling node (as `FrankfurterClient` does) and a link between the nodes. This
  replaces the #12 warning for dependencies without a link.
- A cycle of `dependency` relations between classes (constructor cycle), listing the cycle.

Associations and inheritance across nodes stay allowed: entity types and interfaces are shared
code in one repository.

## Design prompt (`agents/design.ts`)

- Stack: SQLite runs inside one service node's process; no message broker, no database server.
  Fan out between nodes goes over an internal ws feed along a link.
- A node that calls another holds a client class for it, which reads the peer URL from
  `process.env.<PEER>_URL` in code and has no URL attribute; the receiving node has a class whose method handles the
  message. The link carries the protocol and goes from the caller.
- No dependency cycles.

## Code generation

Primary node: the service node that a client node links to over `http`, else the first service
node in design order.

- `src/app/app.ts` `createApp` and `src/app/main.ts` stay as today for the primary node, with
  only the classes on that node (single node projects do not change).
- Every other service node gets `src/app/<node kebab>.ts`: builds its own classes in dependency
  order, serves `GET /health`, its routes and the endpoints its incoming links need, listens on
  `<NODE_KEBAB_UPPER>_PORT` (default 8081, 8082, ... in design order) and logs the port.
- Links: the caller's client class gets the peer URL from `process.env.<PEER>_URL`, default
  `http://localhost:<peer port>` (or `ws://`). The receiver serves `http` links as routes under
  `/internal/` and `ws` links as a ws endpoint at `/internal/<caller kebab>`, both mapped to the
  receiving class's methods.
- Browser links to a node other than the primary (auction: Browser to Live over ws): the
  primary node serves `GET /api/config` with `{ "<node kebab>": url }` for each such node, from
  `<NODE>_PUBLIC_URL`, default `ws://localhost:<port>` (or `http://`). The page reads it before
  opening the connection. The client node's outgoing links are named in the page brief.
- Client node and component lookups use the shared helper `core/client.ts` from #15.
- The wiring brief lists per node: its classes, entry file, port variable, incoming and outgoing
  links with protocol. Only the node that owns the storing classes opens the database.
- `scaffold.ts`: one `start:<node kebab>` script per extra node next to `start`.
- `readmeMarkdown`: one run line per node.

## P4 gate

`App entry exists` checks `src/app/main.ts` and each extra node's entry; the detail names the
missing ones.

## Migration and acceptance run

- Auction design: a P2 change request run (paid, about $0.2) removes the cross node dependency
  pair `EventFeed` and `EventSubscriber` under the new rules; its reply and the validation decide
  the shape. Regenerate auction P4 with Generate (paid, about $0.6), no chat fixes.
- Smoke (scratch script, quoted in the PR): start the API node and two live node instances on
  different ports, open a ws to each live node, place a bid over HTTP, both sockets get the bid.
- Booking (one service node) and todo: no design change; their generated code is unchanged.

## Edge cases

- One service node: identical to today.
- Two service nodes without a link between them: allowed; they do not talk.
- A link between two service nodes in both directions: both sides get client and receiver roles.
- No client node: primary is the first service node.

## Tests

- Validation: cross node dependency issue; same node dependency fine; dependency cycle issue
  with its path; association across nodes fine.
- Primary node choice (client http link, fallback first service node).
- Wiring brief per node: entry, port variable, links.
- Scaffold: `start:<node>` scripts; gate: missing extra entry fails, present passes.
- Prompt tests for the new rules.

## Docs

`docs/decisions.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `AGENTS.md` if the run commands change.
