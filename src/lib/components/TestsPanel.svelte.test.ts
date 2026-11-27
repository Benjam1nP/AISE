import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { snapshotOf, testChecksOf } from './fixtures.ts';
import TestsPanel from './TestsPanel.svelte';

const files = ['src/A.ts', 'test/UC-001.test.ts', 'test/UC-002.test.ts'];
const requirements = {
	requirements: [
		{
			id: 'REQ-001',
			title: 'Tasks',
			text: 't',
			type: 'functional',
			priority: 'must',
			acceptanceCriteria: ['adds a task', 'rejects an empty title', 'manual one']
		}
	]
};
const design = { useCases: [{ id: 'UC-001' }, { id: 'UC-002' }] };

/** P1, P2 and P4 approved: P5 is ready, as the server requires for its actions. */
const ready = (p4 = 'approved') => ({
	phases: {
		P1: { status: 'approved' },
		P2: { status: 'approved' },
		P4: { status: p4 },
		P5: { status: 'awaiting_approval' },
		P6: { status: 'not_started' }
	}
});

function snapshot(over: Record<string, unknown> = {}) {
	return snapshotOf({
		name: 'todo',
		state: ready(),
		files,
		requirements,
		design,
		testChecks: testChecksOf(),
		gates: {
			P5: { passed: false, checks: [{ label: 'All tests pass', ok: false, detail: '1 failed' }] }
		},
		...over
	});
}

