import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshotOf } from './fixtures.ts';
import RequirementsPanel from './RequirementsPanel.svelte';
import { NAMES, REQ_TRACE } from './trace-fixture.ts';

// Stands in for SvelteKit's enhance: records the posted form and reports success.
const posted: FormData[] = [];
const outcome = vi.hoisted(() => ({
	result: { type: 'success', status: 200 } as Record<string, unknown>
}));
vi.mock('$app/forms', () => ({
	enhance: (
		form: HTMLFormElement,
		submit: (input: unknown) => (r: unknown) => Promise<void> | undefined
	) => {
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			posted.push(new FormData(form));
			void submit({ formData: new FormData(form), cancel: () => {} })?.({
				result: outcome.result,
				update: async () => {}
			});
		});
	}
}));

const doc = {
	requirements: [
		{
			id: 'REQ-001',
			title: 'Add a task',
			text: 'The user can add a task.',
			type: 'functional',
			priority: 'must',
			acceptanceCriteria: ['A task appears in the list']
		},
		{
			id: 'REQ-002',
			title: 'Fast list',
			text: 'The list loads quickly.',
			type: 'non-functional',
			priority: 'should',
			acceptanceCriteria: ['Loads under 1 s', 'Works offline']
		}
	],
	openQuestions: [{ id: 'Q-001', text: 'Which platform?', reqIds: ['REQ-001'] }],
	assumptions: ['One user'],
	outOfScope: ['Sharing']
};
const snapshot = (over: Record<string, unknown> = {}) => snapshotOf({ requirements: doc, ...over });
const lastDoc = () => JSON.parse(posted.at(-1)!.get('doc') as string);

beforeEach(() => {
	posted.length = 0;
	outcome.result = { type: 'success', status: 200 };
});

