<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Banner, Button, Skeleton } from '#lib/ui/index.ts';
	import PanZoom from './PanZoom.svelte';

	type MermaidApi = typeof import('mermaid').default;

	type Props = {
		source: string;
		/** Accessible name of the diagram. */
		label: string;
		/** Called with the element ID when the developer clicks a node that carries one. */
		onselect?: (id: string) => void;
	};

	let { source, label, onselect }: Props = $props();

	const uid = $props.id();
	let host: HTMLDivElement | undefined = $state();
	let mermaid = $state.raw<MermaidApi>();
	let loadError = $state<string>();
	let renderError = $state<string>();
	let svg = $state('');
	/** Bumped when `data-theme` changes or a failed render is retried. */
	let revision = $state(0);
	let renders = 0;

	const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
	const token = (name: string) =>
		getComputedStyle(document.documentElement).getPropertyValue(name).trim();

	async function load() {
		loadError = undefined;
		try {
			mermaid = (await import('mermaid')).default;
		} catch (e) {
			loadError = message(e);
		}
	}

	onMount(() => {
		const select = (id: string) => onselect?.(id);
		const globals = window as Window & { aiseSelect?: (id: string) => void };
		globals.aiseSelect = select;
		const observer = new MutationObserver(() => revision++);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme']
		});
		void load();
		return () => {
			observer.disconnect();
			if (globals.aiseSelect === select) delete globals.aiseSelect;
		};
	});

	$effect(() => {
		const api = mermaid;
		const text = source;
		void revision;
		if (!api) return;
		let current = true;
		api.initialize({
			startOnLoad: false,
			securityLevel: 'loose',
			suppressErrorRendering: true,
			theme: 'base',
			themeVariables: {
				primaryColor: token('--color-surface'),
				primaryTextColor: token('--color-text'),
				primaryBorderColor: token('--color-border-strong'),
				lineColor: token('--color-text-muted'),
				fontFamily: token('--font-sans')
			}
		});
		const id = `aise-mermaid-${uid}-${++renders}`;
		void (async () => {
			try {
				const result = await api.render(id, text);
				if (!current) return;
				svg = result.svg;
				renderError = undefined;
				await tick();
				if (!current || !host) return;
				naturalSize(host.querySelector('svg'));
				result.bindFunctions?.(host);
			} catch (e) {
				document.getElementById(`d${id}`)?.remove();
				if (!current) return;
				svg = '';
				renderError = message(e);
			}
		})();
		return () => {
			current = false;
		};
	});

	/** Mermaid scales the SVG to its container; the playground needs its real size to zoom from. */
	function naturalSize(el: SVGSVGElement | null) {
		const box = el?.viewBox.baseVal;
		if (!el || !box || box.width === 0) return;
		el.setAttribute('width', String(box.width));
		el.setAttribute('height', String(box.height));
		el.style.maxWidth = 'none';
	}

	const error = $derived(loadError ?? renderError);
</script>

<figure class="diagram" aria-label={label}>
	{#if error}
		<Banner tone="error" title="This diagram could not be drawn">
			{error}
			{#snippet actions()}
				<Button
					size="sm"
					onclick={() => {
						if (mermaid) revision++;
						else void load();
					}}>Try again</Button
				>
			{/snippet}
		</Banner>
	{:else if !svg}
		<Skeleton height="calc(var(--space-16) * 3)" delay={300} />
	{/if}
	<!-- The SVG comes from mermaid.render; every label in the source is escaped server side (mermaid.ts), and Mermaid sanitises the output. -->
	<div class={{ hidden: !svg }}>
		<PanZoom>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<div bind:this={host}>{@html svg}</div>
		</PanZoom>
	</div>
</figure>

<style>
	.diagram {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.hidden {
		display: none;
	}
</style>
