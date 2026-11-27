import { readFileSync } from 'node:fs';
import { link, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toolsFor } from '../../mcp/server';
import { createRun, updateRun } from '../runs';
import type { Ticket, TicketKind, TicketPlan } from '../schemas/tickets';
import { ProjectStore } from '../store';
import { addTicket, findTicket, saveTicket } from '../tickets';
import { executeTool } from './index';
import type { ToolContext } from './registry';
import { RUN_ONLY_TOOLS, TOOLS_BY_AGENT } from './scope';

const fixture = (name: string): string =>
	readFileSync(new URL(`../../../../../test/fixtures/${name}`, import.meta.url), 'utf8');

let root: string;
let store: ProjectStore;
let ctx: ToolContext;

const call = (name: string, input: unknown, c = ctx) =>
	executeTool(c, name, input, TOOLS_BY_AGENT.maintenance);
const plan = (over: Partial<TicketPlan> = {}): TicketPlan => ({
	entry: 'P2',
	affectedIds: ['REQ-001', 'UC-001'],
	files: ['src/app.ts'],
	steps: ['Change the design', 'Regenerate the code'],
	...over
});
const ticket = (kind: TicketKind = 'change') =>
	addTicket(store, { kind, title: 'A change', description: 'Details' });
/** A run of the maintenance agent that belongs to the ticket, as the orchestrator creates it. */
async function triageRun(ticketId?: string): Promise<ToolContext> {
	const meta = await createRun(store, 'P7', 'maintenance');
	if (ticketId) await updateRun(store, meta.id, { ticketId });
	return { ...ctx, runId: meta.id, agent: 'maintenance' };
}

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-ticket-tools-'));
	store = new ProjectStore(path.join(root, 'proj'));
	await store.writeFile('.aise/requirements.json', fixture('todo-requirements.json'));
	await store.writeFile('.aise/design.json', fixture('todo-design.json'));
	await store.writeFile('src/app.ts', 'export {};\n');
	ctx = { store, runId: 'read-only-session', projectName: 'todo', agent: 'maintenance' };
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('write_ticket_plan', () => {
	it('saves the plan and triages the ticket in a run that belongs to it', async () => {
		const t = await ticket();
		const c = await triageRun(t.id);
		const r = await call('write_ticket_plan', plan(), c);
		expect(r.isError).toBe(false);
		expect(JSON.parse(r.content)).toEqual({ ok: true, ticket: t.id, entry: 'P2' });
		expect(await findTicket(store, t.id)).toMatchObject({ status: 'triaged', plan: plan() });
	});

	it('takes a second plan for a triaged ticket', async () => {
		const t = await ticket();
		const c = await triageRun(t.id);
		await call('write_ticket_plan', plan(), c);
		const r = await call('write_ticket_plan', plan({ entry: 'P1' }), c);
		expect(r.isError).toBe(false);
		expect((await findTicket(store, t.id))?.plan?.entry).toBe('P1');
	});

	it('refuses a run without a ticket and changes nothing', async () => {
		const t = await ticket();
		const r = await call('write_ticket_plan', plan(), await triageRun());
		expect(r).toEqual({
			content: 'Only a ticket triage run can write a plan.',
			isError: true
		});
		expect(await findTicket(store, t.id)).toMatchObject({ status: 'open' });
		expect((await findTicket(store, t.id))?.plan).toBeUndefined();
	});

	it('refuses a ticket that is not open or triaged and names its status', async () => {
		const t = await ticket();
		const c = await triageRun(t.id);
		for (const status of ['in_progress', 'done', 'rejected'] as const) {
			await saveTicket(store, { ...(await findTicket(store, t.id))!, status });
			const r = await call('write_ticket_plan', plan(), c);
			expect(r.isError).toBe(true);
			expect(r.content).toContain(status);
		}
		expect((await findTicket(store, t.id))?.plan).toBeUndefined();
	});

	it.each<[TicketKind, TicketPlan['entry'], boolean]>([
		['requirement', 'P1', true],
		['requirement', 'P2', false],
		['change', 'P1', true],
		['change', 'P2', true],
		['change', 'P4', false],
		['change', 'P5', false],
		['bug', 'P5', true],
		['bug', 'P2', false],
		['bug', 'P1', false],
		['bug', 'P4', false]
	])('a %s ticket entering at %s is allowed: %s', async (kind, entry, allowed) => {
		const t = await ticket(kind);
		const r = await call('write_ticket_plan', plan({ entry }), await triageRun(t.id));
		expect(r.isError).toBe(!allowed);
		if (!allowed) {
			expect(r.content).toContain(entry);
			expect(r.content).toContain(kind);
		}
	});

	it('refuses a direction for a ticket that is not a drift ticket', async () => {
		const t = await ticket('change');
		const r = await call('write_ticket_plan', plan({ direction: 'design' }), await triageRun(t.id));
		expect(r.isError).toBe(true);
		expect(r.content).toContain('direction');
	});

	it('requires a direction for a drift ticket', async () => {
		const t = await ticket('drift');
		const r = await call('write_ticket_plan', plan({ entry: 'P2' }), await triageRun(t.id));
		expect(r.isError).toBe(true);
		expect(r.content).toContain('direction');
	});

	it.each<[TicketPlan['entry'], 'design' | 'code', boolean]>([
		['P2', 'design', true],
		['P4', 'code', true],
		['P4', 'design', false],
		['P2', 'code', false],
		['P1', 'design', false]
	])(
		'a drift ticket entering at %s with direction %s is allowed: %s',
		async (entry, direction, ok) => {
			const t = await ticket('drift');
			const r = await call('write_ticket_plan', plan({ entry, direction }), await triageRun(t.id));
			expect(r.isError).toBe(!ok);
		}
	);

	it('refuses an unknown ID and lists the valid ones', async () => {
		const t = await ticket();
		const r = await call(
			'write_ticket_plan',
			plan({ affectedIds: ['REQ-001', 'REQ-999'] }),
			await triageRun(t.id)
		);
		expect(r.isError).toBe(true);
		expect(r.content).toContain('REQ-999');
		for (const id of ['REQ-004', 'UC-003', 'SEQ-001', 'DSN-008']) expect(r.content).toContain(id);
	});

	it('refuses an ID that is not a REQ, UC, SEQ or DSN ID', async () => {
		const t = await ticket();
		for (const id of ['ACT-001', 'TCK-001', 'nope'])
			expect(
				(await call('write_ticket_plan', plan({ affectedIds: [id] }), await triageRun(t.id)))
					.isError
			).toBe(true);
	});

	it('refuses a file that does not exist and lists it', async () => {
		const t = await ticket();
		const r = await call(
			'write_ticket_plan',
			plan({ files: ['src/app.ts', 'src/nope.ts'] }),
			await triageRun(t.id)
		);
		expect(r.isError).toBe(true);
		expect(r.content).toContain('src/nope.ts');
		expect(r.content).not.toContain('src/app.ts');
	});

	it('refuses a file the maintenance agent may not read, even when it exists', async () => {
		const t = await ticket();
		await store.writeFile('.aise/state.json', '{}');
		const r = await call(
			'write_ticket_plan',
			plan({ files: ['.aise/state.json'] }),
			await triageRun(t.id)
		);
		expect(r.isError).toBe(true);
		expect(r.content).toContain('.aise/state.json');
		expect((await findTicket(store, t.id))?.status).toBe('open');
	});

	it('refuses a run of any agent but the maintenance agent', async () => {
		const t = await ticket();
		const c = { ...(await triageRun(t.id)), agent: 'code' as const };
		const r = await call('write_ticket_plan', plan(), c);
		expect(r.isError).toBe(true);
		expect((await findTicket(store, t.id))?.status).toBe('open');
	});

	it('refuses a report run, which may only write the report', async () => {
		const t = await ticket();
		const meta = await createRun(store, 'P7', 'maintenance');
		await updateRun(store, meta.id, { ticketId: t.id, report: true });
		const r = await call('write_ticket_plan', plan(), { ...ctx, runId: meta.id });
		expect(r).toEqual({ content: 'A report run can only write the report.', isError: true });
		expect(await findTicket(store, t.id)).toMatchObject({ status: 'open' });
		expect((await findTicket(store, t.id))?.plan).toBeUndefined();
	});

	it('refuses a run whose ticket does not exist', async () => {
		const meta = await createRun(store, 'P7', 'maintenance');
		await updateRun(store, meta.id, { ticketId: 'TCK-042' });
		const r = await call('write_ticket_plan', plan(), { ...ctx, runId: meta.id });
		expect(r).toEqual({ content: 'Unknown ticket: TCK-042.', isError: true });
	});

	it('stores normalised paths and each file and ID once', async () => {
		const t = await ticket();
		await call(
			'write_ticket_plan',
			plan({
				files: ['./src/app.ts', 'src//app.ts', 'src/app.ts'],
				affectedIds: ['REQ-001', 'UC-001', 'REQ-001']
			}),
			await triageRun(t.id)
		);
		const saved = (await findTicket(store, t.id))?.plan;
		expect(saved?.files).toEqual(['src/app.ts']);
		expect(saved?.affectedIds).toEqual(['REQ-001', 'UC-001']);
	});

	describe('files that are not plain project files', () => {
		const outside = () => path.join(root, 'outside.txt');
		beforeEach(async () => {
			await store.writeFile('.env', 'SECRET=1\n');
			await writeFile(outside(), 'outside\n');
			await symlink(path.join(store.dir, '.env'), path.join(store.dir, 'src', 'env-link'));
			await symlink(outside(), path.join(store.dir, 'src', 'out-link'));
			await symlink(path.join(store.dir, '.aise', 'state.json'), path.join(store.dir, 'src', 'st'));
			await store.writeFile('.aise/state.json', '{}');
			await store.writeFile('src/shared.ts', 'export {};\n');
			await link(path.join(store.dir, 'src', 'shared.ts'), path.join(store.dir, 'src', 'hard.ts'));
		});

		it.each([
			'.',
			'',
			'./',
			'src',
			'src/app.ts/x',
			'src/env-link',
			'src/out-link',
			'src/st',
			'src/hard.ts',
			`src/${'a'.repeat(300)}.ts`,
			'../outside.txt',
			'src/../.env',
			'src/../src/app.ts',
			'/etc/passwd',
			'.env'
		])('refuses %j as a correctable error', async (file) => {
			const t = await ticket();
			const r = await call('write_ticket_plan', plan({ files: [file] }), await triageRun(t.id));
			expect(r.isError).toBe(true);
			expect(r.content).toContain('Unknown files');
			expect(r.content).not.toContain(root);
			expect(r.content).not.toContain('outside.txt\n');
			expect((await findTicket(store, t.id))?.status).toBe('open');
		});

		it('names the bad file in the same words whatever is wrong with it', async () => {
			const t = await ticket();
			const msgs = new Set<string>();
			for (const f of ['src/env-link', 'src/nope.ts']) {
				const r = await call('write_ticket_plan', plan({ files: [f] }), await triageRun(t.id));
				msgs.add(r.content.replace(f, 'X'));
			}
			expect(msgs.size).toBe(1);
		});
	});

	it('refuses a plan without steps', async () => {
		const t = await ticket();
		const r = await call('write_ticket_plan', plan({ steps: [] }), await triageRun(t.id));
		expect(r.isError).toBe(true);
	});
});

