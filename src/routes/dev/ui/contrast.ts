/** WCAG contrast of two CSS colour variables as the browser resolves them right now (theme aware). */

function channels(css: string): [number, number, number] {
	const values = css.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
	const scale = css.startsWith('color(') ? 255 : 1;
	return [values[0] * scale, values[1] * scale, values[2] * scale];
}

function luminance([r, g, b]: [number, number, number]): number {
	const [lr, lg, lb] = [r, g, b].map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export function resolveColour(token: string): [number, number, number] {
	const probe = document.createElement('span');
	probe.style.color = `var(${token})`;
	document.body.append(probe);
	const resolved = getComputedStyle(probe).color;
	probe.remove();
	return channels(resolved);
}

export function contrastRatio(foreground: string, background: string): number {
	const a = luminance(resolveColour(foreground));
	const b = luminance(resolveColour(background));
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export const PAIRS: { foreground: string; background: string; min: number }[] = [
	{ foreground: '--color-text', background: '--color-bg', min: 4.5 },
	{ foreground: '--color-text', background: '--color-surface', min: 4.5 },
	{ foreground: '--color-text-muted', background: '--color-bg', min: 4.5 },
	{ foreground: '--color-text-muted', background: '--color-surface-2', min: 4.5 },
	{ foreground: '--color-text-soft', background: '--color-bg', min: 3 },
	{ foreground: '--color-brand-strong', background: '--color-bg', min: 4.5 },
	{ foreground: '--color-on-brand', background: '--color-brand-strong', min: 4.5 },
	{ foreground: '--color-success', background: '--color-success-tint', min: 4.5 },
	{ foreground: '--color-warning', background: '--color-warning-tint', min: 4.5 },
	{ foreground: '--color-error', background: '--color-error-tint', min: 4.5 },
	{ foreground: '--color-info', background: '--color-info-tint', min: 4.5 },
	{ foreground: '--color-brand-strong', background: '--color-brand-tint', min: 4.5 }
];
