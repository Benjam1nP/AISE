# Design system

Own design system in `src/lib/ui/`, after the Design System Blueprint checklist. Direction: a technical drawing. Cool graphite ink on a faint drafting grid, monospace for IDs and costs, one orange accent for what needs the developer now. Light and dark theme. Source of truth: `src/lib/ui/tokens.css`. `tokens.test.ts` and `guardrails.test.ts` enforce it.

## Principles

- **Purposeful.** Every element earns its place. Orange marks the one thing that matters on a screen (primary action, running state, focus).
- **Fast.** Interactions stay at 300 ms or less; nothing animates to decorate.
- **Natural.** Motion follows physics: things enter with ease out, move with ease in out, leave with ease in.
- **Semantic tokens only.** Screens and components use `--color-*` names, never the raw scales (`--brand-*`, `--neutral-*`) and never literals. Dark theme overrides the semantic layer only, so nothing else changes between themes.

## Theme

`<html data-theme="light|dark">`. A script in `src/app.html` sets it before first paint from `localStorage['aise-theme']`, else `prefers-color-scheme`. `theme.ts` exports `getTheme()` and `setTheme(t)` (SSR safe, no browser access at import time). Read the theme in `onMount`, not during render, or hydration can differ from the server HTML.

## Colour

Scales (raw, do not use in components): `--brand-100..900` and `--neutral-0, 50..900, 950`.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-bg` | neutral-50 | neutral-950 | page background |
| `--color-surface` | neutral-0 | neutral-900 | cards, panels |
| `--color-surface-2` | neutral-100 | `#2a2e3d` | nested or hovered surface |
| `--color-border` | neutral-200 | `#343a4c` | default borders |
| `--color-border-strong` | neutral-300 | `#4a5166` | inputs, emphasis |
| `--color-text` | neutral-800 | `#f3f4f7` | body text |
| `--color-text-muted` | neutral-600 | `#a8afbf` | secondary text |
| `--color-text-soft` | neutral-500 | neutral-400 | labels only, never body (3.0 contrast) |
| `--color-brand` | brand-500 | brand-400 | accents, indicators, focus |
| `--color-brand-strong` | brand-700 | brand-500 | primary button, brand text |
| `--color-on-brand` | `#ffffff` | neutral-950 | text on `brand-strong` |
| `--color-brand-tint` | `#fbe9e1` | `#3a2419` | brand backgrounds |
| `--color-success` / `-tint` | `#2f6b4a` / `#e6f0ea` | `#5fb383` / `#1d2e25` | status |
| `--color-error` / `-tint` | `#b3261e` / `#f9e5e3` | `#f0726a` / `#3a2023` | status |
| `--color-warning` / `-tint` | `#8a5a00` / `#f6eddb` | `#e0a83a` / `#352b17` | status |
| `--color-info` / `-tint` | `#2e5aa8` / `#e5ecf6` | `#7aa2e8` / `#1e2a40` | status |
| `--color-focus` | = brand | = brand | focus ring |
| `--color-grid` | `#dfe3ea` | `#1c2029` | drafting dot grid (`AppShell grid`) |
| `--color-track` | `#d5dae3` | `#2a303d` | phase rail track, unbuilt stations |
| `--shadow-sm`, `--shadow-md` | light alpha | darker alpha | panels, cards and header; popovers and modal |

Contrast (tested, WCAG AA): `text`, `text-muted` and each status colour reach 4.5 on `bg`, `surface` and `surface-2`; each status colour reaches 4.5 on its tint; `on-brand` on `brand-strong` 4.5; `text-soft` on `bg` 3.0.

Phase status mapping (`StatusBadge`): `not_started` neutral, `running` brand with pulse, `awaiting_approval` brand with a hollow dot, `approved` success, `stale` warning. A failed run uses error.

## Phase rail

