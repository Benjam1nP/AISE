/** Usage notes, props and copyable code for every component, shown on /dev/ui. */

export type PropDoc = { name: string; type: string; default?: string; description: string };

export type ComponentDoc = {
	name: string;
	summary: string;
	use: string;
	avoid: string;
	props: PropDoc[];
	code: string;
};

const p = (name: string, type: string, description: string, def?: string): PropDoc => ({
	name,
	type,
	default: def,
	description
});

export const docs = {
	Button: {
		name: 'Button',
		summary: 'Triggers an action. Four variants, three heights (32, 40 and 48 px).',
		use: 'One primary per view for the main action; secondary for the rest; destructive for deletes; ghost in toolbars.',
		avoid:
			'Navigation (use a link), an icon without text (use IconButton), or disabling it to signal invalid input: keep it enabled, validate on click, mark the fields and say in text what blocks it.',
		props: [
			p(
				'variant',
				"'primary' | 'secondary' | 'ghost' | 'destructive'",
				'Visual style.',
				"'secondary'"
			),
			p('size', "'sm' | 'md' | 'lg'", 'Height 32, 40 or 48 px.', "'md'"),
			p(
				'disabled',
				'boolean',
				'Blocks clicks; neutral fill, not-allowed cursor. Only for actions that cannot happen at all, with visible text saying why.',
				'false'
			),
			p(
				'loading',
				'boolean',
				'Shows a Spinner, sets aria-busy and ignores clicks. Not disabled: it keeps focus.',
				'false'
			),
			p('type', "'button' | 'submit' | 'reset'", 'Button type.', "'button'"),
			p('onclick', '(event) => void', 'Click handler.'),
			p('children', 'Snippet', 'Label.')
		],
		code: `<Button variant="primary" onclick={save}>Save</Button>
<Button variant="destructive" loading={deleting}>Delete</Button>`
	},
	IconButton: {
		name: 'IconButton',
		summary: 'A Button with only an icon. The label is the accessible name and the tooltip.',
		use: 'Toolbars, close buttons, theme switch.',
		avoid: 'When the icon is not universally clear: use a Button with text.',
		props: [
			p('icon', 'LucideIcon', 'Lucide icon component.'),
			p('label', 'string', 'aria-label and title. Required.'),
			p('size', "'sm' | 'md' | 'lg'", 'Square 32, 40 or 48 px.', "'md'"),
			p('variant', "'primary' | 'secondary' | 'ghost' | 'destructive'", 'Visual style.', "'ghost'"),
			p('loading', 'boolean', 'Replaces the icon with a Spinner.', 'false')
		],
		code: `<IconButton icon={Plus} label="Add requirement" onclick={add} />`
	},
	AnimatedIcon: {
		name: 'AnimatedIcon',
		summary:
			'line-md icon that draws itself once when its name changes while mounted. Decorative (aria-hidden).',
		use: 'A state that just changed: approved, check met, error, copied. Keep it mounted and switch name (undefined for none).',
		avoid:
			'Static icons, loaders and agent activity (Spinner, ThinkingOrb). A mount and reduced motion show the final frame, so {#if} around it never animates.',
		props: [
			p(
				'name',
				'AnimatedIconName',
				'check, circle-check, circle-alert, clipboard, clipboard-check.'
			),
			p('size', '16 | 20 | 24 | 32 | 48', 'Pixel size from --icon-N.', '20')
		],
		code: `<AnimatedIcon name={ok ? 'circle-check' : 'circle-alert'} size={16} />`
	},
	Icon: {
		name: 'Icon',
		summary: 'Lucide icon at a token size, stroke 2, current colour. Decorative (aria-hidden).',
		use: 'Next to text, in badges and banners, hero icons in empty states (48).',
		avoid: 'As the only content of a control: wrap it in IconButton so it has a name.',
		props: [
			p('icon', 'LucideIcon', 'Lucide icon component.'),
			p('size', '16 | 20 | 24 | 32 | 48', 'Pixel size from --icon-N.', '20')
		],
		code: `<Icon icon={FileText} size={24} />`
	},
	Input: {
		name: 'Input',
		summary: 'Single line text field with label, hint and error. 44 px high.',
		use: 'Short text: names, titles, search.',
		avoid: 'Multi line text (Textarea) or a fixed set of choices (Select).',
		props: [
			p('label', 'string', 'Visible label. Required.'),
			p('hint', 'string', 'Help text, linked with aria-describedby.'),
			p(
				'error',
				'string',
				'Names the problem and the fix. Icon, text and colour; sets aria-invalid. Wins over success.'
			),
			p(
				'success',
				'boolean | string',
				'Check icon in the field; a string also shows that text below.',
				'false'
			),
			p(
				'loading',
				'boolean',
				'In-field spinner; edits are blocked (readonly, aria-busy) but focus stays.',
				'false'
			),
			p('disabled', 'boolean', 'Neutral fill and not-allowed cursor, no dimming.', 'false'),
			p('value', 'string', 'Bindable value.', "''"),
			p('type, name, placeholder, ...', 'input attributes', 'Passed to the input element.')
		],
		code: `<Input label="Project name" hint="Lowercase, no spaces" bind:value={name} error={nameError} />

Validate on blur, then live: see createFieldValidation.`
	},
	Textarea: {
		name: 'Textarea',
		summary: 'Multi line text field. Same API as Input, resizes vertically.',
		use: 'Descriptions, chat messages, feedback.',
		avoid: 'Short single line values (Input).',
		props: [
			p('label', 'string', 'Visible label. Required.'),
			p('hint', 'string', 'Help text.'),
			p('error', 'string', 'Error text with icon.'),
			p(
				'success',
				'boolean | string',
				'Check icon in the field; a string also shows that text below.',
				'false'
			),
			p('loading', 'boolean', 'In-field spinner; edits are blocked but focus stays.', 'false'),
			p('disabled', 'boolean', 'Neutral fill and not-allowed cursor.', 'false'),
			p('value', 'string', 'Bindable value.', "''"),
			p('rows', 'number', 'Visible lines.', '4')
		],
		code: `<Textarea label="Describe your project" bind:value={description} />`
	},
	Select: {
		name: 'Select',
		summary: 'Native select with the same label, hint and error as Input.',
		use: 'Pick one of a small fixed list.',
		avoid: 'Long searchable lists, or two to three options that fit on screen as buttons.',
		props: [
			p('label', 'string', 'Visible label. Required.'),
			p('options', '{ value: string; label: string }[]', 'The choices.'),
			p('hint', 'string', 'Help text.'),
			p('error', 'string', 'Error text with icon.'),
			p(
				'success',
				'boolean | string',
				'Check icon next to the chevron; a string also shows that text below.',
				'false'
			),
			p('disabled', 'boolean', 'Neutral fill and not-allowed cursor.', 'false'),
			p('value', 'string', 'Bindable selected value.', "''")
		],
		code: `<Select label="Phase" options={[{ value: 'p1', label: 'P1 Requirements' }]} bind:value={phase} />`
	},
	Badge: {
		name: 'Badge',
		summary: 'Small pill for a label or count. Tint background, full contrast text.',
		use: 'Counts, tags, short states that are not a phase status.',
		avoid: 'Phase status (StatusBadge) or long text.',
		props: [
			p(
				'tone',
				"'new' | 'active' | 'pending' | 'error' | 'info' | 'default'",
				'brand, success, warning, error, info, neutral tint.',
				"'default'"
			),
			p('children', 'Snippet', 'Content.')
		],
		code: `<Badge tone="new">New</Badge>`
	},
	StatusBadge: {
		name: 'StatusBadge',
		summary: 'Phase status with a dot and a label. Running pulses; reduced motion stops it.',
		use: 'Phase bar, run lists, anywhere a PhaseStatus shows.',
		avoid: 'Other kinds of state (Badge).',
		props: [
			p('status', 'PhaseStatus', 'not_started, running, awaiting_approval, approved or stale.')
		],
		code: `<StatusBadge status={phase.status} />`
	},
	ThinkingOrb: {
		name: 'ThinkingOrb',
		summary:
			'Animated dotted orb for long, open ended agent work. Canvas, role="img", pauses offscreen and in hidden tabs, static frame under reduced motion. Theme follows data-theme.',
		use: 'An agent run that takes seconds to minutes: working while waiting for the model, searching while tools run, composing while text streams. 20 px inline, 64 px in start states.',
		avoid:
			'Short known waits (Spinner) or content that has a shape (Skeleton). Not for decoration.',
		props: [
			p(
				'state',
				"'working' | 'searching' | 'composing' | 'solving' | 'listening' | 'connecting' | 'weaving' | 'breathing' | 'shaping'",
				'Which animation to show.',
				"'working'"
			),
			p('size', '20 | 64', 'Two tuned designs, not a scale.', '20'),
			p('label', 'string', 'aria-label. Defaults to a short text for the state.'),
			p('paused', 'boolean', 'Freezes the current frame.', 'false')
		],
		code: `<ThinkingOrb state="searching" label="Running tools" />`
	},
	createFieldValidation: {
		name: 'createFieldValidation',
		summary:
			'Rune helper for validation timing: check on blur, then live on every input after the first error, so the error clears as soon as it is fixed. Valid fields get success.',
		use: 'Any Input, Textarea or Select with a rule. Call check() in the submit handler too.',
		avoid: 'Validating on every keystroke from the start, or only on submit.',
		props: [
			p(
				'validate',
				'(value: string) => string | undefined',
				'Returns the error message, or nothing.'
			),
			p('initial', 'string', 'Starting value.', "''"),
			p('value, error, success', 'state', 'Bind value; pass error and success to the field.'),
			p('onblur, oninput', 'handlers', 'Pass to the field (use onchange for Select).'),
			p('check()', '() => boolean', 'Validates now and returns validity.'),
			p('reset()', '() => void', 'Clears value, error and success.')
		],
		code: `const name = createFieldValidation((v) => (v ? undefined : 'Enter a project name.'));

<Input label="Project name" bind:value={name.value} error={name.error}
	success={name.success} onblur={name.onblur} oninput={name.oninput} />`
	},
	Spinner: {
		name: 'Spinner',
		summary: 'Rotating loader. role="status" with a label.',
		use: 'Short waits where progress is unknown.',
		avoid: 'Page or list loading (Skeleton).',
		props: [
			p('size', '16 | 20 | 24 | 32', 'Pixel size.', '20'),
			p('label', 'string', 'Accessible name. An empty string makes it decorative.', "'Loading'"),
			p(
				'delay',
				'number',
				'Milliseconds before anything shows. Waits under about 300 ms stay invisible; use 300 for fetches.',
				'0'
			)
		],
		code: `<Spinner size={24} delay={300} />`
	},
	Skeleton: {
		name: 'Skeleton',
		summary: 'Pulsing placeholder with the shape of content that is loading.',
		use: 'Text blocks and cards while data loads.',
		avoid: 'Actions in progress (Spinner on the Button).',
		props: [
			p('width', 'string', 'CSS length.', "'100%'"),
			p('height', 'string', 'CSS length.', "'var(--space-4)'"),
			p('lines', 'number', 'Renders this many text lines; the last is shorter.'),
			p('delay', 'number', 'Milliseconds before anything shows. Use 300 for fetches.', '0')
		],
		code: `<Skeleton lines={3} delay={300} />`
	},
	Kbd: {
		name: 'Kbd',
		summary: 'Keyboard key cap.',
		use: 'Documenting shortcuts.',
		avoid: 'Decoration.',
		props: [p('children', 'Snippet', 'Key name.')],
		code: `<Kbd>Esc</Kbd>`
	},
	Card: {
		name: 'Card',
		summary: 'Surface with an optional title, description and actions.',
		use: 'A self contained item in a list or grid.',
		avoid: 'The only content of a screen (Panel) or nesting cards.',
		props: [
			p('title', 'string', 'Heading.'),
			p('description', 'string', 'Muted line under the title.'),
			p('actions', 'Snippet', 'Right aligned header actions.'),
			p('children', 'Snippet', 'Body.')
		],
		code: `<Card title="Todo app" description="Small showcase">
	<StatusBadge status="approved" />
</Card>`
	},
	Panel: {
		name: 'Panel',
		summary: 'Header plus a body that scrolls. Give it a height and it scrolls inside.',
		use: 'The big regions of a screen: chat, artefacts.',
		avoid: 'Small grouped content (Card).',
		props: [
			p('title', 'string', 'Header title. Required.'),
			p('actions', 'Snippet', 'Header actions.'),
			p('children', 'Snippet', 'Scrolling body. Required.')
		],
		code: `<Panel title="Requirements" class="tall">
	<RequirementList />
</Panel>`
	},
	Tabs: {
		name: 'Tabs',
		summary: 'ARIA tabs. Arrow keys move and select, Home and End jump, disabled tabs are skipped.',
		use: 'Switch between views of the same thing: phases, chat and artefacts.',
		avoid: 'Navigation between pages (links).',
		props: [
			p('tabs', '{ id; label; disabled?; hint? }[]', 'The tabs. hint becomes a tooltip.'),
			p('active', 'string', 'Bindable id of the selected tab.'),
			p(
				'children',
				'Snippet<[string]>',
				'Optional tab panel for the active id. Without it, render content from active yourself.'
			)
		],
		code: `<Tabs tabs={[{ id: 'p1', label: 'P1' }, { id: 'p2', label: 'P2', disabled: true }]} bind:active />`
	},
	Modal: {
		name: 'Modal',
		summary:
			'Native dialog. Esc and backdrop close it, focus returns to the opener. Enter 300 ms ease out, exit 200 ms ease in.',
		use: 'A decision or short form that blocks the page.',
		avoid: 'Anything that should stay visible next to the page (Panel).',
		props: [
			p('open', 'boolean', 'Bindable.', 'false'),
			p('title', 'string', 'Heading and accessible name. Required.'),
			p('children', 'Snippet', 'Body.'),
			p('footer', 'Snippet', 'Right aligned actions.')
		],
		code: `<Modal bind:open title="Discard last run?">
	This removes its changes.
	{#snippet footer()}<Button variant="destructive">Discard</Button>{/snippet}
</Modal>`
	},
	Dropdown: {
		name: 'Dropdown',
		summary:
			'Menu button. Enter, Space or ArrowDown opens, arrows move, Esc closes, outside click closes.',
		use: 'Secondary actions that would crowd the toolbar.',
		avoid: 'Choosing a form value (Select).',
		props: [
			p('label', 'string', 'Button text and menu name.'),
			p('items', '{ id; label; icon?; destructive?; disabled? }[]', 'Menu items.'),
			p('onselect', '(id: string) => void', 'Called with the item id.'),
			p('align', "'start' | 'end'", 'Edge the menu lines up with.', "'start'")
		],
		code: `<Dropdown label="Actions" items={[{ id: 'rename', label: 'Rename' }]} onselect={(id) => run(id)} />`
	},
	Banner: {
		name: 'Banner',
		summary: 'Inline message with a tone, a title and optional actions. Errors use role="alert".',
		use: 'Failed runs, stale phases, saved confirmations.',
		avoid: 'Field errors (Input error) or transient toasts.',
		props: [
			p('tone', "'info' | 'success' | 'warning' | 'error'", 'Colour and icon.', "'info'"),
			p('title', 'string', 'Bold first line. Required.'),
			p('children', 'Snippet', 'Detail text.'),
			p('actions', 'Snippet', 'Buttons on the right.')
		],
		code: `<Banner tone="warning" title="Requirements changed">
	P2 is stale.
	{#snippet actions()}<Button size="sm">Update</Button>{/snippet}
</Banner>`
	},
	Disclosure: {
		name: 'Disclosure',
		summary: 'Native details and summary with a chevron.',
		use: 'Optional detail: tool calls, raw JSON.',
		avoid: 'Content users need to see.',
		props: [
			p('summary', 'string', 'Always visible line.'),
			p('open', 'boolean', 'Bindable.', 'false'),
			p('bare', 'boolean', 'No frame, compact summary: inside a table row or list.', 'false'),
			p('children', 'Snippet', 'Hidden content.')
		],
		code: `<Disclosure summary="Tool calls">...</Disclosure>`
	},
	Table: {
		name: 'Table',
		summary: 'Data table that scrolls sideways when narrow.',
		use: 'Lists of similar records: runs, requirements.',
		avoid: 'Layout.',
		props: [
			p('columns', '{ key; label; width? }[]', 'Column definitions.'),
			p('rows', 'Record<string, unknown>[]', 'Row data, read by column key.'),
			p('empty', 'Snippet', 'Shown when there are no rows.'),
			p('cell', 'Snippet<[{ row; column }]>', 'Custom cell content.')
		],
		code: `<Table columns={[{ key: 'id', label: 'ID' }]} rows={requirements} />`
	},
	EmptyState: {
		name: 'EmptyState',
		summary: 'Centered 48 px icon, title, text and an optional action.',
		use: 'First use and empty results: say what to do next.',
		avoid: 'Errors (Banner).',
		props: [
			p('icon', 'LucideIcon', 'Hero icon.'),
			p('title', 'string', 'Heading.'),
			p('text', 'string', 'One or two sentences.'),
			p('action', 'Snippet', 'Primary action.')
		],
		code: `<EmptyState icon={Inbox} title="No projects" text="Create one to start." />`
	},
	ThemeToggle: {
		name: 'ThemeToggle',
		summary: 'Icon button that switches light and dark and remembers the choice.',
		use: 'Once, in the app header.',
		avoid: 'Per screen settings.',
		props: [],
		code: `<ThemeToggle />`
	},
	AppShell: {
		name: 'AppShell',
		summary:
			'Page frame: sticky header with an optional second row, main on a 12 column grid with page margin and gutter tokens, optional footer. This page uses it.',
		use: 'Every screen.',
		avoid: 'Nesting shells.',
		props: [
			p('header', 'Snippet', 'Top bar content.'),
			p('subheader', 'Snippet', 'Second header row, for example the phase rail.'),
			p('main', 'Snippet', 'Children span all 12 columns unless they set grid-column.'),
			p('footer', 'Snippet', 'Optional.'),
			p('grid', 'boolean', 'Faint drafting dot grid behind main.', 'false')
		],
		code: `<AppShell>
	{#snippet header()}<h1>AISE</h1>{/snippet}
	{#snippet main()}<SplitView ... />{/snippet}
</AppShell>`
	},
	SplitView: {
		name: 'SplitView',
		summary:
			'Two panes, 5 and 7 columns from md (960 px). Below md one pane with a Chat | Artefacts tab switch.',
		use: 'Chat next to artefacts.',
		avoid: 'More than two regions.',
		props: [
			p('left', 'Snippet', '5 column pane.'),
			p('right', 'Snippet', '7 column pane.'),
			p('leftLabel', 'string', 'Tab label below md.', "'Chat'"),
			p('rightLabel', 'string', 'Tab label below md.', "'Artefacts'"),
			p(
				'stickLeft',
				'boolean',
				'From md the left pane stays in view under the AppShell header and fills the screen height.',
				'false'
			)
		],
		code: `<SplitView>
	{#snippet left()}<Chat />{/snippet}
	{#snippet right()}<Artefacts />{/snippet}
</SplitView>`
	},
	FormField: {
		name: 'FormField',
		summary: 'Label, control, hint and error stack. Input, Textarea and Select are built on it.',
		use: 'Wrapping a custom control so it gets the same labelling.',
		avoid: 'Inputs that already have a label prop.',
		props: [
			p('label', 'string', 'Visible label.'),
			p('hint', 'string', 'Help text.'),
			p('error', 'string', 'Error text.'),
			p(
				'control',
				'Snippet<[{ id; describedby; invalid }]>',
				'Render the control with these attributes.'
			)
		],
		code: `<FormField label="Colour">
	{#snippet control(field)}<input id={field.id} aria-describedby={field.describedby} />{/snippet}
</FormField>`
	},
	Stack: {
		name: 'Stack',
		summary: 'Vertical flex with a token gap. Use instead of margins.',
		use: 'Stacking blocks.',
		avoid: 'Rows (Cluster).',
		props: [p('gap', '1 | 2 | 3 | 4 | 6 | 8', '--space-N between children.', '4')],
		code: `<Stack gap={6}>...</Stack>`
	},
	Cluster: {
		name: 'Cluster',
		summary: 'Wrapping horizontal flex with a token gap.',
		use: 'Rows of buttons, badges and tags.',
		avoid: 'Stacked blocks (Stack).',
		props: [
			p('gap', '1 | 2 | 3 | 4 | 6 | 8', '--space-N between children.', '2'),
			p('align', "'start' | 'center' | 'end' | 'baseline'", 'Cross axis.', "'center'"),
			p('justify', "'start' | 'center' | 'end' | 'between'", 'Main axis.', "'start'")
		],
		code: `<Cluster justify="between"><h2>Runs</h2><Button>New</Button></Cluster>`
	}
} satisfies Record<string, ComponentDoc>;
