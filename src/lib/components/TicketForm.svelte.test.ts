import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { captureSubmit } from './fixtures.ts';
import TicketForm from './TicketForm.svelte';

const form = (container: HTMLElement) => container.querySelector('form')!;

describe('TicketForm', () => {
	it('offers the four kinds', () => {
		render(TicketForm, { form: null });
		const options = [...screen.getByLabelText('Kind').querySelectorAll('option')];
		expect(options.map((o) => o.textContent)).toEqual([
			'Change request',
			'New requirement',
			'Bug',
			'Drift'
		]);
	});

	it('posts kind, title and description to createTicket', async () => {
		const { container } = render(TicketForm, { form: null });
		expect(form(container).getAttribute('action')).toBe('?/createTicket');
		const sent = captureSubmit(form(container));
		await userEvent.selectOptions(screen.getByLabelText('Kind'), 'bug');
		await userEvent.type(screen.getByLabelText('Title'), 'Empty title is accepted');
		await userEvent.type(screen.getByLabelText('Description'), 'POST /tasks accepts ""');
		await userEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
		expect(sent()).toEqual({
			kind: 'bug',
			title: 'Empty title is accepted',
			description: 'POST /tasks accepts ""'
		});
	});

	it('does not send an empty title, names the problem and focuses the field (R17, R18)', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		render(TicketForm, { form: null });
		const button = screen.getByRole('button', { name: 'Create ticket' });
		expect(button.hasAttribute('disabled')).toBe(false);
		await userEvent.click(button);
		const title = screen.getByLabelText('Title');
		expect(title.getAttribute('aria-invalid')).toBe('true');
		expect(screen.getByText(/Give the ticket a short title/)).toBeTruthy();
		expect(document.activeElement).toBe(title);
		expect(fetchMock).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('shows a rejected createTicket under the form and Dismiss hides it', async () => {
		const { rerender } = render(TicketForm, { form: null });
		await rerender({ form: { action: 'createTicket', message: 'Choose the ticket kind.' } });
		expect(screen.getByRole('alert').textContent).toContain('Choose the ticket kind.');
		await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('does not show the error that was there when the form opened', async () => {
		const old = { action: 'createTicket', message: 'Old failure.' };
		const { rerender } = render(TicketForm, { form: old });
		expect(screen.queryByRole('alert')).toBeNull();
		await rerender({ form: { ...old, message: 'New failure.' } });
		expect(screen.getByRole('alert').textContent).toContain('New failure.');
	});

	it('shows Create ticket busy with a reason while an agent runs, and sends nothing (R17)', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		render(TicketForm, { form: null, running: true });
		const button = screen.getByRole('button', { name: 'Create ticket' });
		expect(button.getAttribute('aria-busy')).toBe('true');
		expect(button.hasAttribute('disabled')).toBe(false);
		const note = screen.getByText(/available when the agent finishes/);
		expect(button.getAttribute('aria-describedby')).toBe(note.id);
		await userEvent.type(screen.getByLabelText('Title'), 'x');
		await userEvent.click(button);
		expect(fetchMock).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('focuses the Kind select on request', () => {
		const { component } = render(TicketForm, { form: null });
		(component as unknown as { focus: () => void }).focus();
		expect(document.activeElement).toBe(screen.getByLabelText('Kind'));
	});

	it('ignores the error of another action', () => {
		render(TicketForm, { form: { action: 'send', message: 'Not mine.' } });
		expect(screen.queryByRole('alert')).toBeNull();
	});
});
