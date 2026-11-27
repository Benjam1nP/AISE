import { describe, expect, it } from 'vitest';
import type { TestResult } from './docker/parse';
import type { DesignDoc } from './schemas/design';
import type { Requirement } from './schemas/requirements';
import type { Decl } from './tools/code-model';
import { traceAll, traceId, traceMatrix, type TraceInput } from './trace';

const req = (id: string, title = id): Requirement => ({
	id,
	title,
	text: `${title} text`,
	type: 'functional',
	priority: 'must',
	acceptanceCriteria: ['works']
});

const cls = (id: string, name: string, reqIds: string[]): DesignDoc['classes'][number] => ({
	id,
	name,
	kind: 'class',
	description: '',
	attributes: [],
	methods: [],
	values: [],
	relations: [],
	reqIds
});

// REQ-001 add task: UC-001, TaskService (DSN-001), Task (DSN-002), SEQ-001.
// REQ-002 list tasks: UC-002 only. REQ-003: nothing. Component DSN-010 on node DSN-020.
const design: DesignDoc = {
	actors: [{ id: 'ACT-001', name: 'User', description: '' }],
	useCases: [
		{ id: 'UC-001', name: 'Add task', description: '', actorIds: ['ACT-001'], reqIds: ['REQ-001'] },
		{ id: 'UC-002', name: 'List tasks', description: '', actorIds: [], reqIds: ['REQ-002'] }
	],
	classes: [
		cls('DSN-001', 'TaskService', ['REQ-001']),
		cls('DSN-002', 'Task', ['REQ-001']),
		cls('DSN-003', 'Clock', [])
	],
	components: [
		{
			id: 'DSN-010',
			name: 'tasks',
			classIds: ['DSN-001', 'DSN-002'],
			nodeId: 'DSN-020',
			reqIds: []
		}
	],
	nodes: [{ id: 'DSN-020', name: 'server', kind: 'service', reqIds: [] }],
	links: [],
	sequences: [
		{
			id: 'SEQ-001',
			name: 'Add',
			useCaseId: 'UC-001',
			messages: [
				{ fromId: 'ACT-001', toId: 'DSN-001', method: 'add' },
				{ fromId: 'DSN-001', toId: 'DSN-002', method: 'create' }
			]
		}
	]
};

const decl = (name: string, file: string, line: number, tags: string[]): Decl => ({
	name,
	kind: 'class',
	file,
	line,
	tags,
	members: []
});

const decls: Decl[] = [
	decl('TaskService', 'src/tasks/TaskService.ts', 4, ['@trace DSN-001 REQ-001']),
	decl('Task', 'src/tasks/Task.ts', 3, ['@trace DSN-002']),
	decl('Clock', 'src/tasks/Clock.ts', 2, ['@trace DSN-003']),
	decl('helper', 'src/tasks/util.ts', 9, ['@trace REQ-001']),
	decl('Untagged', 'src/tasks/Other.ts', 1, [])
];

const test = (name: string, status: TestResult['status'], extra: Partial<TestResult> = {}) => {
	const parts = name.split(' > ');
	return {
		name: parts.join(' '),
		title: parts.at(-1)!,
		file: 'test/UC-001.test.ts',
		status,
		line: 5,
		...extra
	} satisfies TestResult;
};

const tests: TestResult[] = [
	test('UC-001 Add task > REQ-001 AC1: works', 'passed'),
	test('UC-001 Add task > SEQ-001 scenario: add', 'failed', { line: 9 }),
	test('UC-001 Add task > helper', 'passed', { line: 12 }),
	test('UC-002 List tasks > REQ-002 AC1: manual: needs a browser', 'todo', {
		file: 'test/UC-002.test.ts'
	}),
	test('UC-002 List tasks > REQ-002 AC2: skipped', 'skipped', { file: 'test/UC-002.test.ts' })
];

