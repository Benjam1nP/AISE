import { describe, expect, it } from 'vitest';
import type { Component, DesignClass, DesignDoc } from '../core/schemas/design';
import { kebab, nodeKebab, planCode, planPaths } from './plan';

const cls = (id: string, name: string, over: Partial<DesignClass> = {}): DesignClass => ({
	id,
	name,
	kind: 'class',
	description: '',
	attributes: [],
	methods: [],
	values: [],
	relations: [],
	reqIds: [],
	...over
});

const component = (id: string, name: string, classIds: string[]): Component => ({
	id,
	name,
	classIds,
	nodeId: 'DSN-020',
	reqIds: []
});

const design = (classes: DesignClass[], components: Component[]): DesignDoc => ({
	actors: [],
	useCases: [],
	classes,
	components,
	nodes: [],
	links: [],
	sequences: []
});

// Task uses TaskStatus (attribute type) and TaskList (attribute type), and TaskList uses Task
// (return type): a cycle the plan must not care about.
const task = cls('DSN-001', 'Task', {
	attributes: [
		{ name: 'list', type: 'TaskList' },
		{ name: 'parent', type: 'Task | undefined' }
	],
	methods: [{ name: 'rename', params: [{ name: 'title', type: 'string' }], returnType: 'void' }],
	relations: [{ kind: 'dependency', targetId: 'DSN-003' }]
});
const taskList = cls('DSN-002', 'TaskList', {
	methods: [{ name: 'all', params: [], returnType: 'Promise<Task[]>' }]
});
const taskStatus = cls('DSN-003', 'TaskStatus', { kind: 'enum', values: ['Open', 'Done'] });
const fixture = design(
	[task, taskList, taskStatus],
	[component('DSN-010', 'Task API', ['DSN-001', 'DSN-002', 'DSN-003'])]
);

describe('nodeKebab', () => {
	const node = (name: string) => ({ id: 'DSN-022', name, kind: 'service' as const, reqIds: [] });

	it('drops notes in parentheses, keeps the full name when nothing else is left, else the ID', () => {
		expect(nodeKebab(node('Live Update Server'))).toBe('live-update-server');
		expect(nodeKebab(node('API Server (owns SQLite)'))).toBe('api-server');
		expect(nodeKebab(node('(Worker)'))).toBe('worker');
		expect(nodeKebab(node('!!!'))).toBe('dsn-022');
	});
});

describe('kebab', () => {
	it('turns component and class names into lower case dashed folder names', () => {
		expect(kebab('Task API')).toBe('task-api');
		expect(kebab('TaskService')).toBe('task-service');
	});

	it('splits an acronym from the word after it', () => {
		expect(kebab('HTTPServer')).toBe('http-server');
		expect(kebab('XMLHttpRequest')).toBe('xml-http-request');
	});

	it('keeps digits in their word', () => {
		expect(kebab('OAuth2Client')).toBe('oauth2-client');
	});

	it('drops accents instead of splitting words on them', () => {
		expect(kebab('Über Service')).toBe('uber-service');
	});

	it('reads any run of spaces as one separator', () => {
		expect(kebab('  Task    API  ')).toBe('task-api');
	});

	it('gives an empty name when there are no letters or digits', () => {
		expect(kebab('!!!')).toBe('');
	});
});

