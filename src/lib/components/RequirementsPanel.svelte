<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import FileText from '@lucide/svelte/icons/file-text';
	import Plus from '@lucide/svelte/icons/plus';
	import { tick } from 'svelte';
	import {
		nextReqId,
		parseSaveErrors,
		toDraft,
		toLines,
		toRequirement,
		type Draft,
		type EditableField,
		type SaveErrors
	} from '#lib/requirements-edit.ts';
	import type { RequirementsDoc, Requirement } from '#lib/server/core/schemas/requirements.ts';
	import type { ProjectSnapshot } from '#lib/server/index.ts';
	import {
		Badge,
		Banner,
		Button,
		Cluster,
		Disclosure,
		EmptyState,
		Icon,
		Input,
		Modal,
		Panel,
		Select,
		Stack,
		Table,
		Textarea,
		createFieldValidation,
		type TableColumn
	} from '#lib/ui/index.ts';

	type Props = { snapshot: ProjectSnapshot };

	let { snapshot }: Props = $props();

	const COLUMNS: TableColumn[] = [
		{ key: 'id', label: 'ID', width: '6rem' },
		{ key: 'title', label: 'Title' },
		{ key: 'type', label: 'Type' },
		{ key: 'priority', label: 'Priority' }
	];
	const TYPES = [
		{ value: 'functional', label: 'Functional' },
		{ value: 'non-functional', label: 'Non-functional' }
	];
	const PRIORITIES = [
		{ value: 'must', label: 'Must' },
		{ value: 'should', label: 'Should' },
		{ value: 'could', label: 'Could' }
	];
	const NO_ERRORS: SaveErrors = { fields: {}, general: [] };

	const doc = $derived(snapshot.requirements);
	const reqs = $derived(doc?.requirements ?? []);
	const changed = $derived(new Set(snapshot.staleReqIds));
	const p1Approved = $derived(snapshot.state.phases.P1.status === 'approved');
	const rows = $derived(reqs.map((r) => ({ ...r })));

	/** The ID of the requirement in the editor; undefined when none is open. */
	let editing = $state<string>();
	let isNew = $state(false);
	let type = $state('functional');
	let priority = $state('must');
	let serverErrors = $state<SaveErrors>(NO_ERRORS);
	let saving = $state<'save' | 'remove'>();
	let removeOpen = $state(false);
	let payload = $state('');
	let savedIndex = -1;
	let poster: HTMLFormElement | undefined = $state();
	let editor: HTMLFormElement | undefined = $state();

	const title = createFieldValidation((v) =>
		v.trim() === '' ? 'Give the requirement a short title.' : undefined
	);
	const text = createFieldValidation((v) =>
		v.trim() === '' ? 'Write what the system must do, as one testable statement.' : undefined
	);
	const criteria = createFieldValidation((v) =>
		toLines(v).length === 0 ? 'Add at least one acceptance criterion, one per line.' : undefined
	);
	const fields = { title, text, acceptanceCriteria: criteria } as const;

	function startEdit(r: Requirement | null) {
		const d: Draft = r
			? toDraft(r)
			: {
					id: nextReqId(reqs),
					title: '',
					text: '',
					type: 'functional',
					priority: 'must',
					criteria: ''
				};
		title.reset(d.title);
		text.reset(d.text);
		criteria.reset(d.criteria);
		type = d.type;
		priority = d.priority;
		serverErrors = NO_ERRORS;
		isNew = r === null;
		editing = d.id;
	}

	function stopEdit() {
		editing = undefined;
		serverErrors = NO_ERRORS;
	}

	const fieldError = (name: EditableField) => fields[name].error ?? serverErrors.fields[name];

	function onInput(name: EditableField, event: Event & { currentTarget: { value: string } }) {
		if (serverErrors.fields[name])
			serverErrors = { ...serverErrors, fields: { ...serverErrors.fields, [name]: undefined } };
		fields[name].oninput(event);
	}

	async function focusFirstError() {
		await tick();
		editor?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	}

	async function post(patch: Partial<RequirementsDoc>, index: number, kind: 'save' | 'remove') {
		const base: RequirementsDoc = doc ?? {
			requirements: [],
			openQuestions: [],
			assumptions: [],
			outOfScope: []
		};
		payload = JSON.stringify({ ...base, ...patch });
		savedIndex = index;
		saving = kind;
		await tick();
		poster?.requestSubmit();
	}

	/** Validates every field on click, so each one that blocks shows its error; Save stays enabled. */
	function save() {
		const valid = [title.check(), text.check(), criteria.check()].every(Boolean);
		if (!valid || editing === undefined) return void focusFirstError();
		const edited = toRequirement({
			id: editing,
			title: title.value,
			text: text.value,
			type: type as Requirement['type'],
			priority: priority as Requirement['priority'],
			criteria: criteria.value
		});
		if (isNew) return void post({ requirements: [...reqs, edited] }, reqs.length, 'save');
		const index = reqs.findIndex((r) => r.id === editing);
		void post({ requirements: reqs.map((r, i) => (i === index ? edited : r)) }, index, 'save');
	}

	/** Removes the open requirement and unlinks it from open questions (the server rejects dangling links). */
	function remove() {
		removeOpen = false;
		const id = editing;
		const index = reqs.findIndex((r) => r.id === id);
		const openQuestions = (doc?.openQuestions ?? []).map((q) => ({
			...q,
			reqIds: q.reqIds.filter((r) => r !== id)
		}));
		void post({ requirements: reqs.filter((_, i) => i !== index), openQuestions }, index, 'remove');
	}

	const removing = $derived(reqs.find((r) => r.id === editing));

	const submit: SubmitFunction = () => {
		return async ({ result, update }) => {
			await update({ reset: false });
			saving = undefined;
			if (result.type === 'success') return stopEdit();
			const message =
				result.type === 'failure' && typeof result.data?.message === 'string'
					? result.data.message
					: 'The server could not save the requirements. Try again.';
			serverErrors = parseSaveErrors(message, savedIndex);
			void focusFirstError();
		};
	};
