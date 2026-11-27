<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { AppShell, Banner } from '#lib/ui/index.ts';
</script>

<svelte:head>
	<title>Something went wrong · AISE</title>
</svelte:head>

<AppShell>
	{#snippet header()}
		<h1 class="brand">AISE</h1>
	{/snippet}

	{#snippet main()}
		<Banner
			tone="error"
			title={page.status === 404 ? 'We could not find that' : 'Something went wrong'}
		>
			{page.error?.message ?? 'Reload the page. If it keeps happening, restart the server.'}
			{#snippet actions()}
				<a class="link" href={resolve('/')}>Back to the projects</a>
			{/snippet}
		</Banner>
	{/snippet}
</AppShell>

<style>
	.brand {
		color: var(--color-brand-strong);
		font-size: var(--text-lg);
	}

	.link {
		display: inline-flex;
		align-items: center;
		min-height: var(--hit-area);
		color: var(--color-brand-strong);
		font-weight: var(--weight-medium);
	}
</style>