describe('planCode', () => {
	it('plans one file per class under src/<component kebab>/<Name>.ts', () => {
		expect(planCode(fixture).map((p) => p.path)).toEqual([
			'src/task-api/Task.ts',
			'src/task-api/TaskList.ts',
			'src/task-api/TaskStatus.ts'
		]);
		expect(planPaths(fixture)).toEqual({
			'DSN-001': 'src/task-api/Task.ts',
			'DSN-002': 'src/task-api/TaskList.ts',
			'DSN-003': 'src/task-api/TaskStatus.ts'
		});
	});

	it('lists relation targets and classes named in types in uses, sorted and without the class itself', () => {
		const uses = Object.fromEntries(planCode(fixture).map((p) => [p.classId, p.uses]));
		// TaskList comes from an attribute type, TaskStatus from a relation: the relation is read
		// first, so the sort is what puts DSN-002 before DSN-003. Task itself is not listed.
		expect(uses['DSN-001']).toEqual(['DSN-002', 'DSN-003']);
		expect(uses['DSN-002']).toEqual(['DSN-001']);
		expect(uses['DSN-003']).toEqual([]);
	});

	it('lists a class named in a method parameter in uses', () => {
		const board = cls('DSN-004', 'Board', {
			methods: [{ name: 'add', params: [{ name: 'task', type: 'Task' }], returnType: 'void' }]
		});
		const d = design([task, board], [component('DSN-010', 'Task API', ['DSN-001', 'DSN-004'])]);
		expect(planCode(d).find((p) => p.classId === 'DSN-004')?.uses).toEqual(['DSN-001']);
	});

	it('resolves a qualified type name such as Shapes.Circle to its leftmost class', () => {
		const shapes = cls('DSN-005', 'Shapes');
		const canvas = cls('DSN-006', 'Canvas', {
			attributes: [{ name: 'circle', type: 'Shapes.Circle' }]
		});
		const d = design([shapes, canvas], [component('DSN-010', 'Task API', ['DSN-005', 'DSN-006'])]);
		expect(planCode(d).find((p) => p.classId === 'DSN-006')?.uses).toEqual(['DSN-005']);
	});

	it('finds class names in types with the TypeScript parser, not in string literals', () => {
		const note = cls('DSN-004', 'Note', {
			attributes: [
				{ name: 'kind', type: '"TaskList"' },
				{ name: 'tags', type: 'Record<string, TaskStatus>' }
			]
		});
		const d = design(
			[note, taskList, taskStatus],
			[component('DSN-010', 'Task API', ['DSN-004', 'DSN-002', 'DSN-003'])]
		);
		expect(planCode(d).find((p) => p.classId === 'DSN-004')?.uses).toEqual(['DSN-003']);
	});

	it('Review Focus 1: a cycle of relations plans both classes, each listing the other in uses', () => {
		const a = cls('DSN-001', 'Task', { relations: [{ kind: 'association', targetId: 'DSN-002' }] });
		const b = cls('DSN-002', 'TaskList', {
			relations: [{ kind: 'association', targetId: 'DSN-001' }]
		});
		const d = design([a, b], [component('DSN-010', 'Task API', ['DSN-001', 'DSN-002'])]);
		expect(planCode(d).map((p) => [p.classId, p.uses])).toEqual([
			['DSN-001', ['DSN-002']],
			['DSN-002', ['DSN-001']]
		]);
	});

	it('gives no file to a class outside every component', () => {
		const orphan = cls('DSN-005', 'Orphan');
		const d = design([...fixture.classes, orphan], fixture.components);
		expect(planCode(d).map((p) => p.classId)).not.toContain('DSN-005');
	});

	it('gives no file to a class on a client node, kept from a design saved before', () => {
		const d = design(fixture.classes, [
			component('DSN-010', 'Task API', ['DSN-001', 'DSN-002']),
			{ ...component('DSN-011', 'Browser', ['DSN-003']), nodeId: 'DSN-021' }
		]);
		d.nodes = [
			{ id: 'DSN-020', name: 'API', kind: 'service', reqIds: [] },
			{ id: 'DSN-021', name: 'Browser', kind: 'client', reqIds: [] }
		];
		expect(planCode(d).map((p) => p.classId)).toEqual(['DSN-001', 'DSN-002']);
	});

	it('accepts a client component whose name gives no folder, since it gets none', () => {
		const d = design(fixture.classes, [
			component('DSN-010', 'Task API', ['DSN-001', 'DSN-002']),
			{ ...component('DSN-011', 'App', []), nodeId: 'DSN-021' }
		]);
		d.nodes = [
			{ id: 'DSN-020', name: 'API', kind: 'service', reqIds: [] },
			{ id: 'DSN-021', name: 'Browser', kind: 'client', reqIds: [] }
		];
		expect(planCode(d).map((p) => p.classId)).toEqual(['DSN-001', 'DSN-002']);
	});

	it('throws when two classes would be written to the same path', () => {
		const d = design(
			[cls('DSN-001', 'Task'), cls('DSN-002', 'Task')],
			[component('DSN-010', 'Task API', ['DSN-001']), component('DSN-011', 'TaskAPI', ['DSN-002'])]
		);
		expect(() => planCode(d)).toThrow(/src\/task-api\/Task\.ts/);
	});

	it('throws when two paths differ only in case', () => {
		const d = design(
			[cls('DSN-001', 'Task'), cls('DSN-002', 'TASK')],
			[component('DSN-010', 'Task API', ['DSN-001', 'DSN-002'])]
		);
		expect(() => planCode(d)).toThrow(/src\/task-api\/Task\.ts.*src\/task-api\/TASK\.ts/);
	});

	it('throws for a component whose name gives the reserved app folder', () => {
		const d = design([cls('DSN-001', 'Task')], [component('DSN-010', 'App', ['DSN-001'])]);
		expect(() => planCode(d)).toThrow(/"app"/);
	});

	it('throws for a component name that gives no folder name', () => {
		const d = design([cls('DSN-001', 'Task')], [component('DSN-010', '!!!', ['DSN-001'])]);
		expect(() => planCode(d)).toThrow(/not empty/);
	});
});
