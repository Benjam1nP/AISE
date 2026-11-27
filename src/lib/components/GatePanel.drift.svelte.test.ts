import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshotOf } from './fixtures.ts';
import GatePanel from './GatePanel.svelte';

// Stands in for SvelteKit's enhance: reports the outcome the test sets once the form is submitted.
const outcome = vi.hoisted(() => ({ result: {} as Record<string, unknown> }));
vi.mock('$app/forms', () => ({
	enhance: (
		form: HTMLFormElement,
		submit: (input: unknown) => (r: unknown) => Promise<void> | undefined
	) => {
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			void submit({ formData: new FormData(form), cancel: () => {} })?.({
				result: outcome.result,
				update: async () => {}
			});
		});
	}
}));

const snapshot = snapshotOf({
	state: {
		phases: {
			P1: { status: 'approved' },
			P2: { status: 'approved' },
			P4: { status: 'awaiting_approval' },
			P5: { status: 'not_started' }
		}
	},
	files: ['src/a.ts'],
	canOpenDriftTicket: true
});

beforeEach(() => {
	outcome.result = { type: 'success', status: 200, data: { ok: true, action: 'openDriftTicket' } };
});

describe('GatePanel Open drift ticket', () => {
	it('tells the page once the drift ticket was opened', async () => {
		const onopendriftticket = vi.fn();
		render(GatePanel, { snapshot, phase: 'P4', form: null, onopendriftticket });
		await userEvent.click(screen.getByRole('button', { name: 'Open drift ticket' }));
		await waitFor(() => expect(onopendriftticket).toHaveBeenCalledTimes(1));
	});

	it('does not tell the page when the server refused', async () => {
		outcome.result = {
			type: 'failure',
			status: 409,
			data: { action: 'openDriftTicket', message: 'TCK-001 already covers the drift.' }
		};
		const onopendriftticket = vi.fn();
		render(GatePanel, { snapshot, phase: 'P4', form: null, onopendriftticket });
		await userEvent.click(screen.getByRole('button', { name: 'Open drift ticket' }));
		// The button is idle again once the submit finished.
		await waitFor(() =>
			expect(
				screen.getByRole('button', { name: 'Open drift ticket' }).getAttribute('aria-busy')
			).not.toBe('true')
		);
		expect(onopendriftticket).not.toHaveBeenCalled();
	});
});