describe('write_ticket_report', () => {
	/** The run the orchestrator starts to close a ticket: a maintenance run of the ticket marked as a report run. */
	async function reportRun(ticketId: string): Promise<ToolContext> {
		const meta = await createRun(store, 'P7', 'maintenance');
		await updateRun(store, meta.id, { ticketId, report: true });
		return { ...ctx, runId: meta.id, agent: 'maintenance' };
	}

	/** An in progress ticket with one code run that changed a file, and the report run's context. */
	async function inProgress(status: Ticket['status'] = 'in_progress') {
		const t = await ticket();
		await saveTicket(store, { ...t, status, plan: plan() });
		const work = await createRun(store, 'P4', 'code');
		await updateRun(store, work.id, { ticketId: t.id, status: 'done' });
		await store.writeFile('src/app.ts', 'export const a = 1;\n', work.id);
		return { t, work, c: await reportRun(t.id) };
	}

	it('saves the text with the change data and closes the ticket', async () => {
		const { t, work, c } = await inProgress();
		const r = await call('write_ticket_report', { text: '  Changed the app.\n' }, c);
		expect(r.isError).toBe(false);
		expect(JSON.parse(r.content)).toEqual({ ok: true, ticket: t.id });
		const saved = await findTicket(store, t.id);
		expect(saved?.status).toBe('done');
		expect(saved?.plan).toEqual(plan());
		expect(saved?.report).toMatchObject({
			text: 'Changed the app.',
			steps: [{ runId: work.id, phase: 'P4', agent: 'code', files: ['src/app.ts'] }],
			changedIds: [],
			tests: null
		});
		expect(saved?.report?.files.map((f) => f.path)).toEqual(['src/app.ts']);
		expect(saved?.report?.files[0].diff).toContain('+export const a = 1;');
		expect(new Date(saved!.report!.at).toISOString()).toBe(saved!.report!.at);
	});

	it.each(['open', 'triaged', 'done', 'rejected'] as const)(
		'refuses a %s ticket, names its status and changes nothing',
		async (status) => {
			const { t, c } = await inProgress(status);
			const before = await findTicket(store, t.id);
			const r = await call('write_ticket_report', { text: 'Report' }, c);
			expect(r.isError).toBe(true);
			expect(r.content).toContain(status);
			expect(await findTicket(store, t.id)).toEqual(before);
		}
	);

	it('refuses a run without a ticket', async () => {
		const { t } = await inProgress();
		const r = await call('write_ticket_report', { text: 'Report' }, await triageRun());
		expect(r).toEqual({
			content: 'Only a ticket report run can write a report.',
			isError: true
		});
		expect((await findTicket(store, t.id))?.status).toBe('in_progress');
	});

	it.each(['P7', 'P4'] as const)(
		'refuses a maintenance run of the ticket that is not a report run (phase %s)',
		async (phase) => {
			const { t } = await inProgress();
			const meta = await createRun(store, phase, 'maintenance');
			await updateRun(store, meta.id, { ticketId: t.id });
			const r = await call('write_ticket_report', { text: 'Report' }, { ...ctx, runId: meta.id });
			expect(r).toEqual({
				content: 'Only a ticket report run can write a report.',
				isError: true
			});
			expect(await findTicket(store, t.id)).toMatchObject({ status: 'in_progress' });
			expect((await findTicket(store, t.id))?.report).toBeUndefined();
		}
	);

	it('refuses a report run that belongs to no ticket', async () => {
		const { t } = await inProgress();
		const meta = await createRun(store, 'P7', 'maintenance');
		await updateRun(store, meta.id, { report: true });
		const r = await call('write_ticket_report', { text: 'Report' }, { ...ctx, runId: meta.id });
		expect(r).toEqual({
			content: 'Only a ticket report run can write a report.',
			isError: true
		});
		expect((await findTicket(store, t.id))?.status).toBe('in_progress');
	});

	it('refuses a run of any agent but the maintenance agent', async () => {
		const { t, c } = await inProgress();
		const r = await call('write_ticket_report', { text: 'Report' }, { ...c, agent: 'code' });
		expect(r.isError).toBe(true);
		expect((await findTicket(store, t.id))?.status).toBe('in_progress');
	});

	it('refuses a run whose ticket does not exist', async () => {
		const meta = await createRun(store, 'P7', 'maintenance');
		await updateRun(store, meta.id, { ticketId: 'TCK-042', report: true });
		const r = await call('write_ticket_report', { text: 'Report' }, { ...ctx, runId: meta.id });
		expect(r).toEqual({ content: 'Unknown ticket: TCK-042.', isError: true });
	});

	it.each([{ text: '' }, { text: '   \n' }, {}, { text: 'ok', files: [] }])(
		'refuses the input %j',
		async (input) => {
			const { t, c } = await inProgress();
			expect((await call('write_ticket_report', input, c)).isError).toBe(true);
			expect((await findTicket(store, t.id))?.status).toBe('in_progress');
		}
	);
});

