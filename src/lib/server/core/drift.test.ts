import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectDrift, injectable, pageDrift } from './drift';
import { buildCodeModel, type CodeModel, type Decl, type Member } from './tools/code-model';
import { DesignDoc } from './schemas/design';

const design = DesignDoc.parse({
	actors: [],
	useCases: [],
	classes: [
		{
			id: 'DSN-001',
			name: 'Task',
			kind: 'class',
			description: '',
			attributes: [
				{ name: 'title', type: 'string' },
				{ name: 'tags', type: 'string[]' },
				{ name: 'due', type: 'Date | undefined' }
			],
			methods: [
				{
					name: 'rename',
					params: [
						{ name: 'title', type: 'string' },
						{ name: 'force', type: 'boolean' }
					],
					returnType: 'void'
				},
				{ name: 'reset', params: [], returnType: 'void' }
			],
			relations: [{ kind: 'inheritance', targetId: 'DSN-003' }],
			reqIds: ['REQ-001']
		},
		{
			id: 'DSN-002',
			name: 'TaskStatus',
			kind: 'enum',
			description: '',
			attributes: [],
			methods: [],
			values: ['Open', 'Done'],
			relations: [],
			reqIds: ['REQ-001']
		},
		{
			id: 'DSN-003',
			name: 'Entity',
			kind: 'interface',
			description: '',
			attributes: [],
			methods: [],
			relations: [],
			reqIds: []
		}
	],
	components: [
		{
			id: 'DSN-010',
			name: 'Tasks',
			classIds: ['DSN-001', 'DSN-002', 'DSN-003'],
			nodeId: 'DSN-020',
			reqIds: []
		}
	],
	nodes: [],
	sequences: []
});
const paths = {
	'DSN-001': 'src/tasks/Task.ts',
	'DSN-002': 'src/tasks/TaskStatus.ts',
	'DSN-003': 'src/tasks/Entity.ts'
};

const prop = (name: string, type: string, extra: Partial<Member> = {}): Member => ({
	name,
	kind: 'property',
	signature: `${name}: ${type}`,
	static: false,
	visibility: 'public',
	type,
	optional: false,
	...extra
});
const method = (
	name: string,
	params: [string, string][],
	returnType = 'void',
	extra: Partial<Member> = {}
): Member => ({
	name,
	kind: 'method',
	signature: name,
	static: false,
	visibility: 'public',
	params: params.map(([n, type]) => ({ name: n, type, optional: false })),
	returnType,
	...extra
});
const decl = (d: Partial<Decl> & Pick<Decl, 'name' | 'kind' | 'file'>): Decl => ({
	line: 3,
	tags: [],
	members: [],
	...d
});

const taskDecl = (over: Partial<Decl> = {}): Decl =>
	decl({
		name: 'Task',
		kind: 'class',
		file: 'src/tasks/Task.ts',
		implements: ['Entity'],
		tags: ['@trace DSN-001 REQ-001'],
		members: [
			prop('title', 'string'),
			prop('tags', 'string[]'),
			prop('due', 'Date', { optional: true }),
			method('rename', [
				['title', 'string'],
				['force', 'boolean']
			]),
			method('reset', [])
		],
		...over
	});
const statusDecl = (over: Partial<Decl> = {}): Decl =>
	decl({
		name: 'TaskStatus',
		kind: 'enum',
		file: 'src/tasks/TaskStatus.ts',
		tags: ['@trace DSN-002 REQ-001'],
		members: [prop('Open', 'x'), prop('Done', 'x')],
		...over
	});
const entityDecl = (): Decl =>
	decl({
		name: 'Entity',
		kind: 'interface',
		file: 'src/tasks/Entity.ts',
		tags: ['@trace DSN-003']
	});

const drift = (decls: Decl[]) =>
	detectDrift(design, { decls, routes: [] } satisfies CodeModel, paths);
const clean = () => [taskDecl(), statusDecl(), entityDecl()];

