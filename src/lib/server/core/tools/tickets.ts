import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { DesignDoc } from '../schemas/design';
import { RequirementsDoc } from '../schemas/requirements';
import {
	TicketId,
	TicketPlan,
	type EntryPhase,
	type Ticket,
	type TicketKind
} from '../schemas/tickets';
import { readRun } from '../runs';
import type { ProjectStore } from '../store';
import { findTicket, readTickets, saveTicket } from '../tickets';
import { reportData } from '../ticket-report';
import { DESIGN_PATH } from './design';
import { defineTool, ToolError, type ToolContext } from './registry';
import { REQUIREMENTS_PATH } from './requirements';
import { safePath } from './files';
import { normalise } from './scope';

/** Entry phases a ticket kind may start at (Deviation 8 of the plan); a drift ticket also needs a direction. */
const ENTRY: Record<TicketKind, readonly EntryPhase[]> = {
	requirement: ['P1'],
	change: ['P1', 'P2'],
	bug: ['P5'],
	drift: ['P2', 'P4']
};
const DRIFT_ENTRY: Record<NonNullable<TicketPlan['direction']>, EntryPhase> = {
	design: 'P2',
	code: 'P4'
};

const list = (ids: string[]) => ids.join(', ');
const unique = <T>(xs: T[]) => [...new Set(xs)];

/**
 * True for a plain file inside the project that the maintenance agent may read. Anything else
 * (a folder, a missing file, a link that leaves the project or the scope, a hard link, an odd
 * path) is false, so every case gets the same answer and nothing is learnt about link targets.
 */
async function isReadableFile(ctx: ToolContext, rel: string): Promise<boolean> {
	let abs: string;
	try {
		abs = await safePath(ctx, rel, 'read');
	} catch (e) {
		if (e instanceof ToolError) return false;
		throw e;
	}
	try {
		const s = await stat(abs);
		return s.isFile() && s.nlink === 1;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw e;
	}
}

/** Every REQ, UC, SEQ and DSN ID in the stored requirements and design, sorted. */
async function knownIds(store: ProjectStore): Promise<string[]> {
	const reqs = await store.readJson(REQUIREMENTS_PATH, RequirementsDoc);
	const d = await store.readJson(DESIGN_PATH, DesignDoc);
	return [
		...(reqs?.requirements ?? []).map((r) => r.id),
		...(d?.useCases ?? []).map((x) => x.id),
		...(d?.sequences ?? []).map((x) => x.id),
		...(d?.classes ?? []).map((x) => x.id),
		...(d?.components ?? []).map((x) => x.id),
		...(d?.nodes ?? []).map((x) => x.id)
	].sort();
}

export const readTicketsTool = defineTool({
	name: 'read_tickets',
	description:
		'Read the tickets of this project. Without an ID: all tickets, with the file diffs of their reports left out. With an ID: that ticket in full.',
	input: z.strictObject({ id: TicketId.optional().describe('Ticket ID, e.g. "TCK-001"') }),
	async run({ store }, { id }) {
		const all = await readTickets(store);
		if (id === undefined)
			return all.map((t: Ticket) =>
				t.report
					? { ...t, report: { ...t.report, files: t.report.files.map((f) => ({ path: f.path })) } }
					: t
			);
		const t = all.find((x) => x.id === id);
		if (!t)
			throw new ToolError(
				`${id} is not a ticket. Known tickets: ${all.length ? list(all.map((x) => x.id)) : 'none'}.`
			);
		return t;
	}
});

