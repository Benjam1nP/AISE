import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DesignDoc } from './schemas/design';
import { RequirementsDoc } from './schemas/requirements';
import { nextFreeIds, uncoveredMustReqs, validateDesign } from './validate';

const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(new URL(`../../../../test/fixtures/${name}`, import.meta.url), 'utf8'));
const design = () => DesignDoc.parse(fixture('todo-design.json'));
const reqs = () => RequirementsDoc.parse(fixture('todo-requirements.json'));

/** Warnings other than the shared-instance one, which a relation kind change can also raise. */
const nodeWarnings = (d: DesignDoc) =>
	validateDesign(d, reqs()).warnings.filter((w) => !w.message.includes('would build its own'));
const issueAt = (d: DesignDoc, path: string) =>
	validateDesign(d, reqs()).issues.find((i) => i.path === path);

describe('validateDesign', () => {
	it('accepts the to-do fixture', () => {
		expect(validateDesign(design(), reqs()).issues).toEqual([]);
		expect(validateDesign(design(), null).issues).toEqual([]);
	});

	it('reports a sequence message whose method was renamed', () => {
		const d = design();
		const service = d.classes.find((c) => c.name === 'TaskService')!;
		service.methods.find((m) => m.name === 'addTask')!.name = 'createTask';
		const issue = issueAt(d, 'sequences[0].messages[1].method');
		expect(issue?.message).toContain('addTask');
		expect(issue?.message).toContain('createTask');
	});

	it('rejects an unknown attribute type', () => {
		const d = design();
		d.classes[0].attributes[2].type = 'date';
		expect(issueAt(d, 'classes[0].attributes[2].type')?.message).toContain('"date"');
	});

	it('normalises types in a copy and leaves the input alone', () => {
		const d = design();
		const { normalised } = validateDesign(d, reqs());
		expect(d.classes[1].methods[1].returnType).toBe('Promise<Array<Task>>');
		expect(normalised.classes[1].methods[1].returnType).toBe('Promise<Task[]>');
		expect(normalised.classes[0].attributes[3].type).toBe('"open" | "done"');
	});

	it('reports unknown requirement IDs only when requirements are given', () => {
		const d = design();
		d.classes[0].reqIds = ['REQ-099'];
		expect(issueAt(d, 'classes[0].reqIds[0]')?.message).toContain('REQ-099');
		expect(validateDesign(d, null).issues).toEqual([]);
	});

	it('reports broken references', () => {
		const d = design();
		d.classes.push(structuredClone(d.classes[0]));
		d.useCases[0].actorIds.push('ACT-009');
		d.classes[0].relations.push({ kind: 'association', targetId: 'DSN-006' });
		d.components[1].classIds.push('DSN-001', 'DSN-042');
		d.components[1].nodeId = 'DSN-001';
		d.sequences[0].useCaseId = 'UC-009';
		d.sequences[0].messages.push({ fromId: 'DSN-007', toId: 'DSN-008', method: 'x' });
		expect(validateDesign(d, reqs()).issues.map((i) => i.path)).toEqual([
			'classes[5].id',
			'classes[5].name',
			'useCases[0].actorIds[1]',
			'classes[0].relations[0].targetId',
			'components[1].classIds[1]',
			'components[1].classIds[2]',
			'components[1].nodeId',
			'sequences[0].useCaseId',
			'sequences[0].messages[3].fromId',
			'sequences[0].messages[3].toId'
		]);
	});
});

describe('committed designs', () => {
	const root = new URL('../../../../', import.meta.url);
	const read = (file: string): unknown => JSON.parse(readFileSync(new URL(file, root), 'utf8'));
	it.each(['showcases/fixture', 'showcases/booking', 'showcases/auction', 'test/fixtures/p4'])(
		'%s validates with no issues or warnings',
		(dir) => {
			const reqFile = `${dir}/.aise/requirements.json`;
			const r = existsSync(new URL(reqFile, root)) ? RequirementsDoc.parse(read(reqFile)) : null;
			const d = DesignDoc.parse(read(`${dir}/.aise/design.json`));
			const { issues, warnings } = validateDesign(d, r);
			expect(issues).toEqual([]);
			expect(warnings).toEqual([]);
		}
	);
});

describe('validateDesign component membership', () => {
	it('reports a class that belongs to no component', () => {
		const d = design();
		d.components[1].classIds = [];
		const issue = issueAt(d, 'classes[4]');
		expect(issue?.message).toContain('SqliteTaskRepository');
		expect(issue?.message).toContain('no component');
	});
});

