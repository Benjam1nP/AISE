<script lang="ts">
	import Network from '@lucide/svelte/icons/network';
	import X from '@lucide/svelte/icons/x';
	import type { DesignDoc } from '#lib/server/core/schemas/design.ts';
	import type { Trace } from '#lib/server/core/trace.ts';
	import type { ProjectSnapshot } from '#lib/server/index.ts';
	import { focusSource, type DiagramKind } from '#lib/trace-nav.ts';
	import {
		Button,
		EmptyState,
		Icon,
		Panel,
		Select,
		Stack,
		Tabs,
		type TabItem
	} from '#lib/ui/index.ts';
	import Mermaid from './Mermaid.svelte';
	import TraceLinks from './TraceLinks.svelte';

	/** The diagram and element to show; pass a new object to show it again. */
	export type DiagramFocus = { id: string; kind: DiagramKind; seqId?: string };

	type Props = {
		diagrams: ProjectSnapshot['diagrams'];
		design?: DesignDoc | null;
		/** Puts text (an element ID) into the chat message being written. */
		oninsert: (text: string) => void;
		focus?: DiagramFocus;
		traces?: Record<string, Trace>;
		names?: Record<string, string>;
		onopenid?: (id: string) => void;
		onopenfile?: (open: { path: string; line?: number }) => void;
	};

	let {
		diagrams,
		design = null,
		oninsert,
		focus,
		traces = {},
		names = {},
		onopenid = () => {},
		onopenfile = () => {}
	}: Props = $props();

	const KINDS: TabItem[] = [
		{ id: 'useCase', label: 'Use case' },
		{ id: 'class', label: 'Class' },
		{ id: 'sequence', label: 'Sequence' },
		{ id: 'deployment', label: 'Deployment' }
	];
	const NAMES: Record<string, string> = {
		useCase: 'Use case diagram',
		class: 'Class diagram',
		sequence: 'Sequence diagram',
		deployment: 'Deployment diagram'
	};

	// Writable deriveds: a new `focus` object replaces the developer's choice, a click replaces it too.
	const incoming = $derived(focus);
	let kind = $derived<string>(incoming?.kind ?? 'useCase');
	let picked = $derived(incoming?.seqId ?? '');
	/** The element whose trace shows below the diagram, and which the diagram marks. */
	let selected = $derived<string | undefined>(incoming?.id);

	const sequences = $derived(diagrams?.sequences ?? []);
	const sequence = $derived(sequences.find((s) => s.id === picked) ?? sequences[0]);
	const trace = $derived(selected ? traces[selected] : undefined);

	function select(id: string) {
		selected = id;
		oninsert(`${id} `);
	}
	const source = (k: DiagramKind, text: string) => focusSource(text, k, selected, design);
</script>

<Panel title="Diagrams">
	{#if !diagrams}
		<EmptyState
			icon={Network}
			title="No design yet"
			text="The design agent draws the diagrams after you approve the requirements."
		/>
	{:else}
		<Stack>
			<Tabs tabs={KINDS} bind:active={kind}>
				{#snippet children(active)}
					{#if active === 'sequence'}
						{#if sequence}
							<Stack>
								<Select
									label="Sequence diagram"
									options={sequences.map((s) => ({ value: s.id, label: `${s.id} ${s.name}` }))}
									bind:value={() => sequence.id, (v) => (picked = v)}
								/>
								<Mermaid
									source={sequence.mermaid}
									label="{sequence.id} {sequence.name}"
									onselect={select}
								/>
							</Stack>
						{:else}
							<EmptyState
								icon={Network}
								title="No sequence diagrams"
								text="The design has no sequences yet. Ask the design agent for one."
							/>
						{/if}
					{:else}
						{@const k = active as DiagramKind}
						<Mermaid
							source={source(
								k,
								k === 'useCase'
									? diagrams.useCase
									: k === 'class'
										? diagrams.class
										: diagrams.deployment
							)}
							label={NAMES[k]}
							onselect={select}
						/>
					{/if}
				{/snippet}
			</Tabs>
			{#if trace}
				<section class="selected" aria-label="Selected {trace.id}">
					<header class="head">
						<h3><span class="id">{trace.id}</span> {names[trace.id] ?? ''}</h3>
						<Button
							size="sm"
							variant="ghost"
							square
							aria-label="Close the trace"
							onclick={() => (selected = undefined)}><Icon icon={X} size={16} /></Button
						>
					</header>
					<TraceLinks {trace} {names} {onopenid} {onopenfile} />
				</section>
			{/if}
		</Stack>
	{/if}
</Panel>

<style>
	.selected {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	h3 {
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
	}

	.id {
		font-family: var(--font-mono);
	}
</style>
