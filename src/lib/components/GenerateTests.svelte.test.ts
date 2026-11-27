import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { snapshotOf } from './fixtures.ts';
import GenerateTests from './GenerateTests.svelte';

const approved = {
	phases: {
		P1: { status: 'approved' },
		P2: { status: 'approved' },
		P4: { status: 'approved' },
		P5: { status: 'not_started' }
	}
};

describe('GenerateTests', () => {
	it('offers Generate tests that submits generateTests when there are no tests', () => {
		render(GenerateTests, {
			snapshot: snapshotOf({ state: approved, files: ['src/A.ts'] }),
			form: null
		});
		const button = screen.getByRole('button', { name: 'Generate tests' });
		expect(button.closest('form')?.getAttribute('action')).toBe('?/generateTests');
	});

	it('is gone once a file exists under test/', () => {
		render(GenerateTests, {
			snapshot: snapshotOf({ state: approved, files: ['src/A.ts', 'test/UC-001.test.ts'] }),
			form: null
		});
		expect(screen.queryByRole('button', { name: 'Generate tests' })).toBeNull();
	});

	it('is gone while a run is active', () => {
		render(GenerateTests, {
			snapshot: snapshotOf({ state: approved, activeRun: { runId: 'r', phase: 'P5' } }),
			form: null
		});
		expect(screen.queryByRole('button', { name: 'Generate tests' })).toBeNull();
	});

	it('asks for the code approval first and keeps the button', () => {
		render(GenerateTests, { snapshot: snapshotOf(), form: null });
		expect(screen.getByText(/Approve the code first/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Generate tests' })).toBeTruthy();
	});

	it('shows a rejected generate as an error next to the button', () => {
		render(GenerateTests, {
			snapshot: snapshotOf({ state: approved }),
			form: { action: 'generateTests', message: 'Approve P4 before generating tests' }
		});
		expect(screen.getByRole('alert').textContent).toContain('Approve P4');
	});
});
