import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codeHash } from '../code-state';
import { GENERATED_HEADER, traceMarkdown } from '../render/markdown';
import { DesignDoc } from '../schemas/design';
import { RequirementsDoc } from '../schemas/requirements';
import type { TicketPlan } from '../schemas/tickets';
import { createRun, updateRun } from '../runs';
import { ProjectStore } from '../store';
import { testHash, writeTestChecks } from '../test-state';
import type { MatrixRow } from '../trace';
import { addTicket, saveTicket } from '../tickets';
import { executeTool } from './index';
import type { ToolContext } from './registry';
import { TOOLS_BY_AGENT } from './scope';
import { writeTraceDoc } from './trace';

let root: string;
let ctx: ToolContext;
const call = (input: unknown, allowed = TOOLS_BY_AGENT.maintenance) =>
	executeTool(ctx, 'trace', input, allowed);

const reqs: RequirementsDoc = {
	requirements: [
		{
			id: 'REQ-001',
			title: 'Add task',
			text: 'A user can add a task.',
			type: 'functional',
			priority: 'must',
			acceptanceCriteria: ['a task is stored']
		},
		{
			id: 'REQ-002',
			title: 'Export | CSV',
			text: 'Tasks export as CSV.',
			type: 'functional',
			priority: 'could',
			acceptanceCriteria: ['a file is offered']
		}
	],
	openQuestions: [],
	assumptions: [],
	outOfScope: []
};

const design: DesignDoc = {
	actors: [],
	useCases: [
		{ id: 'UC-001', name: 'Add task', description: '', actorIds: [], reqIds: ['REQ-001'] }
	],
	classes: [
		{
			id: 'DSN-001',
			name: 'TaskService',
			kind: 'class',
			description: '',
			attributes: [],
			methods: [],
			values: [],
			relations: [],
			reqIds: ['REQ-001']
		}
	],
	components: [],
	nodes: [],
	links: [],
	sequences: []
};

const SERVICE = '/** @trace DSN-001 REQ-001 */\nexport class TaskService {}\n';

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-trace-'));
	const store = new ProjectStore(path.join(root, 'proj'));
	const run = await createRun(store, 'P7', 'maintenance');
	ctx = { store, runId: run.id, projectName: 'todo', agent: 'maintenance' };
	await store.writeJson('.aise/requirements.json', RequirementsDoc, reqs);
	await store.writeJson('.aise/design.json', DesignDoc, design);
	await store.writeFile('src/tasks/TaskService.ts', SERVICE);
	await store.writeFile('test/UC-001.test.ts', '// test\n');
	await writeTestChecks(store, {
		at: '2026-11-21T10:00:00.000Z',
		codeHash: await codeHash(store),
		testHash: await testHash(store),
		typecheck: null,
		result: {
			ok: true,
			passed: 1,
			failed: 0,
			timedOut: false,
			logTail: '',
			tests: [
				{
					name: 'UC-001 Add task REQ-001 AC1: a task is stored',
					title: 'REQ-001 AC1: a task is stored',
					file: 'test/UC-001.test.ts',
					status: 'passed',
					line: 4
				}
			]
		},
		findings: [],
		testFixes: []
	});
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('trace tool', () => {
	it('is offered to the code and maintenance agents only among the in process agents', () => {
		const offered = Object.entries(TOOLS_BY_AGENT)
			.filter(([, tools]) => tools.includes('trace'))
			.map(([agent]) => agent);
		expect(offered).toEqual(['code', 'maintenance']);
	});

	it('traces an ID through the stored requirements, design, code and P5 results', async () => {
		const r = await call({ id: 'REQ-001' });
		expect(r.isError).toBe(false);
		expect(JSON.parse(r.content)).toMatchObject({
			id: 'REQ-001',
			kind: 'requirement',
			design: { useCases: ['UC-001'], classes: ['DSN-001'] },
			code: [{ file: 'src/tasks/TaskService.ts', line: 2, name: 'TaskService' }],
			tests: [{ file: 'test/UC-001.test.ts', line: 4, status: 'passed' }],
			testsAt: '2026-11-21T10:00:00.000Z',
			testsOutOfDate: false
		});
	});

	it('reads public/index.html as the code of a client component', async () => {
		await ctx.store.writeJson('.aise/design.json', DesignDoc, {
			...design,
			components: [{ id: 'DSN-002', name: 'Page', classIds: [], nodeId: 'DSN-003', reqIds: [] }],
			nodes: [{ id: 'DSN-003', name: 'Browser', kind: 'client', reqIds: [] }]
		});
		expect(JSON.parse((await call({ id: 'DSN-002' })).content).code).toEqual([]);
		await ctx.store.writeFile('public/index.html', '<head>\n<!-- @trace DSN-002 -->\n');
		expect(JSON.parse((await call({ id: 'DSN-002' })).content).code).toEqual([
			{ file: 'public/index.html', line: 2, name: 'Page' }
		]);
	});

	it('returns the matrix without an ID', async () => {
		const out = JSON.parse((await call({})).content);
		expect(out.requirements.map((r: MatrixRow) => [r.reqId, r.noDesign, r.noTest])).toEqual([
			['REQ-001', false, false],
			['REQ-002', true, true]
		]);
	});

	it('marks the stored test results out of date after a code change', async () => {
		await ctx.store.writeFile('src/tasks/TaskService.ts', SERVICE + '// edit\n');
		expect(JSON.parse((await call({})).content).testsOutOfDate).toBe(true);
	});

	it('refuses a malformed ID and names an unknown one', async () => {
		const bad = await call({ id: 'task-1' });
		expect(bad.isError).toBe(true);
		expect(bad.content).toMatch(/^id: .*REQ, UC, SEQ, DSN, ACT or TCK/);
		const unknown = await call({ id: 'UC-009' });
		expect(unknown).toEqual({
			content: 'UC-009 is not in the requirements or the design.',
			isError: true
		});
	});

	it('works on an empty project', async () => {
		const store = new ProjectStore(path.join(root, 'empty'));
		ctx = { ...ctx, store };
		expect(JSON.parse((await call({})).content)).toEqual({
			requirements: [],
			testsAt: null,
			testsOutOfDate: false
		});
	});
});