The signature element (`src/lib/components/PhaseBar.svelte`, in the `AppShell` subheader). Seven stations on one track, each with its mono ID, name and status. Glyphs: hollow = not started, orange ring with a dot = awaiting approval, solid orange with three dots and a halo = running (the dots stay under reduced motion), filled ink with a check = approved, dashed amber = stale, dashed track colour = not built yet. The track after a station turns solid ink once that phase is approved. The selected station has a `surface-2` fill, is `aria-current="step"` and scrolls into view when the rail overflows. IDs and status text use `text-muted`, never `text-soft`. A phase with agent runs shows its cost in mono after the status; the total cost closes the rail. The home page repeats the line, static, as its introduction.

## Type

Fonts are self hosted through fontsource (no CDN): Geist (`--font-sans`), Geist Mono (`--font-mono`), Archivo with its width axis (`--font-display`). Fontsource registers the variable families as `Geist Variable`, `Geist Mono Variable` and `Archivo Variable`, so the stacks list those names first. The display face is for page titles only: `h1`, `h2` and the brand wordmark, set semi condensed (`--display-stretch` 88%) with `--display-tracking`. Panel titles use Geist. IDs, project names and costs use Geist Mono; `.aise-num` sets tabular figures.

| Token | Size | Weight token |
| --- | --- | --- |
| `--text-xs` | 11px (0.6875rem) | `--text-xs-weight` 500 |
| `--text-sm` | 13px | `--text-sm-weight` 400 |
| `--text-base` | 15px | `--text-base-weight` 400 |
| `--text-lg` | 18px | `--text-lg-weight` 400 |
| `--text-2xl` | 22px | `--text-2xl-weight` 600 |
| `--text-3xl` | 28px | `--text-3xl-weight` 700 |
| `--text-4xl` | 36px | `--text-4xl-weight` 700 |
| `--text-5xl` | 48px | `--text-5xl-weight` 800 |

Weights `--weight-regular 400`, `-medium 500`, `-semibold 600`, `-bold 700`, `-extrabold 800`. Line heights `--leading-heading 1.2`, `--leading-body 1.6`, `--leading-label 1.1`. Sizes are in rem on a 16px base. `base.css` maps `h1` to `3xl`, `h2` to `2xl`, `h3` to `lg` and `h4` to `base`.

## Spacing, grid, shape

4px base: `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-6` 24, `-8` 32, `-12` 48, `-16` 64. Radius `--radius-sm` 4, `-md` 8, `-lg` 14, `-full` 999. Layers `--z-dropdown` 10, `--z-modal` 100.

12 column grid (`--grid-columns`). `--grid-gutter` is `space-4`, `space-6` from `lg`. `--page-margin` is `space-6`, `space-12` from `lg`.

| Breakpoint | Min width |
| --- | --- |
| `sm` | 640px |
| `md` | 960px |
| `lg` | 1280px |
| `xl` | 1600px |

Breakpoints are literal in media queries (custom properties do not work there): `@media (min-width: 960px)`.

## Icons

Lucide through `@lucide/svelte`, stroke 2, `currentColor`. Sizes: `--icon-16` inline, `--icon-20` default, `--icon-24` navigation, `--icon-32` feature, `--icon-48` hero (empty states). Every interactive element has a hit area of at least `--hit-area` (44 x 44px); when it is drawn smaller, add a transparent `::after` that grows it.

### Animated icons

`AnimatedIcon` renders a vendored line-md icon (`src/lib/ui/animated-icons.ts`: `check`, `circle-check`, `circle-alert`, `clipboard`, `clipboard-check`) on the same 24 grid, stroke 2, `currentColor`, sizes as above. It draws itself once (0.2 to 0.9 s, SVG `<animate>`, held on the last frame) when its `name` changes while it is mounted; a mount (server render, page load, tab switch) and reduced motion show the final frame. So keep it mounted and change `name` (`undefined` draws nothing): a phase approved (`PhaseBar`), a gate check met or failing (`GatePanel`), a file done or failed (`CodegenProgress`), success and error in `FormField`, copied (`/dev/ui` code blocks). Static icons stay Lucide; loaders and agent activity stay `Spinner` and `ThinkingOrb`. New icons come from the Aria Icons MCP (`.mcp.json`) and may only animate `stroke-dashoffset` to 0 (a test checks this), so dropping the animations gives the final frame.

