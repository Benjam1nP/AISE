<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import { formatUsd } from '#lib/live-run.ts';
	import { AnimatedIcon, Icon } from '#lib/ui/index.ts';
	import type { PhaseId, PhaseStatus, State } from '#lib/server/core/state.ts';
	import type { WorkPhase } from '#lib/workspace-view.ts';

	type Props = {
		phases: State['phases'];
		/** What the agent runs of each phase cost; shown under its status, with the total at the end. */
		costByPhase?: Partial<Record<PhaseId, number>>;
		selected: WorkPhase;
		onselect: (phase: WorkPhase) => void;
	};

	let { phases, costByPhase = {}, selected, onselect }: Props = $props();

	const total = $derived(Object.values(costByPhase).reduce((sum, cost) => sum + (cost ?? 0), 0));

	// A plain list: `$lib/server` modules may only be imported as types in client code.
	const PHASES: PhaseId[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
	const NAMES: Record<PhaseId, string> = {
		P1: 'Requirements',
		P2: 'Design',
		P3: 'Refinement',
		P4: 'Code',
		P5: 'Testing',
		P6: 'Deployment',
		P7: 'Maintenance'
	};
	const STATUS: Record<PhaseStatus, string> = {
		not_started: 'Not started',
		running: 'Running',
		awaiting_approval: 'Awaiting approval',
		approved: 'Approved',
		stale: 'Stale'
	};
	/** P1 and P2 always; P3 once P2 has started; P4 once the design is approved, P5 once the code is, P6 and P7 once the tests are, or as long as they hold a state of their own. */
	const isOpen = (phase: PhaseId): phase is WorkPhase =>
		phase === 'P1' ||
		phase === 'P2' ||
		(phase === 'P3' &&
			(phases.P2.status !== 'not_started' ||
				(phases.P3?.status ?? 'not_started') !== 'not_started')) ||
		(phase === 'P4' &&
			(phases.P2.status === 'approved' ||
				(phases.P4?.status ?? 'not_started') !== 'not_started')) ||
		(phase === 'P5' &&
			(phases.P4?.status === 'approved' ||
				(phases.P5?.status ?? 'not_started') !== 'not_started')) ||
		(phase === 'P6' &&
			(phases.P5?.status === 'approved' ||
				(phases.P6?.status ?? 'not_started') !== 'not_started')) ||
		(phase === 'P7' &&
			(phases.P5?.status === 'approved' ||
				phases.P5?.status === 'stale' ||
				(phases.P7?.status ?? 'not_started') !== 'not_started'));

	let rail: HTMLElement | undefined = $state();

	// On narrow screens the rail scrolls; keep the selected station in view.
	// Scrolls the rail only, never the page, and re-runs when the selection changes.
	$effect(() => {
		void selected;
		const el = rail?.querySelector('[aria-current="step"]');
		if (!rail || !el) return;
		const r = rail.getBoundingClientRect();
		const e = el.getBoundingClientRect();
		if (e.left < r.left) rail.scrollLeft -= r.left - e.left;
		else if (e.right > r.right) rail.scrollLeft += e.right - r.right;
	});

	/** The track after a station turns solid once that phase is approved. */
	const done = (phase: PhaseId) => phases[phase]?.status === 'approved';
</script>

<nav aria-label="Phases" class="rail" bind:this={rail}>
	<ol class="list">
		{#each PHASES as phase, i (phase)}
			{@const status = isOpen(phase) ? phases[phase].status : undefined}
			<li class={['station', i < PHASES.length - 1 && 'linked', done(phase) && 'done']}>
				{#if status}
					<button
						type="button"
						class={['stop', selected === phase && 'selected']}
						data-status={status}
						aria-current={selected === phase ? 'step' : undefined}
						onclick={() => onselect(phase as WorkPhase)}
					>
						<span class="glyph" aria-hidden="true">
							<AnimatedIcon name={status === 'approved' ? 'check' : undefined} size={16} />
							{#if status === 'running'}<Icon icon={Ellipsis} size={16} />{/if}
						</span>
						<span class="text">
							<span class="name"><span class="id">{phase}</span>{NAMES[phase]}</span>
							<span class="status"
								>{STATUS[status]}{#if costByPhase[phase] !== undefined}<span class="aise-sr-only"
										>, cost
									</span><span class="cost aise-num">{formatUsd(costByPhase[phase])}</span
									>{/if}</span
							>
						</span>
					</button>
				{:else}
					<span class="stop later">
						<span class="glyph" aria-hidden="true"></span>
						<span class="text">
							<span class="name"><span class="id">{phase}</span>{NAMES[phase]}</span>
							<span class="status"
								>{phase === 'P3'
									? 'After the design starts'
									: phase === 'P4'
										? 'After design approval'
										: phase === 'P5'
											? 'After code approval'
											: phase === 'P6' || phase === 'P7'
												? 'After test approval'
												: 'Not built yet'}</span
							>
						</span>
					</span>
				{/if}
			</li>
		{/each}
		<li class="total aise-num">
			<span class="status">Total cost</span>
			<span class="amount">{formatUsd(total)}</span>
		</li>
	</ol>
</nav>

<style>
	.rail {
		--glyph: var(--icon-20);
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: thin;
	}

	.list {
		display: grid;
		grid-template-columns:
			repeat(7, minmax(calc(var(--space-16) * 2 + var(--space-8)), 1fr))
			auto;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.station {
		position: relative;
		min-width: 0;
	}

	/* The track runs from this station's glyph towards the next one. */
	.linked::before {
		content: '';
		position: absolute;
		top: calc(var(--space-2) + var(--glyph) / 2);
		left: calc(var(--space-2) + var(--glyph) / 2);
		right: calc(0px - var(--space-2) - var(--glyph) / 2);
		border-top: 1px dashed var(--color-track);
	}

	.linked.done::before {
		border-top: 2px solid var(--color-text);
		transform: translateY(-50%);
	}

	.stop {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		width: fit-content;
		max-width: 100%;
		min-height: var(--hit-area);
		margin: 0;
		padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2);
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text);
		text-align: left;
		transition: background-color var(--duration-100) var(--ease-out);
	}

	button.stop {
		cursor: pointer;
	}

	/* The rail scrolls, so an outside ring would be clipped. */
	.stop:focus-visible {
		outline-offset: -2px;
	}

	button.stop:hover {
		background: color-mix(in srgb, var(--color-surface-2) 70%, transparent);
	}

	.stop.selected {
		background: var(--color-surface-2);
		box-shadow: inset 0 0 0 1px var(--color-border);
	}

	.glyph {
		position: relative;
		display: grid;
		flex: none;
		place-items: center;
		width: var(--glyph);
		height: var(--glyph);
		border: 1.5px solid var(--color-border-strong);
		border-radius: var(--radius-full);
		background: var(--color-surface);
		transition:
			background-color var(--duration-200) var(--ease-out),
			border-color var(--duration-200) var(--ease-out);
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		line-height: var(--leading-label);
	}

	.name {
		display: flex;
		align-items: baseline;
		gap: var(--space-1);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		white-space: nowrap;
	}

	.id {
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.status {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: var(--text-xs-weight);
		white-space: nowrap;
	}

	/* Needs the developer: orange ring with a centre dot. */
	[data-status='awaiting_approval'] .glyph {
		border-color: var(--color-brand);
	}

	[data-status='awaiting_approval'] .glyph::after {
		content: '';
		width: calc(var(--glyph) / 2.5);
		height: calc(var(--glyph) / 2.5);
		border-radius: var(--radius-full);
		background: var(--color-brand);
	}

	[data-status='awaiting_approval'] .status,
	[data-status='running'] .status {
		color: var(--color-brand-strong);
	}

	/* Agent at work: solid orange with an expanding halo. */
	[data-status='running'] .glyph {
		border-color: var(--color-brand);
		background: var(--color-brand);
		color: var(--color-on-brand);
	}

	[data-status='running'] .glyph::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: var(--radius-full);
		animation: rail-halo calc(var(--duration-500) * 3) var(--ease-out) infinite;
	}

	[data-status='approved'] .glyph {
		border-color: var(--color-text);
		background: var(--color-text);
		color: var(--color-bg);
	}

	[data-status='stale'] .glyph {
		border-style: dashed;
		border-color: var(--color-warning);
		background: var(--color-warning-tint);
	}

	[data-status='stale'] .status {
		color: var(--color-warning);
	}

	.later {
		color: var(--color-text-muted);
	}

	.cost {
		margin-left: var(--space-2);
		color: var(--color-text-muted);
		font-family: var(--font-mono);
	}

	.total {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: var(--space-1);
		padding: var(--space-2);
		border-left: 1px solid var(--color-border);
		line-height: var(--leading-label);
		white-space: nowrap;
	}

	.amount {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}

	.later .glyph {
		border-style: dashed;
		border-color: var(--color-track);
	}

	@keyframes rail-halo {
		from {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-brand) 55%, transparent);
		}
		to {
			box-shadow: 0 0 0 var(--space-2) color-mix(in srgb, var(--color-brand) 0%, transparent);
		}
	}
</style>
