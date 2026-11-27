import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimatedIcon } from './index';

const reducedMotion = (reduce: boolean) =>
	vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce') }));

beforeEach(() => reducedMotion(false));
afterEach(() => vi.unstubAllGlobals());

describe('AnimatedIcon', () => {
	it('shows the final frame on mount, so a page load or tab switch replays nothing', () => {
		const { container } = render(AnimatedIcon, { name: 'circle-check' });
		const icon = container.querySelector('[data-icon="circle-check"]')!;
		expect(icon.hasAttribute('data-play')).toBe(false);
		expect(icon.querySelector('animate, [stroke-dashoffset]')).toBeNull();
		expect(icon.querySelectorAll('svg path')).toHaveLength(2);
		expect(icon.getAttribute('aria-hidden')).toBe('true');
	});

	it('draws once in a fresh svg when the name changes', async () => {
		const { container, rerender } = render(AnimatedIcon, { name: 'clipboard' });
		const before = container.querySelector('svg');
		await rerender({ name: 'clipboard-check' });
		const after = container.querySelector('[data-icon="clipboard-check"][data-play] svg');
		// A new svg element starts its own animation clock; reusing the old one would skip the draw.
		expect(after).not.toBe(before);
		expect(after!.querySelector('animate')).not.toBeNull();
	});

	it('draws nothing without a name and draws itself when one arrives', async () => {
		const { container, rerender } = render(AnimatedIcon, { name: undefined });
		expect(container.querySelector('svg')).toBeNull();
		await rerender({ name: 'check' });
		expect(container.querySelector('[data-icon="check"] svg animate')).not.toBeNull();
	});

	it('shows the final frame for a change under reduced motion', async () => {
		reducedMotion(true);
		const { container, rerender } = render(AnimatedIcon, { name: 'circle-alert' });
		await rerender({ name: 'circle-check' });
		expect(container.querySelector('[data-icon="circle-check"] svg path')).not.toBeNull();
		expect(container.querySelector('svg animate')).toBeNull();
	});
});