describe('detectDrift', () => {
	it('reports nothing for matching code', () => {
		expect(drift(clean())).toEqual([]);
	});

	it('reports a class missing in code with its ID', () => {
		const items = drift([taskDecl(), entityDecl()]);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ kind: 'missing_in_code', id: 'DSN-002', name: 'TaskStatus' });
	});

	it('reports an exported class missing in the design with file and line', () => {
		const helper = decl({ name: 'Helper', kind: 'class', file: 'src/tasks/Helper.ts', line: 7 });
		expect(drift([...clean(), helper])).toEqual([
			expect.objectContaining({
				kind: 'missing_in_design',
				name: 'Helper',
				file: 'src/tasks/Helper.ts',
				line: 7
			})
		]);
	});

	it('matches by @trace ID and reports a different name', () => {
		const items = drift([taskDecl({ name: 'Todo' }), statusDecl(), entityDecl()]);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ kind: 'changed', id: 'DSN-001' });
		expect(items[0].details.join(' ')).toContain('Todo');
	});

	it('matches by name when there is no @trace tag', () => {
		const untagged = taskDecl({ tags: [] });
		const items = drift([untagged, statusDecl(), entityDecl()]);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ kind: 'changed', id: 'DSN-001' });
		expect(items[0].details.join(' ')).toContain('REQ');
	});

	it('reports a file other than the planned path', () => {
		const items = drift([taskDecl({ file: 'src/other/Task.ts' }), statusDecl(), entityDecl()]);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ kind: 'changed', file: 'src/other/Task.ts' });
		expect(items[0].details.join(' ')).toContain('src/tasks/Task.ts');
	});

	it('reports REQ IDs in the @trace tag that differ from the design', () => {
		const items = drift([
			taskDecl({ tags: ['@trace DSN-001 REQ-009'] }),
			statusDecl(),
			entityDecl()
		]);
		expect(items).toHaveLength(1);
		expect(items[0].kind).toBe('changed');
		expect(items[0].details.join(' ')).toMatch(/REQ-009/);
	});

	it('reports a different declaration kind', () => {
		const items = drift([taskDecl({ kind: 'interface' }), statusDecl(), entityDecl()]);
		expect(items[0].details.join(' ')).toContain('kind');
	});

	it('compares attribute types in normal form', () => {
		const members = taskDecl().members;
		const withType = (type: string, optional = false) =>
			members
				.map((m) => (m.name === 'tags' ? { ...m, type } : m))
				.map((m) => (m.name === 'due' ? { ...m, optional } : m));
		// Array<string> equals string[]
		expect(
			drift([taskDecl({ members: withType('Array<string>', true) }), statusDecl(), entityDecl()])
		).toEqual([]);
		// a different element type is a change
		const items = drift([
			taskDecl({ members: withType('number[]', true) }),
			statusDecl(),
			entityDecl()
		]);
		expect(items[0].details.join(' ')).toContain('tags');
	});

	it('treats an optional property as T | undefined', () => {
		expect(drift(clean())).toEqual([]); // due?: Date against Date | undefined
		const members = taskDecl().members.map((m) =>
			m.name === 'due' ? { ...m, optional: false } : m
		);
		const items = drift([taskDecl({ members }), statusDecl(), entityDecl()]);
		expect(items[0].details.join(' ')).toContain('due');
	});

	it('reports a changed parameter name or order', () => {
		const swapped = (params: [string, string][]) =>
			taskDecl({
				members: taskDecl().members.map((m) => (m.name === 'rename' ? method('rename', params) : m))
			});
		const renamed = drift([
			swapped([
				['name', 'string'],
				['force', 'boolean']
			]),
			statusDecl(),
			entityDecl()
		]);
		expect(renamed[0]).toMatchObject({ kind: 'changed' });
		expect(renamed[0].details.join(' ')).toContain('rename');
		const reordered = drift([
			swapped([
				['force', 'boolean'],
				['title', 'string']
			]),
			statusDecl(),
			entityDecl()
		]);
		expect(reordered[0]).toMatchObject({ kind: 'changed' });
	});

	it('reports a changed return type and a public member missing from the design', () => {
		const members = [
			...taskDecl().members.map((m) => (m.name === 'reset' ? method('reset', [], 'number') : m)),
			method('extra', [])
		];
		const [item] = drift([taskDecl({ members }), statusDecl(), entityDecl()]);
		expect(item.details.join(' ')).toContain('reset');
		expect(item.details.join(' ')).toContain('extra');
	});

	it('reports enum values that differ', () => {
		const items = drift([taskDecl(), statusDecl({ members: [prop('Open', 'x')] }), entityDecl()]);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ kind: 'changed', id: 'DSN-002' });
		expect(items[0].details.join(' ')).toContain('Done');
	});

	it('reports an inheritance relation without extends or implements', () => {
		const items = drift([taskDecl({ implements: undefined }), statusDecl(), entityDecl()]);
		expect(items).toHaveLength(1);
		expect(items[0].details.join(' ')).toContain('Entity');
	});

	it('reports a base class in code that the design does not have', () => {
		const items = drift([taskDecl({ extends: 'TaskStatus' }), statusDecl(), entityDecl()]);
		expect(items[0].details.join(' ')).toContain('TaskStatus');
	});

	it('ignores private members not in the design and accepts a design method that is private', () => {
		const members = [
			...taskDecl().members.map((m) =>
				m.name === 'reset' ? { ...m, visibility: 'private' as const } : m
			),
			prop('cache', 'Map<string, Task>', { visibility: 'private' }),
			method('guard', [], 'void', { visibility: 'protected' })
		];
		expect(drift([taskDecl({ members }), statusDecl(), entityDecl()])).toEqual([]);
	});

	it('ignores constructors and public static members that are not in the design', () => {
		const members = [
			...taskDecl().members,
			{
				name: 'constructor',
				kind: 'constructor' as const,
				signature: 'constructor(x: number)',
				static: false,
				visibility: 'public' as const
			},
			method('create', [['title', 'string']], 'Task', { static: true }),
			prop('count', 'number', { static: true })
		];
		expect(drift([taskDecl({ members }), statusDecl(), entityDecl()])).toEqual([]);
	});

	it('still compares a static member the design lists', () => {
		const members = taskDecl().members.map((m) =>
			m.name === 'title' ? { ...m, static: true, type: 'number' } : m
		);
		const [item] = drift([taskDecl({ members }), statusDecl(), entityDecl()]);
		expect(item.details.join(' ')).toContain('title');
	});

	it('ignores members named like index and call signatures', () => {
		const entity = entityDecl();
		entity.members = [prop('[]', 'string'), method('()', [])];
		expect(drift([taskDecl(), statusDecl(), entity])).toEqual([]);
	});

	it('ignores non exported classes and classes under src/app', () => {
		// non exported classes are not in the model at all; src/app ones are skipped by path
		const app = decl({ name: 'Server', kind: 'class', file: 'src/app/Server.ts' });
		expect(drift([...clean(), app])).toEqual([]);
	});
});

