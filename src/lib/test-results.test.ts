import { describe, expect, it } from 'vitest';
import type { TestResult } from '#lib/server/core/docker/parse.ts';
import type { Requirement } from '#lib/server/core/schemas/requirements.ts';
import { describeTitle, groupTests, missingCriteria } from './test-results.ts';

const req = (id: string, n: number, priority: Requirement['priority'] = 'must'): Requirement => ({
	id,
	title: id,
	text: id,
	type: 'functional',
	priority,
	acceptanceCriteria: Array.from({ length: n }, (_, i) => `criterion ${i + 1}`)
});
const t = (
	title: string,
	status: TestResult['status'],
	over: Partial<TestResult> = {}
): TestResult => ({
	name: `UC-001 Add task ${title}`,
	title,
	file: 'test/UC-001.test.ts',
	status,
	...over
});

describe('describeTitle', () => {
	it('reads criterion, scenario and manual titles', () => {
		expect(describeTitle('REQ-003 AC2: adds a task')).toEqual({
			label: 'REQ-003 AC2',
			text: 'adds a task',
			manual: false
		});
		expect(describeTitle('REQ-007 AC1: manual: needs a person')).toMatchObject({
			label: 'REQ-007 AC1',
			text: 'needs a person',
			manual: true
		});
		expect(describeTitle('SEQ-002 scenario: add then list')).toMatchObject({
			label: 'SEQ-002',
			text: 'add then list'
		});
		expect(describeTitle('something else')).toEqual({
			label: '',
			text: 'something else',
			manual: false
		});
	});
});

describe('groupTests', () => {
	it('groups by describe title in design order and falls back to the file', () => {
		const tests = [
			t('REQ-002 AC1: b', 'passed', {
				name: 'UC-002 Second REQ-002 AC1: b',
				file: 'test/UC-002.test.ts'
			}),
			t('REQ-001 AC1: a', 'failed', { error: '\nexpected 1\nat x' }),
			t('REQ-001 AC2: c', 'todo', {
				title: 'REQ-001 AC2: manual: why',
				name: 'UC-001 Add task REQ-001 AC2: manual: why'
			}),
			{ name: 'loose', title: 'loose', file: 'test/x.test.ts', status: 'skipped' } as TestResult
		];
		const design = { useCases: [{ id: 'UC-001' }, { id: 'UC-002' }] } as never;
		const groups = groupTests(tests, design);
		expect(groups.map((g) => g.heading)).toEqual([
			'UC-001 Add task',
			'UC-002 Second',
			'test/x.test.ts'
		]);
		expect(groups[0]!.rows.map((r) => r.status)).toEqual(['failed', 'manual']);
		expect(groups[0]!.rows[0]!.error).toBe('expected 1');
	});
});

describe('missingCriteria', () => {
	it('lists the criteria no passed, failed or manual test names, with their text', () => {
		const reqs = [req('REQ-001', 4), req('REQ-002', 1, 'should')];
		const tests = [
			t('REQ-001 AC1: a', 'passed'),
			t('REQ-001 AC2: b', 'failed'),
			t('REQ-001 AC3: manual: c', 'todo'),
			t('REQ-001 AC4: d', 'skipped'),
			t('REQ-009 AC1: unknown', 'passed')
		];
		expect(missingCriteria(reqs, tests)).toEqual([
			{ reqId: 'REQ-001', n: 4, priority: 'must', text: 'criterion 4' },
			{ reqId: 'REQ-002', n: 1, priority: 'should', text: 'criterion 1' }
		]);
	});
});