const input: TraceInput = {
	requirements: [
		req('REQ-001', 'Add task'),
		req('REQ-002', 'List tasks'),
		req('REQ-003', 'Export')
	],
	design,
	decls,
	tests,
	page: null
};

const loc = (d: Decl) => ({ file: d.file, line: d.line, name: d.name });

describe('traceId', () => {
	it('returns null for an ID that does not exist', () => {
		expect(traceId('REQ-009', input)).toBeNull();
		expect(traceId('DSN-099', input)).toBeNull();
		expect(traceId('Q-001', input)).toBeNull();
	});

	it('traces a requirement to the elements naming it, their sequences, code and AC tests', () => {
		expect(traceId('REQ-001', input)).toEqual({
			id: 'REQ-001',
			kind: 'requirement',
			requirements: ['REQ-001'],
			design: {
				actors: [],
				useCases: ['UC-001'],
				classes: ['DSN-001', 'DSN-002'],
				components: [],
				nodes: [],
				sequences: ['SEQ-001']
			},
			code: [decls[1], decls[0], decls[3]].map(loc),
			tests: [
				{
					file: 'test/UC-001.test.ts',
					line: 5,
					name: 'UC-001 Add task REQ-001 AC1: works',
					status: 'passed'
				}
			]
		});
	});

	it('traces a use case to its actors, sequences, the classes they call and three kinds of test', () => {
		const t = traceId('UC-001', input)!;
		expect(t.kind).toBe('useCase');
		expect(t.requirements).toEqual(['REQ-001']);
		expect(t.design).toEqual({
			actors: ['ACT-001'],
			useCases: ['UC-001'],
			classes: ['DSN-001', 'DSN-002'],
			components: [],
			nodes: [],
			sequences: ['SEQ-001']
		});
		// decls of the classes only: the REQ-only helper is not one of them
		expect(t.code).toEqual([decls[1], decls[0]].map(loc));
		expect(t.tests.map((x) => x.name)).toEqual([
			'UC-001 Add task REQ-001 AC1: works',
			'UC-001 Add task SEQ-001 scenario: add',
			'UC-001 Add task helper'
		]);
	});

	it('traces a sequence to its use case, the requirements of that and its scenario tests', () => {
		const t = traceId('SEQ-001', input)!;
		expect(t.kind).toBe('sequence');
		expect(t.requirements).toEqual(['REQ-001']);
		expect(t.design.useCases).toEqual(['UC-001']);
		expect(t.design.sequences).toEqual(['SEQ-001']);
		expect(t.design.classes).toEqual(['DSN-001', 'DSN-002']);
		expect(t.tests).toEqual([
			{
				file: 'test/UC-001.test.ts',
				line: 9,
				name: 'UC-001 Add task SEQ-001 scenario: add',
				status: 'failed'
			}
		]);
	});

	it('traces a class to its component, node, sequences, code and the AC tests of its requirements', () => {
		const t = traceId('DSN-002', input)!;
		expect(t.kind).toBe('class');
		expect(t.requirements).toEqual(['REQ-001']);
		expect(t.design).toEqual({
			actors: [],
			useCases: [],
			classes: ['DSN-002'],
			components: ['DSN-010'],
			nodes: ['DSN-020'],
			sequences: ['SEQ-001']
		});
		expect(t.code).toEqual([loc(decls[1])]);
		expect(t.tests.map((x) => x.name)).toEqual(['UC-001 Add task REQ-001 AC1: works']);
	});

	it('traces a class without requirements to its code and nothing else', () => {
		const t = traceId('DSN-003', input)!;
		expect(t.requirements).toEqual([]);
		expect(t.code).toEqual([loc(decls[2])]);
		expect(t.tests).toEqual([]);
	});

	it('traces a component to its classes and node, and a node to its components and their classes', () => {
		const c = traceId('DSN-010', input)!;
		expect(c.kind).toBe('component');
		expect(c.design.classes).toEqual(['DSN-001', 'DSN-002']);
		expect(c.design.nodes).toEqual(['DSN-020']);
		expect(c.code).toEqual([decls[1], decls[0]].map(loc));
		// requirements of the component itself only (none), so no tests
		expect(c.requirements).toEqual([]);
		expect(c.tests).toEqual([]);

		const n = traceId('DSN-020', input)!;
		expect(n.kind).toBe('node');
		expect(n.design.components).toEqual(['DSN-010']);
		expect(n.design.classes).toEqual(['DSN-001', 'DSN-002']);
		expect(n.design.nodes).toEqual(['DSN-020']);
	});

	it('maps a client component to public/index.html at its @trace comment line, only while the page exists', () => {
		const d = structuredClone(design);
		d.nodes.push({ id: 'DSN-021', name: 'browser', kind: 'client', reqIds: [] });
		d.components.push({
			id: 'DSN-011',
			name: 'Web page',
			classIds: [],
			nodeId: 'DSN-021',
			reqIds: ['REQ-002']
		});
		d.components[0]!.reqIds = ['REQ-002'];
		// line 2 names @trace outside a comment; only the comment counts
		const page =
			'<!DOCTYPE html>\n<html data-note="@trace here">\n<head>\n<!-- @trace DSN-011 REQ-002 -->\n<title>x</title>';
		const at = { file: 'public/index.html', line: 4, name: 'Web page' };
		const withPage = { ...input, design: d, page };
		// the component, its node, its requirement and a use case of that requirement
		for (const id of ['DSN-011', 'DSN-021', 'REQ-002', 'UC-002']) {
			expect(traceId(id, withPage)!.code).toEqual([at]);
		}
		// a requirement and a use case the page does not serve, a service component and a service node
		for (const id of ['REQ-001', 'UC-001', 'DSN-010', 'DSN-020']) {
			const code = traceId(id, withPage)!.code;
			expect(code.map((c) => c.file)).not.toContain('public/index.html');
			expect(code).toEqual(traceId(id, input)!.code);
		}
		expect(traceMatrix(withPage)[1]!.files).toEqual(['public/index.html']);
		expect(traceId('DSN-011', { ...withPage, page: '<html>' })!.code).toEqual([{ ...at, line: 1 }]);
		expect(traceId('DSN-011', { ...withPage, page: null })!.code).toEqual([]);
	});

	it('traces an actor to its use cases and their requirements, without code or tests', () => {
		const t = traceId('ACT-001', input)!;
		expect(t.kind).toBe('actor');
		expect(t.requirements).toEqual(['REQ-001']);
		expect(t.design.useCases).toEqual(['UC-001']);
		expect(t.design.actors).toEqual(['ACT-001']);
		expect(t.code).toEqual([]);
		expect(t.tests).toEqual([]);
	});

	it('ignores skipped tests, keeps a manual todo', () => {
		expect(traceId('REQ-002', input)!.tests).toEqual([
			{
				file: 'test/UC-002.test.ts',
				line: 5,
				name: 'UC-002 List tasks REQ-002 AC1: manual: needs a browser',
				status: 'todo'
			}
		]);
	});

	it('links a use case to AC and scenario tests outside its describe block', () => {
		const loose = [
			test('REQ-001 AC1: works', 'passed', { file: 'test/a.test.ts' }),
			test('SEQ-001 scenario: add', 'passed', { file: 'test/b.test.ts' }),
			test('UC-0011 Other > helper', 'passed', { file: 'test/c.test.ts' })
		];
		expect(traceId('UC-001', { ...input, tests: loose })!.tests.map((t) => t.file)).toEqual([
			'test/a.test.ts',
			'test/b.test.ts'
		]);
	});

	it('links tests of a component and a node through their own requirements', () => {
		const d = {
			...design,
			components: [{ ...design.components[0]!, reqIds: ['REQ-002'] }],
			nodes: [{ ...design.nodes[0]!, reqIds: ['REQ-002'] }]
		};
		for (const id of ['DSN-010', 'DSN-020']) {
			const t = traceId(id, { ...input, design: d })!;
			expect(t.requirements).toEqual(['REQ-002']);
			expect(t.tests.map((x) => x.status)).toEqual(['todo']);
			expect(t.code).toEqual([decls[1], decls[0]].map(loc));
		}
	});

	it('reads only exact @trace tags and whole IDs', () => {
		const odd = [
			decl('A', 'src/a.ts', 1, ['@traceability REQ-001 DSN-001']),
			decl('B', 'src/b.ts', 1, ['@trace REQ-0012 DSN-0010']),
			decl('C', 'src/c.ts', 1, ['@trace XREQ-001 XDSN-001'])
		];
		expect(traceId('REQ-001', { ...input, decls: odd })!.code).toEqual([]);
	});

	it('ignores an AC test whose criterion number does not exist', () => {
		const t = test('UC-001 Add task > REQ-001 AC5: extra', 'passed');
		const only = { ...input, tests: [t] };
		expect(traceId('REQ-001', only)!.tests).toEqual([]);
		expect(traceMatrix(only)[0]!.noTest).toBe(true);
	});

	it('works without a design', () => {
		const t = traceId('REQ-001', { ...input, design: null })!;
		expect(t.design.classes).toEqual([]);
		// the REQ-001 tag on code still links
		expect(t.code.map((c) => c.name)).toEqual(['TaskService', 'helper']);
	});
});