## Motion

| Easing | Use |
| --- | --- |
| `--ease-out` | enter |
| `--ease-in-out` | move, resize |
| `--ease-in` | exit |

| Duration | Use |
| --- | --- |
| `--duration-100` | hover, toggle, fade |
| `--duration-200` | press, tooltip |
| `--duration-300` | modal, dropdown |
| `--duration-400` | page transition, slide |
| `--duration-500` | orchestration only |

Interactions stay at 300 ms or less. With `prefers-reduced-motion: reduce` every duration is `0ms` and animations (the running pulse, `aise-pulse` in `base.css`) stop.

## Components

All exported from `src/lib/ui/index.ts`; `/dev/ui` (dev server only) shows each with when to use it, props, every state and a copyable snippet. Every component takes `class` and passes other attributes to its root element (Input, Textarea and Select pass them to the native control; `class` styles the field wrapper).

- Atoms: `Button`, `IconButton`, `Icon`, `AnimatedIcon`, `Input`, `Textarea`, `Select`, `Badge`, `StatusBadge`, `Spinner`, `Skeleton`, `Kbd`, `ThinkingOrb`.
- Composites: `Card`, `Panel`, `Tabs`, `Modal`, `Dropdown`, `Banner`, `Disclosure`, `Table`, `EmptyState`, `ThemeToggle`.
- Layout: `AppShell`, `SplitView`, `FormField`, `Stack`, `Cluster`.

## Code tab and P4 components

Workspace components in `src/lib/components/`, built from the tokens above; nothing new in `src/lib/ui/`.

- `CodeViewer` (`content`, `line?`, `label?`): CodeMirror 6, read only (`EditorState.readOnly` and `EditorView.editable.of(false)`), TypeScript highlighting. The theme and highlight style are objects of `var(--color-*)`, `--font-mono` and `--text-sm`, so both themes work with one style: keywords `brand-strong`, strings `success`, numbers and booleans `info`, comments `text-muted` italic. `line` is scrolled to the centre and marked with a `brand-tint` line. The content takes focus (`tabindex 0`, `aria-label`) so the keyboard can scroll it.
- `CodePanel` (`snapshot`, `open?: { path, line? }`): file tree from `snapshot.files` (folders as rows, files as buttons with `aria-current`), the open file loaded from `/p/<name>/file?path=` with a skeleton after 300 ms and an error `Banner` with Retry, and the `@trace` IDs of the file as `info` badges above the code. Pass a new `open` object to open a file again.
- `CodegenProgress` (`files: Record<string, FileStatus>`): one row per planned file with a glyph and a word for its state (planned, writing, checking, retrying (attempt 2), escalated (attempt 3), ok, failed), a count of settled files, and a last row for the wiring step, shown once its `src/app/` entry of `files` exists (the pipeline reports it like a file).
- `GenerateCode` (`snapshot`, `form`): the "Generate code" panel; renders only while no file under `src/` exists (the scaffold alone is not code) and no run is active.
- `GatePanel` and `StaleBanner` take phase P4. The P4 gate lists the tsc errors and design differences under their check as buttons that call `onopenfile({ path, line })`; they show only while the gate does not say "out of date". "Check again" sits in the panel header and submits `checkCode`. `StaleBanner` takes `phase` (`P2` default, `P4`), `upstreamApproved` and `onshowupstream`.
- `PhaseBar` opens P4 once P2 is approved, P5 once P4 is approved, P6 once P5 is approved and P7 once P5 is approved or stale (P6 and P7 also while they hold a state of their own); before that the stations read "After design approval", "After code approval" and, for P6 and P7, "After test approval". P7 calls `onselect('P7')`, which the page turns into the Tickets tab.

