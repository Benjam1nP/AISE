import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshotOf, ticketOf } from '#lib/components/fixtures.ts';
import Page from './+page.svelte';

// Stands in for SvelteKit's enhance: reports success once a form is submitted. Forms that no test
// submits are not touched.
vi.mock('$app/forms', () => ({
	enhance: (
		form: HTMLFormElement,
		submit: (input: unknown) => (r: unknown) => Promise<void> | undefined
	) => {
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			const action = new URL(form.action, 'http://localhost').search.slice(2);
			void submit({ formData: new FormData(form), cancel: () => {} })?.({
				result: { type: 'success', status: 200, data: { ok: true, action } },
				update: async () => {}
			});
		});
	}
}));
vi.mock('$app/navigation', () => ({ invalidateAll: async () => {} }));
// Mermaid needs a real browser to draw; the diagram tests only need the click hook it registers.
vi.mock('mermaid', () => ({ default: undefined }));

declare global {
	interface Window {
		aiseSelect?: (id: string) => void;
	}
}

beforeEach(() => {
	// jsdom does not scroll.
	Element.prototype.scrollIntoView = vi.fn();
	// The page opens an event stream when it mounts; jsdom has none.
	vi.stubGlobal(
		'EventSource',
		class {
			close() {}
		}
	);
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});

const at = '2026-11-22T10:00:00.000Z';
const walk = (...rows: [string, string][]) =>
	rows.map(([phase, status], i) => ({ phase, status, entry: i === 0 })) as never;

const older = ticketOf({
	id: 'TCK-001',
	title: 'Older ticket',
	status: 'in_progress',
	chat: [{ role: 'assistant', text: 'Chat of the older ticket', at }],
	steps: walk(['P1', 'approved'], ['P2', 'approved'], ['P4', 'stale'])
});
const newer = ticketOf({
	id: 'TCK-002',
	title: 'Newer ticket',
	status: 'triaged',
	chat: [{ role: 'assistant', text: 'Chat of the newer ticket', at }]
});

const snapshot = (over: Record<string, unknown> = {}) =>
	snapshotOf({
		name: 'demo',
		state: {
			phases: {
				P1: { status: 'approved' },
				P2: { status: 'approved' },
				P3: { status: 'not_started' },
				P4: { status: 'approved' },
				P5: { status: 'approved' },
				P6: { status: 'approved' },
				P7: { status: 'awaiting_approval' }
			}
		},
		chat: {
			P1: [],
			P2: [],
			P3: [],
			P4: [{ role: 'assistant', text: 'Chat of the code agent', at }],
			P5: []
		},
		tickets: [older, newer],
		...over
	});

const mount = (over: Record<string, unknown> = {}) =>
	render(Page, { data: { snapshot: snapshot(over) }, form: null } as never);

const rail = (name: RegExp) => screen.getByRole('button', { name });
const heading = (name: string | RegExp) => screen.queryByRole('heading', { name });
/** The tab of the artefact tabs; the chat and artefact pane switch is a tab list of its own. */
const tab = (name: string) => screen.getByRole('tab', { name });
const selected = (name: string) => tab(name).getAttribute('aria-selected') === 'true';

