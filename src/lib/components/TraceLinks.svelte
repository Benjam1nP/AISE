<script lang="ts">
	import type { Trace } from '#lib/server/core/trace.ts';
	import { Badge } from '#lib/ui/index.ts';

	type Props = {
		trace: Trace;
		/** Display names of the requirement and design IDs, e.g. `UC-001` to `Add task`. */
		names: Record<string, string>;
		/** Shows a requirement or design element in its tab. */
		onopenid: (id: string) => void;
		/** Shows a code or test file at a line. */
		onopenfile: (open: { path: string; line?: number }) => void;
	};

	let { trace, names, onopenid, onopenfile }: Props = $props();

	const TONE = { passed: 'active', failed: 'error', todo: 'default', skipped: 'default' } as const;

	// The element itself is where the developer is; the links go everywhere else.
	const others = (ids: string[]) => ids.filter((x) => x !== trace.id);
	const d = $derived(trace.design);
	const groups = $derived(
		[
			{ label: 'Requirements', ids: others(trace.requirements) },
			{ label: 'Use cases', ids: others([...d.actors, ...d.useCases]) },
			{ label: 'Classes', ids: others(d.classes) },
			{ label: 'Deployment', ids: others([...d.components, ...d.nodes]) },
			{ label: 'Sequences', ids: others(d.sequences) }
		].filter((g) => g.ids.length > 0)
	);
	const at = (file: string, line?: number) => (line ? `${file}:${line}` : file);
	const base = (file: string) => file.slice(file.lastIndexOf('/') + 1);
	/** A code location in short: the file name and line, plus the declaration unless the file is named after it. */
	const codeLabel = (c: Trace['code'][number]) => {
		const short = at(base(c.file), c.line);
		return base(c.file).startsWith(`${c.name}.`) ? short : `${short} ${c.name}`;
	};
	/** A test in short: its criterion or scenario (`REQ-001 AC2`), else its whole name. */
	const testLabel = (name: string) =>
		/(?:REQ-\d{3} AC\d+|SEQ-\d{3} scenario)/.exec(name)?.[0] ?? name;
</script>

<dl class="trace" aria-label="Trace of {trace.id}">
	{#each groups as g (g.label)}
		<dt>{g.label}</dt>
		<dd>
			<ul class="links">
				{#each g.ids as id (id)}
					<li>
						<button type="button" class="link aise-hit" onclick={() => onopenid(id)}>
							<span class="id">{id}</span>
							{#if names[id]}{names[id]}{/if}
						</button>
					</li>
				{/each}
			</ul>
		</dd>
	{/each}
	<dt>Code</dt>
	<dd>
		{#if trace.code.length === 0}
			<span class="none">No code names it yet.</span>
		{:else}
			<ul class="links">
				{#each trace.code as c (at(c.file, c.line) + c.name)}
					<li>
						<button
							type="button"
							class="link aise-hit"
							title="{at(c.file, c.line)} {c.name}"
							aria-label="{at(c.file, c.line)} {c.name}"
							onclick={() => onopenfile({ path: c.file, line: c.line })}
						>
							<span class="id">{codeLabel(c)}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</dd>
	<dt>Tests</dt>
	<dd>
		{#if trace.tests.length === 0}
			<span class="none">No test result yet.</span>
		{:else}
			<ul class="links">
				{#each trace.tests as t, i (i)}
					<li>
						<button
							type="button"
							class="link aise-hit"
							title={t.name}
							aria-label="{t.status} {t.name}"
							onclick={() => onopenfile({ path: t.file, line: t.line })}
						>
							<Badge tone={TONE[t.status]}>{t.status}</Badge>
							<span class="id">{testLabel(t.name)}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</dd>
</dl>

<style>
	.trace {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-2) var(--space-3);
		margin: 0;
		font-size: var(--text-sm);
	}

	dt {
		color: var(--color-text-muted);
		font-weight: var(--weight-semibold);
	}

	dd {
		margin: 0;
		min-width: 0;
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.link {
		display: inline;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-brand-strong);
		font: inherit;
		text-align: start;
		text-decoration: underline;
		text-underline-offset: 0.2em;
		cursor: pointer;
		overflow-wrap: anywhere;
	}

	.id {
		margin-right: var(--space-1);
		font-family: var(--font-mono);
	}

	.none {
		color: var(--color-text-muted);
	}

	@media (max-width: 40rem) {
		.trace {
			grid-template-columns: 1fr;
		}

		dd + dt {
			margin-top: var(--space-1);
		}
	}
</style>