## Tests tab and P5 components

Also in `src/lib/components/`, nothing new in `src/lib/ui/`. Pure helpers: `src/lib/test-names.ts` (test title parsing, coverage and finding rules, shared with the server), `src/lib/test-results.ts` (grouping and labels of test rows) and `src/lib/workspace-view.ts` (which phase needs attention, which tab shows a file).

- `TestsPanel` (`snapshot`, `form`, `progress`, `open?: { path, line? }`): the Tests tab. While a generation run writes tests it shows `CodegenProgress` (`progress`; before the first event, its planning state). Otherwise a header row with the count (passed, failed, manual), an "out of date" `Badge` when the gate says so, and "Run tests" (submits `checkTests`, busy while any run is active), then `TestResults` and `Findings`. Clicking a test opens the test file below in a `CodePanel` that lists the files under `test/` only, with a "Close file" button. Before the first results the files show without a click. A rejected `checkTests` shows in the gate panel only, so there is one banner.
- `TestsPanel` Fix automatically: a primary `Button` in the header row that submits `fixLoop`, shown while the stored results are current (not out of date) and a finding is open or a failure has no finding; it shows `loading` like the other actions while a run is active. When Explain failures shows too, Explain failures becomes `secondary`. A rejected `fixLoop` shows in a `Banner` (tone `error`, "That did not work") with Dismiss.
- `TestResults` (`checks`, `reqs`, `design`, `onOpen(path, line?)`): tests grouped by describe title (`UC-001 Add task`, the file when there is none), in the order of the design's use cases. Each row is a button with a status `Badge` (passed `active`, failed `error`, manual `info`, skipped and not written `default`), the `REQ-xxx ACn` or `SEQ-xxx` label, the criterion text and, for a failure, the first line of the message. The accessible name of a row ends with its group, so equal titles in two use cases stay apart. A last list names the criteria without a test, with their priority. Timed out and no test ran show a `Banner`.
- `Findings` (`findings`, `result`, `testFixes?`, `canApply`, `form?`): findings whose test still fails are open and show the test, `REQ` badge, file, explanation, proposed fix and an "Apply fix" button (submits `applyFix` with `findingId`). While `canApply` is false (an agent run is active) the button shows `loading` like Approve (R17, never `disabled`) and `aria-describedby` points to a visible note that says when it is available. Resolved findings sit in a closed `Disclosure`. Test fixes are listed with a "test corrected" `Badge` and the reason.
- `Chat` handoff entry (fix loop): a message between two agents is not a bubble. It renders as a full width `article` with no fill, a 2px left rule in `--color-border-strong`, muted text and a mono "who" line, "Test agent → Code agent" with a screen reader only "to" between the names (`agentLabel` in `src/lib/live-run.ts`: Test agent, Code agent, Checks). A chat entry with `from` and `to` and a live `agent_message` render the same snippet; after Discard the rule turns dashed and the line says the run was discarded.
- `GenerateTests` (`snapshot`, `form`): the "Generate tests" panel; renders only while no file under `test/` exists and no run is active. It sits above the gate while P5 is selected, like `GenerateCode`, because the Tests tab only opens once tests exist or a P5 run is active.
- `GatePanel`, `StaleBanner` and `Chat` take phase P5. The P5 gate lists tsc errors and failing tests under their checks as buttons that call `onopenfile({ path, line })`. Errors use the rule of the gate: a file under `test/` (a leading `./` and backslashes are normalised) or a global error without a file, which shows as text. The page opens `test/` paths in the Tests tab when it is available, else in Code, and keeps an opened file only for the tab it belongs to. "Check again" submits `checkTests`. `StaleBanner` P5 lists the REQ, UC and SEQ IDs of `staleTestIds` and waits for the code approval. The chat talks to the test agent. P5 needs the attention of the page once P1, P2 and P4 are approved and P5 is not.

