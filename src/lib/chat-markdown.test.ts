import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline } from './chat-markdown.ts';

describe('parseInline', () => {
	it('splits bold, italic and code from plain text', () => {
		expect(parseInline('a **b** *c* `d` _e_ f')).toEqual([
			{ kind: 'text', text: 'a ' },
			{ kind: 'strong', text: 'b' },
			{ kind: 'text', text: ' ' },
			{ kind: 'em', text: 'c' },
			{ kind: 'text', text: ' ' },
			{ kind: 'code', text: 'd' },
			{ kind: 'text', text: ' ' },
			{ kind: 'em', text: 'e' },
			{ kind: 'text', text: ' f' }
		]);
	});

	it('leaves unmatched markers and snake_case as text', () => {
		expect(parseInline('2 * 3 and task_id **open')).toEqual([
			{ kind: 'text', text: '2 * 3 and task_id **open' }
		]);
	});

	it('leaves globs, paths, a*b and dunder names as text', () => {
		for (const text of ['edit src/**/*.ts and lib/*.js', 'a*b*c', '__init__.py', 'my__var__name']) {
			expect(parseInline(text)).toEqual([{ kind: 'text', text }]);
		}
	});

	it('still reads __bold__ before punctuation', () => {
		expect(parseInline('__done__.')).toEqual([
			{ kind: 'strong', text: 'done' },
			{ kind: 'text', text: '.' }
		]);
	});
});

describe('parseBlocks', () => {
	it('reads headings, lists, code fences and paragraphs', () => {
		const md = [
			'## Summary',
			'Line one',
			'line two',
			'',
			'- **Sequences:** E',
			'* second',
			'',
			'1. first',
			'2. next',
			'',
			'```ts',
			'const x = 1;',
			'```',
			'> note'
		].join('\n');
		expect(parseBlocks(md)).toEqual([
			{ kind: 'heading', level: 2, inline: [{ kind: 'text', text: 'Summary' }] },
			{ kind: 'paragraph', inline: [{ kind: 'text', text: 'Line one\nline two' }] },
			{
				kind: 'list',
				ordered: false,
				start: 1,
				items: [
					{
						inline: [
							{ kind: 'strong', text: 'Sequences:' },
							{ kind: 'text', text: ' E' }
						],
						sub: null
					},
					{ inline: [{ kind: 'text', text: 'second' }], sub: null }
				]
			},
			{
				kind: 'list',
				ordered: true,
				start: 1,
				items: [
					{ inline: [{ kind: 'text', text: 'first' }], sub: null },
					{ inline: [{ kind: 'text', text: 'next' }], sub: null }
				]
			},
			{ kind: 'code', text: 'const x = 1;' },
			{ kind: 'quote', inline: [{ kind: 'text', text: 'note' }] }
		]);
	});

	it('keeps an unclosed code fence as code', () => {
		expect(parseBlocks('```\nhalf')).toEqual([{ kind: 'code', text: 'half' }]);
	});

	it('nests indented items, keeps continuation lines and the start number', () => {
		const text = (t: string) => [{ kind: 'text', text: t }];
		expect(parseBlocks('3. a\n   wrapped\n   - sub\n4. b')).toEqual([
			{
				kind: 'list',
				ordered: true,
				start: 3,
				items: [
					{
						inline: text('a\nwrapped'),
						sub: {
							kind: 'list',
							ordered: false,
							start: 1,
							items: [{ inline: text('sub'), sub: null }]
						}
					},
					{ inline: text('b'), sub: null }
				]
			}
		]);
	});

	it('reads thematic breaks as rules, not list items', () => {
		expect(parseBlocks('a\n* * *\n---\nb')).toEqual([
			{ kind: 'paragraph', inline: [{ kind: 'text', text: 'a' }] },
			{ kind: 'rule' },
			{ kind: 'rule' },
			{ kind: 'paragraph', inline: [{ kind: 'text', text: 'b' }] }
		]);
	});
});