describe('workspace page, P7', () => {
	it('selects P7 in the rail, opens the Tickets tab and shows no gate', async () => {
		mount();
		expect(heading('Approve the requirements')).toBeTruthy();
		await userEvent.click(rail(/P7\s*Maintenance/));
		expect(rail(/P7\s*Maintenance/).getAttribute('aria-current')).toBe('step');
		expect(rail(/P5\s*Testing/).getAttribute('aria-current')).toBeNull();
		expect(selected('Tickets')).toBe(true);
		expect(heading(/^Approve the/)).toBeNull();
	});

	it('swaps the left pane for the chat of the selected ticket', async () => {
		mount();
		expect(heading('Chat with the code agent')).toBeNull();
		await userEvent.click(rail(/P7\s*Maintenance/));
		expect(heading('Chat with the maintenance agent')).toBeTruthy();
		expect(heading(/^Chat with the (?!maintenance)/)).toBeNull();
		// The ticket in progress is the default, not the newest.
		expect(screen.getByText('Chat of the older ticket')).toBeTruthy();
		expect(screen.queryByText('Chat of the newer ticket')).toBeNull();
	});

	it('follows the ticket picked in the list', async () => {
		mount();
		await userEvent.click(rail(/P7\s*Maintenance/));
		const list = screen.getByRole('list', { name: 'Tickets' });
		await userEvent.click(within(list).getByRole('button', { name: /TCK-002/ }));
		expect(screen.getByText('Chat of the newer ticket')).toBeTruthy();
		expect(screen.queryByText('Chat of the older ticket')).toBeNull();
	});

	it('shows no stale banner while P7 is selected, and shows it again on another station', async () => {
		mount({ staleReqIds: ['REQ-001'] });
		const banner = /changed after you approved/;
		expect(screen.queryByText(banner)).toBeTruthy();
		await userEvent.click(rail(/P7\s*Maintenance/));
		expect(screen.queryByText(banner)).toBeNull();
		await userEvent.click(rail(/P2\s*Design/));
		expect(screen.queryByText(banner)).toBeTruthy();
	});

	it('keeps what was typed for one ticket out of the chat of the next', async () => {
		mount();
		await userEvent.click(rail(/P7\s*Maintenance/));
		await userEvent.type(
			screen.getByRole('textbox', { name: /Message to the maintenance agent/ }),
			'for one'
		);
		const list = screen.getByRole('list', { name: 'Tickets' });
		await userEvent.click(within(list).getByRole('button', { name: /TCK-002/ }));
		expect(
			(
				screen.getByRole('textbox', {
					name: /Message to the maintenance agent/
				}) as HTMLTextAreaElement
			).value
		).toBe('');
	});

	it('falls back to the phase that needs attention when the Tickets tab closes under P7', async () => {
		const { rerender } = mount();
		await userEvent.click(rail(/P7\s*Maintenance/));
		expect(heading('Chat with the maintenance agent')).toBeTruthy();
		await rerender({
			data: {
				snapshot: snapshot({
					state: {
						phases: {
							P1: { status: 'approved' },
							P2: { status: 'approved' },
							P3: { status: 'not_started' },
							P4: { status: 'approved' },
							P5: { status: 'awaiting_approval' },
							P6: { status: 'not_started' },
							P7: { status: 'not_started' }
						}
					},
					tickets: []
				})
			},
			form: null
		} as never);
		expect(heading('Chat with the maintenance agent')).toBeNull();
		expect(rail(/P5\s*Testing/).getAttribute('aria-current')).toBe('step');
		expect(heading('Approve the tests')).toBeTruthy();
	});

	it('goes back to the phase chat and gate when another station is picked', async () => {
		mount();
		await userEvent.click(rail(/P7\s*Maintenance/));
		await userEvent.click(rail(/P4\s*Code/));
		expect(rail(/P4\s*Code/).getAttribute('aria-current')).toBe('step');
		expect(rail(/P7\s*Maintenance/).getAttribute('aria-current')).toBeNull();
		expect(heading('Chat with the code agent')).toBeTruthy();
		expect(heading('Chat with the maintenance agent')).toBeNull();
		expect(heading('Approve the code')).toBeTruthy();
	});

	it('Open P4 in the walk goes to the phase: its chat and gate come back', async () => {
		mount();
		await userEvent.click(rail(/P7\s*Maintenance/));
		await userEvent.click(screen.getByRole('button', { name: 'Open P4' }));
		expect(rail(/P4\s*Code/).getAttribute('aria-current')).toBe('step');
		expect(heading('Chat with the code agent')).toBeTruthy();
		expect(selected('Tickets')).toBe(false);
	});

	it('keeps the Tickets tab closed before the tests are approved', () => {
		mount({
			state: {
				phases: {
					P1: { status: 'approved' },
					P2: { status: 'approved' },
					P3: { status: 'not_started' },
					P4: { status: 'approved' },
					P5: { status: 'awaiting_approval' },
					P6: { status: 'not_started' },
					P7: { status: 'not_started' }
				}
			},
			tickets: []
		});
		expect(tab('Tickets').getAttribute('aria-disabled')).toBe('true');
		expect(screen.queryByRole('button', { name: /P7\s*Maintenance/ })).toBeNull();
	});

	it('shows an empty maintenance chat panel while there is no ticket yet', async () => {
		mount({ tickets: [] });
		await userEvent.click(rail(/P7\s*Maintenance/));
		expect(heading('Chat with the maintenance agent')).toBeNull();
		expect(screen.getByText('No ticket yet')).toBeTruthy();
	});
});

