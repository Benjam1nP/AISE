import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { designHash } from '../code-state';
import { GENERATED_HEADER } from '../render/markdown';
import { createRun } from '../runs';
import { ProjectStore } from '../store';
import { readRunFindings } from '../test-state';
import { anthropicTools, executeTool, TOOLS } from './index';
import type { ToolContext } from './registry';
import { TOOLS_BY_AGENT } from './scope';

const fixture = (name: string): Record<string, unknown> =>
	JSON.parse(
		readFileSync(new URL(`../../../../../test/fixtures/${name}`, import.meta.url), 'utf8')
	);

let root: string;
let ctx: ToolContext;
const all = Object.keys(TOOLS);
const run = (name: string, input: unknown, allowed = all) => executeTool(ctx, name, input, allowed);
const text = (rel: string) => readFile(ctx.store.resolve(rel), 'utf8');

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-tools-'));
	const store = new ProjectStore(path.join(root, 'proj'));
	const meta = await createRun(store, 'P2', 'design');
	ctx = { store, runId: meta.id, projectName: 'todo', agent: 'design' };
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('executeTool', () => {
	it('refuses tools the agent is not allowed to use', async () => {
		const r = await run('update_design', fixture('todo-design.json'), ['read_design']);
		expect(r).toEqual({
			content: 'Tool "update_design" is not available to this agent.',
			isError: true
		});
		expect(await ctx.store.exists('.aise/design.json')).toBe(false);
	});

	it('refuses unknown tools', async () => {
		const r = await run('nope', {});
		expect(r.isError).toBe(true);
		expect(r.content).toContain('"nope" is not available');
	});

	it('returns schema errors as path: message lines', async () => {
		const doc = fixture('todo-requirements.json') as { requirements: Record<string, unknown>[] };
		doc.requirements[0].priority = 'high';
		const r = await run('write_requirements', doc);
		expect(r.isError).toBe(true);
		expect(r.content).toMatch(/^requirements\[0\]\.priority: /m);
		expect(await ctx.store.exists('.aise/requirements.json')).toBe(false);
	});

	it('rethrows unexpected errors', async () => {
		await ctx.store.writeFile('.aise/requirements.json', '{not json');
		await expect(run('read_requirements', {})).rejects.toThrow();
	});
});

describe('requirements tools', () => {
	it('read_requirements gives null before anything is written', async () => {
		expect(await run('read_requirements', {})).toEqual({ content: 'null', isError: false });
	});

	it('writes json and markdown, then reads the document back', async () => {
		const requirements = fixture('todo-requirements.json');
		const w = await run('write_requirements', requirements);
		expect(w.isError).toBe(false);
		expect(JSON.parse(w.content)).toMatchObject({ ok: true, openQuestions: expect.any(Number) });
		expect(JSON.parse(await text('.aise/requirements.json'))).toEqual(requirements);
		expect((await text('docs/requirements.md')).startsWith(GENERATED_HEADER)).toBe(true);
		const r = await run('read_requirements', {});
		expect(JSON.parse(r.content)).toEqual(requirements);
	});
});