/** The design with one change, parsed through the schema. */
const variant = (change: (d: DesignDoc) => void) => {
	const d = structuredClone(design);
	change(d);
	return d;
};
const driftOf = (d: DesignDoc, decls: Decl[]) => detectDrift(d, { decls, routes: [] }, paths);
const withParams = (params: Member['params'], name = 'rename') =>
	taskDecl({
		members: taskDecl().members.map((m) => (m.name === name ? { ...m, params } : m))
	});

describe('detectDrift parameters', () => {
	const rename = (force: { type: string; optional: boolean }) =>
		withParams([
			{ name: 'title', type: 'string', optional: false },
			{ name: 'force', ...force }
		]);

	it('accepts a defaulted or optional parameter against its plain or | undefined type', () => {
		const run = (d: DesignDoc, force: { type: string; optional: boolean }) =>
			driftOf(d, [rename(force), statusDecl(), entityDecl()]);
		expect(run(design, { type: 'boolean', optional: true })).toEqual([]);
		const undef = variant((d) => (d.classes[0].methods[0].params[1].type = 'boolean | undefined'));
		expect(run(undef, { type: 'boolean', optional: true })).toEqual([]);
	});

	it('reports a defaulted parameter whose type differs, with the code type in the message', () => {
		const [item] = drift([rename({ type: 'number', optional: true }), statusDecl(), entityDecl()]);
		expect(item.kind).toBe('changed');
		expect(item.details[0]).toContain('force: boolean');
		expect(item.details[0]).toContain('force?: number');
	});

	it('does not accept an optional type for a required parameter', () => {
		const undef = variant((d) => (d.classes[0].methods[0].params[1].type = 'boolean | undefined'));
		const items = driftOf(undef, [
			rename({ type: 'boolean', optional: false }),
			statusDecl(),
			entityDecl()
		]);
		expect(items).toHaveLength(1);
	});

	it('wraps function types before adding | undefined', () => {
		const d = variant((d) => {
			d.classes[0].methods[0].params = [{ name: 'cb', type: '(() => string) | undefined' }];
		});
		const code = withParams([{ name: 'cb', type: '() => string', optional: true }]);
		expect(driftOf(d, [code, statusDecl(), entityDecl()])).toEqual([]);
	});

	it('adds | undefined after a generic that mentions undefined', () => {
		const d = variant((d) => {
			d.classes[0].methods[0].params = [{ name: 'm', type: 'Map<string, undefined> | undefined' }];
		});
		const code = withParams([{ name: 'm', type: 'Map<string, undefined>', optional: true }]);
		expect(driftOf(d, [code, statusDecl(), entityDecl()])).toEqual([]);
	});

	it('does not add undefined twice', () => {
		const members = taskDecl().members.map((m) =>
			m.name === 'due' ? { ...m, type: 'Date | undefined' } : m
		);
		expect(drift([taskDecl({ members }), statusDecl(), entityDecl()])).toEqual([]);
	});
});

