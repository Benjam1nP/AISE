# Injected bug: a generated test fails, the environment explains and fixes it (C7)

Showcase: [booking](../showcases/booking/). Reproduce with
`npx tsx scripts/run-showcase.ts booking bug` (Docker and API key; a rerun after the fix only
reruns the checks). The script takes the same orchestrator calls as the P5 buttons in the UI.

## 1. The bug, by hand

The overlap rule (REQ-003) lives in one class that booking and rescheduling share
(`BookingRuleChecker`, DSN-024, introduced by the booking P7 ticket). The hand edit drops the
rejection:

```diff
     const overlapping = await this.bookingRepository.findOverlapping(roomId, start, end, excludeId);
-    if (overlapping.some((b) => !b.cancelled && b.id !== excludeId)) {
-      throw new Error(`Booking overlaps an existing booking in room ${roomId}`);
-    }
```

## 2. Run tests: red

Check at 2026-11-27T15:20:56Z (stored as `checks-before.json` in run
[`20261127-152056-P5`](../showcases/booking/.aise/runs/20261127-152056-P5/)): 57 passed, **1 failed**.

```
FAIL test/UC-004.test.ts > REQ-010 AC2: A change that violates the overlap rule or time slot
     rules is rejected and the original booking stays unchanged
AssertionError: expected 200 to be 400
```

Only the time change test fails. Creating a booking stays protected because
`BookingRepository.saveIfFree` repeats the overlap check inside the insert, so the REQ-003 create
tests (UC-002) still pass. The generated design has two defences for create and one for a time
change; the tests make that visible.

## 3. Explain failures

Run [`20261127-152056-P5`](../showcases/booking/.aise/runs/20261127-152056-P5/) (test agent,
$0.05) called `report_code_bug`, so the failure is blamed on the code, not the test:

> PUT /api/bookings/:id moving a booking from 12:00-13:00 to 10:30-11:30 overlaps another booking
> (10:00-11:00) in the same room, but the server answered 200 instead of 400. The overlap rule
> (REQ-003) is not enforced on a time change. Test setup is valid and the expectation follows the
> criterion.

The proposed fix points at the rule check on the time change path and an exclude ID comparison,
which is where the edit was made.

## 4. Apply fix

Run [`20261127-152108-P5`](../showcases/booking/.aise/runs/20261127-152108-P5/) (code agent,
$0.07, typecheck and drift check pass):

```diff
-    if (overlapping.some((b) => !b.cancelled && b.id !== excludeId)) {
-      throw new Error(`Booking overlaps an existing booking in room ${roomId}`);
+    if (overlapping.length > 0) {
+      throw new Error(`Room ${roomId} is already booked for the requested time range`);
     }
```

Not the original line, but equivalent: `findOverlapping` already filters `cancelled = 0` and
`id != excludeId` in SQL. The run summary says the agent did not run the test itself and tells the
developer to rerun it before approving.

## 5. Run tests: green

Check at 2026-11-27T15:21:37Z: 58 passed, 0 failed; finding `20261127-152056-P5-1` resolved at
15:21:26Z ([checks/P5.json](../showcases/booking/.aise/checks/P5.json)). Final gates: P4, P5 and
P6 pass (deploy check `/health` 200). The fix changed `src/`, so P5 waited for approval and P6
turned stale; P5 was approved and P6 confirmed as still valid, since its files did not change.

Total cost of the loop: $0.11, about one minute.

## What this shows, and what it does not

- A generated test caught a broken must rule, the triage put the blame on the right side, and the
  fix was confined to the one line that broke.
- It took one test out of 58. A bug on the create path alone would have been caught by the
  repository, not by the rule check, so a test on the rule check in isolation is missing. The
  mutation check in [artefact-quality.md](artefact-quality.md) looks at this for every must
  requirement.
