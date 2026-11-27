<script lang="ts">
	import FileCode from '@lucide/svelte/icons/file-code';
	import Folder from '@lucide/svelte/icons/folder';
	import Maximize from '@lucide/svelte/icons/maximize';
	import Minimize from '@lucide/svelte/icons/minimize';
	import type { ProjectSnapshot } from '#lib/server/index.ts';
	import { traceIds } from '#lib/trace-ids.ts';
	import {
		AnimatedIcon,
		Badge,
		Banner,
		Button,
		Icon,
		IconButton,
		Skeleton
	} from '#lib/ui/index.ts';
	import CodeViewer from './CodeViewer.svelte';

	type Open = { path: string; line?: number };
	type Props = {
		snapshot: ProjectSnapshot;
		/** The file to show, and the line to mark in it. Pass a new object to open again. */
		open?: Open;
		/** Shows a trace ID (requirement or design element) in its tab; without it the IDs are plain badges. */
		onopenid?: (id: string) => void;
	};

	let { snapshot, open, onopenid }: Props = $props();

	const files = $derived(snapshot.files);
	/** A class file first, then any source file, then whatever is there. */
	const firstFile = (all: string[]) =>
		all.find((f) => f.startsWith('src/') && !f.startsWith('src/app/')) ??
		all.find((f) => f.startsWith('src/')) ??
		all[0] ??
		'';
	// Writable derived: it depends on the `open` object only, so a new `open` object replaces the selection, a
	// click on a file replaces it too, and a refreshed snapshot leaves it alone.
	// `incoming` only changes with the object itself, not with other props updating.
	const incoming = $derived(open);
	let selection = $derived<Open | undefined>(incoming);
	// The selected file; the first one when nothing is selected or the file is gone.
	const path = $derived(
		selection && files.includes(selection.path) ? selection.path : firstFile(files)
	);
	const line = $derived(selection?.path === path ? selection.line : undefined);

	type Row = { kind: 'dir' | 'file'; name: string; path: string; depth: number };
	/** The sorted paths as a flat tree: a folder row appears once, before its first file. */
	const rows = $derived.by(() => {
		const out: Row[] = [];
		for (const path of [...files].sort()) {
			const parts = path.split('/');
			parts.slice(0, -1).forEach((name, depth) => {
				const dir = parts.slice(0, depth + 1).join('/');
				if (out.some((r) => r.path === dir)) return;
				out.push({ kind: 'dir', name, path: dir, depth });
			});
			out.push({ kind: 'file', name: parts.at(-1)!, path, depth: parts.length - 1 });
		}
		return out;
	});

	// A finished run changes files without changing the list, so it reloads the open file too.
	const project = $derived(snapshot.name);
	const stamp = $derived(
		snapshot.lastRun
			? `${snapshot.lastRun.id}:${snapshot.lastRun.status}:${snapshot.lastRun.finishedAt ?? ''}`
			: ''
	);
	/** Bumped by a click on a file and by Retry, so both read the file again. */
	let reads = $state(0);

	type Loaded = { text: string } | { failed: true };
	async function load(path: string): Promise<Loaded> {
		try {
			const res = await fetch(`/p/${project}/file?path=${encodeURIComponent(path)}`);
			return res.ok ? { text: await res.text() } : { failed: true };
		} catch {
			return { failed: true };
		}
	}

	/**
	 * A file opened from outside (a gate item) takes focus; this runs again for every new `open`.
	 * The page only scrolls when the header is off screen.
	 */
	function focusOnOpen(node: HTMLElement) {
		if (!open) return;
		node.focus({ preventScroll: true });
		node.scrollIntoView?.({ block: 'nearest' });
	}

	// The last loaded file stays on screen until the next one has loaded: swapping it for a
	// placeholder would change the height and make the page jump. It belongs to one project, so a
	// project switch drops it.
	let loadedFile = $state<{ project: string; path: string; loaded: Loaded }>();
	const shown = $derived(loadedFile?.project === project ? loadedFile : undefined);
	$effect(() => {
		void [stamp, reads];
		const [want, from] = [path, project];
		if (!want) return;
		let stale = false;
		void load(want).then((loaded) => {
			if (!stale) loadedFile = { project: from, path: want, loaded };
		});
		return () => {
			stale = true;
		};
	});
	/** The file on screen is not the selected one yet. */
	const loading = $derived(!!shown && shown.path !== path);
	// The line of the file on screen: the live one once it is the selected file, the last one before that,
	// so a click on another file leaves the old view alone until the new one has loaded.
	let shownLine = $state<number>();
	$effect(() => {
		if (shown?.path === path) shownLine = line;
	});
	const markedLine = $derived(shown && shown.path !== path ? shownLine : line);

	// Copy: the button shows a check (or says it failed) for a moment; a new file resets it.
	let copied = $state<string>();
	let copyFailed = $state<string>();
	let resetTimer: ReturnType<typeof setTimeout> | undefined;
	async function copy(file: string, text: string) {
		clearTimeout(resetTimer);
		copied = undefined;
		copyFailed = undefined;
		try {
			await navigator.clipboard.writeText(text);
			copied = file;
		} catch {
			copyFailed = file;
		}
		resetTimer = setTimeout(() => {
			copied = undefined;
			copyFailed = undefined;
		}, 2000);
	}
	$effect(() => () => clearTimeout(resetTimer));

	let frame: HTMLDivElement | undefined = $state();
	let fullscreen = $state(false);
	async function toggleFullscreen() {
		if (!frame) return;
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await frame.requestFullscreen();
		} catch {
			// Full screen is not allowed here (for example in an iframe); the view stays as it is.
		}
	}
	$effect(() => {
		const sync = () => (fullscreen = document.fullscreenElement === frame);
		document.addEventListener('fullscreenchange', sync);
		return () => document.removeEventListener('fullscreenchange', sync);
	});
