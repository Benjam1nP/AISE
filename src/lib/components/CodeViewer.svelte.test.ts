import { render, waitFor } from '@testing-library/svelte';
import { EditorView } from 'codemirror';
import { describe, expect, it, vi } from 'vitest';
import CodeViewer from './CodeViewer.svelte';

const content = ['export class Task {', '\tid = 1;', '\ttitle = "x";', '}'].join('\n');
const editor = (c: HTMLElement) => c.querySelector('.cm-content');

describe('CodeViewer', () => {
	it('shows the code as plain text until CodeMirror has loaded', async () => {
		const { container } = render(CodeViewer, { content });
		expect(container.querySelector('pre')?.textContent).toBe(content);
		await waitFor(() => expect(editor(container)).not.toBeNull());
		expect(container.querySelector('pre')).toBeNull();
	});

	it('renders the content and cannot be edited', async () => {
		const { container } = render(CodeViewer, { content });
		await waitFor(() => expect(editor(container)).not.toBeNull());
		expect(editor(container)!.textContent).toContain('export class Task');
		expect(editor(container)!.getAttribute('contenteditable')).toBe('false');
	});

	it('marks the requested line', async () => {
		const { container } = render(CodeViewer, { content, line: 3 });
		await waitFor(() => expect(container.querySelectorAll('.cm-marked-line')).toHaveLength(1));
		expect(container.querySelector('.cm-marked-line')!.textContent).toContain('title');
	});

	it('marks no line without one', async () => {
		const { container } = render(CodeViewer, { content });
		await waitFor(() => expect(editor(container)).not.toBeNull());
		expect(container.querySelector('.cm-marked-line')).toBeNull();
	});

	it('replaces the view when the content and the line change', async () => {
		const { container, rerender } = render(CodeViewer, { content, line: 3 });
		await waitFor(() => expect(container.querySelector('.cm-marked-line')).not.toBeNull());
		await rerender({ content: 'const a = 1;\nconst b = 2;\nconst c = 3;', line: 2 });
		await waitFor(() => expect(editor(container)?.textContent).toContain('const a = 1;'));
		expect(container.querySelectorAll('.cm-editor')).toHaveLength(1);
		expect(editor(container)!.textContent).not.toContain('export class Task');
		const marked = container.querySelectorAll('.cm-marked-line');
		expect(marked).toHaveLength(1);
		expect(marked[0].textContent).toBe('const b = 2;');
	});

	it('centres the marked line again once the plain fallback has gone', async () => {
		const plainShown: boolean[] = [];
		vi.spyOn(EditorView.prototype, 'requestMeasure').mockImplementation(() => {
			plainShown.push(document.querySelector('pre') !== null);
		});
		const { container } = render(CodeViewer, { content, line: 3 });
		try {
			await waitFor(() => expect(plainShown.at(-1)).toBe(false));
			expect(container.querySelector('pre')).toBeNull();
		} finally {
			vi.restoreAllMocks();
		}
	});
});
