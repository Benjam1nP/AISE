import { describe, expect, it } from 'vitest';
import type { DesignClass, DesignDoc, Sequence, UseCase } from '../core/schemas/design';
import type { Requirement, RequirementsDoc } from '../core/schemas/requirements';
import { parseTestName } from '../../test-names';
import { planTests } from './plan';

const req = (id: string, over: Partial<Requirement> = {}): Requirement => ({
	id,
	title: `Title ${id}`,
	text: `Text ${id}`,
	type: 'functional',
	priority: 'must',
	acceptanceCriteria: [`${id} works`],
	...over
});

const reqs = (requirements: Requirement[]): RequirementsDoc => ({
	requirements,
	openQuestions: [],
	assumptions: [],
	outOfScope: []
});

const useCase = (id: string, reqIds: string[]): UseCase => ({
	id,
	name: `Use case ${id}`,
	description: '',
	actorIds: [],
	reqIds
});

const cls = (id: string, reqIds: string[] = []): DesignClass => ({
	id,
	name: `Class${id.slice(4)}`,
	kind: 'class',
	description: '',
	attributes: [],
	methods: [],
	values: [],
	relations: [],
	reqIds
});

/** A sequence whose messages go to the given receivers, one message each. */
const sequence = (id: string, useCaseId: string, toIds: string[] = []): Sequence => ({
	id,
	name: `Sequence ${id}`,
	useCaseId,
	messages: toIds.map((toId) => ({ fromId: 'ACT-001', toId, method: 'run' }))
});

const design = (over: Partial<DesignDoc> = {}): DesignDoc => ({
	actors: [],
	useCases: [],
	classes: [],
	components: [],
	nodes: [],
	links: [],
	sequences: [],
	...over
});

