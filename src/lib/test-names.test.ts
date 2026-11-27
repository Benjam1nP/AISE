import { describe, expect, it } from 'vitest';
import * as server from '#lib/server/core/test-state.ts';
import { findingOpen, parseTestName, unexplainedFailures } from './test-names.ts';

const test = (name: string, status: 'passed' | 'failed' = 'failed', suite?: true) => ({
	name: `UC-001 Add ${name}`,
	title: name,
	file: 'test/UC-001.test.ts',
	status,
	...(suite ? { suite } : {})
});
const finding = (name: string, file = 'test/UC-001.test.ts') => ({ test: name, file });

describe('test-names', () => {
	it('is the module the server re-exports, not a copy', () => {
		expect(server.parseTestName).toBe(parseTestName);
		expect(server.findingOpen).toBe(findingOpen);
	});

	it('findingOpen matches by exact title or full name, in the same file, and closes only on a non failing match', () => {
		const result = { tests: [test('REQ-001 AC2: b')] };
		expect(findingOpen(finding('REQ-001 AC2: b'), result)).toBe(true);
		expect(findingOpen(finding('UC-001 Add REQ-001 AC2: b'), result)).toBe(true);
		for (const status of ['passed', 'todo', 'skipped'] as const) {
			const other = { tests: [{ ...test('REQ-001 AC2: b'), status }] };
			expect(findingOpen(finding('REQ-001 AC2: b'), other)).toBe(false);
			expect(findingOpen(finding('UC-001 Add REQ-001 AC2: b'), other)).toBe(false);
			// the same test in another file says nothing about this one
			const inOther = { ...test('REQ-001 AC2: b'), file: 'test/other.test.ts' };
			expect(
				findingOpen(finding('REQ-001 AC2: b', 'test/other.test.ts'), {
					tests: [...other.tests, inOther]
				})
			).toBe(true);
		}
	});

	it('findingOpen resolves when its test was renamed or its file removed, stays open on a suite failure or no result', () => {
		const f = finding('REQ-001 AC2: b');
		expect(findingOpen(f, { tests: [test('REQ-001 AC2: renamed', 'passed')] })).toBe(false);
		expect(findingOpen(f, { tests: [] })).toBe(false);
		expect(findingOpen(f, { tests: [test('test/UC-001.test.ts', 'failed', true)] })).toBe(true);
		expect(findingOpen(f, null)).toBe(true);
	});

	it('a finding matches only its own test, not another one in the file that ends the same way', () => {
		const result = {
			tests: [
				{ ...test('x'), name: 'UC-001 Add works', title: 'Add works', status: 'failed' as const },
				{ ...test('x'), name: 'UC-001 works', title: 'works', status: 'passed' as const }
			]
		};
		expect(findingOpen(finding('works'), result)).toBe(false);
		expect(findingOpen(finding('Add works'), result)).toBe(true);
	});

	it('findingOpen is false once the finding is resolved, even while its test fails again', () => {
		const result = { tests: [test('REQ-001 AC2: b')] };
		const f = { ...finding('REQ-001 AC2: b'), resolvedAt: '2026-11-21T10:00:00.000Z' };
		expect(findingOpen(f, result)).toBe(false);
	});

	it('unexplainedFailures lists failing tests without an open finding, never suite failures', () => {
		const result = {
			tests: [
				test('REQ-001 AC1: a'),
				test('REQ-001 AC2: b'),
				test('REQ-001 AC3: c', 'passed'),
				test('test/UC-001.test.ts', 'failed', true)
			]
		};
		expect(unexplainedFailures(result, []).map((t) => t.title)).toEqual([
			'REQ-001 AC1: a',
			'REQ-001 AC2: b'
		]);
		const open = finding('REQ-001 AC2: b');
		expect(unexplainedFailures(result, [open]).map((t) => t.title)).toEqual(['REQ-001 AC1: a']);
		// A resolved finding explains nothing.
		const resolved = { ...finding('REQ-001 AC1: a'), resolvedAt: 'x' };
		expect(unexplainedFailures(result, [open, resolved]).map((t) => t.title)).toEqual([
			'REQ-001 AC1: a'
		]);
		expect(unexplainedFailures(null, [])).toEqual([]);
	});
});
