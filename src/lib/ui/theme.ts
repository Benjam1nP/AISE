export type Theme = 'light' | 'dark';

/** localStorage key. The inline script in src/app.html reads the same key before first paint. */
const STORAGE_KEY = 'aise-theme';

const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark';

function stored(): Theme | undefined {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		return isTheme(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

/** `matchMedia` is missing in some test environments; treat that as no match. */
function prefers(query: string): boolean {
	return typeof matchMedia === 'function' && matchMedia(query).matches;
}

/** The theme in effect: the `data-theme` attribute, else the stored choice, else the system setting. Light on the server. */
export function getTheme(): Theme {
	if (typeof document === 'undefined') return 'light';
	const attribute = document.documentElement.dataset.theme;
	if (isTheme(attribute)) return attribute;
	return stored() ?? (prefers('(prefers-color-scheme: dark)') ? 'dark' : 'light');
}

/** Applies the theme to `<html data-theme>` and remembers it. Does nothing on the server. */
export function setTheme(theme: Theme): void {
	if (typeof document === 'undefined') return;
	document.documentElement.dataset.theme = theme;
	try {
		localStorage.setItem(STORAGE_KEY, theme);
	} catch {
		// Storage can be blocked (private mode); the theme still applies for this session.
	}
}
