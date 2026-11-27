import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DiagramsPanel from './DiagramsPanel.svelte';
import { NAMES, REQ_TRACE } from './trace-fixture.ts';

// Mermaid does not draw in jsdom; the panel's own behaviour is what is tested here.
vi.mock('mermaid', () => ({ default: undefined }));

const diagrams = {
	useCase: 'flowchart LR',
	class: 'classDiagram',
	deployment: 'flowchart TB',
	sequences: [
		{ id: 'SEQ-001', name: 'Add', mermaid: 'sequenceDiagram' },
		{ id: 'SEQ-002', name: 'List', mermaid: 'sequenceDiagram' }
	]
};
const UC_TRACE = { ...REQ_TRACE, id: 'UC-001', kind: 'useCase' as const };
const traces = { 'UC-001': UC_TRACE, 'SEQ-002': { ...REQ_TRACE, id: 'SEQ-002' } };

const setup = (over: Record<string, unknown> = {}) => {
	const oninsert = vi.fn();
	const onopenid = vi.fn();
	const result = render(DiagramsPanel, {
		diagrams,
		oninsert,
		traces,
		names: NAMES,
		onopenid,
		...over
	});
	return { oninsert, onopenid, ...result };
};
const aiseSelect = (id: string) =>
	(window as Window & { aiseSelect?: (id: string) => void }).aiseSelect?.(id);

describe('DiagramsPanel', () => {
	it('opens on the diagram of the focused element and shows its trace', () => {
		setup({ focus: { id: 'UC-001', kind: 'useCase' } });
		expect(screen.getByRole('tab', { name: 'Use case', selected: true })).toBeTruthy();
		expect(screen.getByLabelText('Selected UC-001')).toBeTruthy();
	});

	it('picks the sequence diagram a sequence link names', () => {
		setup({ focus: { id: 'SEQ-002', kind: 'sequence', seqId: 'SEQ-002' } });
		expect(screen.getByRole('tab', { name: 'Sequence', selected: true })).toBeTruthy();
		expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('SEQ-002');
	});

	it('a click on an element still writes its ID into the chat, and shows its trace', async () => {
		const { oninsert, onopenid } = setup();
		expect(screen.queryByLabelText(/^Selected/)).toBeNull();
		aiseSelect('UC-001');
		expect(oninsert).toHaveBeenCalledWith('UC-001 ');
		const card = await screen.findByLabelText('Selected UC-001');
		await userEvent.click(screen.getByRole('button', { name: 'DSN-001 TaskService' }));
		expect(onopenid).toHaveBeenCalledWith('DSN-001');
		await userEvent.click(screen.getByRole('button', { name: 'Close the trace' }));
		expect(card.isConnected).toBe(false);
	});

	it('shows no trace for an element the traces do not have yet', () => {
		setup({ focus: { id: 'DSN-001', kind: 'class' } });
		expect(screen.getByRole('tab', { name: 'Class', selected: true })).toBeTruthy();
		expect(screen.queryByLabelText(/^Selected/)).toBeNull();
	});
});
