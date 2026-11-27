<script lang="ts">
	import FileText from '@lucide/svelte/icons/file-text';
	import { Badge, Button, Cluster, Icon, Stack, Table } from '#lib/ui/index.ts';
	import { contrastRatio, PAIRS } from './contrast';

	const BRAND = [100, 200, 300, 400, 500, 600, 700, 800, 900];
	const NEUTRAL = [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
	const SEMANTIC = [
		'bg',
		'surface',
		'surface-2',
		'border',
		'border-strong',
		'text',
		'text-muted',
		'text-soft',
		'brand',
		'brand-strong',
		'on-brand',
		'brand-tint',
		'success',
		'success-tint',
		'warning',
		'warning-tint',
		'error',
		'error-tint',
		'info',
		'info-tint'
	];
	const TYPE = ['xs', 'sm', 'base', 'lg', '2xl', '3xl', '4xl', '5xl'];
	const SPACE = [1, 2, 3, 4, 6, 8, 12, 16];
	const EASINGS = ['out', 'in-out', 'in'];
	const DURATIONS = [100, 200, 300, 400, 500];
	const COLUMNS = [...Array(12).keys()];
	const ICON_SIZES = [16, 20, 24, 32, 48] as const;

	let ratios = $state<number[]>([]);
	let overlay = $state(false);
	let moved = $state(false);

	// Contrast is measured in the browser so it follows the active theme.
	$effect(() => {
		const measure = () =>
			(ratios = PAIRS.map((pair) => contrastRatio(pair.foreground, pair.background)));
		measure();
		const watcher = new MutationObserver(measure);
		watcher.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme']
		});
		return () => watcher.disconnect();
	});

	const contrastRows = $derived(
		PAIRS.map((pair, i) => ({
			pair: `${pair.foreground.slice(8)} on ${pair.background.slice(8)}`,
			ratio: ratios[i] ? ratios[i].toFixed(2) : '',
			min: pair.min.toFixed(1),
			ok: ratios[i] === undefined ? undefined : ratios[i] >= pair.min
		}))
	);
</script>