## Deploy tab and P6 components

Also in `src/lib/components/`, nothing new in `src/lib/ui/`. `src/lib/code-files.ts` has `DEPLOY_FILES` and `hasDeployFiles(files)` (a deploy file at the project root, the same rule as the server).

- `DeployPanel` (`snapshot`): the Deploy tab. Without deploy files a note. Otherwise a header row with a `Passed` (`active`) or `Failed` (`error`) `Badge`, "Took 61.2 s" and an "out of date" `Badge` when the gate says so, and "Run deploy check" (submits `checkDeploy`, busy while any run is active, never `disabled`). Below: a `Table` with Service (the planned compose service of `snapshot.deployServices` with that health url, empty for an unknown url), Status (a `Badge`: 2xx `active`, anything else or no answer `error`) and URL (mono, last because it wraps on a narrow screen), the log tail in a closed `Disclosure`, and a `CodePanel` that lists the three deploy files only, read only (the viewer highlights every file as TypeScript). The tab takes no `form` and shows no banner: `GatePanel` is on the page for every phase and shows the rejected `checkDeploy` (a test pins this), so the Docker message shows once.
- `GenerateDeployment` (`snapshot`, `form`): the "Generate the deployment" panel; renders only while no deploy file exists and no run is active. It sits above the gate while P6 is selected and asks to approve the tests first while P5 is not approved.
- `GatePanel`, `StaleBanner` and `Chat` take phase P6. The gate has "Check again" (submits `checkDeploy`) once a deploy file exists; failing services are named in the check detail. `StaleBanner` P6 lists `staleDeployIds` (service node IDs and `dependencies`) and waits for the tests approval. The chat talks to the deploy agent.
- `PhaseBar` opens P6 once P5 is approved or while P6 holds a state of its own; before that the station reads "After test approval". The page opens the Deploy tab once a deploy file exists or a P6 run is active, and `attentionPhase` picks P6 once P1 to P5 are approved and P6 is not.

## Tickets tab and P7 components

Also in `src/lib/components/`, nothing new in `src/lib/ui/`. `ticket-labels.ts` holds the kind and status words, the status `Badge` tones and the phase names.

