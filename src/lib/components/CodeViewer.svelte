<script lang="ts">
	import { tick } from 'svelte';

	type Props = {
		content: string;
		/** One based line to scroll to and mark. */
		line?: number;
		/** Accessible name of the code, for example the file path. */
		label?: string;
	};

	let { content, line, label = 'Code' }: Props = $props();

	// CodeMirror is a big chunk: the code shows as plain text until it has loaded.
	let ready = $state(false);

	function mount(node: HTMLElement) {
		// Read here, not after the await, so a change of any of them runs this attachment again.
		const [text, at, name] = [content, line, label];
		let cancelled = false;
		let destroy: (() => void) | undefined;
		void import('./code-editor.ts').then(async ({ createEditor, centreOnLine }) => {
			if (cancelled) return;
			const view = createEditor(node, text, at, name);
			destroy = () => view.destroy();
			ready = true;
			// The plain fallback leaves with `ready`: centre again once the editor has the whole height.
			await tick();
			if (!cancelled) centreOnLine(view, at);
		});
		// New content or a new line runs this again: the old view goes, one new view takes its place.
		return () => {
			cancelled = true;
			destroy?.();
		};
	}
</script>

<div class="viewer">
	{#if !ready}
		<pre class="plain" aria-label={label}>{content}</pre>
	{/if}
	<div class="editor" {@attach mount}></div>
</div>

<style>
	/* Fills a fixed height parent (CodePanel); without one it grows up to --code-max-height (70dvh). */
	.viewer {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.editor {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}

	.plain {
		flex: 1;
		max-height: var(--code-max-height, 70dvh);
		margin: 0;
		padding: var(--space-3);
		overflow: auto;
		background: var(--color-surface);
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: 1.6;
	}
</style>
