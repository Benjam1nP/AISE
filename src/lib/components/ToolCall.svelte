<script lang="ts">
	import { Disclosure } from '#lib/ui/index.ts';

	type Props = { name: string; input: unknown; result: string; isError: boolean };

	let { name, input, result, isError }: Props = $props();

	const inputText = $derived(JSON.stringify(input, null, 2) ?? '');
</script>

<Disclosure summary={isError ? `Tool ${name} failed` : `Tool ${name}`}>
	<div class="body">
		<p class="label">Input</p>
		<pre class="code">{inputText}</pre>
		<p class="label">{isError ? 'Error' : 'Result'}</p>
		<pre class={['code', isError && 'error']}>{result}</pre>
	</div>
</Disclosure>

<style>
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.label {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: var(--text-xs-weight);
	}

	.code {
		max-height: calc(var(--space-16) * 3);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.error {
		color: var(--color-error);
	}
</style>
