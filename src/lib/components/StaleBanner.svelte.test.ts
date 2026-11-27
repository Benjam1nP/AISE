import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import StaleBanner from './StaleBanner.svelte';

describe('StaleBanner', () => {
	it('lists the changed IDs with Update and Still valid', () => {
		render(StaleBanner, {
			ids: ['REQ-002', 'REQ-005'],
			failing: [],
			running: false,
			upstreamApproved: true,
			onshowupstream: () => {},
			form: null
		});
		expect(screen.getByText('REQ-002')).toBeTruthy();
		expect(screen.getByText('REQ-005')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Update design' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Still valid' })).toBeTruthy();
	});

	it('shows the failing checks next to Still valid as an explicit override', () => {
		render(StaleBanner, {
			ids: ['REQ-002'],
			failing: [{ label: 'Every must requirement linked', ok: false, detail: 'REQ-002' }],
			running: false,
			upstreamApproved: true,
			onshowupstream: () => {},
			form: null
		});
		expect(screen.getByText(/fails these checks right now/).textContent).toContain(
			'Every must requirement linked (REQ-002)'
		);
		expect(screen.getByRole('button', { name: 'Still valid, override' })).toBeTruthy();
	});

	it('treats a failing advisory check as no override', () => {
		render(StaleBanner, {
			ids: ['REQ-002'],
			failing: [
				{ label: 'Acceptance criteria covered', ok: false, detail: 'not run yet', advisory: true }
			],
			running: false,
			upstreamApproved: true,
			onshowupstream: () => {},
			form: null
		});
		expect(screen.queryByText(/fails these checks right now/)).toBeNull();
		expect(screen.getByRole('button', { name: 'Still valid' })).toBeTruthy();
	});

	it('shows a rejected action as an error banner', () => {
		render(StaleBanner, {
			ids: ['REQ-002'],
			failing: [],
			running: false,
			upstreamApproved: true,
			onshowupstream: () => {},
			form: { action: 'stillValid', message: 'P2 is not stale.' }
		});
		expect(screen.getByRole('alert').textContent).toContain('P2 is not stale.');
	});

	it('says to approve the requirements first when they are not approved', () => {
		render(StaleBanner, {
			ids: ['REQ-002'],
			failing: [],
			running: false,
			upstreamApproved: false,
			onshowupstream: () => {},
			form: null
		});
		expect(
			screen.getByText(/Approve the requirements first, then choose Update or Still valid/)
		).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Update design' }).hasAttribute('disabled')).toBe(
			false
		);
		expect(screen.getByRole('button', { name: 'Still valid' }).hasAttribute('disabled')).toBe(
			false
		);
	});

	it('offers a way to the requirements approval when the server rejects the action', async () => {
		const show = vi.fn();
		render(StaleBanner, {
			ids: ['REQ-002'],
			failing: [],
			running: false,
			upstreamApproved: false,
			onshowupstream: show,
			form: { action: 'stillValid', message: 'Approve P1 before confirming P2.' }
		});
		await userEvent.click(screen.getByRole('button', { name: 'Go to requirements approval' }));
		expect(show).toHaveBeenCalledOnce();
	});

	it('shows no requirements hint when they are approved', () => {
		render(StaleBanner, {
			ids: ['REQ-002'],
			failing: [],
			running: false,
			upstreamApproved: true,
			onshowupstream: () => {},
			form: { action: 'update', message: 'Another action is running.' }
		});
		expect(screen.queryByText(/Approve the requirements first/)).toBeNull();
		expect(screen.queryByRole('button', { name: 'Go to requirements approval' })).toBeNull();
	});
});

describe('StaleBanner for P4', () => {
	const props = {
		phase: 'P4' as const,
		ids: ['DSN-002', 'DSN-007'],
		failing: [],
		running: false,
		upstreamApproved: true,
		onshowupstream: () => {},
		form: null
	};

	it('lists the changed design IDs with Update code and Still valid', () => {
		render(StaleBanner, props);
		expect(screen.getByText('DSN-002')).toBeTruthy();
		expect(screen.getByText('DSN-007')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Update code' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Still valid' })).toBeTruthy();
	});

	it('submits both actions with phase P4', () => {
		render(StaleBanner, props);
		for (const name of ['Update code', 'Still valid']) {
			const form = screen.getByRole('button', { name }).closest('form')!;
			expect(form.querySelector<HTMLInputElement>('input[name="phase"]')?.value).toBe('P4');
		}
	});

	it('says to approve the design first when it is not approved', () => {
		render(StaleBanner, { ...props, upstreamApproved: false });
		expect(screen.getByText(/Approve the design first/)).toBeTruthy();
	});
});

describe('StaleBanner for P5', () => {
	const props = {
		phase: 'P5' as const,
		ids: ['REQ-002', 'UC-001', 'SEQ-003'],
		failing: [],
		running: false,
		upstreamApproved: true,
		onshowupstream: () => {},
		form: null
	};

	it('lists the changed REQ, UC and SEQ IDs with Update tests and Still valid', () => {
		render(StaleBanner, props);
		for (const id of props.ids) expect(screen.getByText(id)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Update tests' })).toBeTruthy();
		expect(screen.getByText(/requirements or design changed/)).toBeTruthy();
	});

	it('submits both actions with phase P5', () => {
		render(StaleBanner, props);
		for (const name of ['Update tests', 'Still valid']) {
			const form = screen.getByRole('button', { name }).closest('form')!;
			expect(form.querySelector<HTMLInputElement>('input[name="phase"]')?.value).toBe('P5');
		}
	});

	it('says to approve the code first when it is not approved', () => {
		render(StaleBanner, { ...props, upstreamApproved: false });
		expect(screen.getByText(/Approve the code first/)).toBeTruthy();
	});
});

describe('StaleBanner for P6', () => {
	const props = {
		phase: 'P6' as const,
		ids: ['DSN-004', 'dependencies'],
		failing: [],
		running: false,
		upstreamApproved: true,
		onshowupstream: () => {},
		form: null
	};

	it('lists the changed service IDs with Update deployment and Still valid', () => {
		render(StaleBanner, props);
		for (const id of props.ids) expect(screen.getByText(id)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Update deployment' })).toBeTruthy();
		expect(screen.getByText(/start scripts, dependencies or code changed/)).toBeTruthy();
	});

	it('submits both actions with phase P6', () => {
		render(StaleBanner, props);
		for (const name of ['Update deployment', 'Still valid']) {
			const form = screen.getByRole('button', { name }).closest('form')!;
			expect(form.querySelector<HTMLInputElement>('input[name="phase"]')?.value).toBe('P6');
		}
	});

	it('says to approve the tests first when they are not approved', () => {
		render(StaleBanner, { ...props, upstreamApproved: false });
		expect(screen.getByText(/Approve the tests first/)).toBeTruthy();
	});
});
