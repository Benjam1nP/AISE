import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { snapshotOf } from './fixtures.ts';
import GenerateDeployment from './GenerateDeployment.svelte';

const approved = {
	phases: {
		P1: { status: 'approved' },
		P2: { status: 'approved' },
		P4: { status: 'approved' },
		P5: { status: 'approved' },
		P6: { status: 'not_started' }
	}
};

describe('GenerateDeployment', () => {
	it('offers Generate deployment that submits generateDeployment when there are no deploy files', () => {
		render(GenerateDeployment, {
			snapshot: snapshotOf({ state: approved, files: ['src/A.ts', 'package.json'] }),
			form: null
		});
		const button = screen.getByRole('button', { name: 'Generate deployment' });
		expect(button.closest('form')?.getAttribute('action')).toBe('?/generateDeployment');
		expect(screen.queryByText(/Approve the tests first/)).toBeNull();
	});

	it('is gone once a deploy file exists', () => {
		render(GenerateDeployment, {
			snapshot: snapshotOf({ state: approved, files: ['src/A.ts', 'compose.yaml'] }),
			form: null
		});
		expect(screen.queryByRole('button', { name: 'Generate deployment' })).toBeNull();
	});

	it('is gone while a run is active', () => {
		render(GenerateDeployment, {
			snapshot: snapshotOf({ state: approved, activeRun: { runId: 'r', phase: 'P6' } }),
			form: null
		});
		expect(screen.queryByRole('button', { name: 'Generate deployment' })).toBeNull();
	});

	it('asks for the test approval first and keeps the button', () => {
		render(GenerateDeployment, { snapshot: snapshotOf(), form: null });
		expect(screen.getByText(/Approve the tests first/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Generate deployment' })).toBeTruthy();
	});

	it('shows a rejected generate as an error next to the button', () => {
		render(GenerateDeployment, {
			snapshot: snapshotOf({ state: approved }),
			form: { action: 'generateDeployment', message: 'Approve P5 before generating' }
		});
		expect(screen.getByRole('alert').textContent).toContain('Approve P5');
	});
});