describe('RequirementsPanel', () => {
	it('lists requirements, open questions, assumptions and out of scope', () => {
		render(RequirementsPanel, { snapshot: snapshot() });
		expect(screen.getByText('REQ-002')).toBeTruthy();
		expect(screen.getByText('Fast list')).toBeTruthy();
		expect(screen.getByText('Which platform?')).toBeTruthy();
		expect(screen.getByText('One user')).toBeTruthy();
		expect(screen.getByText('Sharing')).toBeTruthy();
	});

	it('marks requirements that changed since the design was approved', () => {
		render(RequirementsPanel, { snapshot: snapshot({ staleReqIds: ['REQ-002'] }) });
		expect(screen.getAllByText('Changed since the design was approved')).toHaveLength(1);
	});

	it('posts the whole document with the edited requirement', async () => {
		render(RequirementsPanel, { snapshot: snapshot() });
		await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
		const title = screen.getByLabelText('Title');
		await userEvent.clear(title);
		await userEvent.type(title, 'Quick list');
		await userEvent.selectOptions(screen.getByLabelText('Priority'), 'must');
		const criteria = screen.getByLabelText('Acceptance criteria');
		await userEvent.clear(criteria);
		await userEvent.type(criteria, 'Loads under 500 ms{Enter}Shows a spinner');
		await userEvent.click(screen.getByRole('button', { name: 'Save' }));

		const sent = lastDoc();
		expect(sent.requirements).toHaveLength(2);
		expect(sent.requirements[0].id).toBe('REQ-001');
		expect(sent.requirements[1]).toEqual({
			id: 'REQ-002',
			title: 'Quick list',
			text: 'The list loads quickly.',
			type: 'non-functional',
			priority: 'must',
			acceptanceCriteria: ['Loads under 500 ms', 'Shows a spinner']
		});
		expect(sent.openQuestions).toEqual(doc.openQuestions);
		expect(sent.outOfScope).toEqual(['Sharing']);
	});

	it('adds a requirement with the next ID', async () => {
		render(RequirementsPanel, { snapshot: snapshot() });
		await userEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
		await userEvent.type(screen.getByLabelText('Title'), 'Delete a task');
		await userEvent.type(screen.getByLabelText('Requirement'), 'The user can delete a task.');
		await userEvent.type(screen.getByLabelText('Acceptance criteria'), 'The task is gone');
		await userEvent.click(screen.getByRole('button', { name: 'Save' }));
		const sent = lastDoc();
		expect(sent.requirements.map((r: { id: string }) => r.id)).toEqual([
			'REQ-001',
			'REQ-002',
			'REQ-003'
		]);
		expect(sent.requirements[2].title).toBe('Delete a task');
	});

	it('renders repeated criteria, assumptions and out of scope lines (I1)', () => {
		const repeated = structuredClone(doc);
		repeated.requirements[1].acceptanceCriteria = ['Loads under 1 s', 'Loads under 1 s'];
		repeated.assumptions = ['One user', 'One user'];
		repeated.outOfScope = ['Sharing', 'Sharing'];
		render(RequirementsPanel, { snapshot: snapshot({ requirements: repeated }) });
		expect(screen.getAllByText('Loads under 1 s')).toHaveLength(2);
		expect(screen.getAllByText('One user')).toHaveLength(2);
		expect(screen.getAllByText('Sharing')).toHaveLength(2);
	});

	it('asks before removing a requirement and keeps it on "Keep it"', async () => {
		render(RequirementsPanel, { snapshot: snapshot() });
		await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
		await userEvent.click(screen.getByRole('button', { name: 'Remove requirement' }));
		const dialog = screen.getByRole('dialog');
		expect(dialog.textContent).toContain('REQ-001');
		expect(dialog.textContent).toContain('Add a task');
		await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
		expect(posted).toHaveLength(0);
	});

	it('removes a requirement after confirming and unlinks it from open questions', async () => {
		render(RequirementsPanel, { snapshot: snapshot() });
		await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
		await userEvent.click(screen.getByRole('button', { name: 'Remove requirement' }));
		await userEvent.click(screen.getByRole('button', { name: 'Remove REQ-001' }));
		const sent = lastDoc();
		expect(sent.requirements.map((r: { id: string }) => r.id)).toEqual(['REQ-002']);
		expect(sent.openQuestions).toEqual([{ id: 'Q-001', text: 'Which platform?', reqIds: [] }]);
	});

	it('keeps Save enabled, shows each missing field and posts nothing', async () => {
		render(RequirementsPanel, { snapshot: snapshot() });
		await userEvent.click(screen.getByRole('button', { name: 'Add requirement' }));
		await userEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(posted).toHaveLength(0);
		expect(screen.getByText('Give the requirement a short title.')).toBeTruthy();
		expect(screen.getByText(/Add at least one acceptance criterion/)).toBeTruthy();
		expect(document.activeElement).toBe(screen.getByLabelText('Title'));
	});

	it('shows a server error next to the field it names', async () => {
		outcome.result = {
			type: 'failure',
			status: 400,
			data: {
				action: 'editRequirements',
				message:
					'requirements.0.acceptanceCriteria: Too small: expected array to have >=1 items. Fix this and try again.'
			}
		};
		render(RequirementsPanel, { snapshot: snapshot() });
		await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
		await userEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(screen.getByText('Add at least one acceptance criterion.')).toBeTruthy();
		expect(screen.queryByText('The requirements were not saved')).toBeNull();
	});

	it('shows other server errors as a banner with the message', async () => {
		outcome.result = {
			type: 'failure',
			status: 409,
			data: { action: 'editRequirements', message: 'The agent is still working on this project.' }
		};
		render(RequirementsPanel, { snapshot: snapshot() });
		await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
		await userEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(screen.getByRole('alert').textContent).toContain('still working');
	});

	it('lists the trace of an opened requirement as links', async () => {
		const onopenid = vi.fn();
		const onopenfile = vi.fn();
		render(RequirementsPanel, {
			snapshot: snapshot(),
			traces: { 'REQ-001': REQ_TRACE },
			names: NAMES,
			onopenid,
			onopenfile
		});
		await userEvent.click(screen.getByText('Add a task'));
		await userEvent.click(screen.getByRole('button', { name: 'UC-001 Add task' }));
		expect(onopenid).toHaveBeenCalledWith('UC-001');
		await userEvent.click(screen.getByRole('button', { name: 'src/tasks/Task.ts:3 Task' }));
		expect(onopenfile).toHaveBeenCalledWith({ path: 'src/tasks/Task.ts', line: 3 });
	});

	it('opens the focused requirement and moves focus to it', async () => {
		const { rerender } = render(RequirementsPanel, { snapshot: snapshot() });
		const row = screen.getByText('Fast list').closest('details')!;
		expect(row.open).toBe(false);
		await rerender({ snapshot: snapshot(), focus: { id: 'REQ-002' } });
		expect(row.open).toBe(true);
		expect(document.activeElement).toBe(row.querySelector('summary'));
		// Closed again by hand, a new link to the same requirement opens it again.
		row.open = false;
		await rerender({ snapshot: snapshot(), focus: { id: 'REQ-002' } });
		expect(row.open).toBe(true);
	});
});
