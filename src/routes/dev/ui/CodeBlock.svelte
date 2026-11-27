<script lang="ts">
	import { AnimatedIcon, Button } from '#lib/ui/index.ts';

	let { code }: { code: string } = $props();

	let copied = $state(false);

	async function copy() {
		await navigator.clipboard.writeText(code);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<div class="code">
	<pre><code>{code}</code></pre>
	<Button
		class="copy"
		variant="ghost"
		size="sm"
		square
		aria-label={copied ? 'Copied' : 'Copy code'}
		title={copied ? 'Copied' : 'Copy code'}
		onclick={copy}
	>
		<AnimatedIcon name={copied ? 'clipboard-check' : 'clipboard'} size={16} />
	</Button>
</div>

<style>
	.code {
		position: relative;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
	}

	pre {
		margin: 0;
		padding: var(--space-3) var(--space-12) var(--space-3) var(--space-4);
		overflow-x: auto;
	}

	.code :global(.copy) {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
	}
</style>
