import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	Button,
	Dropdown,
	Input,
	Modal,
	Select,
	Skeleton,
	Spinner,
	StatusBadge,
	Tabs,
	Textarea,
	ThinkingOrb
} from './index';

const text = (value: string) => createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));

describe('Button', () => {
	it('does not call onclick while loading and is aria-busy', async () => {
		const onclick = vi.fn();
		render(Button, { loading: true, onclick, children: text('Save') });
		const button = screen.getByRole('button');
		expect(button.getAttribute('aria-busy')).toBe('true');
		await userEvent.click(button);
		expect(onclick).not.toHaveBeenCalled();
	});

	it('does not call onclick when disabled', async () => {
		const onclick = vi.fn();
		render(Button, { disabled: true, onclick, children: text('Save') });
		await userEvent.click(screen.getByRole('button'));
		expect(onclick).not.toHaveBeenCalled();
	});

	it('stays focusable while loading: no disabled attribute, spinner shown', async () => {
		render(Button, { loading: true, children: text('Save') });
		const button = screen.getByRole('button');
		expect(button.hasAttribute('disabled')).toBe(false);
		expect(button.querySelector('.spinner')).not.toBeNull();
		await userEvent.tab();
		expect(document.activeElement).toBe(button);
	});

	it('calls onclick when enabled', async () => {
		const onclick = vi.fn();
		render(Button, { onclick, children: text('Save') });
		await userEvent.click(screen.getByRole('button'));
		expect(onclick).toHaveBeenCalledOnce();
	});
});

describe('Tabs', () => {
	const tabs = [
		{ id: 'one', label: 'One' },
		{ id: 'two', label: 'Two', disabled: true },
		{ id: 'three', label: 'Three' }
	];

	it('moves focus and selection with ArrowRight and skips disabled tabs', async () => {
		render(Tabs, { tabs, active: 'one' });
		const [one, , three] = screen.getAllByRole('tab');
		one.focus();
		await userEvent.keyboard('{ArrowRight}');
		expect(document.activeElement).toBe(three);
		expect(three.getAttribute('aria-selected')).toBe('true');
		expect(one.getAttribute('aria-selected')).toBe('false');
		expect(three.getAttribute('tabindex')).toBe('0');
		expect(one.getAttribute('tabindex')).toBe('-1');
	});

	it('wraps with ArrowRight and jumps with Home and End', async () => {
		render(Tabs, { tabs, active: 'three' });
		const [one, , three] = screen.getAllByRole('tab');
		three.focus();
		await userEvent.keyboard('{ArrowRight}');
		expect(document.activeElement).toBe(one);
		await userEvent.keyboard('{End}');
		expect(document.activeElement).toBe(three);
		await userEvent.keyboard('{Home}');
		expect(document.activeElement).toBe(one);
	});
});

describe('Modal', () => {
	it('closes on Escape and returns focus to the button that opened it', async () => {
		const { rerender } = render(Modal, {
			open: false,
			title: 'Discard run',
			children: text('Are you sure?')
		});
		const opener = document.createElement('button');
		document.body.append(opener);
		opener.focus();
		await rerender({ open: true });
		const dialog = document.querySelector('dialog')!;
		expect(dialog.hasAttribute('open')).toBe(true);
		expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
		await userEvent.keyboard('{Escape}');
		expect(dialog.hasAttribute('open')).toBe(false);
		expect(document.activeElement).toBe(opener);
		opener.remove();
	});

	it('closes when the backdrop is clicked', async () => {
		render(Modal, { open: true, title: 'Discard run', children: text('Are you sure?') });
		const dialog = document.querySelector('dialog')!;
		await userEvent.click(dialog);
		expect(dialog.hasAttribute('open')).toBe(false);
	});
});