describe('validateDesign component folder names', () => {
	it.each(['App', '!!!'])('reports component name "%s" that gives no usable folder', (name) => {
		const d = design();
		d.components[0].name = name;
		const issue = issueAt(d, 'components[0].name');
		expect(issue?.message).toContain(`"${name}"`);
		expect(issue?.message).toContain('folder name');
	});
});

describe('uncoveredMustReqs', () => {
	it('is empty for the fixture', () => {
		expect(uncoveredMustReqs(design(), reqs())).toEqual([]);
	});

	it('lists a must requirement once nothing links to it', () => {
		const d = design();
		for (const el of [...d.useCases, ...d.classes, ...d.components, ...d.nodes]) {
			el.reqIds = el.reqIds.filter((id) => id !== 'REQ-002');
		}
		expect(uncoveredMustReqs(d, reqs())).toEqual(['REQ-002']);
	});
});

describe('validateDesign links', () => {
	const node = (id: string, kind: DesignDoc['nodes'][number]['kind']) => ({
		id,
		name: kind,
		kind,
		reqIds: []
	});

	it('reports unknown link ends, a self link and a duplicate link, but not two protocols', () => {
		const d = design();
		d.nodes.push(node('DSN-020', 'service'));
		const link = { from: 'DSN-008', to: 'DSN-020', protocol: 'http' } as const;
		d.links.push(
			link,
			{ ...link, protocol: 'ws' },
			{ from: 'DSN-001', to: 'DSN-008', protocol: 'http' },
			{ from: 'DSN-008', to: 'DSN-099', protocol: 'http' },
			{ from: 'DSN-008', to: 'DSN-008', protocol: 'http' },
			{ ...link }
		);
		const nodes = '(nodes: DSN-008 App server, DSN-020 service)';
		expect(validateDesign(d, reqs()).issues).toEqual([
			{ path: 'links[2].from', message: `"DSN-001" is not a deployment node ${nodes}` },
			{ path: 'links[3].to', message: `"DSN-099" is not a deployment node ${nodes}` },
			{ path: 'links[4].to', message: 'link from DSN-008 to itself; a link joins two nodes' },
			{
				path: 'links[5]',
				message: 'duplicate link DSN-008 to DSN-020 over http (also links[0])'
			}
		]);
	});

	it('reports sql to a non database node and another protocol to a database node', () => {
		const d = design();
		d.nodes.push(node('DSN-020', 'service'), node('DSN-021', 'database'));
		d.links.push(
			{ from: 'DSN-008', to: 'DSN-020', protocol: 'sql' },
			{ from: 'DSN-008', to: 'DSN-021', protocol: 'http' },
			{ from: 'DSN-020', to: 'DSN-021', protocol: 'sql' }
		);
		expect(validateDesign(d, reqs()).issues).toEqual([
			{
				path: 'links[0].protocol',
				message:
					'sql link to DSN-020, which is not a database node; sql is only for a database node'
			},
			{ path: 'links[1].protocol', message: 'link to database node DSN-021 uses http; use sql' }
		]);
	});

	it('reports an external node without a link', () => {
		const d = design();
		d.nodes.push(node('DSN-020', 'external'), node('DSN-021', 'external'));
		d.links.push({ from: 'DSN-021', to: 'DSN-008', protocol: 'https' });
		expect(validateDesign(d, reqs()).issues).toEqual([
			{
				path: 'nodes[1]',
				message: 'external node DSN-020 external has no link; link it to the node that calls it'
			}
		]);
	});

	it('warns about a dependency on a collaborator used as a type, unless the dependant holds it as an attribute', () => {
		const d = design();
		// TaskController holds TaskService as an attribute, so it gets the shared instance
		expect(validateDesign(d, reqs()).warnings).toEqual([]);
		d.classes.push({
			id: 'DSN-030',
			name: 'TaskReminder',
			kind: 'class',
			description: '',
			attributes: [],
			methods: [{ name: 'remind', params: [], returnType: 'void' }],
			values: [],
			relations: [{ kind: 'dependency', targetId: 'DSN-003' }],
			reqIds: []
		});
		d.components[0].classIds.push('DSN-030');
		expect(validateDesign(d, reqs()).warnings.map((w) => w.message)).toEqual([
			'TaskReminder depends on TaskService, which has methods but is used as the type of an attribute, parameter or return value, so it is not a constructor parameter and TaskReminder would build its own TaskService instead of sharing one: stop using TaskService as a type, or give TaskReminder an attribute of type TaskService'
		]);
	});

	it('warns about a component on a database or an external node', () => {
		const d = design();
		d.nodes.push(node('DSN-020', 'database'), node('DSN-021', 'external'));
		d.links.push({ from: 'DSN-008', to: 'DSN-021', protocol: 'https' });
		d.components[1].nodeId = 'DSN-020';
		expect(validateDesign(d, reqs()).warnings).toEqual([
			{
				path: 'components[1].nodeId',
				message:
					'component DSN-007 Persistence runs on database node DSN-020 database, which holds no components; move it to the node that runs the code'
			}
		]);
		d.components[1].nodeId = 'DSN-021';
		expect(validateDesign(d, reqs()).warnings.map((w) => w.message)).toEqual([
			'component DSN-007 Persistence runs on external node DSN-021 external, which holds no components; move it to the node that runs the code'
		]);
	});

	it('reports a component with classes on a client node, and passes one without classes', () => {
		const d = design();
		d.nodes.push(node('DSN-020', 'client'));
		d.links.push({ from: 'DSN-020', to: 'DSN-008', protocol: 'http' });
		d.components[1].nodeId = 'DSN-020';
		expect(validateDesign(d, reqs()).issues).toEqual([
			{
				path: 'components[1].classIds',
				message:
					'component DSN-007 Persistence on client node DSN-020 client must hold no classes (has DSN-005): remove them; server logic goes on a service node, the browser page is public/index.html'
			}
		]);
		d.components.push({
			id: 'DSN-021',
			name: 'Browser',
			classIds: [],
			nodeId: 'DSN-020',
			reqIds: []
		});
		d.components[1].nodeId = 'DSN-008';
		expect(validateDesign(d, reqs())).toMatchObject({ issues: [], warnings: [] });
	});

	it('reports a dependency across nodes, with or without a link, also to a database node', () => {
		const d = design();
		d.nodes.push(node('DSN-020', 'service'));
		d.components[1].nodeId = 'DSN-020';
		d.classes[4].relations[0].kind = 'dependency';
		const issue = {
			path: 'classes[4].relations[0]',
			message:
				'class DSN-005 SqliteTaskRepository (node DSN-020 service) depends on DSN-004 TaskRepository (node DSN-008 App server), so the call crosses nodes; model it as a client class on the calling node (as FrankfurterClient does) and a link between the nodes'
		};
		expect(validateDesign(d, reqs()).issues).toEqual([issue]);
		d.links = [{ from: 'DSN-020', to: 'DSN-008', protocol: 'http' }];
		expect(validateDesign(d, reqs()).issues).toEqual([issue]);
		d.links = [];
		d.nodes[1].kind = 'database';
		expect(validateDesign(d, reqs()).issues.map((i) => i.path)).toEqual([
			'classes[4].relations[0]'
		]);
		expect(nodeWarnings(d)).toEqual([expect.objectContaining({ path: 'components[1].nodeId' })]);
	});

	it('accepts a dependency across nodes on a class without methods, such as an entity', () => {
		const d = design();
		d.nodes.push(node('DSN-020', 'service'));
		d.components[1].nodeId = 'DSN-020';
		// SqliteTaskRepository depends on Task, an entity without methods
		d.classes[4].relations.push({ kind: 'dependency', targetId: 'DSN-001' });
		d.classes[0].methods = [];
		expect(validateDesign(d, reqs()).issues).toEqual([]);
	});

	it('accepts a dependency on the same node and other relation kinds across nodes', () => {
		const d = design();
		d.classes[4].relations[0].kind = 'dependency';
		expect(validateDesign(d, reqs()).issues).toEqual([]);
		expect(nodeWarnings(d)).toEqual([]);
		d.nodes.push(node('DSN-020', 'service'));
		d.components[1].nodeId = 'DSN-020';
		for (const kind of ['inheritance', 'association', 'composition'] as const) {
			d.classes[4].relations[0].kind = kind;
			expect(validateDesign(d, reqs()), kind).toMatchObject({ issues: [], warnings: [] });
		}
	});
});