describe('design tools', () => {
	it('rejects a broken sequence reference and writes nothing', async () => {
		await run('write_requirements', fixture('todo-requirements.json'));
		const design = fixture('todo-design.json') as {
			classes: { name: string; methods: { name: string }[] }[];
		};
		design.classes
			.find((c) => c.name === 'TaskService')!
			.methods.find((m) => m.name === 'addTask')!.name = 'createTask';
		const r = await run('update_design', design);
		expect(r.isError).toBe(true);
		expect(r.content).toContain('sequences[0].messages[1].method');
		expect(await ctx.store.exists('.aise/design.json')).toBe(false);
		expect(await ctx.store.exists('docs/design.md')).toBe(false);
	});

	it('writes the normalised design and a generated markdown file', async () => {
		const design = fixture('todo-design.json');
		const w = await run('update_design', design);
		expect(w.isError).toBe(false);
		expect(JSON.parse(w.content)).toMatchObject({ ok: true, issues: 0 });
		const md = await text('docs/design.md');
		expect(md.startsWith(GENERATED_HEADER)).toBe(true);
		expect(md).toContain('todo');
		const stored = JSON.parse(await text('.aise/design.json'));
		expect(JSON.stringify(stored)).toContain('Promise<Task[]>');
		expect(JSON.parse((await run('read_design', {})).content)).toEqual(stored);
	});

	it('backs up the previous design when a run overwrites it', async () => {
		const design = fixture('todo-design.json');
		await ctx.store.writeFile('.aise/design.json', '{"old":true}\n');
		await run('update_design', design);
		const backup = await text(`.aise/runs/${ctx.runId}/backup/.aise/design.json`);
		expect(backup).toBe('{"old":true}\n');
	});

	it('requires links in the update_design input, unlike a design read from disk', async () => {
		const design = fixture('todo-design.json');
		delete design.links;
		const r = await run('update_design', design);
		expect(r.isError).toBe(true);
		expect(r.content).toContain('links');
		const schema = anthropicTools(['update_design'])[0].input_schema as { required?: string[] };
		expect(schema.required).toContain('links');
	});

	it('names the next free IDs, counting the saved design, and returns warnings after a save', async () => {
		const design = fixture('todo-design.json') as {
			nodes: Record<string, unknown>[];
			classes: Record<string, unknown>[];
			components: { classIds: string[]; nodeId: string }[];
		};
		design.nodes.push({ id: 'DSN-009', name: 'Spare', kind: 'service', reqIds: [] });
		await run('update_design', design);
		// deleting that node frees the highest DSN
		design.nodes = design.nodes.filter((n) => n.id !== 'DSN-009');
		design.classes.push({
			id: 'DSN-010',
			name: 'UserRepository',
			kind: 'class',
			description: '',
			attributes: [],
			methods: [],
			relations: [],
			reqIds: []
		});
		design.components[0].classIds.push('DSN-010');
		const w = JSON.parse((await run('update_design', design)).content);
		expect(w.nextIds).toEqual({ ACT: 'ACT-003', UC: 'UC-004', SEQ: 'SEQ-002', DSN: 'DSN-011' });
		expect(w.warnings).toEqual([
			'classes[5]: class DSN-010 UserRepository has no attributes or methods; give it members or remove it'
		]);

		// a duplicate ID fails and the error names the next free IDs
		(design.classes[5] as { id: string }).id = 'DSN-007';
		const r = await run('update_design', design);
		expect(r.isError).toBe(true);
		expect(r.content).toContain('duplicate ID "DSN-007"');
		expect(r.content).toContain(
			'Next free IDs for new elements: ACT-003, UC-004, SEQ-002, DSN-011'
		);
	});

	it('checks requirement IDs against the stored requirements', async () => {
		await run('write_requirements', fixture('todo-requirements.json'));
		const design = fixture('todo-design.json') as { classes: { reqIds: string[] }[] };
		design.classes[0].reqIds = ['REQ-099'];
		const r = await run('update_design', design);
		expect(r.isError).toBe(true);
		expect(r.content).toContain('classes[0].reqIds[0]: unknown requirement "REQ-099"');
	});
});

