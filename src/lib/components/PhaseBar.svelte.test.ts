import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PhaseBar from './PhaseBar.svelte';

const phases = (p4: string, p5?: string, p6?: string, p7?: string) =>
	({
		P1: { status: 'approved' },
		P2: { status: 'approved' },
		P3: { status: 'not_started' },
		P4: { status: p4 },
		P5: { status: p5 ?? 'not_started' },
		P6: { status: p6 ?? 'not_started' },
		P7: { status: p7 ?? 'not_started' }
	}) as never;

describe('PhaseBar', () => {
	it('shows the cost of each phase on its station and the total at the end', () => {
		render(PhaseBar, {
			phases: phases('awaiting_approval'),
			costByPhase: { P1: 0.1, P4: 0.25 },
			selected: 'P4',
			onselect: () => {}
		});
		expect(screen.getByRole('button', { name: /P1\s*Requirements/ }).textContent).toContain(
			'$0.100'
		);
		expect(screen.getByRole('button', { name: /P4\s*Code/ }).textContent).toContain('$0.250');
		expect(screen.getByRole('button', { name: /P2\s*Design/ }).textContent).not.toContain('$');
		expect(screen.getByText('Total cost').parentElement!.textContent).toContain('$0.350');
	});

	it('opens P5 once P4 is approved and selects it on click', async () => {
		const onselect = vi.fn();
		render(PhaseBar, { phases: phases('approved'), selected: 'P4', onselect });
		await userEvent.click(screen.getByRole('button', { name: /P5\s*Testing/ }));
		expect(onselect).toHaveBeenCalledWith('P5');
	});

	it('keeps P5 closed before P4 is approved and says why', () => {
		render(PhaseBar, { phases: phases('awaiting_approval'), selected: 'P4', onselect: () => {} });
		expect(screen.queryByRole('button', { name: /P5/ })).toBeNull();
		expect(screen.getByText('After code approval')).toBeTruthy();
	});

	it('keeps P5 open while it holds a state of its own', () => {
		render(PhaseBar, {
			phases: phases('stale', 'awaiting_approval'),
			selected: 'P5',
			onselect: () => {}
		});
		expect(screen.getByRole('button', { name: /P5\s*Testing/ })).toBeTruthy();
	});

	it('opens P7 once P5 is approved and selects it on click', async () => {
		const onselect = vi.fn();
		render(PhaseBar, { phases: phases('approved', 'approved'), selected: 'P5', onselect });
		await userEvent.click(screen.getByRole('button', { name: /P7\s*Maintenance/ }));
		expect(onselect).toHaveBeenCalledWith('P7');
	});

	it('keeps P7 closed before P5 is approved and says why', () => {
		render(PhaseBar, {
			phases: phases('approved', 'awaiting_approval'),
			selected: 'P5',
			onselect: () => {}
		});
		expect(screen.queryByRole('button', { name: /P7/ })).toBeNull();
		// P6 and P7 both wait for the test approval.
		expect(screen.getAllByText('After test approval')).toHaveLength(2);
	});

	it('keeps P7 open while it holds a state of its own', () => {
		render(PhaseBar, {
			phases: phases('approved', 'awaiting_approval', undefined, 'awaiting_approval'),
			selected: 'P5',
			onselect: () => {}
		});
		expect(screen.getByRole('button', { name: /P7\s*Maintenance/ })).toBeTruthy();
	});

	it('opens P7 while P5 is stale', () => {
		render(PhaseBar, { phases: phases('approved', 'stale'), selected: 'P5', onselect: () => {} });
		expect(screen.getByRole('button', { name: /P7\s*Maintenance/ })).toBeTruthy();
	});

	it('marks P7 as the current step when it is selected, and no other station', () => {
		render(PhaseBar, {
			phases: phases('approved', 'approved'),
			selected: 'P7',
			onselect: () => {}
		});
		expect(
			screen.getByRole('button', { name: /P7\s*Maintenance/ }).getAttribute('aria-current')
		).toBe('step');
		expect(screen.getByRole('button', { name: /P5\s*Testing/ }).getAttribute('aria-current')).toBe(
			null
		);
	});
});

describe('PhaseBar P6', () => {
	it('opens P6 once P5 is approved and selects it on click', async () => {
		const onselect = vi.fn();
		render(PhaseBar, { phases: phases('approved', 'approved'), selected: 'P5', onselect });
		await userEvent.click(screen.getByRole('button', { name: /P6\s*Deployment/ }));
		expect(onselect).toHaveBeenCalledWith('P6');
	});

	it('keeps P6 closed before P5 is approved and says why', () => {
		render(PhaseBar, {
			phases: phases('approved', 'awaiting_approval'),
			selected: 'P5',
			onselect: () => {}
		});
		expect(screen.queryByRole('button', { name: /P6/ })).toBeNull();
		expect(screen.getAllByText('After test approval')).toHaveLength(2);
	});

	it('keeps P6 open while it holds a state of its own', () => {
		render(PhaseBar, {
			phases: phases('approved', 'stale', 'awaiting_approval'),
			selected: 'P6',
			onselect: () => {}
		});
		expect(screen.getByRole('button', { name: /P6\s*Deployment/ })).toBeTruthy();
	});
});