describe('planTests', () => {
	it('makes one plan per use case, with the use case ID, name and test/<UC-ID>.test.ts path', () => {
		const plans = planTests(
			reqs([req('REQ-001')]),
			design({ useCases: [useCase('UC-001', ['REQ-001'])] })
		);
		expect(plans).toEqual([
			{
				id: 'UC-001',
				name: 'Use case UC-001',
				path: 'test/UC-001.test.ts',
				criteria: [{ reqId: 'REQ-001', n: 1, text: 'REQ-001 works', manualHint: false }],
				sequenceIds: [],
				classIds: []
			}
		]);
	});

	it('trims the criterion text, so the title the brief asks for always parses', () => {
		const [plan] = planTests(
			reqs([req('REQ-001', { acceptanceCriteria: ['  padded text\n'] })]),
			design({ useCases: [useCase('UC-001', ['REQ-001'])] })
		);
		expect(plan!.criteria[0]!.text).toBe('padded text');
		const title = `REQ-001 AC1: ${plan!.criteria[0]!.text}`;
		expect(parseTestName(title)).toMatchObject({ kind: 'ac', reqId: 'REQ-001', n: 1 });
	});

	it('lists criteria in the use case reqIds order and numbers them per requirement', () => {
		const requirements = reqs([
			req('REQ-001', { acceptanceCriteria: ['first of one', 'second of one'] }),
			req('REQ-002', { acceptanceCriteria: ['only of two'] })
		]);
		const [plan] = planTests(
			requirements,
			design({ useCases: [useCase('UC-001', ['REQ-002', 'REQ-001'])] })
		);
		expect(plan.criteria).toEqual([
			{ reqId: 'REQ-002', n: 1, text: 'only of two', manualHint: false },
			{ reqId: 'REQ-001', n: 1, text: 'first of one', manualHint: false },
			{ reqId: 'REQ-001', n: 2, text: 'second of one', manualHint: false }
		]);
	});

	it('tests a requirement linked to several use cases only in the use case with the lowest ID', () => {
		const plans = planTests(
			reqs([req('REQ-001')]),
			design({ useCases: [useCase('UC-002', ['REQ-001']), useCase('UC-001', ['REQ-001'])] })
		);
		expect(plans.find((p) => p.id === 'UC-001')?.criteria.map((c) => c.reqId)).toEqual(['REQ-001']);
		expect(plans.find((p) => p.id === 'UC-002')?.criteria).toEqual([]);
	});

	it('lists a requirement once when a use case links it twice', () => {
		const [plan] = planTests(
			reqs([req('REQ-001')]),
			design({ useCases: [useCase('UC-001', ['REQ-001', 'REQ-001'])] })
		);
		expect(plan.criteria.map((c) => c.n)).toEqual([1]);
	});

	it('makes a plan per requirement that no use case links, named after its title, with no sequences', () => {
		const orphan = req('REQ-009', { title: 'Dark mode', acceptanceCriteria: ['theme switches'] });
		const plans = planTests(
			reqs([req('REQ-001'), orphan]),
			design({
				useCases: [useCase('UC-001', ['REQ-001'])],
				classes: [cls('DSN-001', ['REQ-009'])]
			})
		);
		expect(plans.map((p) => p.id)).toEqual(['REQ-009', 'UC-001']);
		expect(plans.find((p) => p.id === 'REQ-009')).toEqual({
			id: 'REQ-009',
			name: 'Dark mode',
			path: 'test/REQ-009.test.ts',
			criteria: [{ reqId: 'REQ-009', n: 1, text: 'theme switches', manualHint: false }],
			sequenceIds: [],
			classIds: ['DSN-001']
		});
	});

	it('lists the sequences of the use case, sorted', () => {
		const [plan] = planTests(
			reqs([req('REQ-001')]),
			design({
				useCases: [useCase('UC-001', ['REQ-001']), useCase('UC-002', [])],
				sequences: [
					sequence('SEQ-002', 'UC-001'),
					sequence('SEQ-003', 'UC-002'),
					sequence('SEQ-001', 'UC-001')
				]
			})
		);
		expect(plan.sequenceIds).toEqual(['SEQ-001', 'SEQ-002']);
	});

	it('lists classes linked to the use case requirements, including requirements tested in another use case', () => {
		const plans = planTests(
			reqs([req('REQ-001')]),
			design({
				useCases: [useCase('UC-001', ['REQ-001']), useCase('UC-002', ['REQ-001'])],
				classes: [cls('DSN-005', ['REQ-001']), cls('DSN-002', ['REQ-001']), cls('DSN-009')]
			})
		);
		expect(plans.find((p) => p.id === 'UC-002')?.classIds).toEqual(['DSN-002', 'DSN-005']);
	});

	it('adds the receivers of the sequence messages that are classes, sorted and unique', () => {
		const plans = planTests(
			reqs([req('REQ-001')]),
			design({
				useCases: [useCase('UC-001', ['REQ-001']), useCase('UC-002', [])],
				classes: [cls('DSN-003', ['REQ-001']), cls('DSN-004'), cls('DSN-009')],
				nodes: [{ id: 'DSN-020', name: 'Server', kind: 'service', reqIds: [] }],
				sequences: [
					sequence('SEQ-001', 'UC-001', ['DSN-004', 'DSN-003', 'DSN-004', 'DSN-020']),
					// Belongs to UC-002, so its receiver must not reach UC-001's classes.
					sequence('SEQ-002', 'UC-002', ['DSN-009'])
				]
			})
		);
		// DSN-020 is a deployment node, not a class, so it is left out.
		expect(plans.find((p) => p.id === 'UC-001')?.classIds).toEqual(['DSN-003', 'DSN-004']);
	});

	it('sets manualHint on the criteria of non-functional requirements only', () => {
		const [plan] = planTests(
			reqs([req('REQ-001', { type: 'non-functional' }), req('REQ-002')]),
			design({ useCases: [useCase('UC-001', ['REQ-001', 'REQ-002'])] })
		);
		expect(plan.criteria.map((c) => [c.reqId, c.manualHint])).toEqual([
			['REQ-001', true],
			['REQ-002', false]
		]);
	});

	it('keeps a use case whose requirements are all tested elsewhere, with empty criteria and its sequences', () => {
		const plans = planTests(
			reqs([req('REQ-001')]),
			design({
				useCases: [useCase('UC-001', ['REQ-001']), useCase('UC-002', ['REQ-001'])],
				sequences: [sequence('SEQ-004', 'UC-002')]
			})
		);
		const second = plans.find((p) => p.id === 'UC-002');
		expect(second?.criteria).toEqual([]);
		expect(second?.sequenceIds).toEqual(['SEQ-004']);
	});

	it('sorts the plans by ID across use cases and requirement files', () => {
		const plans = planTests(
			reqs([req('REQ-001'), req('REQ-002')]),
			design({ useCases: [useCase('UC-002', []), useCase('UC-001', ['REQ-001'])] })
		);
		expect(plans.map((p) => p.id)).toEqual(['REQ-002', 'UC-001', 'UC-002']);
	});

	it('ignores a reqId that matches no requirement, giving it no criteria and no error', () => {
		const [plan] = planTests(
			reqs([req('REQ-001')]),
			design({ useCases: [useCase('UC-001', ['REQ-999', 'REQ-001'])] })
		);
		expect(plan.criteria.map((c) => c.reqId)).toEqual(['REQ-001']);
	});

	it('returns no plans for empty documents', () => {
		expect(planTests(reqs([]), design())).toEqual([]);
	});
});