describe('validateDesign dependency cycles', () => {
	it('reports a cycle of dependencies once, with its path', () => {
		const d = design();
		// TaskController -> TaskService -> TaskRepository -> TaskController
		d.classes[2].relations[0].kind = 'dependency';
		d.classes[3].relations.push({ kind: 'dependency', targetId: 'DSN-002' });
		expect(validateDesign(d, reqs()).issues).toEqual([
			{
				path: 'classes[1]',
				message:
					'dependency cycle DSN-002 TaskController, DSN-003 TaskService, DSN-004 TaskRepository, back to DSN-002 TaskController: no constructor can come first; remove one of these dependencies'
			}
		]);
	});

	it('reports a class that depends on itself', () => {
		const d = design();
		d.classes[2].relations.push({ kind: 'dependency', targetId: 'DSN-003' });
		expect(validateDesign(d, reqs()).issues.map((i) => i.message)).toEqual([
			'dependency cycle DSN-003 TaskService, back to DSN-003 TaskService: no constructor can come first; remove one of these dependencies'
		]);
	});

	it('reports a cycle once when a class names the same dependency twice', () => {
		const d = design();
		d.classes[2].relations.push(
			{ kind: 'dependency', targetId: 'DSN-003' },
			{ kind: 'dependency', targetId: 'DSN-003' }
		);
		expect(validateDesign(d, reqs()).issues).toHaveLength(1);
	});

	it('does not count association, composition or inheritance as a cycle', () => {
		const d = design();
		d.classes[3].relations.push({ kind: 'association', targetId: 'DSN-003' });
		d.classes[2].relations[0].kind = 'dependency';
		expect(validateDesign(d, reqs()).issues).toEqual([]);
	});
});

