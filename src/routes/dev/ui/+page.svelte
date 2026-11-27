<script lang="ts">
	import { tick } from 'svelte';
	import Archive from '@lucide/svelte/icons/archive';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash from '@lucide/svelte/icons/trash';
	import type { PhaseStatus } from '#lib/server/core/state.ts';
	import {
		AnimatedIcon,
		AppShell,
		Badge,
		Banner,
		Button,
		Card,
		Cluster,
		Disclosure,
		Dropdown,
		EmptyState,
		FormField,
		Icon,
		IconButton,
		Input,
		Kbd,
		Modal,
		Panel,
		Select,
		Skeleton,
		Spinner,
		SplitView,
		Stack,
		StatusBadge,
		Table,
		Tabs,
		Textarea,
		ThemeToggle,
		ThinkingOrb,
		createFieldValidation
	} from '#lib/ui/index.ts';
	import DocSection from './DocSection.svelte';
	import { docs } from './docs';
	import Foundations from './Foundations.svelte';
	import Specimen from './Specimen.svelte';

	const STATUSES: PhaseStatus[] = [
		'not_started',
		'running',
		'awaiting_approval',
		'approved',
		'stale'
	];
	const VARIANTS = ['primary', 'secondary', 'ghost', 'destructive'] as const;
	const SIZES = ['sm', 'md', 'lg'] as const;
	const TONES = ['new', 'active', 'pending', 'error', 'info', 'default'] as const;
	const ANIMATED = ['check', 'circle-check', 'circle-alert', 'clipboard-check'] as const;
	let drawn = $state(true);
	/** Clears the names for one tick: setting them again is a change, so the icons draw. */
	async function redraw() {
		drawn = false;
		await tick();
		drawn = true;
	}
	const SPINNER_SIZES = [16, 20, 24, 32] as const;
	const ORB_STATES = [
		'working',
		'searching',
		'composing',
		'solving',
		'listening',
		'connecting',
		'weaving',
		'breathing',
		'shaping'
	] as const;

	const PHASES = [
		{ id: 'p1', label: 'P1 Requirements' },
		{ id: 'p2', label: 'P2 Design' },
		{ id: 'p3', label: 'P3 Refinement', disabled: true, hint: 'Approve P2 first' }
	];
	const PHASE_OPTIONS = [
		{ value: 'p1', label: 'P1 Requirements' },
		{ value: 'p2', label: 'P2 Design' }
	];
	const MENU = [
		{ id: 'rename', label: 'Rename', icon: Pencil },
		{ id: 'archive', label: 'Archive', icon: Archive, disabled: true },
		{ id: 'delete', label: 'Delete', icon: Trash, destructive: true }
	];
	const COLUMNS = [
		{ key: 'id', label: 'ID', width: '6rem' },
		{ key: 'title', label: 'Requirement' },
		{ key: 'priority', label: 'Priority' }
	];
	const ROWS = [
		{ id: 'REQ-001', title: 'Add a to do item', priority: 'must' },
		{ id: 'REQ-002', title: 'Mark an item done', priority: 'must' },
		{ id: 'REQ-003', title: 'Filter by status', priority: 'should' }
	];
	const NAV = ['colour', 'type', 'spacing', 'grid', 'icons', 'motion', ...Object.keys(docs)];

	let name = $state('');
	let description = $state('');
	let phase = $state('p1');
	let activeTab = $state('p1');
	let modalOpen = $state(false);
	let picked = $state('nothing yet');
	let disclosureOpen = $state(false);
	let delayKey = $state(0);
	const project = createFieldValidation((v) =>
		/^[a-z0-9-]+$/.test(v)
			? undefined
			: 'Use lowercase letters, digits and dashes, for example todo-app.'
	);
</script>

<svelte:head>
	<title>Design system</title>
</svelte:head>

