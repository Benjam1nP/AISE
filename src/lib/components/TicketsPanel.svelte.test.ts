import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { snapshotOf, ticketOf } from './fixtures.ts';
import TicketsPanel from './TicketsPanel.svelte';

const first = ticketOf({ id: 'TCK-001', title: 'Due date', status: 'done' });
const second = ticketOf({ id: 'TCK-002', kind: 'bug', title: 'Empty title', status: 'triaged' });
const running = ticketOf({
	id: 'TCK-003',
	kind: 'drift',
	title: 'Hand edit',
	status: 'in_progress',
	plan: { entry: 'P2', affectedIds: [], files: [], steps: ['Update the design'] }
});

const props = (tickets = [first, second], over: Record<string, unknown> = {}) => ({
	snapshot: snapshotOf({ tickets }),
	form: null,
	onopenid: vi.fn(),
	onopenfile: vi.fn(),
	onselectphase: vi.fn(),
	...over
});

const list = () => screen.getByRole('list', { name: 'Tickets' });

/** Props with a two way `selectedId`, as `bind:selectedId` gives them. */
const bound = (initial: string | undefined, tickets = [first, second]) => {
	const box = { id: initial };
	return {
		box,
		props: {
			...props(tickets),
			get selectedId() {
				return box.id;
			},
			set selectedId(id: string | undefined) {
				box.id = id;
			}
		}
	};
};

describe('TicketsPanel', () => {
	it('lists ID, kind, title and status of every ticket', () => {
		render(TicketsPanel, props());
		const items = within(list()).getAllByRole('listitem');
		expect(items).toHaveLength(2);
		expect(items[0].textContent).toContain('TCK-001');
		expect(items[0].textContent).toContain('Change request');
		expect(items[0].textContent).toContain('Due date');
		expect(items[0].textContent).toContain('Done');
		expect(items[1].textContent).toContain('TCK-002');
		expect(items[1].textContent).toContain('Bug');
		expect(items[1].textContent).toContain('Triaged');
	});

	it('selects the newest ticket by default', () => {
		render(TicketsPanel, props());
		expect(screen.getByRole('button', { name: /TCK-002/ }).getAttribute('aria-current')).toBe(
			'true'
		);
		expect(screen.getByRole('heading', { name: 'Empty title' })).toBeTruthy();
	});

	it('selects the ticket in progress over a newer one', () => {
		render(TicketsPanel, props([running, second]));
		expect(screen.getByRole('button', { name: /TCK-003/ }).getAttribute('aria-current')).toBe(
			'true'
		);
		expect(screen.getByRole('heading', { name: 'Hand edit' })).toBeTruthy();
	});

	it('shows the detail of the ticket that was clicked', async () => {
		render(TicketsPanel, props());
		await userEvent.click(screen.getByRole('button', { name: /TCK-001/ }));
		expect(screen.getByRole('heading', { name: 'Due date' })).toBeTruthy();
		expect(screen.getByRole('button', { name: /TCK-001/ }).getAttribute('aria-current')).toBe(
			'true'
		);
		expect(screen.getByRole('button', { name: /TCK-002/ }).getAttribute('aria-current')).toBeNull();
	});

	it('toggles the new ticket form, focusing Kind on open and the button again on Cancel', async () => {
		render(TicketsPanel, props());
		expect(screen.queryByLabelText('Title')).toBeNull();
		await userEvent.click(screen.getByRole('button', { name: 'New ticket' }));
		expect(screen.getByLabelText('Title')).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Kind')));
		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.queryByLabelText('Title')).toBeNull();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New ticket' }));
	});

	it('does not take focus when the form shows because there is no ticket', () => {
		render(TicketsPanel, props([]));
		expect(document.activeElement).toBe(document.body);
	});

	it('selects a ticket that appears, even with another in progress', async () => {
		const view = render(TicketsPanel, props([running, second]));
		expect(screen.getByRole('heading', { name: 'Hand edit' })).toBeTruthy();
		const created = ticketOf({
			id: 'TCK-009',
			kind: 'change',
			title: 'Fresh',
			status: 'open',
			plan: undefined
		});
		await view.rerender(props([running, second, created]));
		expect(screen.getByRole('heading', { name: 'Fresh' })).toBeTruthy();
		expect(screen.getByRole('button', { name: /TCK-009/ }).getAttribute('aria-current')).toBe(
			'true'
		);
	});

	it('keeps the choice of the developer when the tickets change without a new one', async () => {
		const view = render(TicketsPanel, props([first, second]));
		await userEvent.click(screen.getByRole('button', { name: /TCK-001/ }));
		await view.rerender(props([{ ...first }, { ...second, status: 'in_progress' }]));
		expect(screen.getByRole('heading', { name: 'Due date' })).toBeTruthy();
	});

	it('shows the form and an explanation when there is no ticket yet', () => {
		render(TicketsPanel, props([]));
		expect(screen.getByText('No tickets yet')).toBeTruthy();
		expect(screen.getByLabelText('Title')).toBeTruthy();
	});

	it('shows ticket titles as text, never as HTML', () => {
		const evil = ticketOf({ id: 'TCK-004', title: '<img src=x onerror=alert(1)>' });
		const { container } = render(TicketsPanel, props([evil]));
		expect(container.querySelector('img')).toBeNull();
		expect(within(list()).getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
	});
});

describe('TicketsPanel selection shared with the page', () => {
	it('reports the ticket it selects by default', async () => {
		const { box, props } = bound(undefined);
		render(TicketsPanel, props);
		await waitFor(() => expect(box.id).toBe('TCK-002'));
	});

	it('reports the ticket in progress over a newer one', async () => {
		const { box, props } = bound(undefined, [running, second]);
		render(TicketsPanel, props);
		await waitFor(() => expect(box.id).toBe('TCK-003'));
	});

	it('reports the ticket that was clicked', async () => {
		const { box, props } = bound(undefined);
		render(TicketsPanel, props);
		await userEvent.click(screen.getByRole('button', { name: /TCK-001/ }));
		await waitFor(() => expect(box.id).toBe('TCK-001'));
	});

	it('opens on the ticket the page already shows', () => {
		const { props } = bound('TCK-001');
		render(TicketsPanel, props);
		expect(screen.getByRole('button', { name: /TCK-001/ }).getAttribute('aria-current')).toBe(
			'true'
		);
		expect(screen.getByRole('heading', { name: 'Due date' })).toBeTruthy();
	});

	it('does not treat the default as a choice: a ticket that goes in progress takes over', async () => {
		const { props } = bound('TCK-002');
		const { rerender } = render(TicketsPanel, props);
		expect(screen.getByRole('button', { name: /TCK-002/ }).getAttribute('aria-current')).toBe(
			'true'
		);
		const started = { ...first, status: 'in_progress' as const };
		await rerender({ ...props, snapshot: snapshotOf({ tickets: [started, second] }) });
		await waitFor(() =>
			expect(screen.getByRole('button', { name: /TCK-001/ }).getAttribute('aria-current')).toBe(
				'true'
			)
		);
	});

	it('shows no chat: the page holds it', () => {
		render(TicketsPanel, props());
		expect(screen.queryByRole('heading', { name: 'Chat with the maintenance agent' })).toBeNull();
	});
});
