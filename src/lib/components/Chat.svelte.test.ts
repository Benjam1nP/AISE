import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ProjectSnapshot } from '#lib/server/index.ts';
import Chat from './Chat.svelte';
import { captureSubmit, snapshotOf, ticketOf } from './fixtures.ts';

const snapshot = {
	name: 'demo',
	state: { phases: { P1: { status: 'not_started' }, P2: { status: 'not_started' } } },
	chat: { P1: [], P2: [] },
	activeRun: null,
	lastRun: null
} as unknown as ProjectSnapshot;

const props = (form: { action?: string; message?: string }) => ({
	snapshot,
	phase: 'P1' as const,
	live: null,
	form
});

describe('Chat error banner', () => {
	it('Dismiss hides it and a new form result shows it again', async () => {
		const first = { action: 'send', message: 'The agent is still working on this project.' };
		const { rerender } = render(Chat, props(first));
		expect(screen.getByText(first.message)).toBeTruthy();

		await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
		expect(screen.queryByText(first.message)).toBeNull();

		await rerender(props({ action: 'send', message: 'Another failure.' }));
		expect(screen.getByText('Another failure.')).toBeTruthy();
	});

	it('shows no banner for a successful action', () => {
		render(Chat, props({ action: 'send' }));
		expect(screen.queryByRole('alert')).toBeNull();
	});
});