- `TicketsPanel` (`snapshot`, `form`, bindable `selectedId`, `onopenid`, `onopenfile`, `onselectphase`): list of tickets (ID, kind, title, status `Badge`; the selected row has `aria-current`), a "New ticket" toggle for `TicketForm` (shown at once while there is no ticket; opening it focuses Kind) and, whenever a ticket appears, a switch to that ticket and the `TicketDetail` of the selected ticket: the one in progress, else the newest.
- `TicketForm` (`form`, `running?`, `ondone?`, `focus()`): kind `Select`, title and description, submits `createTicket`. Create ticket is busy with a note while an agent runs. An empty title is not sent: the field names the problem and takes focus. A rejected `createTicket` shows in a `Banner` under the form.
- `TicketDetail` (`snapshot`, `ticket`, `form`, `onopenid`, `onopenfile`, `onselectphase`): header with ID, kind, status and the description; the plan (entry phase, steps, affected IDs and files as buttons); `triaged` shows "Approve plan" (drift adds a "Direction" `Select`, preset from the plan) and "Reject", `open` only "Reject"; `in_progress` shows the walk, one row per phase with its live `StatusBadge`, the entry mark and what the developer does next (stale: Update and Still valid with `phase` plus "Open P4"; awaiting approval: "Review in P2"; both call `onselectphase`. A row behind a phase that is not approved says "Approve P2 first." (or to update it) and has no Update, Still valid or Review. A stale P4 whose checks are out of date says to press Check again in the Code tab first. Close ticket adds a hint to run the tests in the Tests tab when the walk includes P5 and the results are old), "Not reproduced" for a bug whose test passes, and "Close ticket"; `done` shows the change report (text as `ChatMarkdown`, steps with run summaries, changed IDs, test result, one closed `Disclosure` per file with the diff in a read only `CodeViewer`, mounted on first open). Approve plan, Reject, Update and Close ticket show `loading` while an agent runs (R17). Close ticket stays enabled: while the walk or the entry run blocks it, a visible note names why (`aria-describedby`), and a click sends nothing and moves focus to that note. A server refusal shows in a `Banner` next to the buttons. The detail opens with the form of an earlier ticket treated as dismissed (`createFormError(form, actions, true)`), so another ticket's error never shows; `TicketForm` does the same.
- Ticket text is user data: titles, descriptions and chat messages render as plain text, never as HTML or Markdown. Only the agent written report and agent chat messages go through `ChatMarkdown` (a small parser that builds elements, no `{@html}`).
- `Chat` gains `ticket?: TicketView` instead of `phase`: title "Chat with the maintenance agent", entries `ticket.chat`, hidden `ticketId`, action `ticketSend`. Live text shows only while the active run is a P7 run of this ticket; a run of another ticket still makes Send busy. A done or rejected ticket shows a note instead of the box. A failed run of the ticket offers Retry.
- Page wiring: P7 is a real station of the rail (`WorkPhase` includes it, `aria-current` as for the others). Picking it opens the Tickets tab, hides the gate and the stale banners and swaps the left pane for `Chat` in ticket mode of the selected ticket (`TicketsPanel` reports the ticket through `bind:selectedId`; without a ticket the pane says "No ticket yet"); another station brings the phase chat and gate back. The ticket chat is not part of `TicketDetail`. The Tickets tab (after Deploy, before Trace) opens once P5 is approved or stale, or a ticket exists (`ticketsTabOpen`); the tab bar and the fallback when a tab closes are `workspaceTabs` and `activeTabId` in `workspace-view.ts`. Affected IDs open Requirements (REQ) or Diagrams (UC, SEQ, ACT, DSN) via `tabForId`; files use `showFile`; `onselectphase` leaves the Tickets tab for that phase (`workPhase` drops phases without a gate). The P4 `GatePanel` shows "Open drift ticket" (`openDriftTicket`) while `snapshot.canOpenDriftTicket` is true and calls `onopendriftticket` after success, which selects P7 on the new ticket. Picking P7 or opening a drift ticket scrolls the tabs to the top. `SplitView` takes a bindable `active` (`left` or `right`) so the page can switch panes below `md`: picking P7 keeps the chat pane (it is the ticket chat now), while an ID, a file or Open Pn switches to the Artefacts pane.

Shared styles live in `base.css` (`.aise-hit` grows a small control to `--hit-area`, `.aise-sr-only`) and `controls.css` (`.aise-control`, the look of Input, Textarea and Select). Helpers: `createFieldValidation` (`validation.svelte.ts`, validation timing) and `createDelay` (`delay.svelte.ts`, used by `Spinner` and `Skeleton`). Component tests: `components.svelte.test.ts` and `validation.svelte.test.ts` (jsdom, Testing Library).

## Interaction patterns

