# P7 maintenance with tickets

Status: draft, 2026-11-22. Tier: Large (new artefact, new workflow).

## Goal

Every maintenance change goes through a ticket: a change request, a bug report, a new requirement
or a drift found after a hand edit. A ticket is triaged by a maintenance agent into an impact plan,
the developer approves the plan, and the change then walks through the existing phases with a gate
each. When it is done the ticket holds a change report. This is the prof's ticket hint and the C2
evidence for the demo (requirement, design and code change, each as one ticket).

## Non goals

- No GitHub Issues or other external tracker (decision: local storage, option A). An import can
  come later.
- No new propagation engine. The existing staleness cascade (P1 change makes P2 stale, design
  change makes P4 stale, requirement or use case change makes P5 stale, each fixed with Update)
  does the propagation; the ticket drives and records it.
- No automatic chaining without the developer: every step keeps its own gate.
- No `TCK` tags in code or diagrams; the link from ticket to artefacts lives in the ticket and in
  the runs.
- P6 is part of the walk only once the deploy agent exists (separate PR).

## User visible behaviour

1. **Tickets tab** (always visible once P5 is approved, or once a ticket exists). A list with ID,
   kind, title and status, a "New ticket" form (kind, title, description) and a detail view.
2. **Triage.** Creating a ticket starts a maintenance agent run in the ticket's own chat. The agent
   reads the artefacts and calls `trace` and `detect_drift`. If the ticket is unclear it asks
   questions in the chat and the ticket stays `open`. Otherwise it saves a plan with
   `write_ticket_plan`: the entry phase, the affected IDs (REQ, UC, SEQ, DSN) and files, and one
   line per step. The ticket becomes `triaged` and shows the plan with an impact list linked to the
   trace view.
3. **Approve plan.** The developer approves (or answers in the chat for a new plan, or rejects the
   ticket). The orchestrator sends the entry brief to the entry phase as a normal chat run, with
   `TCK-001` and the plan in the brief:
   - change request or new requirement: P1 (requirements agent changes or adds requirements),
   - design change: P2,
   - bug: P5 (the test agent writes a failing test for the affected REQ, then the existing finding
     and Apply fix loop),
   - drift: P2 when the design should follow the code, P4 when the code should follow the design;
     the agent proposes a direction in the plan and the developer can switch it before approving.
   The ticket becomes `in_progress`.
4. **Walk.** The ticket shows its steps with the live phase status: approve the entry phase, then
   each phase it made stale shows Update (or Still valid) in the ticket view as well as in the
   phase. Every run started while the ticket is in progress records `ticketId`.
5. **Done.** When the entry phase and every later phase are approved and not stale, "Close ticket"
   asks the maintenance agent for the change report: per step, the run, the changed IDs and the
   files with their diff (from the run backups), plus the final test result. The ticket becomes
   `done`.
6. **Drift ticket.** After "Check again" in the Code tab finds drift, the gate shows "Open drift
   ticket", which creates a `drift` ticket with the drift items in the description. MCP writes
   (already recorded as P7 runs) offer the same.
7. **Phase rail.** P7 shows `awaiting_approval` while a ticket waits for plan approval, `running`
   during triage, `approved` when no ticket is open, `not_started` before the first ticket.
8. **One ticket at a time** in progress; others can be open or triaged. One run per project stays
   the rule.

## Data and interfaces

- `.aise/tickets.json` (zod schema `core/schemas/tickets.ts`):
  `{ id: 'TCK-001', kind: 'change' | 'requirement' | 'bug' | 'drift', title, description,
  status: 'open' | 'triaged' | 'in_progress' | 'done' | 'rejected', createdAt, plan?: { entry:
  'P1' | 'P2' | 'P4' | 'P5', affectedIds: string[], files: string[], steps: string[], direction?:
  'design' | 'code' }, runIds: string[], report?: { at, text, steps: [...] } }`.
- Ticket chat: `.aise/chat/TCK-001.jsonl` (chat file name widened from `PhaseId` to phase or
  ticket ID).
- `RunMeta.ticketId?: string`.
- New tools: `write_ticket_plan` (maintenance agent only, validates IDs against requirements and
  design and files against the project), `read_tickets`.
- `trace` accepts a `TCK` ID: the ticket, its affected IDs with their trace, and its runs.
- New agent `maintenance` (scope row already exists): Opus 5.5 at medium effort (house rule), read
  tools plus `trace`, `detect_drift`, `write_ticket_plan`. It never writes artefacts itself.
- Orchestrator: `createTicket`, `sendTicketMessage`, `approvePlan`, `rejectTicket`,
  `closeTicket`; `snapshot` adds `tickets`. Runs started by Update, Still valid, Apply fix and chat
  while a ticket is `in_progress` get its `ticketId`.
- UI: `TicketsPanel.svelte` (list, form, detail with plan, steps, report), drift button in
  `GatePanel.svelte`, page actions in `src/routes/p/[name]/+page.server.ts`.

## Edge cases

- Discard of the entry run: the ticket goes back to `triaged`.
- Discard of the triage run: the plan is removed, back to `open`.
- Plan names an unknown ID or file: `write_ticket_plan` refuses with the valid IDs.
- Ticket created while another phase is stale: allowed; approve plan is refused until the earlier
  phases are approved and not stale, with the phase to fix named.
- The developer edits requirements by hand during an in progress ticket: the cascade handles it;
  the change report lists what the runs changed only.
- Bug ticket where the new test passes at once: the test agent reports it, the ticket shows "not
  reproduced" and can be rejected or kept with the new test.
- Reject: allowed in `open` and `triaged`; `in_progress` needs Discard of its runs first.

## Tests

- Schema and ID allocation (`TCK-001`, next free, never reuse).
- `write_ticket_plan` validation (unknown ID, unknown file, entry phase).
- Orchestrator: create, triage run with fake model, approve plan per kind sends the right brief to
  the right phase, runs get `ticketId`, close refused while a later phase is stale, discard
  rollbacks, reject rules, P7 status derivation.
- `trace` with a `TCK` ID.
- Component tests for `TicketsPanel` (list, form, plan, steps, report) and the drift button.
- Live smoke: `scripts/smoke-p7.ts` on the to do showcase, one change ticket end to end (costs API
  credit, not in CI).

## Demo script (C2, C7)

1. Requirement ticket: "tasks need a due date", from triage to the plan to the P1 change, then
   Update on P2, P4 and P5, and the change report.
2. Design ticket from a diagram click: "split TaskService".
3. Hand edit in code, Check again, then "Open drift ticket" and a fix in the design direction.
4. Bug ticket: a failing test, Apply fix and a green run (the C7 injected bug).