describe('Dropdown', () => {
	const items = [
		{ id: 'rename', label: 'Rename' },
		{ id: 'archive', label: 'Archive', disabled: true },
		{ id: 'delete', label: 'Delete', destructive: true }
	];

	it('opens on Enter, moves with ArrowDown, selects with Enter and closes on Escape', async () => {
		const onselect = vi.fn();
		render(Dropdown, { label: 'Actions', items, onselect });
		const trigger = screen.getByRole('button', { name: 'Actions' });
		trigger.focus();
		await userEvent.keyboard('{Enter}');
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		const [rename, , del] = screen.getAllByRole('menuitem');
		expect(document.activeElement).toBe(rename);
		await userEvent.keyboard('{ArrowDown}');
		expect(document.activeElement).toBe(del);
		await userEvent.keyboard('{Enter}');
		expect(onselect).toHaveBeenCalledExactlyOnceWith('delete');
		expect(screen.queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(trigger);

		await userEvent.keyboard('{Enter}');
		expect(screen.getByRole('menu')).toBeTruthy();
		await userEvent.keyboard('{Escape}');
		expect(screen.queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it('closes on a click outside', async () => {
		render(Dropdown, { label: 'Actions', items, onselect: vi.fn() });
		await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
		expect(screen.getByRole('menu')).toBeTruthy();
		await userEvent.click(document.body);
		expect(screen.queryByRole('menu')).toBeNull();
	});
});

describe('Input', () => {
	it('links the error and the hint through aria-describedby', () => {
		render(Input, {
			label: 'Name',
			hint: 'Lowercase letters',
			error: 'Name is required',
			value: ''
		});
		const input = screen.getByLabelText('Name');
		const ids = input.getAttribute('aria-describedby')!.split(' ');
		expect(ids).toHaveLength(2);
		const described = ids.map((id) => document.getElementById(id)?.textContent);
		expect(described).toContain('Name is required');
		expect(described).toContain('Lowercase letters');
		expect(input.getAttribute('aria-invalid')).toBe('true');
	});

	it('has no aria-describedby without hint or error', () => {
		render(Input, { label: 'Name', value: '' });
		const input = screen.getByLabelText('Name');
		expect(input.hasAttribute('aria-describedby')).toBe(false);
		expect(input.hasAttribute('aria-invalid')).toBe(false);
	});
});

describe('StatusBadge', () => {
	it('renders the warning tone for stale', () => {
		render(StatusBadge, { status: 'stale' });
		const badge = screen.getByText('Stale').closest('[data-tone]')!;
		expect(badge.getAttribute('data-tone')).toBe('warning');
	});

	it('maps the other phase statuses to their tones', () => {
		const tones = {
			not_started: 'neutral',
			running: 'brand',
			awaiting_approval: 'brand',
			approved: 'success'
		} as const;
		for (const [status, tone] of Object.entries(tones)) {
			const { container, unmount } = render(StatusBadge, {
				status: status as keyof typeof tones
			});
			expect(container.querySelector('[data-tone]')!.getAttribute('data-tone')).toBe(tone);
			unmount();
		}
	});
});

describe('field states', () => {
	it('renders the error with an icon and links it through aria', () => {
		render(Input, { label: 'Name', error: 'Enter a name.', value: '' });
		const input = screen.getByLabelText('Name');
		const message = document.getElementById(input.getAttribute('aria-describedby')!)!;
		expect(message.textContent).toContain('Enter a name.');
		expect(message.querySelector('[data-icon="circle-alert"] svg')).not.toBeNull();
		expect(input.getAttribute('aria-invalid')).toBe('true');
	});

	it('shows the check icon for success and its text through aria-describedby', () => {
		render(Input, { label: 'Name', success: 'Name is free.', value: 'todo' });
		const input = screen.getByLabelText('Name');
		const text = document.getElementById(input.getAttribute('aria-describedby')!)!;
		expect(text.textContent).toBe('Name is free.');
		expect(
			input.closest('.control')!.querySelector('.status.success [data-icon="check"] svg')
		).not.toBeNull();
		expect(input.hasAttribute('aria-invalid')).toBe(false);
	});

	it('shows the check icon alone for success true, without text or description', () => {
		render(Textarea, { label: 'Notes', success: true, value: '' });
		const area = screen.getByLabelText('Notes');
		expect(area.closest('.control')!.querySelector('.status.success svg')).not.toBeNull();
		expect(area.hasAttribute('aria-describedby')).toBe(false);
	});

	it('draws the check when the field turns success after mount', async () => {
		const { rerender } = render(Input, { label: 'Name', value: 'todo' });
		const control = screen.getByLabelText('Name').closest('.control')!;
		expect(control.querySelector('[data-icon]')).toBeNull();
		await rerender({ success: true });
		expect(control.querySelector('[data-icon="check"][data-play] animate')).not.toBeNull();
	});

	it('lets the error win over success', () => {
		render(Input, { label: 'Name', success: 'Fine.', error: 'Taken.', value: '' });
		expect(screen.queryByText('Fine.')).toBeNull();
		expect(screen.getByText('Taken.')).toBeTruthy();
	});

	it('loading blocks edits with readonly and aria-busy but stays focusable', async () => {
		render(Input, { label: 'Name', loading: true, value: '' });
		const input = screen.getByLabelText('Name') as HTMLInputElement;
		expect(input.readOnly).toBe(true);
		expect(input.disabled).toBe(false);
		expect(input.getAttribute('aria-busy')).toBe('true');
		expect(input.closest('.control')!.querySelector('.spinner')).not.toBeNull();
		await userEvent.tab();
		expect(document.activeElement).toBe(input);
	});

	it('disabled sets the attribute on all three controls', () => {
		render(Input, { label: 'A', disabled: true, value: '' });
		render(Textarea, { label: 'B', disabled: true, value: '' });
		render(Select, {
			label: 'C',
			disabled: true,
			options: [{ value: 'x', label: 'X' }],
			value: 'x'
		});
		for (const name of ['A', 'B', 'C']) {
			expect((screen.getByLabelText(name) as HTMLInputElement).disabled).toBe(true);
		}
	});

	it('Select supports error and success', () => {
		const options = [{ value: 'x', label: 'X' }];
		render(Select, { label: 'Kind', options, error: 'Pick one.', value: 'x' });
		expect(screen.getByLabelText('Kind').getAttribute('aria-invalid')).toBe('true');
		render(Select, { label: 'Other', options, success: true, value: 'x' });
		expect(
			screen.getByLabelText('Other').closest('.control')!.querySelector('.status.success')
		).not.toBeNull();
	});
});

describe('delay', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('Spinner renders nothing until the delay has elapsed', async () => {
		render(Spinner, { delay: 300 });
		expect(screen.queryByRole('status')).toBeNull();
		await vi.advanceTimersByTimeAsync(299);
		expect(screen.queryByRole('status')).toBeNull();
		await vi.advanceTimersByTimeAsync(1);
		await tick();
		expect(screen.getByRole('status')).toBeTruthy();
	});

	it('Skeleton renders nothing until the delay has elapsed', async () => {
		const { container } = render(Skeleton, { delay: 300 });
		expect(container.querySelector('.skeleton')).toBeNull();
		await vi.advanceTimersByTimeAsync(300);
		await tick();
		expect(container.querySelector('.skeleton')).not.toBeNull();
	});

	it('renders at once without a delay', () => {
		render(Spinner, {});
		expect(screen.getByRole('status')).toBeTruthy();
	});
});

describe('ThinkingOrb', () => {
	it('is an image with a default label per state and does not throw without a canvas context', () => {
		render(ThinkingOrb, { state: 'searching' });
		const orb = screen.getByRole('img');
		expect(orb.tagName).toBe('CANVAS');
		expect(orb.getAttribute('aria-label')).toBe('Searching');
	});

	it('takes a custom label and the size', () => {
		render(ThinkingOrb, { label: 'The agent is working', size: 64 });
		const orb = screen.getByRole('img', { name: 'The agent is working' });
		expect(orb.style.width).toBe('64px');
	});

	it('uses the 20 px size and the working state by default', () => {
		render(ThinkingOrb, {});
		const orb = screen.getByRole('img');
		expect(orb.getAttribute('aria-label')).toBe('Working');
		expect(orb.style.width).toBe('20px');
	});
});
