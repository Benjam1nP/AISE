import { createRawSnippet } from 'svelte';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import SplitView from './SplitView.svelte';

const pane = (text: string) => createRawSnippet(() => ({ render: () => `<p>${text}</p>` }));

/** Props with a two way `active`, as `bind:active` gives them. */
const bound = (initial?: 'left' | 'right') => {
	const box = { active: initial };
	return {
		box,
		props: {
			left: pane('left pane'),
			right: pane('right pane'),
			get active() {
				return box.active;
			},
			set active(v: 'left' | 'right' | undefined) {
				box.active = v;
			}
		}
	};
};

const shown = (text: string) =>
	screen.getByText(text).parentElement!.classList.contains('shown') as boolean;

describe('SplitView', () => {
	it('shows the left pane first', () => {
		render(SplitView, { left: pane('left pane'), right: pane('right pane') });
		expect(shown('left pane')).toBe(true);
		expect(shown('right pane')).toBe(false);
	});

	it('shows the pane the parent binds', () => {
		const { props } = bound('right');
		render(SplitView, props);
		expect(shown('right pane')).toBe(true);
		expect(shown('left pane')).toBe(false);
		expect(screen.getByRole('tab', { name: 'Artefacts' }).getAttribute('aria-selected')).toBe(
			'true'
		);
	});

	it('reports the tab the user taps', async () => {
		const { box, props } = bound('left');
		render(SplitView, props);
		await userEvent.click(screen.getByRole('tab', { name: 'Artefacts' }));
		expect(box.active).toBe('right');
		await userEvent.click(screen.getByRole('tab', { name: 'Chat' }));
		expect(box.active).toBe('left');
	});

	it('switches the pane by itself when the parent binds nothing', async () => {
		render(SplitView, { left: pane('left pane'), right: pane('right pane') });
		await userEvent.click(screen.getByRole('tab', { name: 'Artefacts' }));
		expect(shown('right pane')).toBe(true);
		expect(shown('left pane')).toBe(false);
		await userEvent.click(screen.getByRole('tab', { name: 'Chat' }));
		expect(shown('left pane')).toBe(true);
	});
});