describe('read_tickets', () => {
	const withReport = async () => {
		const t = await ticket();
		await saveTicket(store, {
			...t,
			status: 'done',
			report: {
				at: '2026-11-22T10:00:00.000Z',
				text: 'Done',
				steps: [],
				changedIds: ['REQ-001'],
				files: [{ path: 'src/app.ts', diff: '-a\n+b' }],
				tests: null
			}
		});
		return t;
	};

	it('lists all tickets without the file diffs', async () => {
		const t = await withReport();
		const second = await ticket();
		const r = JSON.parse((await call('read_tickets', {})).content);
		expect(r.map((x: { id: string }) => x.id)).toEqual([t.id, second.id]);
		expect(r[0].report.files).toEqual([{ path: 'src/app.ts' }]);
		expect(r[0].report.text).toBe('Done');
	});

	it('gives one ticket in full', async () => {
		const t = await withReport();
		const r = JSON.parse((await call('read_tickets', { id: t.id })).content);
		expect(r.report.files).toEqual([{ path: 'src/app.ts', diff: '-a\n+b' }]);
	});

	it('names the known IDs for an unknown ticket', async () => {
		const t = await ticket();
		const r = await call('read_tickets', { id: 'TCK-009' });
		expect(r.isError).toBe(true);
		expect(r.content).toContain('TCK-009');
		expect(r.content).toContain(t.id);
	});

	it('refuses a malformed ID', async () => {
		expect((await call('read_tickets', { id: 'TCK-9' })).isError).toBe(true);
	});
});

describe('tool lists', () => {
	it('gives the maintenance agent the ticket tools', () => {
		expect(TOOLS_BY_AGENT.maintenance).toEqual(
			expect.arrayContaining(['read_tickets', 'write_ticket_plan', 'write_ticket_report'])
		);
	});

	it('gives no other agent a ticket write tool', () => {
		for (const [agent, names] of Object.entries(TOOLS_BY_AGENT))
			if (agent !== 'maintenance') {
				expect(names).not.toContain('write_ticket_plan');
				expect(names).not.toContain('write_ticket_report');
			}
	});

	it('keeps the run bound ticket tools out of every MCP session', () => {
		expect(RUN_ONLY_TOOLS).toEqual(
			expect.arrayContaining(['write_ticket_plan', 'write_ticket_report'])
		);
		for (const agent of ['maintenance', 'mcp'] as const) {
			expect(toolsFor(agent)).toContain('read_tickets');
			expect(toolsFor(agent)).not.toContain('write_ticket_plan');
			expect(toolsFor(agent)).not.toContain('write_ticket_report');
		}
	});
});
