import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { testChecksOf } from './fixtures.ts';
import TestResults from './TestResults.svelte';

const reqs = [
	{
		id: 'REQ-001',
		title: 'Tasks',
		text: 't',
		type: 'functional',
		priority: 'must',
		acceptanceCriteria: ['adds a task', 'rejects an empty title', 'manual one', 'lists tasks']
	}
] as never;
const design = { useCases: [{ id: 'UC-001' }, { id: 'UC-002' }] } as never;

const props = (over: Record<string, unknown> = {}) => ({
	checks: testChecksOf(),
	reqs,
	design,
	onOpen: () => {},
	...over
});

describe('TestResults', () => {
	it('groups the tests by use case in design order', () => {
		render(TestResults, props());
		const groups = screen.getAllByRole('group');
		expect(groups.map((g) => within(g).getByRole('heading').textContent)).toEqual([
			'UC-001 Add task',
			'UC-002 List tasks'
		]);
		expect(within(groups[0]!).getAllByRole('button')).toHaveLength(3);
	});

	it('labels every test with its status and trace label', () => {
		render(TestResults, props());
		const [passed, failed, manual] = screen.getAllByRole('button');
		expect(passed!.textContent).toContain('passed');
		expect(passed!.textContent).toContain('REQ-001 AC1');
		expect(failed!.textContent).toContain('failed');
		expect(failed!.textContent).toContain('expected 400 to be 201');
		expect(manual!.textContent).toContain('manual');
		expect(screen.getByRole('button', { name: /SEQ-001/ }).textContent).toContain('passed');
	});

	it('opens the test file at its line on click', async () => {
		const onOpen = vi.fn();
		render(TestResults, props({ onOpen }));
		await userEvent.click(screen.getByRole('button', { name: /REQ-001 AC2/ }));
		expect(onOpen).toHaveBeenCalledWith('test/UC-001.test.ts', 12);
	});

	it('lists the criteria without a test', () => {
		render(TestResults, props());
		const list = screen.getByRole('list', { name: 'Criteria without a test' });
		expect(list.textContent).toContain('REQ-001 AC4');
		expect(list.textContent).toContain('lists tasks');
		expect(within(list).getAllByRole('listitem')).toHaveLength(1);
	});

	it('shows no missing list when every criterion has a test', () => {
		const one = [
			{ ...((reqs as never[])[0] as object), acceptanceCriteria: ['a', 'b', 'c'] }
		] as never;
		render(TestResults, props({ reqs: one }));
		expect(screen.queryByRole('list', { name: 'Criteria without a test' })).toBeNull();
	});

	it('says so when the run timed out or found no tests', () => {
		const base = testChecksOf();
		render(
			TestResults,
			props({ checks: { ...base, result: { ...base.result!, timedOut: true } } })
		);
		expect(screen.getByRole('alert').textContent).toContain('timed out');
	});

	it('warns when the suite ran but no test passed or failed', () => {
		const base = testChecksOf();
		render(TestResults, props({ checks: { ...base, result: { ...base.result!, noTests: true } } }));
		expect(screen.getByText('No test ran')).toBeTruthy();
		expect(screen.queryByText(/timed out/)).toBeNull();
	});

	it('gives two tests with the same title different names through their group', () => {
		const base = testChecksOf();
		const same = (file: string, heading: string) => ({
			name: `${heading} REQ-001 AC1: adds a task`,
			title: 'REQ-001 AC1: adds a task',
			file,
			status: 'passed' as const,
			line: 3
		});
		const result = {
			...base.result!,
			tests: [
				same('test/UC-001.test.ts', 'UC-001 Add task'),
				same('test/UC-002.test.ts', 'UC-002 List tasks')
			]
		};
		render(TestResults, props({ checks: { ...base, result } }));
		const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
		expect(new Set(names).size).toBe(2);
		expect(names[0]).toContain('UC-001 Add task');
		expect(names[1]).toContain('UC-002 List tasks');
	});

	it('explains a missing result', () => {
		render(TestResults, props({ checks: testChecksOf({ result: null }) }));
		expect(screen.getByText(/did not run/)).toBeTruthy();
	});
});
