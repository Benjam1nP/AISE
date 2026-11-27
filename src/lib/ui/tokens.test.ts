import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8').replace(
	/\/\*[\s\S]*?\*\//g,
	''
);

/** Top level rule blocks as selector to declarations. Nested at rules are skipped. */
function parseBlocks(source: string): Map<string, Map<string, string>> {
	const blocks = new Map<string, Map<string, string>>();
	let depth = 0;
	let start = 0;
	let selector = '';
	for (let i = 0; i < source.length; i++) {
		const ch = source[i];
		if (ch === '{') {
			if (depth === 0) {
				selector = source.slice(start, i).trim().replace(/"/g, "'");
				start = i + 1;
			}
			depth++;
		} else if (ch === '}') {
			depth--;
			if (depth === 0) {
				if (!selector.startsWith('@')) {
					const vars = blocks.get(selector) ?? new Map<string, string>();
					for (const m of source.slice(start, i).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
						vars.set(m[1], m[2].trim());
					}
					blocks.set(selector, vars);
				}
				start = i + 1;
			}
		}
	}
	return blocks;
}

const blocks = parseBlocks(css);
const light = blocks.get(':root')!;
const dark = new Map([...light, ...blocks.get("[data-theme='dark']")!]);

function resolve(vars: Map<string, string>, name: string): string {
	let value = vars.get(name);
	for (let guard = 0; value !== undefined && guard < 10; guard++) {
		const ref = /^var\((--[\w-]+)\)$/.exec(value);
		if (!ref) return value;
		value = vars.get(ref[1]);
	}
	throw new Error(`cannot resolve ${name}`);
}

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(vars: Map<string, string>, fg: string, bg: string): number {
	const [a, b] = [fg, bg].map((n) => luminance(resolve(vars, `--color-${n}`)));
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const themes = { light, dark };
const statuses = ['success', 'error', 'warning', 'info'];
const surfaces = ['bg', 'surface', 'surface-2'];

describe.each(Object.entries(themes))('%s theme contrast', (_name, vars) => {
	it('resolves every colour token to a hex value', () => {
		const names = [...vars.keys()].filter((n) => /^--(brand|neutral)-\d+$|^--color-/.test(n));
		expect(names.length).toBeGreaterThan(30);
		for (const n of names.filter((n) => !n.startsWith('--color-focus'))) {
			expect(resolve(vars, n), n).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});

	it.each(surfaces)('text, text-muted and status colours reach 4.5 on %s', (surface) => {
		for (const fg of ['text', 'text-muted', ...statuses]) {
			expect(contrast(vars, fg, surface), `${fg} on ${surface}`).toBeGreaterThanOrEqual(4.5);
		}
	});

	it.each(statuses)('%s reaches 4.5 on its tint', (status) => {
		expect(contrast(vars, status, `${status}-tint`)).toBeGreaterThanOrEqual(4.5);
	});

	it('on-brand reaches 4.5 on brand-strong', () => {
		expect(contrast(vars, 'on-brand', 'brand-strong')).toBeGreaterThanOrEqual(4.5);
	});

	it('text-soft reaches 3.0 on bg', () => {
		expect(contrast(vars, 'text-soft', 'bg')).toBeGreaterThanOrEqual(3);
	});

	it('focus follows brand', () => {
		expect(resolve(vars, '--color-focus')).toBe(resolve(vars, '--color-brand'));
	});
});

describe('scales', () => {
	it('every spacing token is a multiple of 4px', () => {
		const spacing = [...light].filter(([n]) => /^--space-\d+$/.test(n));
		expect(spacing.map(([n]) => n)).toEqual([1, 2, 3, 4, 6, 8, 12, 16].map((n) => `--space-${n}`));
		for (const [name, value] of spacing) {
			const px = /^(\d+)px$/.exec(value);
			expect(px, name).not.toBeNull();
			expect(Number(px![1]) % 4, name).toBe(0);
		}
	});

	it('type scale matches the table (rem, base 16px)', () => {
		const scale: Record<string, [number, string]> = {
			xs: [11, '500'],
			sm: [13, '400'],
			base: [15, '400'],
			lg: [18, '400'],
			'2xl': [22, '600'],
			'3xl': [28, '700'],
			'4xl': [36, '700'],
			'5xl': [48, '800']
		};
		for (const [key, [px, weight]] of Object.entries(scale)) {
			const size = /^([\d.]+)rem$/.exec(light.get(`--text-${key}`) ?? '');
			expect(size, `--text-${key}`).not.toBeNull();
			expect(Number(size![1]) * 16, `--text-${key}`).toBeCloseTo(px, 5);
			expect(resolve(light, `--text-${key}-weight`), `--text-${key}-weight`).toBe(weight);
		}
		expect([...light.keys()].filter((n) => /^--text-[\w]+$/.test(n))).toHaveLength(8);
	});

	it('weights, line heights and fonts', () => {
		const expected: Record<string, string> = {
			'--weight-regular': '400',
			'--weight-medium': '500',
			'--weight-semibold': '600',
			'--weight-bold': '700',
			'--weight-extrabold': '800',
			'--leading-heading': '1.2',
			'--leading-body': '1.6',
			'--leading-label': '1.1'
		};
		for (const [name, value] of Object.entries(expected)) expect(light.get(name), name).toBe(value);
		expect(light.get('--font-sans')).toMatch(/Geist.*system-ui, sans-serif$/);
		expect(light.get('--font-mono')).toMatch(/Geist Mono.*ui-monospace, monospace$/);
		expect(light.get('--font-display')).toMatch(/Archivo.*sans-serif$/);
	});

	it('motion tokens, with reduced motion zeroing every duration', () => {
		expect(light.get('--duration-100')).toBe('100ms');
		expect(light.get('--duration-500')).toBe('500ms');
		expect(light.get('--ease-out')).toBe('cubic-bezier(0, 0, 0.2, 1)');
		expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
		const reduced = css.slice(css.indexOf('prefers-reduced-motion'));
		for (const d of [100, 200, 300, 400, 500]) {
			expect(reduced).toMatch(new RegExp(`--duration-${d}:\\s*0ms`));
		}
	});
});