export const writeTicketPlan = defineTool({
	name: 'write_ticket_plan',
	description:
		'Save the plan for the ticket of this run and mark it triaged. Give the entry phase (requirement: P1; change: P1 or P2; bug: P5; drift: P2 with direction "design", or P4 with direction "code"), the IDs it affects (REQ, UC, SEQ or DSN IDs that exist), the project files it affects (that exist) and the steps in plain words. New requirements or design elements go into the steps, not into affectedIds. Every problem is returned, so nothing is saved until the plan is consistent.',
	input: z.strictObject(TicketPlan.shape),
	async run(ctx, input) {
		const { store, runId } = ctx;
		if (ctx.agent !== 'maintenance')
			throw new ToolError('Only the maintenance agent can write a ticket plan.');
		const run = await readRun(store, runId);
		const ticketId = run?.ticketId;
		if (!ticketId) throw new ToolError('Only a ticket triage run can write a plan.');
		// The flag is set by the orchestrator when it starts the close run, never from anything the model or the developer writes.
		if (run.report) throw new ToolError('A report run can only write the report.');
		const ticket = await findTicket(store, ticketId);
		if (!ticket) throw new ToolError(`Unknown ticket: ${ticketId}.`);
		if (ticket.status !== 'open' && ticket.status !== 'triaged')
			throw new ToolError(
				`${ticket.id} is ${ticket.status}; only an open or triaged ticket can get a plan.`
			);

		const problems: string[] = [];
		if (!ENTRY[ticket.kind].includes(input.entry))
			problems.push(
				`A ${ticket.kind} ticket cannot enter at ${input.entry}; use ${ENTRY[ticket.kind].join(' or ')}.`
			);
		if (ticket.kind === 'drift') {
			if (!input.direction)
				problems.push(
					'A drift ticket needs a direction: "design" (enter at P2) or "code" (enter at P4).'
				);
			else if (DRIFT_ENTRY[input.direction] !== input.entry)
				problems.push(
					`Direction "${input.direction}" enters at ${DRIFT_ENTRY[input.direction]}, not ${input.entry}.`
				);
		} else if (input.direction) {
			problems.push(
				`direction is only for drift tickets, but ${ticket.id} is a ${ticket.kind} ticket.`
			);
		}

		const known = await knownIds(store);
		const affectedIds = unique(input.affectedIds);
		const badIds = affectedIds.filter((id) => !known.includes(id));
		if (badIds.length)
			problems.push(
				`Unknown IDs in affectedIds: ${list(badIds)}. Only existing REQ, UC, SEQ and DSN IDs are allowed; describe new ones in the steps. Valid IDs: ${known.length ? list(known) : 'none'}.`
			);

		// Checked as given (safePath rejects `..` on the raw path), stored normalised; errors name the input.
		const files = unique(input.files.map(normalise));
		const badFiles = [];
		for (const f of input.files) if (!(await isReadableFile(ctx, f))) badFiles.push(f);
		if (badFiles.length)
			problems.push(
				`Unknown files: ${list(badFiles)}. Name existing project files (see list_files), not .aise/ or secrets.`
			);

		if (problems.length) throw new ToolError(problems.join('\n'));
		await saveTicket(store, {
			...ticket,
			status: 'triaged',
			plan: { ...input, affectedIds, files }
		});
		return { ok: true, ticket: ticket.id, entry: input.entry };
	}
});

export const writeTicketReport = defineTool({
	name: 'write_ticket_report',
	description:
		'Save the report text for the ticket of this run and close the ticket. Write the text in plain prose for the developer: what was asked, what changed and why, and what to look at. The steps, changed IDs, file diffs and test result are added from the ticket runs; do not repeat them.',
	input: z.strictObject({
		text: z.string().trim().min(1).describe('The report in plain prose')
	}),
	async run({ store, runId, agent }, { text }) {
		if (agent !== 'maintenance')
			throw new ToolError('Only the maintenance agent can write a ticket report.');
		// A chat run of the ticket has a ticketId too; only the close run, which the orchestrator starts after the walk check, is marked.
		const run = await readRun(store, runId);
		if (!run?.ticketId || !run.report)
			throw new ToolError('Only a ticket report run can write a report.');
		const ticket = await findTicket(store, run.ticketId);
		if (!ticket) throw new ToolError(`Unknown ticket: ${run.ticketId}.`);
		if (ticket.status !== 'in_progress')
			throw new ToolError(
				`${ticket.id} is ${ticket.status}; only an in progress ticket can get a report.`
			);
		const report = { at: new Date().toISOString(), text, ...(await reportData(store, ticket.id)) };
		await saveTicket(store, { ...ticket, status: 'done', report });
		return { ok: true, ticket: ticket.id };
	}
});
