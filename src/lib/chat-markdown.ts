/**
 * A small Markdown subset for agent chat messages. It returns tokens that the
 * component renders as elements, so agent text never reaches the page as HTML.
 */

export type Inline = { kind: 'text' | 'strong' | 'em' | 'code'; text: string };

export type ListItem = { inline: Inline[]; sub: ListBlock | null };
export type ListBlock = { kind: 'list'; ordered: boolean; start: number; items: ListItem[] };

export type Block =
	| { kind: 'heading'; level: 1 | 2 | 3; inline: Inline[] }
	| { kind: 'paragraph'; inline: Inline[] }
	| { kind: 'quote'; inline: Inline[] }
	| ListBlock
	| { kind: 'code'; text: string }
	| { kind: 'rule' };

// Emphasis markers need a boundary on both sides, so paths, globs, a*b and
// __init__.py stay text. A closing marker may be followed by punctuation, but
// not by ".word" as in a file name.
const INLINE =
	/`([^`\n]+)`|\*\*(?=\S)(.+?)(?<=\S)\*\*|(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w|\.\w)|(?<![\w/*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])|(?<!\w)_(?=[^\s_])(.+?)(?<=[^\s_])_(?!\w)/g;

export function parseInline(source: string): Inline[] {
	const out: Inline[] = [];
	let last = 0;
	for (const m of source.matchAll(INLINE)) {
		if (m.index > last) out.push({ kind: 'text', text: source.slice(last, m.index) });
		const [, code, bold, bold2, em, em2] = m;
		if (code !== undefined) out.push({ kind: 'code', text: code });
		else if (bold !== undefined || bold2 !== undefined)
			out.push({ kind: 'strong', text: bold ?? bold2 });
		else out.push({ kind: 'em', text: em ?? em2 });
		last = m.index + m[0].length;
	}
	if (last < source.length) out.push({ kind: 'text', text: source.slice(last) });
	return out;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)(?:[-*+]|(\d+)[.)])\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const FENCE = /^\s*```/;

const indentOf = (line: string) => line.length - line.trimStart().length;
const isItem = (line: string) => ITEM.test(line) && !RULE.test(line);

export function parseBlocks(source: string): Block[] {
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	const blocks: Block[] = [];
	let i = 0;

	/** Reads items at `indent`. Deeper items nest; indented plain lines continue an item. */
	const list = (indent: number): ListBlock => {
		const first = lines[i].match(ITEM)!;
		const ordered = first[2] !== undefined;
		const block: ListBlock = {
			kind: 'list',
			ordered,
			start: ordered ? Number(first[2]) : 1,
			items: []
		};
		while (i < lines.length && isItem(lines[i])) {
			const m = lines[i].match(ITEM)!;
			const depth = m[1].length;
			if (depth < indent) break;
			if (depth > indent) {
				const last = block.items.at(-1)!;
				if (last.sub) break;
				last.sub = list(depth);
				continue;
			}
			if ((m[2] !== undefined) !== ordered) break;
			i++;
			const text = [m[3]];
			while (
				i < lines.length &&
				lines[i].trim() !== '' &&
				indentOf(lines[i]) > indent &&
				!isItem(lines[i]) &&
				!FENCE.test(lines[i])
			) {
				text.push(lines[i++].trim());
			}
			block.items.push({ inline: parseInline(text.join('\n')), sub: null });
		}
		return block;
	};

	while (i < lines.length) {
		const line = lines[i];
		if (line.trim() === '') {
			i++;
			continue;
		}
		if (FENCE.test(line)) {
			i++;
			const code: string[] = [];
			while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
			i++;
			blocks.push({ kind: 'code', text: code.join('\n') });
			continue;
		}
		if (RULE.test(line)) {
			blocks.push({ kind: 'rule' });
			i++;
			continue;
		}
		const heading = line.match(HEADING);
		if (heading) {
			const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
			blocks.push({ kind: 'heading', level, inline: parseInline(heading[2].trim()) });
			i++;
			continue;
		}
		if (isItem(line)) {
			blocks.push(list(indentOf(line)));
			continue;
		}
		if (QUOTE.test(line)) {
			const quote: string[] = [];
			let m: RegExpMatchArray | null;
			while (i < lines.length && (m = lines[i].match(QUOTE))) {
				quote.push(m[1]);
				i++;
			}
			blocks.push({ kind: 'quote', inline: parseInline(quote.join('\n')) });
			continue;
		}
		const para: string[] = [];
		while (
			i < lines.length &&
			lines[i].trim() !== '' &&
			!FENCE.test(lines[i]) &&
			!RULE.test(lines[i]) &&
			!HEADING.test(lines[i]) &&
			!isItem(lines[i]) &&
			!QUOTE.test(lines[i])
		) {
			para.push(lines[i++]);
		}
		blocks.push({ kind: 'paragraph', inline: parseInline(para.join('\n')) });
	}
	return blocks;
}