</script>

<div class={['code', { fullscreen }]} bind:this={frame}>
	<nav class="tree" aria-label="Files">
		<ul>
			{#each rows as row (row.path)}
				<li style:--depth={row.depth}>
					{#if row.kind === 'dir'}
						<span class="dir"><Icon icon={Folder} size={16} />{row.name}</span>
					{:else}
						<button
							type="button"
							class="file aise-hit"
							title={row.path}
							aria-current={path === row.path ? 'true' : undefined}
							onclick={() => {
								selection = { path: row.path };
								reads++;
							}}
						>
							<Icon icon={FileCode} size={16} />{row.name}
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	</nav>

	<div class="view">
		{#if path}
			<header class="head">
				<span class="path" tabindex="-1" {@attach focusOnOpen}
					>{shown?.path ?? path}{markedLine ? `:${markedLine}` : ''}</span
				>
				{#if shown && 'text' in shown.loaded}
					{@const ids = traceIds(shown.loaded.text)}
					{#if ids.length > 0}
						<ul class="trace" aria-label="Trace">
							{#each ids as id (id)}
								<li>
									{#if onopenid}
										<button
											type="button"
											class="trace-link aise-hit"
											aria-label="Show {id}"
											onclick={() => onopenid(id)}><Badge tone="info">{id}</Badge></button
										>
									{:else}
										<Badge tone="info">{id}</Badge>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
				<div class="tools" role="group" aria-label="File">
					{#if shown && 'text' in shown.loaded}
						{@const { path: file, loaded } = shown}
						{@const done = copied === file}
						<Button
							size="sm"
							variant="ghost"
							square
							aria-label="Copy file"
							title={done ? 'Copied' : copyFailed === file ? 'Copy did not work' : 'Copy file'}
							onclick={() => copy(file, loaded.text)}
						>
							<AnimatedIcon name={done ? 'clipboard-check' : 'clipboard'} size={16} />
						</Button>
					{/if}
					<IconButton
						size="sm"
						icon={fullscreen ? Minimize : Maximize}
						label={fullscreen ? 'Exit full screen' : 'Full screen'}
						onclick={toggleFullscreen}
					/>
				</div>
				<span class="aise-sr-only" role="status"
					>{copied && copied === shown?.path
						? 'Copied to the clipboard'
						: copyFailed && copyFailed === shown?.path
							? 'Copy did not work'
							: ''}</span
				>
			</header>
			{#if !shown}
				<Skeleton delay={300} lines={8} />
			{:else if 'text' in shown.loaded}
				<div class="body" class:loading aria-busy={loading}>
					<CodeViewer content={shown.loaded.text} line={markedLine} label={shown.path} />
				</div>
			{:else}
				<Banner tone="error" title="That file did not load">
					{shown.path} could not be read.
					{#snippet actions()}
						<Button size="sm" onclick={() => reads++}>Retry</Button>
					{/snippet}
				</Banner>
			{/if}
		{/if}
	</div>
</div>

<style>
	.code {
		display: grid;
		gap: var(--space-4);
		min-width: 0;
	}

	/* One fixed height, the same as CodegenProgress: a file of any length or a finished run never
	   changes the height of the page; the tree and the code scroll inside it. */
	@media (min-width: 640px) {
		.code {
			grid-template-columns: calc(var(--space-16) * 3) minmax(0, 1fr);
			height: 70dvh;
		}
	}

	.tree {
		max-height: 70dvh;
		overflow: auto;
	}

	/* Full screen: tree and code take the whole screen. */
	.code.fullscreen {
		--code-max-height: none;
		height: 100dvh;
		padding: var(--space-4);
		background: var(--color-bg);
	}

	.fullscreen .tree {
		max-height: none;
	}

	@media (min-width: 640px) {
		.code.fullscreen {
			grid-template-columns: calc(var(--space-16) * 4) minmax(0, 1fr);
		}
	}

	.tree ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tree li {
		padding-left: calc(var(--depth) * var(--space-3));
	}

	.dir,
	.file {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-height: var(--space-8);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-sm);
	}

	.dir {
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.file {
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		text-align: left;
		cursor: pointer;
		overflow-wrap: anywhere;
		transition: background-color var(--duration-100) var(--ease-out);
	}

	.file:hover {
		background: var(--color-surface-2);
	}

	.file[aria-current='true'] {
		background: var(--color-surface-2);
		box-shadow: inset 0 0 0 1px var(--color-border);
		font-weight: var(--weight-semibold);
	}

	.view {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
		min-height: 0;
	}

	/* Keeps CodeViewer filling the fixed height; dimmed while the next file loads. */
	.body {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		transition: opacity var(--duration-200) var(--ease-out);
	}

	.body.loading {
		opacity: 0.5;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}

	.tools {
		display: flex;
		gap: var(--space-1);
		margin-left: auto;
	}

	.path {
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		overflow-wrap: anywhere;
	}

	.trace-link {
		padding: 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: none;
		font: inherit;
		cursor: pointer;
	}

	.trace-link:hover :global(.badge) {
		text-decoration: underline;
	}

	.trace {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
		font-family: var(--font-mono);
	}
</style>