describe('detectDrift members', () => {
	const detailsOf = (members: Member[]) =>
		drift([taskDecl({ members }), statusDecl(), entityDecl()])[0]?.details.join(' ');
	const without = (name: string) => taskDecl().members.filter((m) => m.name !== name);

	it('reports a design attribute missing in code', () => {
		expect(detailsOf(without('title'))).toContain('attribute title: in design, not in code');
	});

	it('reports a public attribute in code that the design does not have', () => {
		expect(detailsOf([...taskDecl().members, prop('extra', 'string')])).toContain(
			'attribute extra: in code, not in design'
		);
	});

	it('reports a design method missing in code', () => {
		expect(detailsOf(without('reset'))).toContain('method reset: in design, not in code');
	});

	it('compares a function typed property with the design methods, not the attributes', () => {
		const d = variant((d) =>
			d.classes[0].methods.push({
				name: 'handle',
				params: [{ name: 'req', type: 'Req' }],
				returnType: 'Promise<void>'
			})
		);
		const handler = (type: string) =>
			taskDecl({ members: [...taskDecl().members, prop('handle', type)] });
		expect(
			driftOf(d, [handler('(req: Req) => Promise<void>'), statusDecl(), entityDecl()])
		).toEqual([]);
		const [item] = driftOf(d, [handler('(req: Req) => void'), statusDecl(), entityDecl()]);
		expect(item.details.join(' ')).toContain('method handle: return type Promise<void>');
		const [wrongParam] = driftOf(d, [
			handler('(request: Req) => Promise<void>'),
			statusDecl(),
			entityDecl()
		]);
		expect(wrongParam.details.join(' ')).toContain('method handle: parameters');
	});

	it('treats an optional function property as the attribute T | undefined', () => {
		const d = variant((d) =>
			d.classes[0].attributes.push({ name: 'cb', type: '(() => void) | undefined' })
		);
		const code = (optional: boolean, type: string) =>
			taskDecl({ members: [...taskDecl().members, prop('cb', type, { optional })] });
		expect(driftOf(d, [code(true, '() => void'), statusDecl(), entityDecl()])).toEqual([]);
		// a required function property stays a method, so the design attribute is not satisfied
		const [item] = driftOf(d, [code(false, '() => void'), statusDecl(), entityDecl()]);
		expect(item.details.join(' ')).toContain('attribute cb: in design, not in code');
	});

	it('treats a design attribute with a function type as a method too', () => {
		const d = variant((d) =>
			d.classes[0].attributes.push({ name: 'onChange', type: '(x: number) => void' })
		);
		const code = taskDecl({
			members: [...taskDecl().members, prop('onChange', '(x: number) => void')]
		});
		expect(driftOf(d, [code, statusDecl(), entityDecl()])).toEqual([]);
	});
});

describe('detectDrift inheritance', () => {
	const named = variant((d) => {
		d.classes.push({
			id: 'DSN-004',
			name: 'Named',
			kind: 'interface',
			description: '',
			attributes: [],
			methods: [],
			values: [],
			relations: [],
			reqIds: []
		});
		d.classes[2].relations.push({ kind: 'inheritance', targetId: 'DSN-004' });
		d.components[0].classIds.push('DSN-004');
	});
	const namedDecl = () =>
		decl({
			name: 'Named',
			kind: 'interface',
			file: 'src/tasks/Named.ts',
			tags: ['@trace DSN-004']
		});
	const entity = (extra: Partial<Decl>) => ({ ...entityDecl(), ...extra });
	const run = (e: Decl) =>
		detectDrift(
			named,
			{ decls: [taskDecl(), statusDecl(), e, namedDecl()], routes: [] },
			{
				...paths,
				'DSN-004': 'src/tasks/Named.ts'
			}
		);

	it('compares interface extends with the design', () => {
		expect(run(entity({ extends: 'Named' }))).toEqual([]);
		const [item] = run(entity({}));
		expect(item).toMatchObject({ kind: 'changed', id: 'DSN-003' });
		expect(item.details.join(' ')).toContain('Named');
	});

	it('removes generic arguments, also nested ones, before looking for base names', () => {
		// Entity<Task> is the base Entity; Task inside the brackets is not a base
		expect(drift([taskDecl({ implements: ['Entity<Task>'] }), statusDecl(), entityDecl()])).toEqual(
			[]
		);
		// Entity and Named only appear inside generics, so they are not bases
		const [item] = run(entity({ extends: 'Foo<Bar<Named>>' }));
		expect(item.details.join(' ')).toContain('Named in design, none in code');
	});

	it('does not take a qualified name for a design class', () => {
		const [item] = drift([
			taskDecl({ implements: ['Express.Entity'] }),
			statusDecl(),
			entityDecl()
		]);
		expect(item.details.join(' ')).toContain('Entity in design, none in code');
	});
});