<AppShell>
	{#snippet header()}
		<Cluster justify="between" class="bar">
			<h1>Design system</h1>
			<ThemeToggle />
		</Cluster>
	{/snippet}

	{#snippet main()}
		<Stack gap={6}>
			<p class="intro">
				Every component of <code>src/lib/ui</code>, with its variants and states. Hover, press and
				focus the live ones. Disabled, loading, error and empty states are shown statically. All
				components accept <code>class</code> and pass other attributes to their root element (form
				controls pass them to the native control). Tokens live in <code>tokens.css</code>.
			</p>
			<nav aria-label="Sections">
				<Cluster gap={3}>
					{#each NAV as id (id)}<a href="#{id}">{id}</a>{/each}
				</Cluster>
			</nav>
			<Foundations />

			<DocSection doc={docs.Button}>
				<Cluster gap={4} align="end">
					{#each VARIANTS as variant (variant)}
						<Specimen label={variant}><Button {variant}>{variant}</Button></Specimen>
					{/each}
				</Cluster>
				<Cluster gap={4} align="end">
					{#each SIZES as size (size)}
						<Specimen label={size}><Button {size}>Size {size}</Button></Specimen>
					{/each}
				</Cluster>
				<Cluster gap={4} align="end">
					<Specimen label="disabled"><Button disabled>Disabled</Button></Specimen>
					<Specimen label="disabled primary">
						<Button variant="primary" disabled>Disabled</Button>
					</Specimen>
					<Specimen label="loading"><Button variant="primary" loading>Saving</Button></Specimen>
					<Specimen label="loading secondary"><Button loading>Saving</Button></Specimen>
				</Cluster>
			</DocSection>

			<DocSection doc={docs.IconButton}>
				<Cluster gap={4} align="end">
					{#each VARIANTS as variant (variant)}
						<Specimen label={variant}>
							<IconButton icon={Plus} label="Add {variant}" {variant} />
						</Specimen>
					{/each}
					{#each SIZES as size (size)}
						<Specimen label={size}><IconButton icon={Plus} label="Add {size}" {size} /></Specimen>
					{/each}
					<Specimen label="disabled">
						<IconButton icon={Plus} label="Add disabled" disabled />
					</Specimen>
					<Specimen label="loading"><IconButton icon={Plus} label="Adding" loading /></Specimen>
				</Cluster>
			</DocSection>

			<DocSection doc={docs.Icon}>
				<Cluster gap={6} align="end">
					{#each [16, 20, 24, 32, 48] as const as size (size)}
						<Specimen label="{size} px"><Icon icon={Plus} {size} /></Specimen>
					{/each}
				</Cluster>
			</DocSection>

			<DocSection doc={docs.AnimatedIcon}>
				<Cluster gap={6} align="end">
					{#each ANIMATED as name (name)}
						<Specimen label={name}
							><AnimatedIcon name={drawn ? name : undefined} size={24} /></Specimen
						>
					{/each}
					<Button size="sm" onclick={redraw}>Replay</Button>
				</Cluster>
			</DocSection>

			<DocSection doc={docs.Input}>
				<div class="forms">
					<Input label="Default" placeholder="my-project" bind:value={name} />
					<Input label="With hint" hint="Lowercase letters, digits and dashes" value="" />
					<Input label="With error" error="This name is already taken" value="todo" />
					<Input label="Success" success value="todo-app" />
					<Input label="Success with text" success="Name is free" value="todo-app" />
					<Input label="Loading" loading value="todo-app" hint="Checking the name" />
					<Input label="Disabled" disabled value="Locked" />
					<Input
						label="Validate on blur, then live"
						hint="Type something invalid, leave the field, then fix it"
						placeholder="todo-app"
						bind:value={project.value}
						error={project.error}
						success={project.success && 'Looks good'}
						onblur={project.onblur}
						oninput={project.oninput}
					/>
				</div>
			</DocSection>

			<DocSection doc={docs.Textarea}>
				<div class="forms">
					<Textarea label="Default" placeholder="Describe your project" bind:value={description} />
					<Textarea label="With hint" hint="Plain language is fine" value="" />
					<Textarea label="With error" error="Describe at least one feature" value="" />
					<Textarea label="Success" success="Clear enough" value="A to do list" />
					<Textarea label="Loading" loading value="A to do list" />
					<Textarea label="Disabled" disabled value="Locked" />
				</div>
			</DocSection>

			<DocSection doc={docs.Select}>
				<div class="forms">
					<Select label="Default" options={PHASE_OPTIONS} bind:value={phase} />
					<Select
						label="With hint"
						hint="Pick the phase to open"
						options={PHASE_OPTIONS}
						value="p2"
					/>
					<Select label="With error" error="Choose a phase" options={PHASE_OPTIONS} value="p1" />
					<Select label="Success" success options={PHASE_OPTIONS} value="p1" />
					<Select label="Disabled" disabled options={PHASE_OPTIONS} value="p1" />
				</div>
			</DocSection>

			<DocSection doc={docs.Badge}>
				<Cluster gap={3}>
					{#each TONES as tone (tone)}<Badge {tone}>{tone}</Badge>{/each}
				</Cluster>
			</DocSection>

			<DocSection doc={docs.StatusBadge}>
				<Cluster gap={3}>
					{#each STATUSES as status (status)}<StatusBadge {status} />{/each}
				</Cluster>
			</DocSection>

			<DocSection doc={docs.Spinner}>
				<Cluster gap={6}>
					{#each SPINNER_SIZES as size (size)}
						<Specimen label="{size} px"><Spinner {size} /></Specimen>
					{/each}
				</Cluster>
				<Cluster gap={4}>
					<Button onclick={() => delayKey++}>Replay with a 1 s delay</Button>
					<Specimen label="delay 1000 ms">
						{#key delayKey}<Spinner delay={1000} />{/key}
					</Specimen>
				</Cluster>
			</DocSection>

			<DocSection doc={docs.Skeleton}>
				<Cluster gap={6} align="start">
					<Specimen label="lines"><Skeleton lines={3} width="16rem" /></Specimen>
					<Specimen label="block"><Skeleton width="8rem" height="var(--space-12)" /></Specimen>
					<Specimen label="delay 1000 ms (replay under Spinner)">
						{#key delayKey}<Skeleton lines={2} width="12rem" delay={1000} />{/key}
					</Specimen>
				</Cluster>
			</DocSection>

			<DocSection doc={docs.ThinkingOrb}>
				<p class="note">
					With reduced motion on, each orb shows one static frame. Orbs also pause when scrolled out
					of view or when the tab is hidden. The first row is 20 px (inline), the second 64 px.
				</p>
				<Cluster gap={6} align="end">
					{#each ORB_STATES as orb (orb)}
						<Specimen label="{orb} 20"><ThinkingOrb state={orb} size={20} /></Specimen>
					{/each}
				</Cluster>
				<Cluster gap={6} align="end">
					{#each ORB_STATES as orb (orb)}
						<Specimen label="{orb} 64"><ThinkingOrb state={orb} size={64} /></Specimen>
					{/each}
				</Cluster>
				<Cluster gap={6} align="end">
					<Specimen label="paused"><ThinkingOrb size={64} paused /></Specimen>
					<Specimen label="inline">
						<Cluster gap={2} align="center">
							<ThinkingOrb state="working" label="The agent is working" />
							<span>The agent is working; you can send when it finishes.</span>
						</Cluster>
					</Specimen>
				</Cluster>
			</DocSection>

			<DocSection doc={docs.createFieldValidation}>
				<p class="note">
					The last Input under Input uses it: leave it empty or invalid, tab away, then type.
				</p>
				<Cluster gap={4}>
					<Button onclick={() => project.check()}>Validate now</Button>
					<Button variant="ghost" onclick={() => project.reset()}>Reset</Button>
				</Cluster>
			</DocSection>

			<DocSection doc={docs.Kbd}>
				<Cluster gap={2}><Kbd>Esc</Kbd><Kbd>Enter</Kbd><Kbd>Tab</Kbd></Cluster>
			</DocSection>

			<DocSection doc={docs.Card}>
				<div class="forms">
					<Card title="Todo app" description="Small showcase">
						<StatusBadge status="approved" />
						{#snippet actions()}<IconButton
								icon={Pencil}
								label="Edit todo app"
								size="sm"
							/>{/snippet}
					</Card>
					<Card title="Loading">
						<Skeleton lines={2} />
					</Card>
				</div>
			</DocSection>

			<DocSection doc={docs.Panel}>
				<div class="panels">
					<Panel title="Requirements" class="short">
						{#each ROWS as row (row.id)}<p>{row.id} {row.title}</p>{/each}
						{#each ROWS as row (row.id)}<p>{row.id} {row.title}</p>{/each}
						{#snippet actions()}<Button size="sm">Add</Button>{/snippet}
					</Panel>
				</div>
			</DocSection>

			<DocSection doc={docs.Tabs}>
				<Tabs tabs={PHASES} bind:active={activeTab}>
					{#snippet children(id)}Selected: {id}{/snippet}
				</Tabs>
			</DocSection>

			<DocSection doc={docs.Modal}>
				<Cluster>
					<Button onclick={() => (modalOpen = true)}>Open modal</Button>
				</Cluster>
				<Modal bind:open={modalOpen} title="Discard last run?">
					This removes the changes of the run. You can run it again afterwards.
					{#snippet footer()}
						<Button onclick={() => (modalOpen = false)}>Cancel</Button>
						<Button variant="destructive" onclick={() => (modalOpen = false)}>Discard</Button>
					{/snippet}
				</Modal>
			</DocSection>

			<DocSection doc={docs.Dropdown}>
				<Cluster gap={4}>
					<Dropdown label="Actions" items={MENU} onselect={(id) => (picked = id)} />
					<span>Picked: <code>{picked}</code></span>
				</Cluster>
			</DocSection>

			<DocSection doc={docs.Banner}>
				<Banner tone="info" title="P2 is waiting for approval"
					>Review the diagrams, then approve.</Banner
				>
				<Banner tone="success" title="Requirements approved">P2 can start now.</Banner>
				<Banner tone="warning" title="Requirements changed">
					P2 is stale.
					{#snippet actions()}<Button size="sm">Update P2</Button>{/snippet}
				</Banner>
				<Banner tone="error" title="The run failed"
					>The model call timed out after 3 retries.</Banner
				>
			</DocSection>

			<DocSection doc={docs.Disclosure}>
				<Disclosure summary="Tool calls" bind:open={disclosureOpen}>
					read_requirements, write_requirements
				</Disclosure>
				<Disclosure summary="Open by default" open>Content that starts visible.</Disclosure>
				<Disclosure bare summary="Bare, for table rows">No frame, compact summary.</Disclosure>
			</DocSection>

			<DocSection doc={docs.Table}>
				<Table columns={COLUMNS} rows={ROWS} />
				<Table columns={COLUMNS} rows={[]}>
					{#snippet empty()}No requirements yet.{/snippet}
				</Table>
			</DocSection>

			<DocSection doc={docs.EmptyState}>
				<EmptyState
					icon={Inbox}
					title="No projects yet"
					text="Create a project to start with requirements."
				>
					{#snippet action()}<Button variant="primary">New project</Button>{/snippet}
				</EmptyState>
			</DocSection>

			<DocSection doc={docs.ThemeToggle}>
				<Cluster><ThemeToggle /></Cluster>
			</DocSection>

			<DocSection doc={docs.AppShell}>
				<p>
					This page is an <code>AppShell</code>: header above, main on the 12 column grid, optional
					footer. Turn on the page grid overlay under Grid to see the columns.
				</p>
			</DocSection>

			<DocSection doc={docs.SplitView}>
				<p>Resize below 960 px to get the Chat | Artefacts switch.</p>
				<SplitView>
					{#snippet left()}
						<Panel title="Chat" class="short"><p>Left pane, 5 columns.</p></Panel>
					{/snippet}
					{#snippet right()}
						<Panel title="Artefacts" class="short"><p>Right pane, 7 columns.</p></Panel>
					{/snippet}
				</SplitView>
			</DocSection>

			<DocSection doc={docs.FormField}>
				<div class="forms">
					<FormField label="Custom control" hint="Any control can use the same labelling">
						{#snippet control(field)}
							<input id={field.id} type="range" aria-describedby={field.describedby} />
						{/snippet}
					</FormField>
				</div>
			</DocSection>

			<DocSection doc={docs.Stack}>
				<Stack gap={2}>
					<Badge>gap 2</Badge>
					<Badge>second</Badge>
					<Badge>third</Badge>
				</Stack>
			</DocSection>

			<DocSection doc={docs.Cluster}>
				<Cluster gap={3} justify="between">
					<Badge>start</Badge>
					<Badge>between</Badge>
					<Badge>end</Badge>
				</Cluster>
			</DocSection>
		</Stack>
	{/snippet}

	{#snippet footer()}Design system showcase, development builds only.{/snippet}
</AppShell>

<style>
	.intro {
		max-width: 72ch;
		color: var(--color-text-muted);
	}

	nav a {
		font-size: var(--text-sm);
	}

	.forms {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
		gap: var(--space-6);
	}

	.note {
		max-width: 72ch;
		color: var(--color-text-muted);
	}

	.panels :global(.short) {
		max-height: 12rem;
	}

	:global(.bar) {
		width: 100%;
	}
</style>
