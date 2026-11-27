import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Proposal } from '#lib/server/core/tools/proposals.ts';
import ProposalsPanel from './ProposalsPanel.svelte';

const open: Proposal = {
	id: 'PRP-001',
	kind: 'missing_method',
	title: 'Add a delete method',
	change: 'TaskService gets deleteTask(id).',
	elementIds: ['DSN-001'],
	reqIds: ['REQ-003'],
	status: 'open'
};
const accepted: Proposal = { ...open, id: 'PRP-002', title: 'Rename Task', status: 'accepted' };

const props = (over: Record<string, unknown> = {}) => ({
	proposals: { designHash: 'h', proposals: [open, accepted] },
	status: 'awaiting_approval' as const,
	hasDesign: true,
	running: false,
	ondiscuss: () => {},
	form: null,
	...over
});

/** Records the form each click submits, without sending it. */
async function submitted(click: () => Promise<void>) {
	const sent: [string | null, string | null][] = [];
	const record = (e: Event) => {
		e.preventDefault();
		e.stopPropagation();
		const form = e.target as HTMLFormElement;
		sent.push([form.getAttribute('action'), new FormData(form).get('proposalId') as string | null]);
	};
	document.addEventListener('submit', record, true);
	await click();
	document.removeEventListener('submit', record, true);
	return sent;
}

describe('ProposalsPanel', () => {
	it('shows an open proposal as a card with its kind, change and linked IDs', () => {
		render(ProposalsPanel, props());
		const card = screen.getByRole('article', { name: /PRP-001/ });
		expect(card.textContent).toContain('Missing method');
		expect(card.textContent).toContain('Add a delete method');
		expect(card.textContent).toContain('TaskService gets deleteTask(id).');
		expect(card.textContent).toContain('DSN-001');
		expect(card.textContent).toContain('REQ-003');
	});

	it('posts Accept and Reject with the proposal id', async () => {
		render(ProposalsPanel, props());
		const card = screen.getByRole('article', { name: /PRP-001/ });
		const sent = await submitted(async () => {
			await userEvent.click(within(card).getByRole('button', { name: 'Accept' }));
			await userEvent.click(within(card).getByRole('button', { name: 'Reject' }));
		});
		expect(sent).toEqual([
			['?/acceptProposal', 'PRP-001'],
			['?/rejectProposal', 'PRP-001']
		]);
	});

	it('Discuss hands the proposal to the page and posts nothing', async () => {
		const ondiscuss = vi.fn();
		render(ProposalsPanel, props({ ondiscuss }));
		const sent = await submitted(() =>
			userEvent.click(screen.getByRole('button', { name: 'Discuss' }))
		);
		expect(sent).toEqual([]);
		expect(ondiscuss).toHaveBeenCalledWith(open);
	});

	it('posts Review design', async () => {
		render(ProposalsPanel, props());
		const sent = await submitted(() =>
			userEvent.click(screen.getByRole('button', { name: 'Review design' }))
		);
		expect(sent).toEqual([['?/reviewDesign', null]]);
	});

	it('collapses resolved proposals without buttons', () => {
		render(ProposalsPanel, props());
		const details = screen.getByText(/Resolved proposals \(1\)/).closest('details')!;
		expect(details.hasAttribute('open')).toBe(false);
		expect(details.textContent).toContain('Rename Task');
		expect(screen.getAllByRole('button', { name: 'Accept' })).toHaveLength(1);
	});

	it('says so when a review found nothing', () => {
		render(
			ProposalsPanel,
			props({ proposals: { designHash: 'h', proposals: [] }, status: 'approved' })
		);
		expect(screen.getByText('No improvements proposed')).toBeTruthy();
	});

	it('shows busy buttons with a wait note while a run is active, and does not submit', async () => {
		render(ProposalsPanel, props({ running: true }));
		for (const name of ['Review design', 'Accept', 'Reject']) {
			expect(screen.getByRole('button', { name }).getAttribute('aria-busy')).toBe('true');
		}
		expect(screen.getByText(/when the agent finishes/)).toBeTruthy();
		const sent = await submitted(() =>
			userEvent.click(screen.getByRole('button', { name: 'Accept' }))
		);
		expect(sent).toEqual([]);
	});

	it('notes that the proposals are out of date when the design changed since', () => {
		render(ProposalsPanel, props({ status: 'stale' }));
		expect(screen.getByText(/design changed since this review/)).toBeTruthy();
	});

	it('asks for a design first and offers no review without one', () => {
		render(ProposalsPanel, props({ proposals: null, status: 'not_started', hasDesign: false }));
		expect(screen.queryByRole('button', { name: 'Review design' })).toBeNull();
		expect(screen.getByText('No design yet')).toBeTruthy();
	});

	it('shows the error of a failed action', () => {
		render(
			ProposalsPanel,
			props({ form: { action: 'acceptProposal', message: 'A run is active.' } })
		);
		expect(screen.getByText('A run is active.')).toBeTruthy();
	});
});