describe('detectDrift matching', () => {
	it('does not match by name a declaration traced to another design class', () => {
		const stray = decl({
			name: 'Task',
			kind: 'class',
			file: 'src/tasks/Task.ts',
			tags: ['@trace DSN-002']
		});
		const items = drift([entityDecl(), statusDecl(), stray]);
		expect(items.map((i) => `${i.kind} ${i.name}`)).toEqual([
			'missing_in_code Task',
			'missing_in_design Task'
		]);
	});

	it('still matches by name when the traced ID is not in the design', () => {
		expect(
			drift([taskDecl({ tags: ['@trace DSN-099 REQ-001'] }), statusDecl(), entityDecl()])
		).toEqual([]);
	});

	it('gives a second declaration with the same ID to missing_in_design', () => {
		const twin = decl({
			name: 'Twin',
			kind: 'enum',
			file: 'src/tasks/Twin.ts',
			tags: ['@trace DSN-002']
		});
		const items = drift([...clean(), twin]);
		expect(items).toEqual([expect.objectContaining({ kind: 'missing_in_design', name: 'Twin' })]);
	});
});

describe('pageDrift', () => {
	const withClient = variant((d) => {
		d.nodes.push({ id: 'DSN-021', name: 'Browser', kind: 'client', reqIds: [] });
		d.components.push({
			id: 'DSN-011',
			name: 'Web UI',
			classIds: [],
			nodeId: 'DSN-021',
			reqIds: ['REQ-001']
		});
	});
	const page = (comment: string) =>
		`<!doctype html>\n<html>\n<head>\n${comment}\n<title>x</title>\n</head>\n</html>\n`;

	it('reports nothing for a matching comment, or without a client component', () => {
		expect(pageDrift(withClient, page('<!-- @trace DSN-011 REQ-001 -->'))).toEqual([]);
		expect(pageDrift(design, null)).toEqual([]);
	});

	it('reports a page without a @trace comment', () => {
		expect(pageDrift(withClient, page('<meta charset="utf-8">'))).toEqual([
			{
				kind: 'changed',
				id: 'DSN-011',
				name: 'Web UI',
				file: 'public/index.html',
				details: [
					'public/index.html has no @trace comment; add <!-- @trace DSN-011 REQ-001 --> as the first line in <head>'
				]
			}
		]);
	});

	it('reports a missing REQ ID at the line of the comment', () => {
		const [item] = pageDrift(withClient, page('<!-- @trace DSN-011 -->'));
		expect(item).toMatchObject({
			kind: 'changed',
			id: 'DSN-011',
			file: 'public/index.html',
			line: 4
		});
		expect(item.details).toEqual([
			'@trace IDs: DSN-011 REQ-001 in design, DSN-011 in public/index.html (missing REQ-001)'
		]);
	});

	it('reports an extra ID', () => {
		const [item] = pageDrift(withClient, page('<!-- @trace DSN-011 REQ-001 REQ-009 -->'));
		expect(item.details).toEqual([
			'@trace IDs: DSN-011 REQ-001 in design, DSN-011 REQ-001 REQ-009 in public/index.html (extra REQ-009)'
		]);
	});

	it('reads only the @trace HTML comment, not @trace text elsewhere', () => {
		const html = page('<!-- @trace DSN-011 -->').replace(
			'</html>',
			'<script>// @trace REQ-001</script>\n</html>'
		);
		expect(pageDrift(withClient, html)[0].details).toEqual([
			'@trace IDs: DSN-011 REQ-001 in design, DSN-011 in public/index.html (missing REQ-001)'
		]);
	});

	it('reports a missing page', () => {
		expect(pageDrift(withClient, null)).toEqual([
			{
				kind: 'missing_in_code',
				id: 'DSN-011',
				name: 'Web UI',
				details: ['client component Web UI is in the design but public/index.html does not exist']
			}
		]);
	});
});