describe('trace of a ticket', () => {
	const plan: TicketPlan = {
		entry: 'P1',
		affectedIds: ['REQ-001'],
		files: [],
		steps: ['Add a due date']
	};

	/** A triaged ticket whose plan names `affectedIds`. */
	async function triagedTicket(affectedIds: string[]): Promise<string> {
		const t = await addTicket(ctx.store, {
			kind: 'change',
			title: 'Add a due date',
			description: 'Tasks get a due date.'
		});
		await saveTicket(ctx.store, { ...t, status: 'triaged', plan: { ...plan, affectedIds } });
		return t.id;
	}

	/** A finished P1 run, belonging to `ticketId` when given. */
	async function runFor(ticketId: string | undefined, summary: string): Promise<string> {
		const run = await createRun(ctx.store, 'P1', 'requirements');
		await updateRun(ctx.store, run.id, {
			...(ticketId ? { ticketId } : {}),
			status: 'done',
			summary
		});
		return run.id;
	}

	it('traces the IDs of the plan, with the ticket and its own runs only', async () => {
		const id = await triagedTicket(['REQ-001']);
		const mine = await runFor(id, 'Added a due date to REQ-001');
		await runFor('TCK-002', 'Another ticket');
		await runFor(undefined, 'Not a ticket');
		const r = await call({ id });
		expect(r.isError).toBe(false);
		const out = JSON.parse(r.content);
		expect(out.ticket).toEqual({
			id,
			kind: 'change',
			title: 'Add a due date',
			status: 'triaged',
			plan: { ...plan, affectedIds: ['REQ-001'] }
		});
		expect(out.affected).toMatchObject([
			{
				id: 'REQ-001',
				kind: 'requirement',
				requirements: ['REQ-001'],
				design: { useCases: ['UC-001'], classes: ['DSN-001'] },
				code: [{ file: 'src/tasks/TaskService.ts', line: 2, name: 'TaskService' }]
			}
		]);
		expect(out.runs).toEqual([
			{
				id: mine,
				phase: 'P1',
				agent: 'requirements',
				status: 'done',
				summary: 'Added a due date to REQ-001'
			}
		]);
		expect(out).toMatchObject({
			testsAt: '2026-11-21T10:00:00.000Z',
			testsOutOfDate: false
		});
	});

	it('has no affected IDs before a plan exists', async () => {
		const t = await addTicket(ctx.store, { kind: 'change', title: 'Later', description: '' });
		const r = await call({ id: t.id });
		expect(r.isError).toBe(false);
		expect(JSON.parse(r.content).affected).toEqual([]);
	});

	it('skips a plan ID that no longer exists', async () => {
		const id = await triagedTicket(['REQ-001', 'REQ-999']);
		const r = await call({ id });
		expect(r.isError).toBe(false);
		expect(JSON.parse(r.content).affected.map((a: { id: string }) => a.id)).toEqual(['REQ-001']);
	});

	it('lists the runs in the order they started, not the order they were created', async () => {
		const id = await triagedTicket(['REQ-001']);
		const firstRun = await runFor(id, 'first');
		const secondRun = await runFor(id, 'second');
		await updateRun(ctx.store, firstRun, { startedAt: '2026-11-21T12:00:00.000Z' });
		await updateRun(ctx.store, secondRun, { startedAt: '2026-11-21T11:00:00.000Z' });
		const out = JSON.parse((await call({ id })).content);
		expect(out.runs.map((r: { id: string }) => r.id)).toEqual([secondRun, firstRun]);
	});

	it('names the known tickets when the ID is unknown', async () => {
		const t = await addTicket(ctx.store, { kind: 'change', title: 'Later', description: '' });
		expect(await call({ id: 'TCK-009' })).toEqual({
			content: `TCK-009 is not a ticket. Known tickets: ${t.id}.`,
			isError: true
		});
	});
});