describe('report_coverage', () => {
	type Row = Record<string, unknown>;
	const viaClass = (n: number, reqId: string, classId: string, method: string): Row => ({
		reqId,
		criterion: n,
		coveredBy: [{ classId, method }]
	});
	/** A row for every criterion of the functional todo requirements. */
	const fullRows = (): Row[] => [
		viaClass(1, 'REQ-001', 'DSN-003', 'addTask'),
		{ reqId: 'REQ-001', criterion: 2, coveredBy: [{ sequenceId: 'SEQ-001', step: 2 }] },
		viaClass(1, 'REQ-002', 'DSN-003', 'listTasks'),
		viaClass(2, 'REQ-002', 'DSN-004', 'findAll'),
		viaClass(1, 'REQ-004', 'DSN-003', 'completeTask')
	];
	const seed = async () => {
		await run('write_requirements', fixture('todo-requirements.json'));
		await run('update_design', fixture('todo-design.json'));
	};
	const coverage = (rows: Row[]) => run('report_coverage', { rows });

	it('stores the rows with the design hash and returns no gaps for a full report', async () => {
		await seed();
		const r = await coverage(fullRows());
		expect(r.isError).toBe(false);
		expect(JSON.parse(r.content)).toEqual({ ok: true, rows: 5, uncovered: [] });
		const stored = JSON.parse(await text('.aise/design-review.json'));
		expect(stored.rows).toEqual(fullRows());
		expect(stored.designHash).toBe(designHash(JSON.parse(await text('.aise/design.json'))));
	});

	it('returns criteria without cover with their text and still stores the report', async () => {
		await seed();
		const rows = fullRows();
		rows[3] = { reqId: 'REQ-002', criterion: 2, coveredBy: [], note: 'No ordering in the design' };
		const r = await coverage(rows);
		expect(r.isError).toBe(false);
		expect(JSON.parse(r.content).uncovered).toEqual([
			'REQ-002 AC2: Tasks are ordered by creation time, newest first.'
		]);
		expect(await ctx.store.exists('.aise/design-review.json')).toBe(true);
	});

	it('accepts a non functional row without cover when it has a note, and counts it uncovered without', async () => {
		await seed();
		const withNote = { reqId: 'REQ-003', criterion: 1, coveredBy: [], note: 'Needs the database' };
		const ok = await coverage([...fullRows(), withNote]);
		expect(JSON.parse(ok.content).uncovered).toEqual([]);
		const bare = await coverage([...fullRows(), { ...withNote, note: undefined }]);
		expect(JSON.parse(bare.content).uncovered).toEqual([
			'REQ-003 AC1: Tasks added before a restart are listed after the restart.'
		]);
	});

	it('returns every problem at once and stores nothing', async () => {
		await seed();
		const rows = fullRows().slice(1, 4);
		rows.push(
			viaClass(1, 'REQ-009', 'DSN-003', 'addTask'),
			viaClass(7, 'REQ-001', 'DSN-003', 'addTask'),
			viaClass(1, 'REQ-004', 'DSN-099', 'x'),
			viaClass(1, 'REQ-004', 'DSN-003', 'nope'),
			{ reqId: 'REQ-004', criterion: 1, coveredBy: [{ sequenceId: 'SEQ-009', step: 1 }] },
			{ reqId: 'REQ-004', criterion: 1, coveredBy: [{ sequenceId: 'SEQ-001', step: 4 }] }
		);
		const r = await coverage(rows);
		expect(r.isError).toBe(true);
		for (const part of [
			'rows[3].reqId: unknown requirement "REQ-009"',
			'rows[4].criterion: REQ-001 has 2 criteria, not 7',
			'rows[5].coveredBy[0].classId: unknown class "DSN-099"',
			'rows[6].coveredBy[0].method: DSN-003 (TaskService) has no method "nope"',
			'rows[7].coveredBy[0].sequenceId: unknown sequence "SEQ-009"',
			'rows[8].coveredBy[0].step: SEQ-001 has 3 messages, not 4',
			'rows[6]: more than one row for REQ-004 AC1',
			'rows: no row for REQ-001 AC1'
		]) {
			expect(r.content).toContain(part);
		}
		expect(r.content).toMatch(/Fix these \d+ problems/);
		expect(await ctx.store.exists('.aise/design-review.json')).toBe(false);
	});

	it('refuses a functional criterion without a row', async () => {
		await seed();
		const r = await coverage(fullRows().slice(0, 4));
		expect(r.isError).toBe(true);
		expect(r.content).toContain('rows: no row for REQ-004 AC1');
		expect(r.content).not.toContain('REQ-003');
	});

	it('refuses without a saved design', async () => {
		await run('write_requirements', fixture('todo-requirements.json'));
		const r = await coverage([]);
		expect(r).toMatchObject({ isError: true });
		expect(r.content).toContain('no saved design');
		expect(await ctx.store.exists('.aise/design-review.json')).toBe(false);
	});

	it('is a design agent tool', () => {
		expect(TOOLS_BY_AGENT.design).toContain('report_coverage');
		expect(TOOLS_BY_AGENT.code).not.toContain('report_coverage');
	});
});

