# Generated services validate entity ids and state (#36)

## Goal

Generated services reject an empty or unknown entity id and a state change the entity's status
forbids, every run, not only when a worker happens to write the check. Auction: `placeBid` with an
empty `bidderId` gives 400, with an unknown one 404, on a closed item 400.

## Non goals

- Authentication of the caller, and keeping user ids out of public ws events. Auction's P1 chose a
  display name identity with no login, which is enough for the course demo.

## Rules

Added to `STACK_RULES` (workers and the code agent):

1. A public method that takes an entity id (a parameter named `<entity>Id` or `id` whose type is the
   entity's id type) checks it is a non-empty string (or a positive integer for number ids) and throws
   a 400 error otherwise.
2. When the class can reach the entity's store (its constructor shape has the store or a service
   that has a lookup method), it looks the entity up and throws `<Entity> <id> not found` (404) when
   it does not exist.
3. A method that changes an entity whose design has a status enum checks the current status against
   that enum before the change and throws a 400 error when the status forbids it (a bid on an item
   whose status is not open), in addition to any time check. It restricts only what the
   requirements, acceptance criteria or sequences say; repeating the current status is not an error.

## Worker brief

Added during implementation: the first regeneration wrote the id checks but not the status check,
because workers never see sequences, and the auction Place bid sequence is where `BidService` calls
`Item.isOpen`. The worker brief now lists the calls the class makes in the design sequences, grouped
by the method that handles them, in addition to the state changes the requirements ask for.

## Design changes

- Design agent prompt (`design.ts`): a store of an entity that other classes refer to by id has a
  lookup method `findById(id: string): Promise<Entity | null>`; it returns null and never throws
  not found, its caller throws.
- Auction design: `UserStore.findById(id: string): Promise<User | null>` (P3 edit through
  `update_design`, so the gates and hashes stay consistent).

## Showcase

Regenerate auction P4 (and P5 for the acceptance criteria tests), about $3 to $5 of API credit,
then check: `BidService.placeBid` and `ItemService.listItem` call `userStore.findById`, no
`void this.userStore` remains, and the P5 tests for the bid acceptance criteria cover empty,
unknown and closed cases and pass. Run this after #37 merges so auction regenerates once on the
new injection rule.

## Edge cases

- Number ids: rule 1 checks a positive integer instead.
- A class that cannot reach the store does only the non-empty check.
- An id parameter of a non entity (a session token) is out of scope; the rule names entity ids only.

## Tests

- `agents.test.ts`: the worker and code agent system prompts contain the three rules; the design
  prompt contains the `findById` rule.
- Auction design validates with `findById` (`validate.test.ts` or the showcase design test).
- Live: the regenerated auction answers `POST` bid with an empty `bidderId` 400, unknown 404,
  closed item 400 (recorded in the PR, from the P5 run).