describe('detectDrift on a real code model', () => {
	const dirs: string[] = [];
	afterEach(async () => {
		await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
	});
	const small = variant((d) => {
		d.classes = [
			{
				...d.classes[0],
				attributes: [{ name: 'title', type: 'string' }],
				methods: [
					{
						name: 'load',
						params: [
							{ name: 'id', type: 'string' },
							{ name: 'force', type: 'boolean' }
						],
						returnType: 'Promise<string[]>'
					},
					{
						name: 'handle',
						params: [{ name: 'req', type: 'Req' }],
						returnType: 'Promise<void>'
					}
				],
				relations: []
			}
		];
	});
	const model = async (body: string) => {
		const dir = await mkdtemp(path.join(tmpdir(), 'aise-drift-'));
		dirs.push(dir);
		await mkdir(path.join(dir, 'src/tasks'), { recursive: true });
		await writeFile(path.join(dir, 'src/tasks/Task.ts'), body);
		return buildCodeModel(dir, { includePrivate: true });
	};
	const source = (members: string) =>
		`type Req = { id: string };\n/** @trace DSN-001 REQ-001 */\nexport class Task {\n${members}\n}\n`;

	it('is clean with readonly, a constructor, a static factory, a defaulted parameter and an arrow property', async () => {
		const code = await model(
			source(`constructor(readonly title: string, private cache = 1) {}
static create(title: string): Task { return new Task(title); }
async load(id: string, force = false) { return [id]; }
handle = async (req: Req) => {};`)
		);
		expect(detectDrift(small, code, paths)).toEqual([]);
	});

	it('reports a defaulted parameter of another type', async () => {
		const code = await model(
			source(`constructor(readonly title: string) {}
async load(id: string, force = 1) { return [id]; }
handle = async (req: Req) => {};`)
		);
		const [item] = detectDrift(small, code, paths);
		expect(item.details.join(' ')).toContain('force?: number');
	});
});

describe('detectDrift inherited members', () => {
	const cls = (
		id: string,
		name: string,
		kind: 'class' | 'interface',
		methods: { name: string; params: { name: string; type: string }[]; returnType: string }[],
		baseId?: string
	) => ({
		id,
		name,
		kind,
		description: '',
		attributes: [],
		methods,
		relations: baseId ? [{ kind: 'inheritance', targetId: baseId }] : [],
		reqIds: []
	});
	const send = { name: 'send', params: [{ name: 'msg', type: 'string' }], returnType: 'void' };
	const inheritance = DesignDoc.parse({
		actors: [],
		useCases: [],
		classes: [
			cls('DSN-001', 'Notifier', 'interface', [send]),
			cls('DSN-002', 'EmailNotifier', 'class', [], 'DSN-001'),
			cls('DSN-003', 'Base', 'class', [send]),
			cls('DSN-004', 'Mid', 'class', [], 'DSN-003'),
			cls('DSN-005', 'Leaf', 'class', [], 'DSN-004')
		],
		components: [],
		nodes: [],
		sequences: []
	});
	const codeDecl = (
		name: string,
		kind: Decl['kind'],
		id: string,
		extra: Partial<Decl> = {},
		members: Member[] = []
	) =>
		decl({
			name,
			kind,
			file: `src/x/${name}.ts`,
			tags: [`@trace ${id}`],
			members,
			...extra
		});
	const sendMember = () => method('send', [['msg', 'string']]);
	const decls = (email: Member[], leaf: Member[]) => [
		codeDecl('Notifier', 'interface', 'DSN-001', {}, [sendMember()]),
		codeDecl('EmailNotifier', 'class', 'DSN-002', { implements: ['Notifier'] }, email),
		codeDecl('Base', 'class', 'DSN-003', {}, [sendMember()]),
		codeDecl('Mid', 'class', 'DSN-004', { extends: 'Base' }),
		codeDecl('Leaf', 'class', 'DSN-005', { extends: 'Mid' }, leaf)
	];
	const run = (email: Member[], leaf: Member[]) =>
		detectDrift(inheritance, { decls: decls(email, leaf), routes: [] }, {});

	it('accepts a public member that implements an interface member of the design', () => {
		expect(run([sendMember()], [])).toEqual([]);
	});

	it('accepts a public member that overrides a base class member, also through a chain', () => {
		expect(run([sendMember()], [sendMember()])).toEqual([]);
	});

	it('still reports a public member no base has', () => {
		const items = run([sendMember(), method('flush', [])], []);
		expect(items).toHaveLength(1);
		expect(items[0].details.join(' ')).toContain('method flush: in code, not in design');
	});
});

