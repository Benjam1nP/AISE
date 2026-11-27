import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import GenerateCode from './GenerateCode.svelte';
import { snapshotOf } from './fixtures.ts';

const approvedDesign = {
	phases: { P1: { status: 'approved' }, P2: { status: 'approved' }, P4: { status: 'not_started' } }
};

describe('GenerateCode', () => {
	it('offers Generate code that submits the generate action when there is no code', () => {
		render(GenerateCode, {
			snapshot: snapshotOf({ state: approvedDesign }),
			form: null
		});
		const button = screen.getByRole('button', { name: 'Generate code' });
		expect(button.closest('form')?.getAttribute('action')).toBe('?/generate');
	});

	it('still offers Generate code when only the scaffold exists, as the server does', () => {
		render(GenerateCode, {
			snapshot: snapshotOf({ state: approvedDesign, files: ['package.json', 'tsconfig.json'] }),
			form: null
		});
		expect(screen.getByRole('button', { name: 'Generate code' })).toBeTruthy();
	});

	it('is gone once code exists', () => {
		render(GenerateCode, {
			snapshot: snapshotOf({ state: approvedDesign, files: ['src/A.ts'] }),
			form: null
		});
		expect(screen.queryByRole('button', { name: 'Generate code' })).toBeNull();
	});

	it('is gone while a run is active', () => {
		render(GenerateCode, {
			snapshot: snapshotOf({ state: approvedDesign, activeRun: { runId: 'r', phase: 'P4' } }),
			form: null
		});
		expect(screen.queryByRole('button', { name: 'Generate code' })).toBeNull();
	});

	it('asks for the design approval first and keeps the button', () => {
		render(GenerateCode, { snapshot: snapshotOf(), form: null });
		expect(screen.getByText(/Approve the design first/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Generate code' })).toBeTruthy();
	});

	it('shows a rejected generate as an error next to the button', () => {
		render(GenerateCode, {
			snapshot: snapshotOf({ state: approvedDesign }),
			form: { action: 'generate', message: 'The design has issues.' }
		});
		expect(screen.getByRole('alert').textContent).toContain('The design has issues.');
	});
});