describe('validateDesign service node names', () => {
	const service = (id: string, name: string) => ({
		id,
		name,
		kind: 'service' as const,
		reqIds: []
	});

	it.each(['Main', 'App (backend)', '2nd Server'])(
		'reports service node name "%s" that gives no usable entry name',
		(name) => {
			const d = design();
			d.nodes.push(service('DSN-020', name));
			const issue = issueAt(d, 'nodes[1].name');
			expect(issue?.message).toContain(`"${name}"`);
			expect(issue?.message).toContain('entry file name');
		}
	);

	it('accepts any name on a lone service node, which keeps src/app/main.ts', () => {
		const d = design();
		d.nodes[0] = { ...d.nodes[0], name: 'App' };
		expect(validateDesign(d, reqs()).issues).toEqual([]);
	});

	it('reports two service nodes with the same entry name, and accepts other kinds', () => {
		const d = design();
		d.nodes.push(service('DSN-020', 'App Server (backup)'));
		expect(issueAt(d, 'nodes[1].name')?.message).toBe(
			'service node DSN-020 App Server (backup) gives the entry name "app-server" like nodes[0]; rename one'
		);
		d.nodes[1] = { ...d.nodes[1], kind: 'external' };
		d.links.push({ from: 'DSN-008', to: 'DSN-020', protocol: 'https' });
		expect(validateDesign(d, reqs()).issues).toEqual([]);
	});
});

describe('validateDesign warnings', () => {
	it('has none for the fixture', () => {
		expect(validateDesign(design(), reqs()).warnings).toEqual([]);
	});

	it('warns about a class or interface without members and an enum without values', () => {
		const d = design();
		const empty = { attributes: [], methods: [], values: [], relations: [], description: '' };
		d.classes.push(
			{ ...empty, id: 'DSN-010', name: 'UserRepository', kind: 'class', reqIds: [] },
			{ ...empty, id: 'DSN-011', name: 'Marker', kind: 'interface', reqIds: [] },
			{ ...empty, id: 'DSN-012', name: 'Colour', kind: 'enum', reqIds: [] }
		);
		d.components[0].classIds.push('DSN-010', 'DSN-011', 'DSN-012');
		const { issues, warnings } = validateDesign(d, reqs());
		expect(issues).toEqual([]);
		expect(warnings).toEqual([
			{
				path: 'classes[5]',
				message:
					'class DSN-010 UserRepository has no attributes or methods; give it members or remove it'
			},
			{
				path: 'classes[6]',
				message:
					'interface DSN-011 Marker has no attributes or methods; give it members or remove it'
			},
			{ path: 'classes[7]', message: 'enum DSN-012 Colour has no values; add values or remove it' }
		]);
	});

	it('does not warn about a class with only attributes or only methods', () => {
		const d = design();
		d.classes[0].methods = [];
		d.classes[2].attributes = [];
		expect(validateDesign(d, reqs()).warnings).toEqual([]);
	});
});

describe('nextFreeIds', () => {
	it('gives the number after the highest of each prefix, DSN shared by classes, components and nodes', () => {
		expect(nextFreeIds(design())).toEqual({
			ACT: 'ACT-003',
			UC: 'UC-004',
			SEQ: 'SEQ-002',
			DSN: 'DSN-009'
		});
	});

	it('counts IDs of the saved design too, so a deleted ID is not reused', () => {
		const saved = design();
		const next = design();
		next.nodes = [];
		next.useCases = [];
		expect(nextFreeIds(next, null)).toMatchObject({ DSN: 'DSN-008', UC: 'UC-001' });
		expect(nextFreeIds(next, saved)).toMatchObject({ DSN: 'DSN-009', UC: 'UC-004' });
	});

	it('reports a prefix with no IDs left instead of throwing', () => {
		const d = design();
		d.nodes[0].id = 'DSN-999';
		expect(nextFreeIds(d)).toMatchObject({ DSN: 'no DSN IDs left', UC: 'UC-004' });
	});
});