describe('Chat of the design review (P3)', () => {
	it('shows the review run without a composer and without Retry', () => {
		const failed = snapshotOf({
			lastRun: { phase: 'P3', agent: 'review', status: 'failed', error: 'boom' }
		} as never);
		render(Chat, { snapshot: failed, phase: 'P3', live: null, form: null });
		expect(screen.getByRole('heading', { name: /review agent/ })).toBeTruthy();
		expect(screen.queryByRole('textbox')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
		expect(screen.getByText(/Press Review design to run it again/)).toBeTruthy();
	});
});

describe('Chat messages', () => {
	const at = '2026-11-04T10:00:00.000Z';
	const withChat = (over: Record<string, unknown>) =>
		({ ...snapshot, discardedRunIds: [], ...over }) as unknown as ProjectSnapshot;

	it('renders two entries with the same time and role (I1)', () => {
		const chat = {
			P1: [
				{ role: 'user', text: 'first', at, runId: 'r1' },
				{ role: 'user', text: 'second', at, runId: 'r1' }
			],
			P2: []
		};
		render(Chat, { ...props({}), snapshot: withChat({ chat }) });
		expect(screen.getByText('first')).toBeTruthy();
		expect(screen.getByText('second')).toBeTruthy();
	});

	it('marks the messages of a discarded run and keeps them visible (M5)', () => {
		const chat = {
			P1: [
				{ role: 'user', text: 'old idea', at, runId: '20261104-100000-P1' },
				{ role: 'assistant', text: 'old answer', at, runId: '20261104-100000-P1' },
				{ role: 'user', text: 'new idea', at, runId: '20261104-100100-P1' }
			],
			P2: []
		};
		const snap = withChat({ chat, discardedRunIds: ['20261104-100000-P1'] });
		render(Chat, { ...props({}), snapshot: snap });
		expect(screen.getByText('old idea')).toBeTruthy();
		const discarded = screen.getAllByText(/run discarded/);
		expect(discarded).toHaveLength(2);
		expect(screen.getByText('new idea').closest('article')?.textContent).not.toMatch(/discarded/);
	});
	it('formats agent Markdown and shows the user text as typed', () => {
		const chat = {
			P1: [
				{ role: 'user', text: 'keep **this** raw', at },
				{ role: 'assistant', text: '- **Sequences:** E\n- `UC-001`', at }
			],
			P2: []
		};
		render(Chat, { ...props({}), snapshot: withChat({ chat }) });
		expect(screen.getByText('keep **this** raw')).toBeTruthy();
		expect(screen.getByText('Sequences:').tagName).toBe('STRONG');
		expect(screen.getByText('UC-001').tagName).toBe('CODE');
		expect(screen.getAllByRole('listitem')).toHaveLength(2);
	});
});

describe('Chat composer', () => {
	it('does not send an empty message and puts focus back in the box', async () => {
		render(Chat, props({}));
		const box = screen.getByRole('textbox');
		await userEvent.type(box, '   ');
		await userEvent.click(screen.getByRole('button', { name: 'Send' }));
		expect(document.activeElement).toBe(box);
		expect((box as HTMLTextAreaElement).value).toBe('   ');
	});
});

describe('Chat for P4', () => {
	const p4 = (files: string[], p2: 'approved' | 'not_started') =>
		({
			...snapshot,
			state: {
				phases: { P1: { status: 'approved' }, P2: { status: p2 }, P4: { status: 'not_started' } }
			},
			chat: { P1: [], P2: [], P4: [{ role: 'user', text: 'use a Map' }] },
			files
		}) as unknown as ProjectSnapshot;

	it('talks to the code agent and sends with phase P4', () => {
		render(Chat, { snapshot: p4(['src/A.ts'], 'approved'), phase: 'P4', live: null, form: null });
		expect(screen.getByRole('heading', { name: 'Chat with the code agent' })).toBeTruthy();
		expect(screen.getByText('use a Map')).toBeTruthy();
		expect(document.querySelector<HTMLInputElement>('input[name="phase"]')?.value).toBe('P4');
	});

	it('explains the empty chat before any code exists', () => {
		const empty = {
			...p4([], 'approved'),
			chat: { P1: [], P2: [], P3: [], P4: [], P5: [], P6: [] }
		} as ProjectSnapshot;
		render(Chat, { snapshot: empty, phase: 'P4', live: null, form: null });
		expect(screen.getByText(/Generate the code first/)).toBeTruthy();
	});

	it('explains the empty chat when only the scaffold exists', () => {
		const scaffold = {
			...p4(['package.json', 'tsconfig.json'], 'approved'),
			chat: { P1: [], P2: [], P3: [], P4: [], P5: [], P6: [] }
		} as ProjectSnapshot;
		render(Chat, { snapshot: scaffold, phase: 'P4', live: null, form: null });
		expect(screen.getByText(/Generate the code first/)).toBeTruthy();
	});

	it('asks for the design approval first when P2 is not approved', () => {
		const open = {
			...p4([], 'not_started'),
			chat: { P1: [], P2: [], P3: [], P4: [], P5: [], P6: [] }
		} as ProjectSnapshot;
		render(Chat, { snapshot: open, phase: 'P4', live: null, form: null });
		expect(screen.getByText(/Approve the design first/)).toBeTruthy();
	});
});

describe('Chat for P5', () => {
	const p5 = (files: string[], p4: 'approved' | 'awaiting_approval', chat: unknown[] = []) =>
		({
			...snapshot,
			state: {
				phases: {
					P1: { status: 'approved' },
					P2: { status: 'approved' },
					P4: { status: p4 },
					P5: { status: 'not_started' }
				}
			},
			chat: { P1: [], P2: [], P4: [], P5: chat },
			files
		}) as unknown as ProjectSnapshot;

	it('talks to the test agent and sends with phase P5', () => {
		const withChat = p5(['src/A.ts', 'test/UC-001.test.ts'], 'approved', [
			{ role: 'user', text: 'test the empty title' }
		]);
		render(Chat, { snapshot: withChat, phase: 'P5', live: null, form: null });
		expect(screen.getByRole('heading', { name: 'Chat with the test agent' })).toBeTruthy();
		expect(screen.getByText('test the empty title')).toBeTruthy();
		expect(document.querySelector<HTMLInputElement>('input[name="phase"]')?.value).toBe('P5');
	});

	it('asks for the code approval first when P4 is not approved', () => {
		render(Chat, {
			snapshot: p5(['src/A.ts'], 'awaiting_approval'),
			phase: 'P5',
			live: null,
			form: null
		});
		expect(screen.getByText(/Approve the code first/)).toBeTruthy();
	});

	it('explains the empty chat before any tests exist', () => {
		render(Chat, { snapshot: p5(['src/A.ts'], 'approved'), phase: 'P5', live: null, form: null });
		expect(screen.getByText(/Generate the tests first/)).toBeTruthy();
	});
});

describe('Chat for P6', () => {
	const p6 = (files: string[], p5: 'approved' | 'awaiting_approval', chat: unknown[] = []) =>
		({
			...snapshot,
			state: {
				phases: {
					P1: { status: 'approved' },
					P2: { status: 'approved' },
					P4: { status: 'approved' },
					P5: { status: p5 },
					P6: { status: 'not_started' }
				}
			},
			chat: { P1: [], P2: [], P4: [], P5: [], P6: chat },
			files
		}) as unknown as ProjectSnapshot;

	it('talks to the deploy agent and sends with phase P6', () => {
		const withChat = p6(['src/A.ts', 'compose.yaml'], 'approved', [
			{ role: 'user', text: 'why port 8081?' }
		]);
		render(Chat, { snapshot: withChat, phase: 'P6', live: null, form: null });
		expect(screen.getByRole('heading', { name: 'Chat with the deploy agent' })).toBeTruthy();
		expect(screen.getByText('why port 8081?')).toBeTruthy();
		expect(document.querySelector<HTMLInputElement>('input[name="phase"]')?.value).toBe('P6');
	});

	it('asks for the test approval first when P5 is not approved', () => {
		render(Chat, {
			snapshot: p6(['src/A.ts'], 'awaiting_approval'),
			phase: 'P6',
			live: null,
			form: null
		});
		expect(screen.getByText(/Approve the tests first/)).toBeTruthy();
	});

	it('suggests only changes the compose rules allow in the empty chat', () => {
		render(Chat, {
			snapshot: p6(['src/A.ts', 'compose.yaml'], 'approved'),
			phase: 'P6',
			live: null,
			form: null
		});
		expect(screen.getByText(/troubleshooting section to RUN\.md/)).toBeTruthy();
		expect(screen.queryByText(/restart policy/)).toBeNull();
	});

	it('explains the empty chat before any deploy file exists', () => {
		render(Chat, { snapshot: p6(['src/A.ts'], 'approved'), phase: 'P6', live: null, form: null });
		expect(screen.getByText(/Generate the deployment first/)).toBeTruthy();
	});
});

describe('Chat in ticket mode', () => {
	const at = '2026-11-22T10:00:00.000Z';
	const chat = [
		{ role: 'user' as const, text: 'Tasks need a due date', at, runId: 'r1' },
		{ role: 'assistant' as const, text: 'Which tasks?', at, runId: 'r1' }
	];
	const ticket = ticketOf({ id: 'TCK-001', status: 'open', plan: undefined, chat });
	const ticketProps = (over: Record<string, unknown> = {}) => ({
		snapshot: snapshotOf({ tickets: [ticket] }),
		ticket,
		live: null,
		form: null,
		...over
	});

	it('talks to the maintenance agent and shows the ticket chat', () => {
		render(Chat, ticketProps());
		expect(screen.getByRole('heading', { name: 'Chat with the maintenance agent' })).toBeTruthy();
		expect(screen.getByText('Tasks need a due date')).toBeTruthy();
		expect(screen.getByText('Which tasks?')).toBeTruthy();
	});

	it('does not show the chat of a phase', () => {
		const snap = snapshotOf({
			tickets: [ticket],
			chat: { P1: [{ role: 'user', text: 'phase text', at }], P2: [], P4: [], P5: [] }
		});
		render(Chat, ticketProps({ snapshot: snap }));
		expect(screen.queryByText('phase text')).toBeNull();
	});

	it('posts ticketSend with the ticket ID and the text, and no phase', async () => {
		const { container } = render(Chat, ticketProps());
		const composer = container.querySelector('form.composer') as HTMLFormElement;
		expect(composer.getAttribute('action')).toBe('?/ticketSend');
		const sent = captureSubmit(composer);
		await userEvent.type(screen.getByRole('textbox'), 'All of them');
		await userEvent.click(screen.getByRole('button', { name: 'Send' }));
		expect(sent()).toEqual({ ticketId: 'TCK-001', text: 'All of them' });
	});

	it('explains the empty chat of an open ticket', () => {
		const empty = { ...ticket, chat: [] };
		render(Chat, ticketProps({ ticket: empty }));
		expect(screen.getByText(/answer its questions/i)).toBeTruthy();
	});

	const liveText = {
		runId: 'run-7',
		phase: 'P7' as const,
		items: [{ kind: 'text' as const, text: 'Looking at REQ-001' }]
	};

	it('shows the live text only of a P7 run of this ticket', () => {
		const snap = snapshotOf({
			tickets: [ticket],
			activeRun: { runId: 'run-7', phase: 'P7', ticketId: 'TCK-001' }
		});
		render(Chat, ticketProps({ snapshot: snap, live: liveText }));
		expect(screen.getByText('Looking at REQ-001')).toBeTruthy();
		expect(screen.getByRole('status').textContent).toContain('The agent is working');
	});

	it('shows no live text of a run of another ticket, but still waits for it', () => {
		const snap = snapshotOf({
			tickets: [ticket],
			activeRun: { runId: 'run-7', phase: 'P7', ticketId: 'TCK-002' }
		});
		render(Chat, ticketProps({ snapshot: snap, live: liveText }));
		expect(screen.queryByText('Looking at REQ-001')).toBeNull();
		expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-busy')).toBe('true');
	});

	it('shows no live text of a phase run that belongs to this ticket', () => {
		const snap = snapshotOf({
			tickets: [ticket],
			activeRun: { runId: 'run-7', phase: 'P2', ticketId: 'TCK-001' }
		});
		render(Chat, ticketProps({ snapshot: snap, live: { ...liveText, phase: 'P2' } }));
		expect(screen.queryByText('Looking at REQ-001')).toBeNull();
	});

	it('shows only the errors of ticketSend', async () => {
		const { rerender } = render(Chat, ticketProps());
		await rerender(
			ticketProps({ form: { action: 'ticketSend', message: 'The ticket is closed.' } })
		);
		expect(screen.getByRole('alert').textContent).toContain('The ticket is closed.');
		await rerender(ticketProps({ form: { action: 'send', message: 'A phase error.' } }));
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('does not show a ticketSend error that was there when the ticket chat opened', async () => {
		const old = { action: 'ticketSend', message: 'Belongs to another ticket.' };
		const { rerender } = render(Chat, ticketProps({ form: old }));
		expect(screen.queryByRole('alert')).toBeNull();
		await rerender(ticketProps({ form: { ...old, message: 'A new failure.' } }));
		expect(screen.getByRole('alert').textContent).toContain('A new failure.');
	});

	it('shows a user message as typed and an agent message with raw HTML as text', () => {
		const evil = '<img src=x onerror=alert(1)>';
		const hostile = ticketOf({
			id: 'TCK-001',
			chat: [
				{ role: 'user', text: `${evil} **raw**`, at },
				{ role: 'assistant', text: `<b>bold</b> ${evil}`, at }
			]
		});
		const { container } = render(Chat, ticketProps({ ticket: hostile }));
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('b')).toBeNull();
		expect(screen.getByText(`${evil} **raw**`)).toBeTruthy();
		expect(screen.getByText(`<b>bold</b> ${evil}`)).toBeTruthy();
	});

	it('Retry of a failed ticket run sends the last message again with ticketSend', () => {
		const snap = snapshotOf({
			tickets: [ticket],
			lastRun: { id: 'r1', phase: 'P7', ticketId: 'TCK-001', status: 'failed', error: 'boom' }
		});
		render(Chat, ticketProps({ snapshot: snap }));
		const retry = screen.getByRole('button', { name: 'Retry' });
		const form = retry.closest('form')!;
		expect(form.getAttribute('action')).toBe('?/ticketSend');
		const sent = captureSubmit(form);
		retry.click();
		expect(sent()).toEqual({ ticketId: 'TCK-001', text: 'Tasks need a due date' });
	});

	it('a failed report run offers no Retry: Close ticket starts it again', () => {
		const snap = snapshotOf({
			tickets: [ticket],
			lastRun: {
				id: 'r1',
				phase: 'P7',
				ticketId: 'TCK-001',
				status: 'failed',
				error: 'boom',
				report: true
			}
		});
		render(Chat, ticketProps({ snapshot: snap }));
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
		expect(screen.getByText(/Press Close ticket again/)).toBeTruthy();
	});

	it('ignores a failed run of another ticket', () => {
		const snap = snapshotOf({
			tickets: [ticket],
			lastRun: { id: 'r1', phase: 'P7', ticketId: 'TCK-002', status: 'failed', error: 'boom' }
		});
		render(Chat, ticketProps({ snapshot: snap }));
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
	});

	it.each(['done', 'rejected'] as const)('a %s ticket has no composer', (status) => {
		render(Chat, ticketProps({ ticket: { ...ticket, status } }));
		expect(screen.queryByRole('textbox')).toBeNull();
		expect(screen.getByText(/ticket is closed/i)).toBeTruthy();
		expect(screen.getByText('Which tasks?')).toBeTruthy();
	});
});

describe('Chat Retry of an entry run', () => {
	const at = '2026-11-22T10:00:00.000Z';
	const failed = (text: string, auto: boolean, status = 'in_progress') =>
		snapshotOf({
			state: { phases: { P1: { status: 'approved' }, P2: { status: 'awaiting_approval' } } },
			chat: { P1: [], P2: [{ role: 'user', text, at, runId: 'r1', auto }], P4: [], P5: [] },
			lastRun: { id: 'r1', phase: 'P2', ticketId: 'TCK-001', status: 'failed', error: 'boom' },
			tickets: [ticketOf({ status: status as 'in_progress' })]
		});
	const props = (snapshot: ProjectSnapshot) => ({
		snapshot,
		phase: 'P2' as const,
		live: null,
		form: null
	});

	it('offers no Retry when the failed run started from an approved plan; the ticket starts it again', () => {
		render(Chat, props(failed('Plan of TCK-001 approved.', true)));
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
		expect(screen.getByText(/Start the entry run again/)).toBeTruthy();
	});

	it('says to press Approve plan when a discard put the ticket back to triaged', () => {
		render(Chat, props(failed('Plan of TCK-001 approved.', true, 'triaged')));
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
		expect(screen.getByText(/press Approve plan/)).toBeTruthy();
		expect(screen.queryByText(/Start the entry run again/)).toBeNull();
	});

	it('keeps Retry for a message the developer typed', () => {
		render(Chat, props(failed('Plan of TCK-001 approved.', false)));
		expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
	});
});

describe('Chat Retry of a Tests tab run', () => {
	const at = '2026-11-26T10:00:00.000Z';
	const failed = (text: string, run: Record<string, unknown>) =>
		snapshotOf({
			state: { phases: { P1: { status: 'approved' }, P4: { status: 'approved' } } },
			chat: { P1: [], P2: [], P4: [], P5: [{ role: 'user', text, at, runId: 'r1', auto: true }] },
			lastRun: { id: 'r1', phase: 'P5', status: 'failed', error: 'boom', ...run }
		});
	const p5 = (snapshot: ProjectSnapshot) => ({
		snapshot,
		phase: 'P5' as const,
		live: null,
		form: null
	});

	it.each([
		[
			'a fix loop',
			'Fix the failing tests: the test agent and the code agent work through them together.',
			{ agent: 'test', fixLoop: true },
			/Press Fix automatically in the Tests tab/
		],
		[
			'an Apply fix run',
			'Apply the fix for "REQ-001 AC2: empty title" (F-1).',
			{ agent: 'code' },
			/Press Apply fix in the Tests tab/
		],
		[
			'an Explain failures run',
			'Explain the failing tests.',
			{ agent: 'test' },
			/Press Explain failures in the Tests tab/
		]
	])('offers no Retry after %s: its brief is not in the chat line', (_, text, run, hint) => {
		render(Chat, p5(failed(text, run)));
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
		expect(screen.getByText(hint)).toBeTruthy();
		expect(screen.queryByText(/Retry sends your last message again/)).toBeNull();
	});

	it('points a fix loop that left typecheck errors or drift at the Code tab and the P4 gate', () => {
		const snap = failed(
			'Fix the failing tests: the test agent and the code agent work through them together.',
			{
				agent: 'test',
				fixLoop: true,
				error: 'The fix loop left the code with typecheck errors or drift'
			}
		);
		render(Chat, p5(snap));
		expect(screen.getByText(/Code tab/)).toBeTruthy();
		expect(screen.getByText(/P4 gate/)).toBeTruthy();
		expect(screen.queryByText(/Press Fix automatically/)).toBeNull();
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
	});

	it('points a fix loop that left broken test files at the Tests tab and the P5 chat', () => {
		const snap = failed(
			'Fix the failing tests: the test agent and the code agent work through them together.',
			{
				agent: 'test',
				fixLoop: true,
				error: 'The fix loop left test files that no longer load or type check'
			}
		);
		render(Chat, p5(snap));
		expect(screen.getByText(/Check them in the Tests tab or the P5 chat/)).toBeTruthy();
		expect(screen.queryByText(/Fix automatically/)).toBeNull();
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
	});

	it('keeps Retry for a failed P5 chat run', () => {
		const snap = failed('Add a test for an empty list', { agent: 'test' });
		snap.chat.P5[0]!.auto = undefined;
		render(Chat, p5(snap));
		expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
	});
});

describe('Chat agent handoffs', () => {
	const at = '2026-11-26T10:00:00.000Z';
	const withEntries = (chat: unknown[]) =>
		snapshotOf({
			state: { phases: { P1: { status: 'approved' }, P4: { status: 'approved' } } },
			chat: { P1: [], P2: [], P4: [], P5: chat }
		});
	const p5 = (snap: ProjectSnapshot, live: unknown = null) => ({
		snapshot: snap,
		phase: 'P5' as const,
		live: live as never,
		form: null
	});

	// The header as it shows: the arrow is decoration, " to " is for screen readers only.
	const headers = () =>
		[...document.querySelectorAll('.who')].map((el) => {
			const copy = el.cloneNode(true) as HTMLElement;
			copy.querySelectorAll('.aise-sr-only').forEach((n) => n.remove());
			return copy.textContent?.replace(/\s+/g, ' ').trim();
		});

	it('titles a stored handoff with both agents instead of Automatic request', () => {
		render(
			Chat,
			p5(
				withEntries([
					{
						role: 'user',
						text: 'Please fix F-1',
						at,
						runId: 'r1',
						auto: true,
						from: 'test',
						to: 'code'
					},
					{
						role: 'user',
						text: 'Round 1: 3 passed',
						at,
						runId: 'r1',
						auto: true,
						from: 'checks',
						to: 'test'
					}
				])
			)
		);
		expect(headers()).toEqual(['Test agent \u2192 Code agent', 'Checks \u2192 Test agent']);
		expect(screen.getByText('Please fix F-1')).toBeTruthy();
		expect(screen.queryByText('Automatic request')).toBeNull();
	});

	it('reads the handoff header as "to" for a screen reader and hides the arrow', () => {
		render(
			Chat,
			p5(
				withEntries([
					{ role: 'user', text: 'x', at, runId: 'r1', auto: true, from: 'test', to: 'code' }
				])
			)
		);
		const who = document.querySelector('.who')!;
		expect(who.textContent?.replace(/\s+/g, ' ').trim()).toBe('Test agent \u2192 to Code agent');
		expect(who.querySelector('[aria-hidden="true"]')?.textContent).toBe('\u2192');
	});

	it('marks the handoff of a discarded run and keeps it visible', () => {
		const snap = {
			...withEntries([
				{
					role: 'user',
					text: 'Please fix F-1',
					at,
					runId: 'r1',
					auto: true,
					from: 'test',
					to: 'code'
				}
			]),
			discardedRunIds: ['r1']
		} as ProjectSnapshot;
		render(Chat, p5(snap));
		expect(screen.getByText(/run discarded/)).toBeTruthy();
		expect(screen.getByText('Please fix F-1')).toBeTruthy();
		expect(headers()[0]).toContain('Test agent \u2192 Code agent');
	});

	it('falls back to the normal bubble when an entry has only from', () => {
		render(
			Chat,
			p5(withEntries([{ role: 'user', text: 'plan', at, runId: 'r1', auto: true, from: 'test' }]))
		);
		expect(screen.getByText('Automatic request')).toBeTruthy();
		expect(document.querySelector('.handoff')).toBeNull();
	});

	it('keeps Automatic request for an auto entry without from and to', () => {
		render(Chat, p5(withEntries([{ role: 'user', text: 'plan', at, runId: 'r1', auto: true }])));
		expect(screen.getByText('Automatic request')).toBeTruthy();
	});

	it('shows a handoff once when the snapshot chat already holds the live message', () => {
		const snap = snapshotOf({
			state: { phases: { P1: { status: 'approved' }, P4: { status: 'approved' } } },
			chat: {
				P1: [],
				P2: [],
				P4: [],
				P5: [
					{
						role: 'assistant',
						text: 'F-1 fixed',
						at,
						runId: 'run-9',
						auto: true,
						from: 'code',
						to: 'test',
						seq: 2
					}
				]
			},
			activeRun: { runId: 'run-9', phase: 'P5' }
		});
		render(
			Chat,
			p5(snap, {
				runId: 'run-9',
				phase: 'P5',
				items: [
					{ kind: 'message', from: 'code', to: 'test', text: 'F-1 fixed', seq: 2 },
					{
						kind: 'message',
						from: 'checks',
						to: 'test',
						text: 'Round 1: 3 passed, 0 failed',
						seq: 3
					}
				]
			})
		);
		expect(screen.getAllByText('F-1 fixed')).toHaveLength(1);
		expect(screen.getByText('Round 1: 3 passed, 0 failed')).toBeTruthy();
	});

	it('keeps a live handoff with the same text as a stored one from an earlier round', () => {
		const entry = (runId: string, seq: number) => ({
			role: 'assistant',
			text: 'Please fix F-1',
			at,
			runId,
			auto: true,
			from: 'test',
			to: 'code',
			seq
		});
		const snap = snapshotOf({
			state: { phases: { P1: { status: 'approved' }, P4: { status: 'approved' } } },
			chat: { P1: [], P2: [], P4: [], P5: [entry('run-8', 1), entry('run-9', 3)] },
			activeRun: { runId: 'run-9', phase: 'P5' }
		});
		const message = (seq: number) => ({
			kind: 'message',
			from: 'test',
			to: 'code',
			text: 'Please fix F-1',
			seq
		});
		// Heard live: round 2's handoff (stored, seq 3) and round 3's with the same text (seq 6).
		render(Chat, p5(snap, { runId: 'run-9', phase: 'P5', items: [message(3), message(6)] }));
		// Stored: run-8 and run-9 once each. Live: seq 3 is the stored one, seq 6 is new.
		expect(screen.getAllByText('Please fix F-1')).toHaveLength(3);
	});

	it('shows a live handoff a reloaded chat does not hold yet, even with the text of a stored one', () => {
		const snap = snapshotOf({
			state: { phases: { P1: { status: 'approved' }, P4: { status: 'approved' } } },
			chat: {
				P1: [],
				P2: [],
				P4: [],
				P5: [
					{
						role: 'assistant',
						text: 'Please fix F-1',
						at,
						runId: 'run-9',
						auto: true,
						from: 'test',
						to: 'code',
						seq: 1
					}
				]
			},
			activeRun: { runId: 'run-9', phase: 'P5' }
		});
		const retry = { kind: 'message', from: 'test', to: 'code', text: 'Please fix F-1', seq: 4 };
		render(Chat, p5(snap, { runId: 'run-9', phase: 'P5', items: [retry] }));
		expect(screen.getAllByText('Please fix F-1')).toHaveLength(2);
	});

	it('shows a live agent message between two agents, not as tool output', () => {
		const snap = snapshotOf({
			state: { phases: { P1: { status: 'approved' }, P4: { status: 'approved' } } },
			chat: { P1: [], P2: [], P4: [], P5: [] },
			activeRun: { runId: 'run-9', phase: 'P5' }
		});
		render(
			Chat,
			p5(snap, {
				runId: 'run-9',
				phase: 'P5',
				items: [{ kind: 'message', from: 'code', to: 'test', text: 'F-1 fixed', seq: 1 }]
			})
		);
		expect(headers()).toEqual(['Code agent \u2192 Test agent']);
		expect(screen.getByText('F-1 fixed')).toBeTruthy();
	});
});