describe('detectDrift relations', () => {
	const cls = (
		id: string,
		name: string,
		extra: Partial<DesignDoc['classes'][number]> = {}
	): DesignDoc['classes'][number] => ({
		id,
		name,
		kind: 'class',
		description: '',
		attributes: [],
		methods: [],
		values: [],
		relations: [],
		reqIds: [],
		...extra
	});
	// the auction case: EventFeed depends on EventSubscriber
	const relDesign = DesignDoc.parse({
		actors: [],
		useCases: [],
		classes: [
			cls('DSN-001', 'EventFeed', { relations: [{ kind: 'dependency', targetId: 'DSN-002' }] }),
			cls('DSN-002', 'EventSubscriber', {
				kind: 'interface',
				methods: [{ name: 'notify', params: [], returnType: 'void' }]
			}),
			// a dependency on an entity: it would show up in method signatures only
			cls('DSN-003', 'Clock', { relations: [{ kind: 'dependency', targetId: 'DSN-004' }] }),
			cls('DSN-004', 'Bid', { attributes: [{ name: 'item', type: 'Item' }] }),
			cls('DSN-005', 'Item', { relations: [{ kind: 'association', targetId: 'DSN-006' }] }),
			cls('DSN-006', 'User'),
			// a stateful collaborator: still injected
			cls('DSN-007', 'LiveGateway', {
				attributes: [{ name: 'sockets', type: 'Set<string>' }],
				methods: [{ name: 'broadcast', params: [], returnType: 'void' }]
			}),
			cls('DSN-008', 'Watcher', { relations: [{ kind: 'dependency', targetId: 'DSN-007' }] })
		],
		components: [],
		nodes: [],
		sequences: []
	});
	const ctor = (...params: [string, string][]): Member => ({
		name: 'constructor',
		kind: 'constructor',
		signature: 'constructor()',
		static: false,
		visibility: 'public',
		params: params.map(([name, type]) => ({ name, type, optional: false }))
	});
	const codeDecl = (
		name: string,
		id: string,
		members: Member[] = [],
		kind: Decl['kind'] = 'class'
	) => decl({ name, kind, file: `src/x/${name}.ts`, tags: [`@trace ${id}`], members });
	const run = (
		feed: Member[],
		more: { bid?: Member[]; user?: Member[]; watcher?: Member[] } = {}
	) =>
		detectDrift(
			relDesign,
			{
				decls: [
					codeDecl('EventFeed', 'DSN-001', feed),
					codeDecl('EventSubscriber', 'DSN-002', [method('notify', [])], 'interface'),
					codeDecl('Clock', 'DSN-003'),
					codeDecl('Bid', 'DSN-004', more.bid ?? [prop('item', 'Item')]),
					codeDecl('Item', 'DSN-005'),
					codeDecl('User', 'DSN-006', more.user ?? []),
					codeDecl('LiveGateway', 'DSN-007', [
						prop('sockets', 'Set<string>'),
						method('broadcast', [])
					]),
					codeDecl('Watcher', 'DSN-008', more.watcher ?? [ctor(['liveGateway', 'LiveGateway'])])
				],
				routes: []
			},
			{}
		);
	const injected = ctor(['subscriber', 'EventSubscriber']);

	it('accepts a dependency taken as a constructor parameter', () => {
		expect(run([injected])).toEqual([]);
		expect(
			run([injected, prop('subscriber', 'EventSubscriber', { visibility: 'private' })])
		).toEqual([]);
	});

	it('reports an injected dependency the constructor does not take, once used elsewhere', () => {
		const missing =
			'constructor parameter of type EventSubscriber: in design, not in code; take EventSubscriber as a constructor parameter of EventFeed so it shares the one instance the wiring creates, or remove the relation from the design';
		for (const member of [
			prop('subscribers', 'Map<string, EventSubscriber[]>', { visibility: 'private' }),
			method('publish', [['to', 'EventSubscriber']], 'void', { visibility: 'private' })
		]) {
			expect(run([member])[0].details).toEqual([missing]);
			expect(run([member, ctor(['wss', 'WebSocketServer'])])[0].details).toEqual([missing]);
		}
	});

	it('checks a dependency on a stateful class like one on a stateless class', () => {
		expect(run([injected], { watcher: [] })[0].details).toEqual([
			'dependency on LiveGateway: in design, not in code (no field, parameter or return type of LiveGateway); inject LiveGateway into Watcher, or remove the relation from the design'
		]);
		// a private copy the class builds itself
		expect(
			run([injected], { watcher: [prop('gateway', 'LiveGateway', { visibility: 'private' })] })[0]
				.details[0]
		).toContain('constructor parameter of type LiveGateway: in design, not in code');
	});

	it('reports a dependency whose target the code no longer uses, with both repairs', () => {
		const items = run([ctor(['wss', 'WebSocketServer'])]);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ kind: 'changed', id: 'DSN-001' });
		expect(items[0].details).toEqual([
			'dependency on EventSubscriber: in design, not in code (no field, parameter or return type of EventSubscriber); inject EventSubscriber into EventFeed, or remove the relation from the design'
		]);
	});

	it('does not ask for associations or dependencies on entities in code', () => {
		// Item has an association to User and no member of type User; Clock depends on Bid, an entity
		expect(run([injected])).toEqual([]);
	});

	it('reports a constructor parameter of a design class type with no relation, once', () => {
		const items = run([
			ctor(['subscriber', 'EventSubscriber'], ['clock', 'Clock'], ['backup', 'Clock | null'])
		]);
		expect(items).toHaveLength(1);
		expect(items[0].details).toEqual([
			'constructor parameter clock: Clock: in code, no relation to Clock in design; add a dependency on Clock to the design, or remove the parameter from the code'
		]);
	});

	it('accepts a constructor parameter covered by an attribute or by a relation in either direction', () => {
		expect(run([injected], { bid: [prop('item', 'Item'), ctor(['item', 'Item'])] })).toEqual([]);
		// the association goes from Item to User; User may still take an Item
		expect(run([injected], { user: [ctor(['item', 'Item'])] })).toEqual([]);
		expect(run([injected], { user: [ctor(['bid', 'Bid'])] })[0].details[0]).toContain(
			'constructor parameter bid: Bid'
		);
	});

	it('ignores a constructor parameter of its own class and qualified names', () => {
		expect(
			run([ctor(['subscriber', 'EventSubscriber'], ['parent', 'EventFeed'], ['c', 'ns.Clock'])])
		).toEqual([]);
	});
});