describe('traceMarkdown and writeTraceDoc', () => {
	it('renders one table row per requirement with gaps and escaped cells', () => {
		const md = traceMarkdown(
			[
				{
					reqId: 'REQ-001',
					title: 'Add task',
					design: ['UC-001', 'DSN-001'],
					files: ['src/a.ts', 'src/b.ts'],
					tests: [
						{ name: 'a', status: 'passed' },
						{ name: 'b', status: 'failed' },
						{ name: 'c', status: 'passed' }
					],
					noDesign: false,
					noTest: false
				},
				{
					reqId: 'REQ-002',
					title: 'Export | CSV',
					design: [],
					files: [],
					tests: [],
					noDesign: true,
					noTest: true
				}
			],
			'todo',
			{ at: '2026-11-21T10:00:00.000Z', outOfDate: true }
		);
		expect(md).toBe(
			[
				GENERATED_HEADER,
				'',
				'# todo: traceability',
				'',
				'Test results from 2026-11-21T10:00:00.000Z (out of date: code or tests changed since).',
				'',
				'| Requirement | Design | Code | Tests | Gaps |',
				'| --- | --- | --- | --- | --- |',
				'| REQ-001 Add task | UC-001, DSN-001 | src/a.ts, src/b.ts | 2 passed, 1 failed | none |',
				'| REQ-002 Export \\| CSV | none | none | none | no design, no test |',
				''
			].join('\n')
		);
	});

	it('escapes backslashes before pipes and keeps the title on one line', () => {
		const row = {
			reqId: 'REQ-001',
			title: 'a\\|b',
			design: [],
			files: [],
			tests: [],
			noDesign: true,
			noTest: true
		};
		const md = traceMarkdown([row], 'to\ndo', null);
		expect(md).toContain('| REQ-001 a\\\\\\|b | none |');
		expect(md).toContain('# to do: traceability');
	});

	it('says when no tests have run', () => {
		expect(traceMarkdown([], 'todo', null)).toContain('No test results yet.');
	});

	it('writes docs/trace.md from the stored artefacts', async () => {
		await writeTraceDoc(ctx);
		const md = await readFile(ctx.store.resolve('docs/trace.md'), 'utf8');
		expect(md).toContain(
			'| REQ-001 Add task | UC-001, DSN-001 | src/tasks/TaskService.ts | 1 passed | none |'
		);
		expect(md).toContain('Test results from 2026-11-21T10:00:00.000Z.');
	});
});
