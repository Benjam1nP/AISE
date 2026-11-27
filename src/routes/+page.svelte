<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import FolderPlus from '@lucide/svelte/icons/folder-plus';
	import Brand from '#lib/components/Brand.svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { navigating } from '$app/state';
	import {
		AppShell,
		Banner,
		Button,
		EmptyState,
		Icon,
		Input,
		Skeleton,
		ThemeToggle,
		createFieldValidation
	} from '#lib/ui/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// The server accepts the same names, plus checkpoint names like todo@P2 that nobody types here.
	const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
	const name = createFieldValidation((v) =>
		NAME.test(v.trim())
			? undefined
			: 'Use lowercase letters, digits and hyphens, starting with a letter or digit (up to 41 characters).'
	);
	let creating = $state(false);

	const serverError = $derived(
		form?.name === name.value.trim() && form?.message && 'field' in form ? form.message : undefined
	);
	const exists = $derived(
		form?.name === name.value.trim() && form?.message && !('field' in form) ? form : undefined
	);
	const opening = $derived(navigating.to?.url.pathname.startsWith('/p/') ?? false);

	// The process every project walks through; the workspace rail shows the live state.
	const PHASES = [
		['P1', 'Requirements', 'Clarifying questions turn the idea into numbered requirements.'],
		[
			'P2',
			'Design',
			'Use case, class, sequence and component diagrams from the approved requirements.'
		],
		['P3', 'Refinement', 'Change the design in conversation; every diagram stays consistent.'],
		['P4', 'Code', 'Generated from the design, structured like the diagrams.'],
		['P5', 'Testing', 'Tests from the requirements, run, explained and fixed.'],
		['P6', 'Deployment', 'Dockerfile, Compose and a start script that run locally.'],
		['P7', 'Maintenance', 'Change requests and drift repair across every artefact.']
	] as const;

	const create: SubmitFunction = ({ cancel, formElement }) => {
		if (!name.check()) {
			cancel();
			formElement.querySelector('input')?.focus();
			return;
		}
		creating = true;
		return async ({ update }) => {
			await update({ reset: false });
			creating = false;
		};
	};
</script>

<svelte:head>
	<title>AISE</title>
</svelte:head>

