import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ID_PATTERNS, nextId, toMermaidId } from '../ids';
import { RequirementsDoc } from './requirements';
import { DesignDoc } from './design';

const validRequirements = {
	requirements: [
		{
			id: 'REQ-001',
			title: 'Create task',
			text: 'A user can create a task with a title.',
			type: 'functional',
			priority: 'must',
			acceptanceCriteria: ['A task with a title appears in the list.']
		}
	],
	openQuestions: [{ id: 'Q-001', text: 'Do tasks have due dates?', reqIds: ['REQ-001'] }],
	assumptions: [],
	outOfScope: []
};

const validClass = {
	id: 'DSN-001',
	name: 'TaskManager',
	kind: 'class',
	description: 'Keeps the task list.',
	attributes: [{ name: 'tasks', type: 'Task[]' }],
	methods: [{ name: 'add', params: [{ name: 'title', type: 'string' }], returnType: 'Task' }],
	relations: [{ kind: 'composition', targetId: 'DSN-002', multiplicity: '0..*' }],
	reqIds: ['REQ-001']
};

const validDesign = {
	actors: [{ id: 'ACT-001', name: 'User', description: 'Person managing tasks.' }],
	useCases: [
		{
			id: 'UC-001',
			name: 'Create task',
			description: 'User adds a task.',
			actorIds: ['ACT-001'],
			reqIds: ['REQ-001']
		}
	],
	classes: [validClass],
	components: [
		{ id: 'DSN-010', name: 'API', classIds: ['DSN-001'], nodeId: 'DSN-020', reqIds: [] }
	],
	nodes: [{ id: 'DSN-020', name: 'Server', kind: 'service', reqIds: [] }],
	sequences: [
		{
			id: 'SEQ-001',
			name: 'Create task flow',
			useCaseId: 'UC-001',
			messages: [
				{ fromId: 'ACT-001', toId: 'DSN-001', method: 'add' },
				{ fromId: 'DSN-001', toId: 'DSN-001', method: 'save', label: 'persist' }
			]
		}
	]
};

function withClass(overrides: Record<string, unknown>) {
	return { ...validDesign, classes: [{ ...validClass, ...overrides }] };
}

describe('ids', () => {
	it('nextId continues after the highest existing number', () => {
		expect(nextId('REQ', ['REQ-001', 'REQ-003'])).toBe('REQ-004');
	});

	it('nextId starts at 001', () => {
		expect(nextId('UC', [])).toBe('UC-001');
	});

	it('nextId ignores other prefixes and malformed entries', () => {
		expect(nextId('UC', ['UC-002', 'REQ-009', 'UC-9', 'UC-0100', 'xUC-005', 'SEQ-007'])).toBe(
			'UC-003'
		);
	});

	it('toMermaidId replaces the dash', () => {
		expect(toMermaidId('DSN-012')).toBe('DSN_012');
	});

	it('ID_PATTERNS require three digits', () => {
		expect(ID_PATTERNS.REQ.test('REQ-001')).toBe(true);
		expect(ID_PATTERNS.REQ.test('REQ-1')).toBe(false);
		expect(ID_PATTERNS.Q.test('Q-012')).toBe(true);
		expect(ID_PATTERNS.TCK.test('TCK-001')).toBe(true);
		expect(ID_PATTERNS.TCK.test('TCK-1')).toBe(false);
	});
});

describe('RequirementsDoc schema', () => {
	it('parses a valid minimal doc', () => {
		expect(RequirementsDoc.safeParse(validRequirements).success).toBe(true);
		const empty = { requirements: [], openQuestions: [], assumptions: [], outOfScope: [] };
		expect(RequirementsDoc.safeParse(empty).success).toBe(true);
	});

	it('rejects an unknown priority', () => {
		const doc = structuredClone(validRequirements);
		doc.requirements[0].priority = 'high';
		expect(RequirementsDoc.safeParse(doc).success).toBe(false);
	});

	it('rejects empty acceptanceCriteria', () => {
		const doc = structuredClone(validRequirements);
		doc.requirements[0].acceptanceCriteria = [];
		expect(RequirementsDoc.safeParse(doc).success).toBe(false);
	});

	it('rejects a malformed id', () => {
		const doc = structuredClone(validRequirements);
		doc.requirements[0].id = 'REQ-1';
		expect(RequirementsDoc.safeParse(doc).success).toBe(false);
	});

	it('rejects a malformed reqId in an open question', () => {
		const doc = structuredClone(validRequirements);
		doc.openQuestions[0].reqIds = ['UC-001'];
		expect(RequirementsDoc.safeParse(doc).success).toBe(false);
	});

	it('rejects unknown fields', () => {
		const doc = structuredClone(validRequirements);
		Object.assign(doc.requirements[0], { foo: 1 });
		expect(RequirementsDoc.safeParse(doc).success).toBe(false);
	});

	it('rejects duplicate requirement and question IDs', () => {
		const doc = structuredClone(validRequirements);
		doc.requirements.push({ ...doc.requirements[0], title: 'Again' });
		doc.openQuestions.push({ ...doc.openQuestions[0], text: 'Another question?' });
		const result = RequirementsDoc.safeParse(doc);
		expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual([
			'requirements.1.id',
			'openQuestions.1.id'
		]);
	});

	it('rejects an open question linked to a requirement that does not exist', () => {
		const doc = structuredClone(validRequirements);
		doc.openQuestions[0].reqIds = ['REQ-001', 'REQ-009'];
		const issue = RequirementsDoc.safeParse(doc).error?.issues[0];
		expect(issue?.path.join('.')).toBe('openQuestions.0.reqIds.1');
		expect(issue?.message).toContain('REQ-009');
	});

	it('rejects empty titles, texts and list entries', () => {
		const blank = (edit: (d: typeof validRequirements) => void) => {
			const doc = structuredClone(validRequirements);
			edit(doc);
			return RequirementsDoc.safeParse(doc).success;
		};
		expect(blank((d) => (d.requirements[0].title = ''))).toBe(false);
		expect(blank((d) => (d.requirements[0].text = ''))).toBe(false);
		expect(blank((d) => (d.requirements[0].acceptanceCriteria = ['']))).toBe(false);
		expect(blank((d) => (d.openQuestions[0].text = ''))).toBe(false);
		expect(blank((d) => ((d.assumptions as string[]) = ['']))).toBe(false);
		expect(blank((d) => ((d.outOfScope as string[]) = ['']))).toBe(false);
	});
});

