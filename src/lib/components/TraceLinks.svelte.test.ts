import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NAMES, REQ_TRACE } from './trace-fixture.ts';
import TraceLinks from './TraceLinks.svelte';

const setup = (trace = REQ_TRACE) => {
	const onopenid = vi.fn();
	const onopenfile = vi.fn();
	render(TraceLinks, { trace, names: NAMES, onopenid, onopenfile });
	return { onopenid, onopenfile, list: screen.getByLabelText(`Trace of ${trace.id}`) };
};

describe('TraceLinks', () => {
	it('links the design elements by ID and name, without the element itself', async () => {
		const { onopenid, list } = setup();
		expect(within(list).queryByRole('button', { name: /^REQ-001/ })).toBeNull();
		await userEvent.click(within(list).getByRole('button', { name: 'UC-001 Add task' }));
		expect(onopenid).toHaveBeenCalledWith('UC-001');
		await userEvent.click(within(list).getByRole('button', { name: 'DSN-001 TaskService' }));
		expect(onopenid).toHaveBeenLastCalledWith('DSN-001');
		expect(within(list).getByRole('button', { name: 'SEQ-001' })).toBeTruthy();
	});

	it('opens the code at its line, short label, full path as the name', async () => {
		const { onopenfile, list } = setup();
		const task = within(list).getByRole('button', { name: 'src/tasks/Task.ts:3 Task' });
		expect(task.textContent?.trim()).toBe('Task.ts:3');
		expect(
			within(list).getByRole('button', { name: 'src/tasks/util.ts:9 helper' }).textContent?.trim()
		).toBe('util.ts:9 helper');
		await userEvent.click(task);
		expect(onopenfile).toHaveBeenCalledWith({ path: 'src/tasks/Task.ts', line: 3 });
	});

	it('opens a test at its line and shows its last status and criterion', async () => {
		const { onopenfile, list } = setup();
		const failed = within(list).getByRole('button', {
			name: 'failed UC-001 Add task REQ-001 AC2: rejects'
		});
		expect(failed.textContent).toContain('REQ-001 AC2');
		await userEvent.click(failed);
		expect(onopenfile).toHaveBeenCalledWith({ path: 'test/UC-001.test.ts', line: 9 });
	});

	it('says so when no code or test is linked yet', () => {
		setup({ ...REQ_TRACE, code: [], tests: [] });
		expect(screen.getByText('No code names it yet.')).toBeTruthy();
		expect(screen.getByText('No test result yet.')).toBeTruthy();
	});
});