describe('workspace page, drift ticket', () => {
	it('Open drift ticket on the P4 gate selects P7 and shows the chat of the newest ticket', async () => {
		mount({ canOpenDriftTicket: true });
		await userEvent.click(rail(/P4\s*Code/));
		expect(heading('Chat with the code agent')).toBeTruthy();
		await userEvent.click(screen.getByRole('button', { name: 'Open drift ticket' }));
		await vi.waitFor(() =>
			expect(rail(/P7\s*Maintenance/).getAttribute('aria-current')).toBe('step')
		);
		expect(selected('Tickets')).toBe(true);
		expect(heading('Chat with the maintenance agent')).toBeTruthy();
		// Not the ticket in progress, which is the default: the newest one.
		expect(screen.getByText('Chat of the newer ticket')).toBeTruthy();
		expect(screen.queryByText('Chat of the older ticket')).toBeNull();
	});
});

describe('workspace page, diagram clicks in P7', () => {
	const diagrams = { useCase: 'flowchart LR', class: '', deployment: '', sequences: [] };
	/** Opens the Diagrams tab, clicks an element with `id` (Mermaid calls aiseSelect) and goes back to the Tickets tab. */
	const clickInDiagram = async (id: string) => {
		await userEvent.click(tab('Diagrams'));
		await vi.waitFor(() => expect(window.aiseSelect).toBeTypeOf('function'));
		window.aiseSelect!(id);
		await userEvent.click(tab('Tickets'));
	};
	const description = () =>
		(screen.getByRole('textbox', { name: /Description/ }) as HTMLTextAreaElement).value;

	it('puts the ID into the new ticket while there is no ticket yet', async () => {
		mount({ tickets: [], diagrams });
		await userEvent.click(rail(/P7\s*Maintenance/));
		await clickInDiagram('DSN-002');
		expect(description()).toBe('DSN-002 ');
	});

	it('puts the ID into the open New ticket form, after what was typed, not into the ticket chat', async () => {
		mount({ diagrams });
		await userEvent.click(rail(/P7\s*Maintenance/));
		await userEvent.click(screen.getByRole('button', { name: 'New ticket' }));
		await userEvent.type(screen.getByRole('textbox', { name: /Description/ }), 'Split it');
		await clickInDiagram('DSN-003');
		expect(description()).toBe('Split it DSN-003 ');
		const message = screen.getByRole('textbox', { name: /Message to the maintenance agent/ });
		expect((message as HTMLTextAreaElement).value).toBe('');
	});

	it('puts the ID into the ticket chat while the New ticket form is closed', async () => {
		mount({ diagrams });
		await userEvent.click(rail(/P7\s*Maintenance/));
		await clickInDiagram('DSN-003');
		const message = screen.getByRole('textbox', { name: /Message to the maintenance agent/ });
		expect((message as HTMLTextAreaElement).value).toBe('DSN-003 ');
	});

	const designMessage = () =>
		(screen.getByRole('textbox', { name: /Message to the design agent/ }) as HTMLTextAreaElement)
			.value;

	it('puts the ID into the phase chat outside P7, even without a ticket', async () => {
		mount({ tickets: [], diagrams });
		await userEvent.click(rail(/P2\s*Design/));
		await userEvent.click(tab('Diagrams'));
		await vi.waitFor(() => expect(window.aiseSelect).toBeTypeOf('function'));
		window.aiseSelect!('REQ-001');
		await vi.waitFor(() => expect(designMessage()).toBe('REQ-001 '));
	});

	it('puts the ID into the phase chat after leaving P7 with the New ticket form open', async () => {
		mount({ diagrams });
		await userEvent.click(rail(/P7\s*Maintenance/));
		await userEvent.click(screen.getByRole('button', { name: 'New ticket' }));
		await userEvent.click(rail(/P2\s*Design/));
		await userEvent.click(tab('Diagrams'));
		await vi.waitFor(() => expect(window.aiseSelect).toBeTypeOf('function'));
		window.aiseSelect!('DSN-003');
		await vi.waitFor(() => expect(designMessage()).toBe('DSN-003 '));
	});

	it('Cancel on the New ticket form drops its description', async () => {
		mount({ diagrams });
		await userEvent.click(rail(/P7\s*Maintenance/));
		await userEvent.click(screen.getByRole('button', { name: 'New ticket' }));
		await clickInDiagram('DSN-003');
		expect(description()).toBe('DSN-003 ');
		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await userEvent.click(screen.getByRole('button', { name: 'New ticket' }));
		expect(description()).toBe('');
	});
});