function serve(contents: Record<string, string>) {
	const fetchMock = vi.fn(async (url: string) => {
		const path = new URL(url, 'http://x').searchParams.get('path') ?? '';
		return path in contents
			? new Response(contents[path], { status: 200 })
			: new Response('not found', { status: 404 });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('TestsPanel', () => {
	it('shows the results and a Run tests button that submits checkTests', () => {
		render(TestsPanel, { snapshot: snapshot(), form: null, progress: null });
		expect(screen.getByRole('group', { name: 'UC-001 Add task' })).toBeTruthy();
		const run = screen.getByRole('button', { name: 'Run tests' });
		expect(run.closest('form')?.getAttribute('action')).toBe('?/checkTests');
	});

	it('shows the open findings under the results and passes canApply from the run state', () => {
		const finding = {
			id: 'r-1',
			runId: 'r',
			test: 'REQ-001 AC2: rejects an empty title',
			file: 'test/UC-001.test.ts',
			explanation: 'Bug.',
			proposedFix: 'Fix it.'
		};
		const checks = testChecksOf({ findings: [finding] });
		const { unmount } = render(TestsPanel, {
			snapshot: snapshot({ testChecks: checks }),
			form: null,
			progress: null
		});
		expect(screen.getByRole('button', { name: 'Apply fix' }).getAttribute('aria-busy')).toBeNull();
		unmount();
		render(TestsPanel, {
			snapshot: snapshot({ testChecks: checks, activeRun: { runId: 'x', phase: 'P5' } }),
			form: null,
			progress: null
		});
		expect(screen.getByRole('button', { name: 'Apply fix' }).getAttribute('aria-busy')).toBe(
			'true'
		);
	});

	it('disables Apply fix while the results are out of date, with a note that says why', () => {
		const finding = {
			id: 'r-1',
			runId: 'r',
			test: 'REQ-001 AC2: rejects an empty title',
			file: 'test/UC-001.test.ts',
			explanation: 'Bug.',
			proposedFix: 'Fix it.'
		};
		render(TestsPanel, {
			snapshot: snapshot({
				testChecks: testChecksOf({ findings: [finding] }),
				gates: {
					P5: {
						passed: false,
						checks: [{ label: 'All tests pass', ok: false, detail: 'out of date' }]
					}
				}
			}),
			form: null,
			progress: null
		});
		expect(screen.getByRole('button', { name: 'Apply fix' }).getAttribute('aria-busy')).toBe(
			'true'
		);
		expect(screen.getByText(/run the tests again/i)).toBeTruthy();
	});

	it('shows the progress list while a generation run writes the tests', () => {
		render(TestsPanel, {
			snapshot: snapshot({ testChecks: null, activeRun: { runId: 'r', phase: 'P5' } }),
			form: null,
			progress: { 'test/UC-001.test.ts': 'writing' }
		});
		expect(screen.getByRole('list', { name: 'Files being generated' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Run tests' })).toBeNull();
	});

	it('says the tests have not run yet when there are no stored checks', () => {
		render(TestsPanel, { snapshot: snapshot({ testChecks: null }), form: null, progress: null });
		expect(screen.getByText(/have not run yet/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Run tests' })).toBeTruthy();
	});

	it('marks results that describe older code', () => {
		render(TestsPanel, {
			snapshot: snapshot({
				gates: {
					P5: {
						passed: false,
						checks: [{ label: 'All tests pass', ok: false, detail: 'out of date' }]
					}
				}
			}),
			form: null,
			progress: null
		});
		expect(screen.getByText(/older code or tests/)).toBeTruthy();
	});

	it('opens the test file at the line of the clicked test', async () => {
		const fetchMock = serve({ 'test/UC-001.test.ts': 'a\nb\nc\nd\ne\n' });
		const { container } = render(TestsPanel, { snapshot: snapshot(), form: null, progress: null });
		await userEvent.click(screen.getByRole('button', { name: /REQ-001 AC1/ }));
		expect(fetchMock).toHaveBeenCalledWith('/p/todo/file?path=test%2FUC-001.test.ts');
		await waitFor(() => expect(container.querySelector('.cm-marked-line')?.textContent).toBe('e'));
		// Only the test files are listed, not the code.
		expect(screen.queryByRole('button', { name: 'A.ts' })).toBeNull();
	});

	it('opens the file passed in from outside', async () => {
		serve({ 'test/UC-002.test.ts': 'x\ny\n' });
		render(TestsPanel, {
			snapshot: snapshot(),
			form: null,
			progress: null,
			open: { path: 'test/UC-002.test.ts', line: 2 }
		});
		expect(await screen.findByText('test/UC-002.test.ts:2')).toBeTruthy();
	});

	it('leaves a rejected Run tests to the gate panel, so there is one banner', () => {
		render(TestsPanel, {
			snapshot: snapshot(),
			form: { action: 'checkTests', message: 'Docker is not running.' },
			progress: null
		});
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('shows Run tests busy while an agent run is active, idle otherwise', () => {
		const { unmount } = render(TestsPanel, { snapshot: snapshot(), form: null, progress: null });
		expect(screen.getByRole('button', { name: 'Run tests' }).getAttribute('aria-busy')).toBeNull();
		unmount();
		render(TestsPanel, {
			snapshot: snapshot({ activeRun: { runId: 'x', phase: 'P5' } }),
			form: null,
			progress: null
		});
		expect(screen.getByRole('button', { name: 'Run tests' }).getAttribute('aria-busy')).toBe(
			'true'
		);
	});

	it('shows the out of date badge only when the gate says so', () => {
		const { unmount } = render(TestsPanel, { snapshot: snapshot(), form: null, progress: null });
		expect(screen.queryByText('out of date')).toBeNull();
		unmount();
		render(TestsPanel, {
			snapshot: snapshot({
				gates: {
					P5: {
						passed: false,
						checks: [{ label: 'All tests pass', ok: false, detail: 'out of date' }]
					}
				}
			}),
			form: null,
			progress: null
		});
		expect(screen.getByText('out of date')).toBeTruthy();
	});

	it('shows the planning state while a P5 run is active and no progress has arrived', () => {
		render(TestsPanel, {
			snapshot: snapshot({
				files: ['src/A.ts'],
				testChecks: null,
				activeRun: { runId: 'r', phase: 'P5' }
			}),
			form: null,
			progress: null
		});
		expect(screen.getByRole('status').textContent).toContain('Planning the files');
		expect(screen.queryByText(/no tests yet/)).toBeNull();
	});

	it('keeps the results while a chat or Apply fix run is active and tests exist', () => {
		render(TestsPanel, {
			snapshot: snapshot({ activeRun: { runId: 'r', phase: 'P5' } }),
			form: null,
			progress: null
		});
		expect(screen.getByRole('group', { name: 'UC-001 Add task' })).toBeTruthy();
	});

	it('says there are no tests when none exist and no run is active', () => {
		render(TestsPanel, {
			snapshot: snapshot({ files: ['src/A.ts'], testChecks: null }),
			form: null,
			progress: null
		});
		expect(screen.getByText('There are no tests yet.')).toBeTruthy();
	});

	it('lists the test files without a click while there are no results yet', async () => {
		serve({ 'test/UC-001.test.ts': 'a\n' });
		render(TestsPanel, { snapshot: snapshot({ testChecks: null }), form: null, progress: null });
		expect(await screen.findByRole('button', { name: 'UC-001.test.ts' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Close file' })).toBeNull();
	});

	it('has no Browse test files button', () => {
		render(TestsPanel, { snapshot: snapshot(), form: null, progress: null });
		expect(screen.queryByRole('button', { name: /Browse/ })).toBeNull();
	});

	describe('Explain failures', () => {
		const explain = () => screen.queryByRole('button', { name: 'Explain failures' });
		const finding = {
			id: 'r-1',
			runId: 'r',
			test: 'REQ-001 AC2: rejects an empty title',
			file: 'test/UC-001.test.ts',
			explanation: 'Bug.',
			proposedFix: 'Fix it.'
		};

		it('shows for a failing test without an open finding and posts triageTests', () => {
			render(TestsPanel, { snapshot: snapshot(), form: null, progress: null });
			expect(explain()?.closest('form')?.getAttribute('action')).toBe('?/triageTests');
			expect(explain()?.getAttribute('aria-busy')).toBeNull();
		});

		it('is hidden when every failing test has an open finding', () => {
			render(TestsPanel, {
				snapshot: snapshot({ testChecks: testChecksOf({ findings: [finding] }) }),
				form: null,
				progress: null
			});
			expect(explain()).toBeNull();
		});

		it('shows again when the only finding of the failing test is resolved', () => {
			const resolved = { ...finding, resolvedAt: '2026-11-21T10:00:00.000Z' };
			render(TestsPanel, {
				snapshot: snapshot({ testChecks: testChecksOf({ findings: [resolved] }) }),
				form: null,
				progress: null
			});
			expect(explain()).toBeTruthy();
		});

		it('is hidden while a run is active, when the results are out of date and when no test fails', () => {
			const { unmount } = render(TestsPanel, {
				snapshot: snapshot({ activeRun: { runId: 'x', phase: 'P5' } }),
				form: null,
				progress: null
			});
			expect(explain()).toBeNull();
			unmount();
			const stale = render(TestsPanel, {
				snapshot: snapshot({
					gates: {
						P5: {
							passed: false,
							checks: [{ label: 'All tests pass', ok: false, detail: 'out of date' }]
						}
					}
				}),
				form: null,
				progress: null
			});
			expect(explain()).toBeNull();
			stale.unmount();
			const passing = testChecksOf();
			passing.result = {
				...passing.result!,
				tests: passing.result!.tests.filter((t) => t.status !== 'failed')
			};
			render(TestsPanel, {
				snapshot: snapshot({ testChecks: passing }),
				form: null,
				progress: null
			});
			expect(explain()).toBeNull();
		});

		it('shows a rejected Explain failures with its message', () => {
			render(TestsPanel, {
				snapshot: snapshot(),
				form: { action: 'triageTests', message: 'Run tests first.' },
				progress: null
			});
			expect(screen.getByText('Run tests first.')).toBeTruthy();
		});
	});

	describe('Fix automatically', () => {
		const fix = () => screen.queryByRole('button', { name: 'Fix automatically' });
		const finding = {
			id: 'r-1',
			runId: 'r',
			test: 'REQ-001 AC2: rejects an empty title',
			file: 'test/UC-001.test.ts',
			explanation: 'Bug.',
			proposedFix: 'Fix it.'
		};
		const stale = {
			P5: { passed: false, checks: [{ label: 'All tests pass', ok: false, detail: 'out of date' }] }
		};

		it('shows for an unexplained failure and posts fixLoop', () => {
			render(TestsPanel, { snapshot: snapshot(), form: null, progress: null });
			expect(fix()?.closest('form')?.getAttribute('action')).toBe('?/fixLoop');
			expect(fix()?.getAttribute('aria-busy')).toBeNull();
		});

		it('is primary, and Explain failures is secondary beside it', () => {
			render(TestsPanel, { snapshot: snapshot(), form: null, progress: null });
			expect(fix()?.classList.contains('primary')).toBe(true);
			expect(screen.getByRole('button', { name: 'Explain failures' }).classList).toContain(
				'secondary'
			);
		});

		it('shows for an open finding although no failure is unexplained', () => {
			render(TestsPanel, {
				snapshot: snapshot({ testChecks: testChecksOf({ findings: [finding] }) }),
				form: null,
				progress: null
			});
			expect(screen.queryByRole('button', { name: 'Explain failures' })).toBeNull();
			expect(fix()).toBeTruthy();
		});

		it('is hidden while a run is active', () => {
			render(TestsPanel, {
				snapshot: snapshot({ activeRun: { runId: 'x', phase: 'P5' } }),
				form: null,
				progress: null
			});
			expect(fix()).toBeNull();
		});

		it('is hidden when the results are out of date', () => {
			render(TestsPanel, {
				snapshot: snapshot({ gates: stale }),
				form: null,
				progress: null
			});
			expect(fix()).toBeNull();
		});

		it('is hidden when no test fails, although a finding is unresolved', () => {
			const passing = testChecksOf({ findings: [finding] });
			passing.result = {
				...passing.result!,
				tests: passing.result!.tests.filter((t) => t.status !== 'failed')
			};
			render(TestsPanel, {
				snapshot: snapshot({ testChecks: passing }),
				form: null,
				progress: null
			});
			expect(fix()).toBeNull();
		});

		it('is hidden when the stored checks have no result, although a finding is unresolved', () => {
			render(TestsPanel, {
				snapshot: snapshot({ testChecks: testChecksOf({ result: null, findings: [finding] }) }),
				form: null,
				progress: null
			});
			expect(fix()).toBeNull();
		});

		it('is hidden while P4 is stale, as the server would refuse it', () => {
			render(TestsPanel, {
				snapshot: snapshot({ state: ready('stale') }),
				form: null,
				progress: null
			});
			expect(fix()).toBeNull();
		});

		it('is hidden when the tests have not run yet', () => {
			render(TestsPanel, { snapshot: snapshot({ testChecks: null }), form: null, progress: null });
			expect(fix()).toBeNull();
		});

		it('shows a rejected Fix automatically with its message', () => {
			render(TestsPanel, {
				snapshot: snapshot(),
				form: { action: 'fixLoop', message: 'No test fails, nothing to fix.' },
				progress: null
			});
			expect(screen.getByText('No test fails, nothing to fix.')).toBeTruthy();
		});
	});
});
