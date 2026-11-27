import { describe, expect, it } from 'vitest';
import type { DesignDoc } from './server/core/schemas/design';
import { FOCUS_CLASS, focusSource, traceNames, traceTarget } from './trace-nav';

const design: DesignDoc = {
	actors: [{ id: 'ACT-001', name: 'User', description: '' }],
	useCases: [
		{ id: 'UC-001', name: 'Add task', description: '', actorIds: ['ACT-001'], reqIds: ['REQ-001'] }
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
	components: [
		{ id: 'DSN-010', name: 'tasks', classIds: ['DSN-001'], nodeId: 'DSN-020', reqIds: [] }
	],
	nodes: [{ id: 'DSN-020', name: 'server', kind: 'service', reqIds: [] }],
	links: [],
	sequences: [{ id: 'SEQ-001', name: 'Add', useCaseId: 'UC-001', messages: [] }]
};

describe('traceTarget', () => {
	it('sends a requirement to its row, even without a design', () => {
		expect(traceTarget('REQ-001', null)).toEqual({ tab: 'requirements', id: 'REQ-001' });
	});

	it('sends each design element to the diagram that draws it', () => {
		expect(traceTarget('UC-001', design)).toMatchObject({ tab: 'diagrams', kind: 'useCase' });
		expect(traceTarget('ACT-001', design)).toMatchObject({ tab: 'diagrams', kind: 'useCase' });
		expect(traceTarget('DSN-001', design)).toMatchObject({ tab: 'diagrams', kind: 'class' });
		expect(traceTarget('DSN-010', design)).toMatchObject({ tab: 'diagrams', kind: 'deployment' });
		expect(traceTarget('DSN-020', design)).toMatchObject({ tab: 'diagrams', kind: 'deployment' });
		expect(traceTarget('SEQ-001', design)).toEqual({
			tab: 'diagrams',
			id: 'SEQ-001',
			kind: 'sequence',
			seqId: 'SEQ-001'
		});
	});

	it('has no target for an ID the design lacks, a ticket or any other text', () => {
		expect(traceTarget('UC-009', design)).toBeUndefined();
		expect(traceTarget('UC-001', null)).toBeUndefined();
		expect(traceTarget('TCK-001', design)).toBeUndefined();
		expect(traceTarget('REQUIREMENT', design)).toBeUndefined();
	});
});

describe('focusSource', () => {
	it('marks a use case or actor by its Mermaid ID', () => {
		const out = focusSource('flowchart LR', 'useCase', 'UC-001', design);
		expect(out).toContain(`classDef ${FOCUS_CLASS} `);
		expect(out).toContain(`class UC_001 ${FOCUS_CLASS}`);
	});

	it('marks a class by its name', () => {
		expect(focusSource('classDiagram', 'class', 'DSN-001', design)).toBe(
			`classDiagram\n  cssClass "TaskService" ${FOCUS_CLASS}`
		);
	});

	it('marks a component or node in the deployment diagram', () => {
		expect(focusSource('flowchart TB', 'deployment', 'DSN-020', design)).toContain(
			`class DSN_020 ${FOCUS_CLASS}`
		);
	});

	it('leaves the source alone without an ID, for an ID the diagram does not draw, or a sequence', () => {
		expect(focusSource('x', 'useCase', undefined, design)).toBe('x');
		expect(focusSource('x', 'useCase', 'DSN-001', design)).toBe('x');
		expect(focusSource('x', 'class', 'UC-001', design)).toBe('x');
		expect(focusSource('x', 'sequence', 'SEQ-001', design)).toBe('x');
		expect(focusSource('x', 'class', 'DSN-001', null)).toBe('x');
	});
});

describe('traceNames', () => {
	it('names requirements by title and design elements by name', () => {
		const names = traceNames([{ id: 'REQ-001', title: 'Add a task' }], design);
		expect(names).toMatchObject({
			'REQ-001': 'Add a task',
			'UC-001': 'Add task',
			'DSN-001': 'TaskService',
			'DSN-020': 'server',
			'SEQ-001': 'Add'
		});
	});
});
