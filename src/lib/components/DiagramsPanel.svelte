<script lang="ts">
	import Network from '@lucide/svelte/icons/network';
	import type { ProjectSnapshot } from '#lib/server/index.ts';
	import { EmptyState, Panel, Select, Stack, Tabs, type TabItem } from '#lib/ui/index.ts';
	import Mermaid from './Mermaid.svelte';

	type Props = {
		diagrams: ProjectSnapshot['diagrams'];
		/** Puts text (an element ID) into the chat message being written. */
		oninsert: (text: string) => void;
	};

	let { diagrams, oninsert }: Props = $props();

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

	let kind = $state('useCase');
	let picked = $state('');
	const sequences = $derived(diagrams?.sequences ?? []);
	const sequence = $derived(sequences.find((s) => s.id === picked) ?? sequences[0]);
	const select = (id: string) => oninsert(`${id} `);
</script>

<Panel title="Diagrams">
	{#if !diagrams}
		<EmptyState
			icon={Network}
			title="No design yet"
			text="The design agent draws the diagrams after you approve the requirements."
		/>
	{:else}
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
					<Mermaid
						source={active === 'useCase'
							? diagrams.useCase
							: active === 'class'
								? diagrams.class
								: diagrams.deployment}
						label={NAMES[active]}
						onselect={select}
					/>
				{/if}
			{/snippet}
		</Tabs>
	{/if}
</Panel>