</script>

{#snippet editorForm()}
	<form
		class="editor"
		bind:this={editor}
		onsubmit={(event) => {
			event.preventDefault();
			save();
		}}
	>
		<Stack gap={3}>
			<Input
				label="Title"
				bind:value={title.value}
				error={fieldError('title')}
				success={title.success}
				onblur={title.onblur}
				oninput={(e) => onInput('title', e)}
			/>
			<Textarea
				label="Requirement"
				hint="One testable statement of what the system must do or be."
				rows={3}
				bind:value={text.value}
				error={fieldError('text')}
				success={text.success}
				onblur={text.onblur}
				oninput={(e) => onInput('text', e)}
			/>
			<Cluster gap={3} align="start">
				<Select label="Type" options={TYPES} bind:value={type} />
				<Select label="Priority" options={PRIORITIES} bind:value={priority} />
			</Cluster>
			<Textarea
				label="Acceptance criteria"
				hint="One checkable condition per line."
				rows={4}
				bind:value={criteria.value}
				error={fieldError('acceptanceCriteria')}
				success={criteria.success}
				onblur={criteria.onblur}
				oninput={(e) => onInput('acceptanceCriteria', e)}
			/>
			{#if p1Approved}
				<p class="note">Saving reopens the requirements for approval.</p>
			{/if}
			<Cluster gap={2} justify="between">
				{#if isNew}
					<span></span>
				{:else}
					<Button
						variant="destructive"
						loading={saving === 'remove'}
						onclick={() => (removeOpen = true)}>Remove requirement</Button
					>
				{/if}
				<Cluster gap={2}>
					<Button onclick={stopEdit}>Cancel</Button>
					<Button type="submit" variant="primary" loading={saving === 'save'}>Save</Button>
				</Cluster>
			</Cluster>
		</Stack>
	</form>
{/snippet}

<Panel title="Requirements">
	{#snippet actions()}
		{#if !editing}
			<Button size="sm" onclick={() => startEdit(null)}
				><Icon icon={Plus} size={16} />Add requirement</Button
			>
		{/if}
	{/snippet}

	<Stack gap={4}>
		{#if serverErrors.general.length > 0}
			<Banner tone="error" title="The requirements were not saved">
				{serverErrors.general.join(' ')}
				{#snippet actions()}
					<Button size="sm" variant="ghost" onclick={() => (serverErrors = NO_ERRORS)}
						>Dismiss</Button
					>
				{/snippet}
			</Banner>
		{/if}

		{#if reqs.length === 0 && !(editing && isNew)}
			<EmptyState
				icon={FileText}
				title="No requirements yet"
				text="They appear here as the requirements agent writes them. You can also add one yourself."
			/>
		{:else}
			<Table columns={COLUMNS} {rows}>
				{#snippet cell({ row, column })}
					{@const r = row as unknown as Requirement}
					{#if column.key === 'title'}
						<Disclosure bare summary={r.title} open={editing === r.id}>
							<Stack gap={3}>
								{#if changed.has(r.id)}
									<div>
										<Badge tone="pending">Changed since the design was approved</Badge>
									</div>
								{/if}
								{#if editing === r.id}
									{@render editorForm()}
								{:else}
									<p>{r.text}</p>
									<div>
										<p class="label">Acceptance criteria</p>
										<ul class="criteria">
											{#each r.acceptanceCriteria as line, i (i)}<li>{line}</li>{/each}
										</ul>
									</div>
									{#if !editing}
										<div><Button size="sm" onclick={() => startEdit(r)}>Edit</Button></div>
									{/if}
								{/if}
							</Stack>
						</Disclosure>
					{:else if column.key === 'priority'}
						<Badge tone={r.priority === 'must' ? 'new' : 'default'}>{r.priority}</Badge>
					{:else if column.key === 'id'}
						<span class="id">{r.id}</span>
					{:else}
						{r[column.key as 'type']}
					{/if}
				{/snippet}
			</Table>
		{/if}

		{#if editing && isNew}
			<section class="new" aria-label="New requirement {editing}">
				<h3>New requirement {editing}</h3>
				{@render editorForm()}
			</section>
		{/if}

		{#if doc && (doc.openQuestions.length > 0 || doc.assumptions.length > 0 || doc.outOfScope.length > 0)}
			<Stack gap={3}>
				{#if doc.openQuestions.length > 0}
					<div>
						<h3>Open questions</h3>
						<ul class="list">
							{#each doc.openQuestions as q, i (i)}
								<li>
									<span class="id">{q.id}</span>
									{q.text}
									{#if q.reqIds.length > 0}<span class="note">({q.reqIds.join(', ')})</span>{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if doc.assumptions.length > 0}
					<div>
						<h3>Assumptions</h3>
						<ul class="list">
							{#each doc.assumptions as a, i (i)}<li>{a}</li>{/each}
						</ul>
					</div>
				{/if}
				{#if doc.outOfScope.length > 0}
					<div>
						<h3>Out of scope</h3>
						<ul class="list">
							{#each doc.outOfScope as o, i (i)}<li>{o}</li>{/each}
						</ul>
					</div>
				{/if}
			</Stack>
		{/if}
	</Stack>
</Panel>

{#if removing}
	<Modal bind:open={removeOpen} title="Remove {removing.id}?">
		<p>
			Remove requirement puts {removing.id} "{removing.title}" out of the requirements and unlinks
			it from open questions. A manual edit is not a run, so Discard last run cannot bring it back.
		</p>
		{#snippet footer()}
			<Button variant="destructive" onclick={remove}>Remove {removing.id}</Button>
			<Button variant="primary" onclick={() => (removeOpen = false)}>Keep it</Button>
		{/snippet}
	</Modal>
{/if}

<form method="POST" action="?/editRequirements" bind:this={poster} use:enhance={submit} hidden>
	<input type="hidden" name="doc" value={payload} />
</form>

<style>
	h3 {
		margin-bottom: var(--space-1);
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
	}

	.id {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}

	.label {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
	}

	.criteria,
	.list {
		margin: 0;
		padding-left: var(--space-4);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.note {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.new {
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
</style>