describe('detect_drift', () => {
	const design = {
		actors: [],
		useCases: [],
		classes: [
			{
				id: 'DSN-001',
				name: 'Task',
				kind: 'class',
				description: '',
				attributes: [{ name: 'title', type: 'string' }],
				methods: [],
				relations: [],
				reqIds: ['REQ-001']
			}
		],
		components: [
			{ id: 'DSN-010', name: 'Task API', classIds: ['DSN-001'], nodeId: 'DSN-020', reqIds: [] }
		],
		nodes: [],
		sequences: []
	};
	const taskFile = '/** @trace DSN-001 REQ-001 */\nexport class Task {\n\ttitle = "";\n}\n';

	it('is clean for code that matches the design and lists drift otherwise', async () => {
		await ctx.store.writeFile('.aise/design.json', JSON.stringify(design));
		await ctx.store.writeFile('src/task-api/Task.ts', taskFile);
		expect(JSON.parse((await run('detect_drift', {})).content)).toEqual({ clean: true, items: [] });

		await ctx.store.writeFile('src/task-api/Task.ts', taskFile.replace('title = ""', 'title = 1'));
		const r = JSON.parse((await run('detect_drift', {})).content);
		expect(r.clean).toBe(false);
		expect(r.items[0]).toMatchObject({ kind: 'changed', id: 'DSN-001' });
	});

	it('checks the @trace comment of the page against the client components', async () => {
		const withClient = {
			...design,
			components: [
				...design.components,
				{ id: 'DSN-011', name: 'Web UI', classIds: [], nodeId: 'DSN-021', reqIds: ['REQ-001'] }
			],
			nodes: [{ id: 'DSN-021', name: 'Browser', kind: 'client', reqIds: [] }]
		};
		await ctx.store.writeFile('.aise/design.json', JSON.stringify(withClient));
		await ctx.store.writeFile('src/task-api/Task.ts', taskFile);
		const page = (ids: string) => `<html><head>\n<!-- @trace ${ids} -->\n</head></html>\n`;
		await ctx.store.writeFile('public/index.html', page('DSN-011 REQ-001'));
		expect(JSON.parse((await run('detect_drift', {})).content).clean).toBe(true);

		await ctx.store.writeFile('public/index.html', page('DSN-011'));
		const r = JSON.parse((await run('detect_drift', {})).content);
		expect(r.items).toEqual([
			expect.objectContaining({ kind: 'changed', id: 'DSN-011', file: 'public/index.html' })
		]);
	});

	it('reports a design that cannot be planned as a tool error, not a crash', async () => {
		const named = { ...design, components: [{ ...design.components[0], name: 'App' }] };
		await ctx.store.writeFile('.aise/design.json', JSON.stringify(named));
		const r = await run('detect_drift', {});
		expect(r.isError).toBe(true);
		expect(r.content).toContain('"app"');
	});

	it('asks for a design first', async () => {
		const r = await run('detect_drift', {});
		expect(r.isError).toBe(true);
		expect(r.content).toContain('no design');
	});
});

describe('anthropicTools', () => {
	it('builds object schemas without $schema, sorted by name', () => {
		const tools = anthropicTools(['write_requirements', 'read_design']);
		expect(tools.map((t) => t.name)).toEqual(['read_design', 'write_requirements']);
		for (const t of tools) {
			expect(t.input_schema.type).toBe('object');
			expect(t.input_schema).not.toHaveProperty('$schema');
		}
		expect(anthropicTools(['write_requirements'])[0].input_schema.type).toBe('object');
	});
});