<AppShell grid>
	{#snippet header()}
		<Brand />
		<span class="grow"></span>
		<ThemeToggle />
	{/snippet}

	{#snippet main()}
		<div class="page">
			<section class="intro" aria-labelledby="intro-title">
				<h1 id="intro-title">
					From a rough idea to running software, one approved phase at a time.
				</h1>
				<p class="lede">
					Agents draft each artefact. You read it, discuss it and approve it before the next phase
					starts, and every line of code traces back to a requirement.
				</p>
				<ol class="process" aria-label="Phases">
					{#each PHASES as [id, name, text], i (id)}
						<li class="step" style:--i={i}>
							<span class="node" aria-hidden="true"></span>
							<span class="step-id">{id}</span>
							<span class="step-name">{name}</span>
							<span class="step-text">{text}</span>
						</li>
					{/each}
				</ol>
			</section>

			<div class="columns">
				<section class="card" aria-labelledby="new-title">
					<h2 id="new-title">New project</h2>
					<p class="sub">It opens on the requirements chat.</p>
					{#if exists}
						<Banner tone="error" title="That project already exists">
							{exists.message}
							{#snippet actions()}
								<a class="open" href={resolve('/p/[name]', { name: exists.name })}
									>Open {exists.name}</a
								>
							{/snippet}
						</Banner>
					{/if}
					<form method="POST" action="?/create" class="create" use:enhance={create}>
						<Input
							name="name"
							label="Project name"
							hint="Lowercase letters, digits and hyphens, for example to-do-app."
							autocomplete="off"
							bind:value={name.value}
							error={name.error ?? serverError}
							success={name.success && !serverError}
							onblur={name.onblur}
							oninput={name.oninput}
						/>
						<Button type="submit" variant="primary" loading={creating}>Create project</Button>
					</form>
				</section>

				<section class="card" aria-labelledby="projects-title">
					<h2 id="projects-title">Projects</h2>
					<p class="sub">
						{data.projects.length === 1 ? '1 project' : `${data.projects.length} projects`} in this workspace.
					</p>
					{#if opening}
						<Skeleton lines={3} height="var(--space-6)" delay={300} />
					{:else if data.projects.length === 0}
						<EmptyState
							icon={FolderPlus}
							title="No projects yet"
							text="Create your first project. It starts with the requirements chat."
						/>
					{:else}
						<ul class="projects">
							{#each data.projects as project (project)}
								<li>
									<a class="project" href={resolve('/p/[name]', { name: project })}>
										<span class="project-name">{project}</span>
										<Icon icon={ArrowRight} size={16} class="arrow" />
									</a>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			</div>
		</div>
	{/snippet}
</AppShell>

<style>
	.grow {
		flex: 1;
	}

	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-12);
		width: 100%;
		max-width: calc(var(--space-16) * 18);
		margin-inline: auto;
		padding-top: var(--space-8);
	}

	.intro {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.intro h1 {
		max-width: 22ch;
		font-size: var(--text-4xl);
		font-weight: var(--weight-semibold);
		line-height: var(--leading-heading);
	}

	.lede {
		max-width: 60ch;
		color: var(--color-text-muted);
		font-size: var(--text-lg);
	}

	/* The phases as one drawn line: the thesis of the product. */
	.process {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		margin: 0;
		padding: var(--space-6) 0 0;
		list-style: none;
	}

	.step {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding-right: var(--space-4);
		animation: step-in var(--duration-400) var(--ease-out) backwards;
		animation-delay: calc(var(--i) * var(--duration-100) / 2);
	}

	.step:not(:last-child)::before {
		content: '';
		position: absolute;
		top: calc(var(--space-3) / 2);
		left: var(--space-3);
		right: 0;
		border-top: 1px dashed var(--color-track);
	}

	.node {
		position: relative;
		width: var(--space-3);
		height: var(--space-3);
		margin-bottom: var(--space-2);
		border: 1.5px solid var(--color-text);
		border-radius: var(--radius-full);
		background: var(--color-bg);
	}

	.step:first-child .node {
		border-color: var(--color-brand);
		background: var(--color-brand);
	}

	.step-id {
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.step-name {
		font-weight: var(--weight-semibold);
	}

	.step-text {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		line-height: var(--leading-heading);
	}

	@keyframes step-in {
		from {
			opacity: 0;
			transform: translateY(var(--space-1));
		}
	}

	.columns {
		display: grid;
		gap: var(--space-6);
		align-items: start;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-6);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}

	.card h2 {
		font-size: var(--text-2xl);
	}

	.sub {
		margin-top: calc(0px - var(--space-3));
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.create {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
	}

	.create > :global(:first-child) {
		align-self: stretch;
	}

	.projects {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		border-top: 1px solid var(--color-border);
		list-style: none;
	}

	.projects li {
		border-bottom: 1px solid var(--color-border);
	}

	.project {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		min-height: calc(var(--space-12) + var(--space-2));
		padding-inline: var(--space-2);
		color: var(--color-text);
		text-decoration: none;
		transition: background-color var(--duration-100) var(--ease-out);
	}

	.project:hover {
		background: color-mix(in srgb, var(--color-surface-2) 60%, transparent);
	}

	.project-name {
		font-family: var(--font-mono);
		font-weight: var(--weight-medium);
	}

	.project :global(.arrow) {
		color: var(--color-text-soft);
		transition:
			transform var(--duration-200) var(--ease-out),
			color var(--duration-100) var(--ease-out);
	}

	.project:hover :global(.arrow) {
		color: var(--color-brand-strong);
		transform: translateX(var(--space-1));
	}

	.open {
		display: inline-flex;
		align-items: center;
		min-height: var(--hit-area);
		color: var(--color-brand-strong);
		font-weight: var(--weight-medium);
	}

	@media (max-width: 959px) {
		.process {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-4);
		}

		.step {
			display: grid;
			grid-template-columns: var(--space-6) auto 1fr;
			column-gap: var(--space-2);
			align-items: baseline;
		}

		.step::before {
			display: none;
		}

		.step-text {
			grid-column: 2 / -1;
		}
	}

	@media (min-width: 960px) {
		.intro h1 {
			font-size: var(--text-5xl);
		}

		.columns {
			grid-template-columns: 5fr 7fr;
		}
	}
</style>
