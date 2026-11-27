import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { WIRING_ROW } from '#lib/live-run.ts';
import CodegenProgress from './CodegenProgress.svelte';

describe('CodegenProgress', () => {
	it('shows one row per file with its state', () => {
		render(CodegenProgress, {
			files: { 'src/tasks/Task.ts': 'retrying', 'src/tasks/TaskList.ts': 'ok' }
		});
		const rows = screen.getAllByRole('listitem');
		expect(rows).toHaveLength(2);
		expect(within(rows[0]).getByText('src/tasks/Task.ts')).toBeTruthy();
		expect(within(rows[0]).getByText('retrying (attempt 2)')).toBeTruthy();
		expect(within(rows[1]).getByText('ok')).toBeTruthy();
	});

	it('names the escalation to the stronger model', () => {
		render(CodegenProgress, { files: { 'src/A.ts': 'escalated' } });
		expect(screen.getByText('escalated (attempt 3)')).toBeTruthy();
	});

	it('shows the wiring row from its own entry and counts only class files', () => {
		render(CodegenProgress, {
			files: { 'src/A.ts': 'ok', 'src/B.ts': 'writing', [WIRING_ROW]: 'planned' }
		});
		const wiring = screen.getByText(/Wiring/).closest('li')!;
		expect(within(wiring).getByText('planned')).toBeTruthy();
		expect(screen.getByText(/1 of 2/)).toBeTruthy();
		expect(screen.getAllByRole('listitem')).toHaveLength(3);
	});

	it('follows the wiring entry and never claims a state it did not get', () => {
		const { rerender } = render(CodegenProgress, {
			files: { 'src/A.ts': 'ok', [WIRING_ROW]: 'writing' }
		});
		const state = () => within(screen.getByText(/Wiring/).closest('li')!);
		expect(state().getByText('writing')).toBeTruthy();
		void rerender({ files: { 'src/A.ts': 'ok', [WIRING_ROW]: 'failed' } });
		expect(state().getByText('failed')).toBeTruthy();
	});

	it('has no wiring row until the pipeline reports one, even when every file is settled', () => {
		render(CodegenProgress, { files: { 'src/A.ts': 'ok', 'src/B.ts': 'failed' } });
		expect(screen.queryByText(/Wiring/)).toBeNull();
	});

	it('says what is happening before the first file is planned', () => {
		render(CodegenProgress, { files: {} });
		expect(screen.getByText(/Planning the files/)).toBeTruthy();
	});
});