We follow the form, button, loading and error patterns from [designmotionhq.com/patterns](https://designmotionhq.com/patterns). In short:

- Fields have six states: default, focus, error, success, disabled, loading. The label sits above, help text below, and a placeholder never replaces the label. An error combines an icon, text and colour, and names the problem and the fix. Success shows a check inside the field. Disabled uses a neutral fill and a not allowed cursor, never reduced opacity. Loading shows a spinner in the field and blocks edits.
- Validate a field when the user leaves it, not on every keystroke and not only on submit. After the first error, check live so the error disappears as soon as it is fixed.
- Do not disable a button because input is invalid. Keep it enabled, validate on click, mark the fields that block and say in visible text what is missing. A running action is not disabled: it shows a spinner, sets `aria-busy` and keeps focus. Validate on the client for speed and on the server for trust, and keep the busy state until the server answers.
- Destructive actions name what happens on both buttons ("Discard run" and "Keep run", not Yes and No), use red only for destruction, and keep the destructive button away from the usual confirm position.
- Loading: under about 300 ms show nothing, content of a known shape gets a skeleton, a short unknown wait a spinner, long open ended work a clear activity indicator. No full page spinner.
- Errors: the surface follows the severity (inline for a field, banner for a transient problem, a prominent space for a blocking one). Every error offers a way out such as Retry, and uses plain words.
- File uploads are not used yet; when they arrive: drag over feedback, per file progress, retry in place.

How this app applies them:

| Rule | In the code |
| --- | --- |
| R16 Long agent work shows an orb | `ThinkingOrb`: `working` while waiting for the model, `searching` while tools run, `composing` while text streams. 20 px in the chat stream; 64 px is available for start states but so far only shown in `/dev/ui`. Theme follows `data-theme`; reduced motion shows one static frame. |
| R17 Buttons stay enabled | `Button` `loading` sets `aria-busy`, shows the spinner and stays focusable (no `disabled` attribute). `disabled` only for things that cannot happen (phases and tabs not reached yet, the Trace tab), always with visible text why. Approve with a failing gate stays enabled and moves focus to the gate checklist. |
| R18 Field states and timing | `Input`, `Textarea`, `Select` take `error`, `success` and (Input, Textarea) `loading`; `createFieldValidation` runs blur then live. |
| R19 Discard asks with named buttons | `Modal` says what is restored; buttons "Discard run" and "Keep run". |
| R20 Delay and error surfaces | `Spinner` and `Skeleton` take `delay` (fetches use 300). Failed run: error `Banner` with Retry. Lost connection: warning `Banner`. Action errors sit next to the control that caused them. |

`ThinkingOrb` wraps the engine of the `thinking-orbs` package (MIT, `thinking-orbs/engine`: geometry and canvas painting). We draw the canvas loop ourselves and do not use the package's React component.

## Do and don't

| Do | Don't |
| --- | --- |
| Space from the 4px scale | Pick pixel values by eye |
| Keep a limited palette: neutrals plus one accent plus status colours | Add a colour for one screen |
| Use the type scale | Set ad hoc font sizes |
| Document and build every state (default, hover, focus, active, disabled, loading, error) | Ship only the default state |
| Use semantic tokens | Use hex values or raw scale steps |

## Naming

- CSS custom properties: `--<group>-<name>` (`--color-text`, `--space-4`, `--duration-200`).
- Components: PascalCase files in `src/lib/ui/` (`Button.svelte`).
- Props: `variant` (visual style), `size`, `tone` (semantic colour).
- No BEM: Svelte scopes component styles.

## Guardrails

`guardrails.test.ts` scans `src/**/*.{svelte,css}` (except `tokens.css`; CSS comments ignored; `var(--x, fallback)` counts as a token) and fails on:

- hex, `rgb(` or `hsl(` colours;
- `font-size` without `var(--text-*)`, `font-family` without a `var(--font-*)` token;
- `padding`, `margin`, `gap` or `inset` with a non zero length other than `1px` (`0`, `auto`, `inherit`, percentages and `calc()` built from tokens are fine);
- `transition` or `animation` durations without `var(--duration-*)`;
- an export of `src/lib/ui/index.ts` missing from `src/routes/dev/ui/+page.svelte`.

## Contributing a component

1. Tokens only, no literals; both themes.
2. Build every state and keep the 44 x 44px hit area.
3. Export it from `src/lib/ui/index.ts`.
4. Add a section for it to `/dev/ui` (`src/routes/dev/ui/+page.svelte`).
5. `npm run check && npm run lint && npm test` green.