describe('traceMatrix', () => {
	it('has one row per requirement with design, files, tests and both flags', () => {
		expect(traceMatrix(input)).toEqual([
			{
				reqId: 'REQ-001',
				title: 'Add task',
				design: ['UC-001', 'DSN-001', 'DSN-002', 'SEQ-001'],
				files: ['src/tasks/Task.ts', 'src/tasks/TaskService.ts', 'src/tasks/util.ts'],
				tests: [{ name: 'UC-001 Add task REQ-001 AC1: works', status: 'passed' }],
				noDesign: false,
				noTest: false
			},
			{
				reqId: 'REQ-002',
				title: 'List tasks',
				design: ['UC-002'],
				files: [],
				tests: [{ name: 'UC-002 List tasks REQ-002 AC1: manual: needs a browser', status: 'todo' }],
				noDesign: false,
				noTest: false
			},
			{
				reqId: 'REQ-003',
				title: 'Export',
				design: [],
				files: [],
				tests: [],
				noDesign: true,
				noTest: true
			}
		]);
	});

	it('flags a requirement whose only test is a todo without the manual marker', () => {
		const t = test('UC-002 List tasks > REQ-002 AC1: later', 'todo');
		const rows = traceMatrix({ ...input, tests: [t] });
		expect(rows[1]!.tests).toEqual([{ name: t.name, status: 'todo' }]);
		expect(rows[1]!.noTest).toBe(true);
	});

	it('flags a failing test as a test (noTest is about existence, not result)', () => {
		const t = test('UC-002 List tasks > REQ-002 AC1: shows', 'failed');
		expect(traceMatrix({ ...input, tests: [t] })[1]!.noTest).toBe(false);
	});
});

describe('traceAll', () => {
	it('has the trace of every requirement and design ID, the same as traceId', () => {
		const all = traceAll(input);
		expect(Object.keys(all).sort()).toEqual([
			'ACT-001',
			'DSN-001',
			'DSN-002',
			'DSN-003',
			'DSN-010',
			'DSN-020',
			'REQ-001',
			'REQ-002',
			'REQ-003',
			'SEQ-001',
			'UC-001',
			'UC-002'
		]);
		expect(all['UC-001']).toEqual(traceId('UC-001', input));
	});

	it('has only the requirements without a design', () => {
		expect(Object.keys(traceAll({ ...input, design: null }))).toEqual([
			'REQ-001',
			'REQ-002',
			'REQ-003'
		]);
	});
});
