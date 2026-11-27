import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { Decoration, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { EditorView } from 'codemirror';

/**
 * The CodeMirror side of `CodeViewer`, in its own module so the editor is a separate chunk that
 * loads with the first file shown and not with the page.
 */

// Colours come from the theme tokens, so both themes work without a second highlight style.
const theme = EditorView.theme({
	'&': {
		flex: '1',
		minHeight: '0',
		maxHeight: 'var(--code-max-height, 70dvh)',
		backgroundColor: 'var(--color-surface)',
		color: 'var(--color-text)',
		fontSize: 'var(--text-sm)'
	},
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
	'.cm-content': { padding: 'var(--space-2) 0' },
	'.cm-content:focus-visible': { outline: '2px solid var(--color-focus)', outlineOffset: '-2px' },
	'.cm-line': { padding: '0 var(--space-3)' },
	'.cm-gutters': {
		backgroundColor: 'var(--color-surface-2)',
		color: 'var(--color-text-muted)',
		border: 'none',
		borderRight: '1px solid var(--color-border)'
	},
	'.cm-lineNumbers .cm-gutterElement': { padding: '0 var(--space-2)' },
	'.cm-marked-line': { backgroundColor: 'var(--color-brand-tint)' }
});

const highlight = HighlightStyle.define([
	{ tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: 'var(--color-brand-strong)' },
	{ tag: [tags.string, tags.regexp], color: 'var(--color-success)' },
	{ tag: [tags.number, tags.bool, tags.null], color: 'var(--color-info)' },
	{ tag: [tags.typeName, tags.className], fontWeight: 'var(--weight-semibold)' },
	{ tag: tags.comment, color: 'var(--color-text-muted)', fontStyle: 'italic' }
]);

/** A read only TypeScript view of `content` in `parent`; scrolls to and marks the one based `line`. */
export function createEditor(
	parent: HTMLElement,
	content: string,
	line: number | undefined,
	label: string
): EditorView {
	const doc = EditorState.create({ doc: content }).doc;
	const at =
		line === undefined ? undefined : doc.line(Math.min(Math.max(1, Math.floor(line)), doc.lines));
	const view = new EditorView({
		parent,
		state: EditorState.create({
			doc: content,
			extensions: [
				lineNumbers(),
				javascript({ typescript: true }),
				syntaxHighlighting(highlight),
				theme,
				EditorState.readOnly.of(true),
				EditorView.editable.of(false),
				EditorView.contentAttributes.of({ tabindex: '0', 'aria-label': label }),
				EditorView.decorations.of(
					at
						? Decoration.set([Decoration.line({ class: 'cm-marked-line' }).range(at.from)])
						: Decoration.none
				)
			]
		})
	});
	centreOnLine(view, line);
	return view;
}

/**
 * Scrolls the editor, and only the editor, so the one based `line` is in the middle:
 * EditorView.scrollIntoView would scroll the page as well. The height is read in the measure phase;
 * call it again once the editor has its final size (the plain fallback shares the height until then).
 */
export function centreOnLine(view: EditorView, line: number | undefined): void {
	if (line === undefined) return;
	const { doc } = view.state;
	const from = doc.line(Math.min(Math.max(1, Math.floor(line)), doc.lines)).from;
	view.requestMeasure({
		read: (v) => v.lineBlockAt(from).top - v.scrollDOM.clientHeight / 2,
		write: (top, v) => {
			v.scrollDOM.scrollTop = top;
		}
	});
}