describe('injectable', () => {
	const cls = (
		id: string,
		name: string,
		extra: Partial<DesignDoc['classes'][number]> = {}
	): DesignDoc['classes'][number] => ({
		id,
		name,
		kind: 'class',
		description: '',
		attributes: [],
		methods: [],
		values: [],
		relations: [],
		reqIds: [],
		...extra
	});
	const m = (name: string, returnType = 'void', params: { name: string; type: string }[] = []) => ({
		name,
		params,
		returnType
	});
	const doc = DesignDoc.parse({
		actors: [],
		useCases: [],
		classes: [
			cls('DSN-001', 'ExchangeRateService', {
				attributes: [{ name: 'cache', type: 'Map<string, number>' }],
				methods: [m('convert', 'number', [{ name: 'amount', type: 'number' }])]
			}),
			cls('DSN-002', 'Item', {
				attributes: [{ name: 'title', type: 'string' }],
				methods: [m('close')]
			}),
			cls('DSN-003', 'ItemService', { methods: [m('get', 'Item | undefined')] }),
			cls('DSN-004', 'Bid', { attributes: [{ name: 'amount', type: 'number' }] }),
			// the schema allows methods on an enum; it is still never injected
			cls('DSN-005', 'Status', { kind: 'enum', values: ['Open'], methods: [m('label', 'string')] }),
			cls('DSN-006', 'Notifier', { kind: 'interface', methods: [m('send')] }),
			// used as a type only by itself
			cls('DSN-007', 'Draft', { methods: [m('copy', 'Draft')] }),
			cls('DSN-008', 'Rule', { methods: [m('check')] }),
			cls('DSN-009', 'Checker', {
				attributes: [{ name: 'rules', type: 'Rule[]' }],
				methods: [m('run'), m('add', 'void', [{ name: 'gw', type: 'ns.ExchangeRateService' }])]
			}),
			cls('DSN-010', 'Mailer', { methods: [m('send')] }),
			// a word in a string literal type is not a use of the class
			cls('DSN-011', 'Preference', {
				attributes: [{ name: 'channel', type: '"Mailer" | \'Sms\'' }]
			})
		],
		components: [],
		nodes: [],
		sequences: []
	});
	const of = (name: string) =>
		injectable(
			doc.classes.find((c) => c.name === name)!,
			doc
		);

	it('injects a class or interface with methods that no design class uses as a type', () => {
		expect(of('ExchangeRateService')).toBe(true); // has an attribute, still a collaborator
		expect(of('ItemService')).toBe(true);
		expect(of('Notifier')).toBe(true);
		expect(of('Mailer')).toBe(true);
	});

	it('never injects data: a type of an attribute, parameter or return type, or a class without methods', () => {
		expect(of('Item')).toBe(false); // a return type of ItemService
		expect(of('Draft')).toBe(false);
		expect(of('Rule')).toBe(false); // an attribute type of Checker
		expect(of('Bid')).toBe(false);
		expect(of('Status')).toBe(false);
	});
});
