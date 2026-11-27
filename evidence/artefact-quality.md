# Artefact quality: sample review and mutation check (C7)

Samples from the [booking](../showcases/booking/) showcase (medium size, after its P7 ticket and the
[injected bug](injected-bug.md) fix). Each section says what is good and what is wrong.

## Requirement: REQ-003 No overlapping bookings

> The system shall reject any booking or booking change that overlaps in time with an existing
> booking for the same room. (must, functional; 4 acceptance criteria)

- Good: one testable rule; the criteria cover the rejection, concurrent requests, other rooms and
  the boundary (a booking may start exactly when another ends). "Booking change" carries the rule
  into REQ-010, and the design traces both to DSN-024.
- Wrong: nothing in the text; the concurrency criterion (AC2) is phrased for booking only, so the
  time change path never got a concurrency test (see below).

## Class diagram ([design.md](../showcases/booking/docs/design.md#classes))

- Good: clean layering (controller, service, repository) that matches `src/` folder for folder;
  every class has its DSN ID, a `@trace` tag in the code and a click target in the UI. The P7
  ticket pulled the shared rule into `BookingRuleChecker`, and both services use it.
- Wrong: the controllers' methods are modelled as typed calls with a `token` parameter, while the
  code reads the token from the `x-admin-token` header, so the diagram hides where auth comes from.
  `Booking --> Room` is an association, but the code only holds `roomId`.

## Sequence diagram: SEQ-004 Change own booking time

- Good: matches `BookingService.changeTime` call for call (findById, check, validate,
  findOverlapping, update); P4's code check verifies that order.
- Wrong: no return messages and no `alt` branch for a rejection, so the error path is not shown.
  It also shows the flaw the mutation check found: check, then `update`, with nothing atomic in
  between. Create uses `saveIfFree` (check and insert in one), a time change does not, so two
  concurrent changes can both pass the check. The design review (P3) did not flag it.

## Test file: [UC-002.test.ts](../showcases/booking/test/UC-002.test.ts)

- Good: one test per acceptance criterion, named `REQ-xxx ACn`, which is what the P5 gate counts;
  manual criteria are `it.todo` with a reason instead of fake tests.
- Wrong: the REQ-003 tests run on a hand-written fake repository that reimplements the overlap
  rule, so they test the fake, not the SQL. The "two simultaneous requests" test is a race against
  the fake. Many assertions are `toThrow(/\S/)` (22 in the suite), which passes on any error.

## Deployment files ([Dockerfile](../showcases/booking/Dockerfile), [compose.yaml](../showcases/booking/compose.yaml), [RUN.md](../showcases/booking/RUN.md))

- Good: works first try (deploy check `/health` 200); port published on 127.0.0.1 only; named
  volume for the SQLite file; RUN.md covers start, stop, reset, a taken port and the placeholder
  admin password.
- Wrong: no lockfile, so builds are not reproducible; `npm install` includes the dev dependencies
  because `npm start` runs `tsx` (no build step); the container runs as root; no `healthcheck` in
  compose although the plan has a health URL; the admin password is a plain value in compose.

## Mutation check: does a test catch each broken must rule?

46 hand mutants, one at a time, in a scratch copy of the booking code (`npx vitest run` on the
generated suite, 58 tests); every file restored and the suite green afterwards. The mutants
were made by hand and are not committed, so no script reproduces the table.

| Requirement             | Mutants | Caught | Survivors (why)                                                                                                                                              |
| ----------------------- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-001 availability    | 3       | 2      | equipment read back as `[]` (fake repositories)                                                                                                              |
| REQ-002 book            | 3       | 2      | cancelled bookings still in "my bookings" (no test)                                                                                                          |
| REQ-003 no overlap      | 5       | 3      | `saveIfFree` guard dropped; adjacent slots counted as overlap in SQL (both tested only on the fake repository)                                               |
| REQ-004 cancel own      | 3       | 3      |                                                                                                                                                              |
| REQ-005 manage rooms    | 3       | 3      |                                                                                                                                                              |
| REQ-006 browser         | 0       |        | not testable by a unit test; `it.todo`                                                                                                                       |
| REQ-007 time slots      | 9       | 7      | minimum duration (the test slot fails the 15 minute step first); 60 day boundary (no test at exactly 60 days)                                                |
| REQ-008 name and email  | 4       | 2      | each of the two guards (controller, service) alone; the test cannot tell which one threw                                                                     |
| REQ-009 admin password  | 5       | 2      | any token accepted (the test sends the token in the body, the server reads a header); empty password accepted; admin cancel guard (404 also passes `>= 400`) |
| REQ-010 change own time | 5       | 4      | own booking not excluded from the overlap check (no test moves a booking over its own old slot)                                                              |
| REQ-011 admin cancel    | 3       | 3      |                                                                                                                                                              |
| REQ-012 deactivate      | 3       | 2      | deactivation cancels the room's bookings (mock with methods the repository does not have)                                                                    |
| **Total**               | **46**  | **33** | **13 survivors**                                                                                                                                             |

Every must requirement except REQ-006 has at least one mutant that a test catches, so the P5 gate
("every must criterion has a test") holds in substance, not only by name. But 28 % of the mutants (13 of 46)
survive. The causes repeat:

1. **Fakes that reimplement the rule.** The test agent writes in-memory repositories with their
   own logic, so the real SQL (overlap boundary, atomic insert) is never run.
2. **Weak assertions.** `toThrow(/\S/)` and `status >= 400` pass on the wrong error.
3. **Boundaries and double guards.** Exactly 60 days, zero length slots, a rule enforced in two
   layers: the tests pick values where another rule decides first.

What we would change in the test agent's rules: prefer the real repository on `:memory:` SQLite
over fakes, assert the error message or status exactly, and add one test per boundary named in a
criterion. Not done in this PR; recorded for the report.