describe('DesignDoc schema', () => {
	it('parses a valid doc and defaults values to []', () => {
		const result = DesignDoc.safeParse(validDesign);
		expect(result.success).toBe(true);
		expect(result.data?.classes[0].values).toEqual([]);
	});

	it('rejects a class name that is not PascalCase', () => {
		expect(DesignDoc.safeParse(withClass({ name: 'task manager' })).success).toBe(false);
	});

	it('rejects an extra field on a class', () => {
		expect(DesignDoc.safeParse(withClass({ foo: 'bar' })).success).toBe(false);
	});

	it('rejects a relation target that is not a DSN id', () => {
		const relations = [{ kind: 'association', targetId: 'UC-001' }];
		expect(DesignDoc.safeParse(withClass({ relations })).success).toBe(false);
	});

	it('accepts ACT or DSN as message sender but only DSN as receiver', () => {
		const withMessage = (fromId: string, toId: string) => ({
			...validDesign,
			sequences: [{ ...validDesign.sequences[0], messages: [{ fromId, toId, method: 'm' }] }]
		});
		expect(DesignDoc.safeParse(withMessage('ACT-001', 'DSN-001')).success).toBe(true);
		expect(DesignDoc.safeParse(withMessage('DSN-002', 'DSN-001')).success).toBe(true);
		expect(DesignDoc.safeParse(withMessage('UC-001', 'DSN-001')).success).toBe(false);
		expect(DesignDoc.safeParse(withMessage('DSN-001', 'ACT-001')).success).toBe(false);
	});

	it('requires identifier names for attributes, methods, parameters and enum values', () => {
		const bad = ['due date', 'add;', '1st', ''];
		for (const name of bad) {
			const attributes = [{ name, type: 'string' }];
			const methods = [{ name, params: [], returnType: 'void' }];
			const params = [{ ...validClass.methods[0], params: [{ name, type: 'string' }] }];
			expect(DesignDoc.safeParse(withClass({ attributes })).success).toBe(false);
			expect(DesignDoc.safeParse(withClass({ methods })).success).toBe(false);
			expect(DesignDoc.safeParse(withClass({ methods: params })).success).toBe(false);
			expect(DesignDoc.safeParse(withClass({ kind: 'enum', values: [name] })).success).toBe(false);
		}
		const ok = withClass({ attributes: [{ name: '_id$2', type: 'string' }], values: ['OPEN'] });
		expect(DesignDoc.safeParse(ok).success).toBe(true);
	});

	it('rejects empty element names', () => {
		const blankActor = { ...validDesign, actors: [{ ...validDesign.actors[0], name: '' }] };
		const blankNode = { ...validDesign, nodes: [{ ...validDesign.nodes[0], name: '' }] };
		expect(DesignDoc.safeParse(blankActor).success).toBe(false);
		expect(DesignDoc.safeParse(blankNode).success).toBe(false);
	});

	it('accepts client nodes, defaults links to [] and rejects an unknown protocol', () => {
		const client = { ...validDesign.nodes[0], id: 'DSN-021', kind: 'client' };
		const withNodes = { ...validDesign, nodes: [...validDesign.nodes, client] };
		expect(DesignDoc.parse(withNodes).links).toEqual([]);
		const link = { from: 'DSN-021', to: 'DSN-020', protocol: 'http' };
		expect(DesignDoc.safeParse({ ...withNodes, links: [link] }).success).toBe(true);
		const sql = { ...link, protocol: 'sql' };
		expect(DesignDoc.safeParse({ ...withNodes, links: [sql] }).success).toBe(true);
		const ftp = { ...link, protocol: 'ftp' };
		expect(DesignDoc.safeParse({ ...withNodes, links: [ftp] }).success).toBe(false);
	});

	it('converts to JSON Schema for tool input', () => {
		expect(() => z.toJSONSchema(DesignDoc, { io: 'input' })).not.toThrow();
		expect(() => z.toJSONSchema(RequirementsDoc, { io: 'input' })).not.toThrow();
	});
});
