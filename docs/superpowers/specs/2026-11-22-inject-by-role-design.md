# Injection by role (#37)

## Goal

A dependency on a collaborator class is always a constructor parameter, whether or not the class
holds state, so every dependant shares the one instance the wiring creates. Today `injectable`
(`core/drift.ts`) means "methods and no attributes", so a dependency on a stateful class (a gateway
holding sockets, a service with a cache) is never injected and each dependant builds a private copy.

## Non goals

- No new design field (no stereotype or role enum). The role is inferred from the design.
- No change to entities, enums or association and composition handling.
- No dependency injection container; the wiring stays plain `new` calls in `src/app/`.

## Rule

A dependency target is **injected** when it is a class or interface with at least one method and
it is **not data**. A class is data when any design class uses its name as a type in an attribute,
a method parameter or a return type (it is passed around, like `Item` or `Bid`), or when it has no
methods. Enums are never injected.

| Showcase case                          | Today        | New         |
| -------------------------------------- | ------------ | ----------- |
| `ItemController -> ExchangeRateService` (1 attribute) | not injected | injected    |
| `EventFeedClient -> LiveGateway`       | injected (workaround: no attributes) | injected, may hold sockets |
| fixture `TaskController -> TaskService` (held as an attribute) | not injected | not injected; the attribute already passes the shared instance |
| `TaskService -> Task` (data)           | not injected | not injected |
| `ItemService -> Item` style (Item is a return type) | not injected | not injected |

`injectable(c, design)` gets the design as a second argument and implements the rule. Its callers
use it unchanged otherwise: the worker's constructor shape (`code-worker.ts` `ctorParams`) and the
drift relation check (`relationDiffs`).

## Prompt changes

- `stack-rules.ts` and `code.ts`: the injection sentence describes the new rule ("one private
  readonly parameter per dependency target that is a collaborator: a class or interface with
  methods that no design class uses as a data type").
- `code.ts` wiring: create each injected class once and pass that instance to every dependant;
  never wrap, replace or reassign a method of a class instance (the `broadcast()` wrapper in
  auction's `live-update-server.ts`).
- `design.ts`: drop the #14 workaround "a class that other classes depend on has no attributes".
  Add: a class that pushes to sockets lists them as an attribute (for example
  `sockets: Map<string, WebSocket>` keyed by client id), so the code can deliver without a wiring
  wrapper. (A send callback attribute was dropped in review: the wiring passes empty values for
  attributes, which would silence the gateway.) A class others depend on is never used as a type;
  `update_design` warns when it is.

## Drift

Drift keeps reporting a dependency on an injectable target that the code does not use, now with the
new rule. A dependant that builds its own instance (`new LiveGateway()` inside `EventFeedClient`)
has no field or parameter of that type only when it does not store it; when it stores it in a
private field, drift cannot tell. Add one check: a constructor of a class whose shape lists an
injected parameter must take it as a parameter (`constructor parameter x: T missing`).

## Showcases

- auction: migrate the design (LiveGateway gets its socket attribute back), rerun P4. Check that
  `LiveGateway` has no unread `outbox`, `live-update-server.ts` does not wrap `broadcast()`, and two
  watchers both receive a bid.
- booking, fixture, arthur: rerun drift. Fixture `TaskService` is used as an attribute type, so it
  stays data and `test/fixtures/p4` needs no change. Booking has no stateful targets, so no change.
- One live P4 run (auction), roughly $3 of API credit.

## Edge cases

- A class used as a type only by itself (a factory returning `Item`) still counts as data.
- An interface implemented by a stateful class: injected (interfaces with methods are collaborators).
- A dependency cycle is already refused by `update_design`.
- A dependency target on another node is refused by `update_design`; unchanged.

## Tests

- `drift.test.ts`: `injectable` for a stateful service (injected), an entity with methods used as a
  return type (not), a class without methods (not), an enum (not); relation drift for a stateful
  target not used in code; the new missing constructor parameter item.
- `agents.test.ts` / `code-worker` tests: the constructor shape of `ItemController` includes
  `exchangeRateService`; the prompt texts contain the new rule and no longer the #14 sentence.
- `test/docker/codegen.test.ts` on the updated fixture stays clean.