<section class="foundation" id="colour">
	<Stack gap={4}>
		<h2>Colour</h2>
		<p class="note">
			Components use the semantic tokens only. The raw scales are shown for reference. Both themes
			override the semantic layer.
		</p>
		<h3>Scales</h3>
		<div class="swatches">
			{#each BRAND as step (step)}
				<div class="swatch">
					<span class="chip" style:background="var(--brand-{step})"></span>
					<code>brand-{step}</code>
				</div>
			{/each}
		</div>
		<div class="swatches">
			{#each NEUTRAL as step (step)}
				<div class="swatch">
					<span class="chip" style:background="var(--neutral-{step})"></span>
					<code>neutral-{step}</code>
				</div>
			{/each}
		</div>
		<h3>Semantic tokens</h3>
		<div class="swatches">
			{#each SEMANTIC as name (name)}
				<div class="swatch">
					<span class="chip" style:background="var(--color-{name})"></span>
					<code>--color-{name}</code>
				</div>
			{/each}
		</div>
		<h3>Contrast in the active theme</h3>
		<Table
			columns={[
				{ key: 'pair', label: 'Pair' },
				{ key: 'ratio', label: 'Ratio' },
				{ key: 'min', label: 'Needs' },
				{ key: 'ok', label: 'Result' }
			]}
			rows={contrastRows}
		>
			{#snippet cell({ row, column })}
				{#if column.key === 'ok'}
					{#if row.ok === undefined}
						<Badge>Measuring</Badge>
					{:else}
						<Badge tone={row.ok ? 'active' : 'error'}>{row.ok ? 'Pass' : 'Fail'}</Badge>
					{/if}
				{:else}
					{row[column.key]}
				{/if}
			{/snippet}
		</Table>
	</Stack>
</section>

<section class="foundation" id="type">
	<Stack gap={4}>
		<h2>Type</h2>
		<p class="note">
			Geist for text, Geist Mono for code and IDs, Archivo semi condensed for page titles (h1, h2,
			4xl and 5xl).
		</p>
		<div class="type-list">
			{#each TYPE as name (name)}
				<div class="type-row">
					<code>--text-{name}</code>
					<span
						class={['sample', (name === '4xl' || name === '5xl') && 'display']}
						style:font-size="var(--text-{name})"
						style:font-weight={name === '4xl' || name === '5xl'
							? undefined
							: `var(--text-${name}-weight)`}
					>
						Requirements before code
					</span>
				</div>
			{/each}
		</div>
	</Stack>
</section>

<section class="foundation" id="spacing">
	<Stack gap={4}>
		<h2>Spacing</h2>
		<p class="note">4 px base. Use these steps for every gap, padding and margin.</p>
		<div class="type-list">
			{#each SPACE as step (step)}
				<div class="type-row">
					<code>--space-{step}</code>
					<span class="bar" style:width="var(--space-{step})"></span>
				</div>
			{/each}
		</div>
	</Stack>
</section>

<section class="foundation" id="grid">
	<Stack gap={4}>
		<h2>Grid</h2>
		<p class="note">
			12 columns. Gutter and page margin come from tokens. Breakpoints: sm 640, md 960, lg 1280, xl
			1600 px.
		</p>
		<div class="grid-demo" aria-hidden="true">
			{#each COLUMNS as i (i)}
				<span class="column">{i + 1}</span>
			{/each}
		</div>
		<Cluster>
			<Button onclick={() => (overlay = !overlay)} aria-pressed={overlay}>
				{overlay ? 'Hide' : 'Show'} page grid overlay
			</Button>
		</Cluster>
	</Stack>
</section>

{#if overlay}
	<div class="overlay" aria-hidden="true">
		{#each COLUMNS as i (i)}<span class="column"></span>{/each}
	</div>
{/if}

<section class="foundation" id="icons">
	<Stack gap={4}>
		<h2>Icons</h2>
		<p class="note">Lucide, stroke 2, current colour. Sizes 16, 20, 24, 32 and 48 px.</p>
		<Cluster gap={6} align="end">
			{#each ICON_SIZES as size (size)}
				<div class="icon-specimen">
					<Icon icon={FileText} {size} />
					<code>{size}</code>
				</div>
			{/each}
		</Cluster>
	</Stack>
</section>

<section class="foundation" id="motion">
	<Stack gap={4}>
		<h2>Motion</h2>
		<p class="note">
			Enter with ease out, move with ease in out, leave with ease in. Interactions stay at 300 ms or
			less. Reduced motion sets every duration to 0.
		</p>
		<Cluster>
			<Button onclick={() => (moved = !moved)}>Play</Button>
		</Cluster>
		<h3>Easing</h3>
		<div class="type-list">
			{#each EASINGS as name (name)}
				<div class="track-row">
					<code>--ease-{name}</code>
					<div class="track">
						<span
							class={['dot', moved && 'moved']}
							style:transition-timing-function="var(--ease-{name})"
							style:transition-duration="var(--duration-400)"
						></span>
					</div>
				</div>
			{/each}
		</div>
		<h3>Duration</h3>
		<div class="type-list">
			{#each DURATIONS as ms (ms)}
				<div class="track-row">
					<code>--duration-{ms}</code>
					<div class="track">
						<span
							class={['dot', moved && 'moved']}
							style:transition-timing-function="var(--ease-out)"
							style:transition-duration="var(--duration-{ms})"
						></span>
					</div>
				</div>
			{/each}
		</div>
	</Stack>
</section>

<style>
	.foundation {
		scroll-margin-top: var(--space-4);
		padding-block: var(--space-8);
		border-top: 1px solid var(--color-border);
	}

	.note {
		color: var(--color-text-muted);
	}

	.swatches {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
		gap: var(--space-3);
	}

	.swatch {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.swatch code {
		overflow-wrap: anywhere;
		font-size: var(--text-xs);
	}

	.chip {
		display: block;
		height: var(--space-8);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
	}

	.type-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.type-row,
	.track-row {
		display: grid;
		grid-template-columns: 8rem 1fr;
		align-items: center;
		gap: var(--space-4);
	}

	.sample {
		min-width: 0;
		line-height: var(--leading-heading);
	}

	.display {
		font-family: var(--font-display);
		font-stretch: var(--display-stretch);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--display-tracking);
	}

	.bar {
		display: block;
		max-width: 100%;
		height: var(--space-4);
		border-radius: var(--radius-sm);
		background: var(--color-brand);
	}

	.grid-demo,
	.overlay {
		display: grid;
		grid-template-columns: repeat(var(--grid-columns), minmax(0, 1fr));
		column-gap: var(--grid-gutter);
	}

	.grid-demo {
		padding: var(--space-4) var(--page-margin);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.overlay {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal);
		padding-inline: var(--page-margin);
		pointer-events: none;
	}

	.column {
		display: flex;
		align-items: flex-start;
		justify-content: center;
		height: var(--space-12);
		border-radius: var(--radius-sm);
		background: var(--color-brand-tint);
		color: var(--color-brand-strong);
		font-size: var(--text-xs);
	}

	.overlay .column {
		height: auto;
		background: color-mix(in srgb, var(--color-brand) 12%, transparent);
	}

	.icon-specimen {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		color: var(--color-text);
	}

	.track {
		position: relative;
		height: var(--space-4);
		border-radius: var(--radius-full);
		background: var(--color-surface-2);
	}

	.dot {
		position: absolute;
		top: 0;
		left: 0;
		width: var(--space-4);
		height: var(--space-4);
		border-radius: var(--radius-full);
		background: var(--color-brand);
		transition-property: left, transform;
	}

	.dot.moved {
		left: 100%;
		transform: translateX(-100%);
	}
</style>
