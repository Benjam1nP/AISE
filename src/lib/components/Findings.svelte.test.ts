import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { testChecksOf } from './fixtures.ts';
import Findings from './Findings.svelte';

const checks = testChecksOf();
const open = {
	id: 'run-1-1',
	runId: 'run-1',
	test: 'REQ-001 AC2: rejects an empty title',
	file: 'test/UC-001.test.ts',
	reqId: 'REQ-001',
	explanation: 'The route accepts an empty title.',
	proposedFix: 'Reject titles that are empty after trimming.'
};
const resolved = {
	...open,
	id: 'run-1-2',
	test: 'REQ-001 AC1: adds a task',
	explanation: 'Old bug.'
};

const props = (over: Record<string, unknown> = {}) => ({
	findings: [open, resolved],
	result: checks.result,
	testFixes: [],
	canApply: true,
	form: null,
	...over
});

describe('Findings', () => {
	it('shows an open finding with explanation, proposed fix and Apply fix', () => {
		render(Findings, props());
		const item = screen.getByRole('article', { name: /AC2/ });
		expect(item.textContent).toContain('The route accepts an empty title.');
		expect(item.textContent).toContain('Reject titles that are empty after trimming.');
		const button = within(item).getByRole('button', { name: 'Apply fix' });
		expect(button.closest('form')?.getAttribute('action')).toBe('?/applyFix');
		expect(
			(button.closest('form')!.querySelector('input[name="findingId"]') as HTMLInputElement).value
		).toBe('run-1-1');
	});

	it('shows Apply fix busy with a reason while a run is active, and does not submit', async () => {
		const submit = vi.fn((e: Event) => e.preventDefault());
		const { container } = render(Findings, props({ canApply: false }));
		container.querySelector('form')!.addEventListener('submit', submit);
		const button = screen.getByRole('button', { name: 'Apply fix' });
		expect(button.getAttribute('aria-busy')).toBe('true');
		expect(button.hasAttribute('disabled')).toBe(false);
		const note = screen.getByText(/when the agent finishes/);
		expect(button.getAttribute('aria-describedby')).toBe(note.id);
		await userEvent.click(button);
		expect(submit).not.toHaveBeenCalled();
	});

	it('has no busy state or description while Apply fix can run', () => {
		render(Findings, props());
		const button = screen.getByRole('button', { name: 'Apply fix' });
		expect(button.getAttribute('aria-busy')).toBeNull();
		expect(button.getAttribute('aria-describedby')).toBeNull();
	});

	it('posts the id of the finding whose button was clicked', async () => {
		const second = {
			...open,
			id: 'run-1-3',
			test: 'REQ-002 AC1: lists',
			file: 'test/UC-002.test.ts'
		};
		const result = {
			...checks.result!,
			tests: [
				...checks.result!.tests,
				{
					name: 'UC-002 List tasks REQ-002 AC1: lists',
					title: 'REQ-002 AC1: lists',
					file: 'test/UC-002.test.ts',
					status: 'failed' as const
				}
			]
		};
		render(Findings, props({ findings: [open, second], result }));
		const sent: string[] = [];
		// Capture on the document and stop there, so the enhance handler never sends the form.
		const record = (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
			sent.push(new FormData(e.target as HTMLFormElement).get('findingId') as string);
		};
		document.addEventListener('submit', record, true);
		const buttons = screen.getAllByRole('button', { name: 'Apply fix' });
		expect(buttons).toHaveLength(2);
		await userEvent.click(buttons[1]!);
		document.removeEventListener('submit', record, true);
		expect(sent).toEqual(['run-1-3']);
	});

	it('names each finding by test and file', () => {
		render(Findings, props());
		expect(
			screen.getByRole('article', {
				name: 'REQ-001 AC2: rejects an empty title, test/UC-001.test.ts'
			})
		).toBeTruthy();
	});

	it('collapses resolved findings without an Apply fix button', () => {
		render(Findings, props());
		expect(screen.getAllByRole('button', { name: 'Apply fix' })).toHaveLength(1);
		const details = screen.getByText(/Resolved findings/).closest('details')!;
		expect(details.hasAttribute('open')).toBe(false);
		expect(details.textContent).toContain('REQ-001 AC1: adds a task');
	});

	it('lists a resolved finding as resolved even while its test fails again, newest first', () => {
		const reopened = { ...open, id: 'run-1-3', resolvedAt: '2026-11-21T09:00:00.000Z' };
		const later = { ...resolved, id: 'run-1-4', resolvedAt: '2026-11-21T10:00:00.000Z' };
		render(Findings, props({ findings: [reopened, later] }));
		expect(screen.queryByRole('button', { name: 'Apply fix' })).toBeNull();
		const details = screen.getByText(/Resolved findings \(2\)/).closest('details')!;
		const items = [...details.querySelectorAll('li')].map((li) => li.textContent);
		expect(items[0]).toContain('REQ-001 AC1: adds a task');
		expect(items[1]).toContain('REQ-001 AC2: rejects an empty title');
	});

	it('lists test fixes with their reason', () => {
		render(
			Findings,
			props({
				findings: [],
				testFixes: [
					{
						runId: 'run-1',
						test: 'REQ-002 AC1: lists',
						file: 'test/UC-002.test.ts',
						reason: 'The route is /tasks, not /task.'
					}
				]
			})
		);
		const list = screen.getByRole('list', { name: 'Tests corrected (1)' });
		expect(list.textContent).toContain('test corrected');
		expect(list.textContent).toContain('REQ-002 AC1: lists');
		expect(list.textContent).toContain('The route is /tasks, not /task.');
	});

	it('renders nothing without findings or fixes', () => {
		const { container } = render(Findings, props({ findings: [], testFixes: [] }));
		expect(container.textContent?.trim()).toBe('');
	});

	it('shows a rejected Apply fix next to the button', () => {
		render(Findings, props({ form: { action: 'applyFix', message: 'A run is active.' } }));
		expect(screen.getByRole('alert').textContent).toContain('A run is active.');
	});
});
