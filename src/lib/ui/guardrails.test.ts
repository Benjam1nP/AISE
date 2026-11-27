import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = new URL('../..', import.meta.url).pathname;
const uiDir = new URL('.', import.meta.url).pathname;

function stripComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
}

/** Removes balanced var(...) calls, fallbacks included: a var() counts as a token. */
function stripVars(value: string): string {
	let out = '';
	for (let i = 0; i < value.length;) {
		if (value.startsWith('var(', i)) {
			let depth = 1;
			i += 4;
			while (depth > 0 && i < value.length) {
				if (value[i] === '(') depth++;
				if (value[i] === ')') depth--;
				i++;
			}
			out += ' ';
		} else out += value[i++];
	}
	return out;
}

/** The CSS parts of a file: the whole of a .css file, style blocks and style attributes of .svelte. */
function cssParts(file: string, text: string): string[] {
	const clean = stripComments(text);
	if (file.endsWith('.css')) return [clean];
	return [
		...[...clean.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]),
		...[...clean.matchAll(/\sstyle(?::[\w-]+)?=(?:"([^"]*)"|'([^']*)')/g)].map((m) => m[1] ?? m[2])
	];
}

const SPACING_PROP = /^(padding|margin|gap|row-gap|column-gap|inset)(-[a-z-]+)?$/;
const TIME_PROPS = new Set([
	'transition',
	'transition-duration',
	'animation',
	'animation-duration'
]);
const LENGTH = /(?<![\w.-])(\d*\.?\d+)(px|rem|em|ch|vh|vw|vmin|vmax|pt)\b/g;

function findViolations(file: string, text: string): string[] {
	const found: string[] = [];
	for (const part of cssParts(file, text)) {
		const bare = stripVars(part);
		for (const m of bare.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g)) {
			found.push(`${file}: colour literal ${m[0]}`);
		}
		for (const m of part.matchAll(/(?<![\w-])([a-z-]+)\s*:\s*([^;{}]+)/g)) {
			const prop = m[1];
			const value = m[2].replace(/!important/, '').trim();
			const bareValue = stripVars(value);
			const where = `${file}: ${prop}: ${value}`;
			if (prop === 'font-size' && !value.includes('var(--text-'))
				found.push(`${where} (font-size)`);
			if (prop === 'font-family' && !value.includes('var(--font-')) {
				found.push(`${where} (font-family)`);
			}
			if (SPACING_PROP.test(prop)) {
				for (const l of bareValue.matchAll(LENGTH)) {
					if (Number(l[1]) !== 0 && l[0] !== '1px') found.push(`${where} (spacing ${l[0]})`);
				}
			}
			if (TIME_PROPS.has(prop)) {
				const timeless = /^(none|inherit|initial|unset|revert)$/.test(value);
				if (!timeless && !value.includes('var(--duration-')) found.push(`${where} (duration)`);
				for (const t of bareValue.matchAll(/(?<![\w.-])\d*\.?\d+m?s\b/g)) {
					found.push(`${where} (duration ${t[0]})`);
				}
			}
		}
	}
	return found;
}

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const path = join(dir, e.name);
		return e.isDirectory() ? walk(path) : [path];
	});
}

describe('findViolations', () => {
	const bad = (css: string) => findViolations('x.css', css);

	it('flags raw colours, sizes, spacing, durations and fonts', () => {
		expect(bad('a { color: #fff; }')).toHaveLength(1);
		expect(bad('a { color: rgb(0 0 0); }')).toHaveLength(1);
		expect(bad('a { background: hsl(10 10% 10%); }')).toHaveLength(1);
		expect(bad('a { font-size: 14px; }')).toHaveLength(1);
		expect(bad('a { padding: var(--space-2) 6px; }')).toHaveLength(1);
		expect(bad('a { margin-inline: 0.5rem; }')).toHaveLength(1);
		expect(bad('a { gap: calc(var(--space-2) + 3px); }')).toHaveLength(1);
		expect(bad('a { inset: 8px; }')).toHaveLength(1);
		expect(bad('a { transition: opacity 100ms; }')).toHaveLength(2);
		expect(bad('a { animation-duration: 1s; }')).toHaveLength(2);
		expect(bad('a { font-family: Arial; }')).toHaveLength(1);
	});

	it('allows tokens, fallbacks, 0, 1px, auto, inherit, percentages and token calc()', () => {
		const ok = `a {
			/* color: #fff; padding: 9px; */
			color: var(--color-text, #000);
			font-size: var(--text-sm);
			font-family: var(--font-mono);
			padding: 0 1px;
			margin: auto;
			margin-inline: inherit;
			gap: calc(var(--space-2) * 2);
			inset: 0 auto 50% 100%;
			padding-block: calc(var(--space-4) - 1px);
			transition: opacity var(--duration-100) var(--ease-out);
			animation: none !important;
		}`;
		expect(bad(ok)).toEqual([]);
	});

	it('reads style blocks and style attributes of svelte files', () => {
		const svelte = '<div style="padding: 5px">x</div><style>a { color: #abc }</style>';
		expect(findViolations('x.svelte', svelte)).toHaveLength(2);
		expect(findViolations('x.svelte', '<a href="#abc">x</a>')).toEqual([]);
	});
});

describe('guardrails on src', () => {
	it('uses tokens only in svelte and css files', () => {
		const files = walk(srcDir).filter(
			(f) => /\.(svelte|css)$/.test(f) && !f.endsWith('/lib/ui/tokens.css')
		);
		expect(files.length).toBeGreaterThan(0);
		const violations = files.flatMap((f) =>
			findViolations(relative(srcDir, f), readFileSync(f, 'utf8'))
		);
		expect(violations).toEqual([]);
	});

	// Task 12 creates src/lib/ui/index.ts; until then this rule has nothing to check and is skipped.
	const indexFile = join(uiDir, 'index.ts');
	it.skipIf(!existsSync(indexFile))('shows every ui export on /dev/ui', () => {
		const index = readFileSync(indexFile, 'utf8');
		const names = [...index.matchAll(/export\s*\{([^}]*)\}/g)].flatMap((m) =>
			m[1]
				.split(',')
				.map((s) =>
					s
						.trim()
						.split(/\s+as\s+/)
						.pop()!
				)
				.filter(Boolean)
		);
		const page = join(srcDir, 'routes/dev/ui/+page.svelte');
		expect(existsSync(page), 'src/routes/dev/ui/+page.svelte').toBe(true);
		const showcase = readFileSync(page, 'utf8');
		const missing = names.filter((n) => !new RegExp(`\\b${n}\\b`).test(showcase));
		expect(missing).toEqual([]);
	});
});