describe('workspace page, scrolling', () => {
	const scrolled = () => {
		const spy = vi.fn();
		Element.prototype.scrollIntoView = spy;
		return spy;
	};

	it('brings the tabs into view when P7 is picked', async () => {
		const scroll = scrolled();
		mount();
		expect(scroll).not.toHaveBeenCalled();
		await userEvent.click(rail(/P7\s*Maintenance/));
		await vi.waitFor(() => expect(scroll).toHaveBeenCalled());
		const target = scroll.mock.contexts[0] as HTMLElement;
		expect(target.contains(tab('Tickets'))).toBe(true);
	});

	it('does not scroll when another station is picked', async () => {
		const scroll = scrolled();
		mount();
		await userEvent.click(rail(/P4\s*Code/));
		expect(scroll).not.toHaveBeenCalled();
	});
});

describe('workspace page, panes below md', () => {
	it('keeps the chat pane when P7 is picked: it is now the ticket chat', async () => {
		mount();
		await userEvent.click(rail(/P7\s*Maintenance/));
		expect(screen.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true');
		expect(heading('Chat with the maintenance agent')).toBeTruthy();
	});

	it('switches to the Artefacts pane when an ID of a plan is opened', async () => {
		mount();
		await userEvent.click(rail(/P7\s*Maintenance/));
		expect(screen.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true');
		await userEvent.click(screen.getByRole('button', { name: /^REQ-001$/ }));
		expect(screen.getByRole('tab', { name: 'Artefacts' }).getAttribute('aria-selected')).toBe(
			'true'
		);
		expect(selected('Requirements')).toBe(true);
	});

	it('switches to the Artefacts pane when a file of a plan is opened', async () => {
		mount();
		await userEvent.click(rail(/P7\s*Maintenance/));
		await userEvent.click(screen.getByRole('button', { name: 'src/tasks/Task.ts' }));
		expect(screen.getByRole('tab', { name: 'Artefacts' }).getAttribute('aria-selected')).toBe(
			'true'
		);
	});

	it('switches to the Artefacts pane again after the user went back to the chat', async () => {
		mount();
		const artefacts = () =>
			screen.getByRole('tab', { name: 'Artefacts' }).getAttribute('aria-selected');
		await userEvent.click(rail(/P7\s*Maintenance/));
		await userEvent.click(screen.getByRole('button', { name: 'Open P4' }));
		expect(artefacts()).toBe('true');
		await userEvent.click(screen.getByRole('tab', { name: 'Chat' }));
		expect(artefacts()).toBe('false');
		await userEvent.click(rail(/P7\s*Maintenance/));
		await userEvent.click(screen.getByRole('button', { name: /^REQ-001$/ }));
		expect(artefacts()).toBe('true');
	});

	it('switches to the Artefacts pane when a phase of the walk is opened', async () => {
		mount();
		await userEvent.click(rail(/P7\s*Maintenance/));
		await userEvent.click(screen.getByRole('button', { name: 'Open P4' }));
		expect(screen.getByRole('tab', { name: 'Artefacts' }).getAttribute('aria-selected')).toBe(
			'true'
		);
	});
});

describe('workspace page, P3', () => {
	const diagrams = { useCase: 'flowchart LR', class: '', deployment: '', sequences: [] };
	const proposal = {
		id: 'PRP-001',
		kind: 'missing_method',
		title: 'Add a delete method',
		change: 'TaskService gets deleteTask(id).',
		elementIds: ['DSN-001'],
		reqIds: ['REQ-003'],
		status: 'open'
	};
	const mountP3 = () =>
		mount({
			design: {},
			diagrams,
			proposals: { designHash: 'h', proposals: [proposal] }
		});
	const designMessage = () =>
		(screen.getByRole('textbox', { name: /Message to the design agent/ }) as HTMLTextAreaElement)
			.value;
	/** Collects the forms submitted while `act` runs. */
	const posted = async (act: () => Promise<void>) => {
		const actions: string[] = [];
		const record = (e: Event) => actions.push((e.target as HTMLFormElement).action);
		document.addEventListener('submit', record);
		await act();
		document.removeEventListener('submit', record);
		return actions;
	};

	it('shows the review run read only next to the proposals', async () => {
		mountP3();
		await userEvent.click(rail(/P3\s*Refinement/));
		expect(heading('Chat with the review agent')).toBeTruthy();
		expect(screen.queryByRole('textbox')).toBeNull();
		expect(screen.getByRole('article', { name: /PRP-001/ })).toBeTruthy();
		expect(selected('Diagrams')).toBe(true);
	});

	it('Discuss opens the design chat with the proposal in the composer and posts nothing', async () => {
		mountP3();
		await userEvent.click(rail(/P3\s*Refinement/));
		const sent = await posted(() =>
			userEvent.click(screen.getByRole('button', { name: 'Discuss PRP-001' }))
		);
		expect(sent).toEqual([]);
		expect(rail(/P2\s*Design/).getAttribute('aria-current')).toBe('step');
		await vi.waitFor(() => expect(designMessage()).toContain('Regarding PRP-001'));
		expect(designMessage()).toContain('TaskService gets deleteTask(id).');
	});

	it('Accept switches to the design chat', async () => {
		mountP3();
		await userEvent.click(rail(/P3\s*Refinement/));
		await userEvent.click(screen.getByRole('button', { name: 'Accept PRP-001' }));
		expect(rail(/P2\s*Design/).getAttribute('aria-current')).toBe('step');
		expect(heading('Chat with the design agent')).toBeTruthy();
	});

	it('Reject moves focus to the panel heading', async () => {
		mountP3();
		await userEvent.click(rail(/P3\s*Refinement/));
		await userEvent.click(screen.getByRole('button', { name: 'Reject PRP-001' }));
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Design review' }))
		);
	});

	it('a diagram click in P3 switches to the design chat and puts the ID in its composer', async () => {
		mountP3();
		await userEvent.click(rail(/P3\s*Refinement/));
		await vi.waitFor(() => expect(window.aiseSelect).toBeTypeOf('function'));
		window.aiseSelect!('DSN-003');
		await vi.waitFor(() => expect(designMessage()).toBe('DSN-003 '));
		expect(rail(/P2\s*Design/).getAttribute('aria-current')).toBe('step');
	});
});
