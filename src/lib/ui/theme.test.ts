import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTheme, setTheme } from './theme';

function stubBrowser(options: { stored?: string; dark?: boolean }) {
	const dataset: Record<string, string> = {};
	const store = new Map<string, string>(options.stored ? [['aise-theme', options.stored]] : []);
	vi.stubGlobal('document', { documentElement: { dataset } });
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v)
	});
	vi.stubGlobal('matchMedia', () => ({ matches: options.dark ?? false }));
	return { dataset, store };
}

afterEach(() => vi.unstubAllGlobals());

describe('theme', () => {
	it('is safe on the server', () => {
		expect(getTheme()).toBe('light');
		expect(() => setTheme('dark')).not.toThrow();
	});

	it('defaults to the system setting', () => {
		stubBrowser({ dark: true });
		expect(getTheme()).toBe('dark');
		stubBrowser({ dark: false });
		expect(getTheme()).toBe('light');
	});

	it('prefers a stored choice over the system setting and ignores junk', () => {
		stubBrowser({ stored: 'light', dark: true });
		expect(getTheme()).toBe('light');
		stubBrowser({ stored: 'purple', dark: true });
		expect(getTheme()).toBe('dark');
	});

	it('setTheme sets data-theme and stores the choice', () => {
		const { dataset, store } = stubBrowser({ dark: false });
		setTheme('dark');
		expect(dataset.theme).toBe('dark');
		expect(store.get('aise-theme')).toBe('dark');
		expect(getTheme()).toBe('dark');
	});
});