describe('P5 tools', () => {
	const testAgent = async () => {
		const meta = await createRun(ctx.store, 'P5', 'test');
		ctx = { ...ctx, runId: meta.id, agent: 'test' };
		return TOOLS_BY_AGENT.test;
	};
	const bug = {
		test: 'REQ-001 AC1: a',
		file: 'test/UC-001.test.ts',
		reqId: 'REQ-001',
		explanation: 'returns 500',
		proposedFix: 'validate the title'
	};
	const stored = async () =>
		JSON.parse(await text(`.aise/runs/${ctx.runId}/findings.json`)) as {
			findings: Record<string, unknown>[];
			testFixes: Record<string, unknown>[];
		};

	it('gives the test agent the report tools, delete_file and typecheck, and no other agent', () => {
		for (const n of ['report_code_bug', 'report_test_fix', 'delete_file', 'typecheck'])
			expect(TOOLS_BY_AGENT.test).toContain(n);
		for (const [agent, names] of Object.entries(TOOLS_BY_AGENT))
			if (agent !== 'test') {
				expect(names).not.toContain('report_code_bug');
				expect(names).not.toContain('report_test_fix');
			}
	});

	it('stores report_code_bug in the run with a stable unique id', async () => {
		const allowed = await testAgent();
		const a = await run('report_code_bug', bug, allowed);
		expect(a.isError).toBe(false);
		await run('report_code_bug', { ...bug, test: 'REQ-001 AC2: b' }, allowed);
		const { findings } = await stored();
		expect(findings).toHaveLength(2);
		expect(findings[0]).toEqual({ ...bug, id: `${ctx.runId}-1`, runId: ctx.runId });
		expect(findings[1]!.id).toBe(`${ctx.runId}-2`);
		expect(await readRunFindings(ctx.store, ctx.runId)).toEqual(await stored());
	});

	it('replaces an earlier report for the same file and test and never reuses an id', async () => {
		const allowed = await testAgent();
		await run('report_code_bug', bug, allowed);
		await run('report_code_bug', { ...bug, test: 'other' }, allowed);
		await run('report_code_bug', { ...bug, file: 'test/UC-002.test.ts' }, allowed);
		await run('report_code_bug', { ...bug, explanation: 'second look' }, allowed);
		const { findings } = await stored();
		expect(findings.map((f) => [f.test, f.file, f.id])).toEqual([
			['other', bug.file, `${ctx.runId}-2`],
			[bug.test, 'test/UC-002.test.ts', `${ctx.runId}-3`],
			[bug.test, bug.file, `${ctx.runId}-4`]
		]);
		expect(findings[2]!.explanation).toBe('second look');
	});

	it('stores report_test_fix in the run', async () => {
		const allowed = await testAgent();
		const r = await run(
			'report_test_fix',
			{ test: 'REQ-001 AC1: a', file: 'test/UC-001.test.ts', reason: 'wrong route' },
			allowed
		);
		expect(r.isError).toBe(false);
		expect((await stored()).testFixes).toEqual([
			{
				runId: ctx.runId,
				test: 'REQ-001 AC1: a',
				file: 'test/UC-001.test.ts',
				reason: 'wrong route'
			}
		]);
	});

	it('validates the input', async () => {
		const allowed = await testAgent();
		for (const bad of [
			{ ...bug, test: '' },
			{ ...bug, reqId: 'REQ-1' },
			{ ...bug, explanation: '' },
			{ ...bug, file: 'src/app.ts' },
			{ ...bug, extra: 1 }
		])
			expect((await run('report_code_bug', bad, allowed)).isError).toBe(true);
		expect(
			(await run('report_test_fix', { test: 't', file: '../x', reason: 'r' }, allowed)).isError
		).toBe(true);
		expect(await ctx.store.exists(`.aise/runs/${ctx.runId}/findings.json`)).toBe(false);
	});

	it('refuses both report tools in the context of any other agent', async () => {
		await testAgent();
		const fix = { test: bug.test, file: bug.file, reason: 'r' };
		for (const agent of ['code', 'mcp'] as const) {
			ctx = { ...ctx, agent };
			for (const [name, input] of [
				['report_code_bug', bug],
				['report_test_fix', fix]
			] as const) {
				const r = await run(name, input);
				expect(r.isError, `${agent} ${name}`).toBe(true);
				expect(r.content).toContain('test agent');
			}
		}
		expect(await ctx.store.exists(`.aise/runs/${ctx.runId}/findings.json`)).toBe(false);
	});

	it('refuses src/ reads and writes for the test agent but lets it delete its own files', async () => {
		const allowed = await testAgent();
		await ctx.store.writeFile('src/x.ts', 'export {};');
		const read = await run('read_file', { path: 'src/x.ts' }, allowed);
		expect(read.isError).toBe(true);
		expect(read.content).toContain('test agent');
		expect((await run('delete_file', { path: 'src/x.ts' }, allowed)).isError).toBe(true);
		await ctx.store.writeFile('test/UC-001.test.ts', 'x');
		expect((await run('delete_file', { path: 'test/UC-001.test.ts' }, allowed)).isError).toBe(
			false
		);
		expect(await ctx.store.exists('test/UC-001.test.ts')).toBe(false);
		expect(await ctx.store.exists('src/x.ts')).toBe(true);
	});
});
