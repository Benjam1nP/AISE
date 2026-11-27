import type { ProjectSnapshot } from '#lib/server/index.ts';
import type { DeployCheck } from '#lib/server/core/deploy-state.ts';
import type { TestChecks } from '#lib/server/core/test-state.ts';

/** A snapshot with only the fields the panels read; override what a test needs. */
export function snapshotOf(over: Record<string, unknown> = {}): ProjectSnapshot {
	return {
		name: 'demo',
		state: {
			phases: {
				P1: { status: 'awaiting_approval' },
				P2: { status: 'not_started' },
				P4: { status: 'not_started' },
				P5: { status: 'not_started' },
				P6: { status: 'not_started' }
			}
		},
		requirements: null,
		design: null,
		diagrams: null,
		chat: { P1: [], P2: [], P3: [], P4: [], P5: [], P6: [] },
		gates: {
			P1: { passed: true, checks: [{ label: 'At least one requirement', ok: true }] },
			P2: { passed: false, checks: [{ label: 'Design exists', ok: false }] },
			P4: { passed: false, checks: [{ label: 'Code exists', ok: false }] },
			P5: { passed: false, checks: [{ label: 'Tests exist', ok: false }] },
			P6: { passed: false, checks: [{ label: 'Deployment files exist', ok: false }] }
		},
		costByPhase: {},
		activeRun: null,
		lastRun: null,
		discardableRun: null,
		staleReqIds: [],
		staleDesignIds: [],
		files: [],
		codegen: null,
		checks: null,
		testChecks: null,
		proposals: null,
		staleTestIds: [],
		deployCheck: null,
		deployCheckRunning: false,
		deployServices: [],
		staleDeployIds: [],
		discardedRunIds: [],
		tickets: [],
		...over
	} as unknown as ProjectSnapshot;
}

/** Stored P5 checks; override what a test needs. */
export function testChecksOf(over: Partial<TestChecks> = {}): TestChecks {
	return {
		at: '2026-11-20T10:00:00.000Z',
		codeHash: 'c',
		testHash: 't',
		typecheck: { ok: true, errors: [], timedOut: false },
		result: {
			ok: false,
			passed: 2,
			failed: 1,
			timedOut: false,
			logTail: '',
			tests: [
				{
					name: 'UC-001 Add task REQ-001 AC1: adds a task',
					title: 'REQ-001 AC1: adds a task',
					file: 'test/UC-001.test.ts',
					status: 'passed',
					line: 5
				},
				{
					name: 'UC-001 Add task REQ-001 AC2: rejects an empty title',
					title: 'REQ-001 AC2: rejects an empty title',
					file: 'test/UC-001.test.ts',
					status: 'failed',
					line: 12,
					error: 'expected 400 to be 201\n  at line 14'
				},
				{
					name: 'UC-001 Add task REQ-001 AC3: manual: needs a person',
					title: 'REQ-001 AC3: manual: needs a person',
					file: 'test/UC-001.test.ts',
					status: 'todo',
					line: 20
				},
				{
					name: 'UC-002 List tasks SEQ-001 scenario: add then list',
					title: 'SEQ-001 scenario: add then list',
					file: 'test/UC-002.test.ts',
					status: 'passed',
					line: 4
				}
			]
		},
		findings: [],
		testFixes: [],
		...over
	};
}

/** A stored deploy check; override what a test needs. */
export function deployCheckOf(over: Partial<DeployCheck> = {}): DeployCheck {
	return {
		at: '2026-11-22T10:00:00.000Z',
		filesHash: 'h',
		passed: true,
		services: [{ url: 'http://localhost:8080/health', status: 200 }],
		logTail: 'api-1  | listening on 8080',
		durationMs: 12400,
		...over
	};
}

type TicketView = ProjectSnapshot['tickets'][number];

/** A ticket as the snapshot shows it; a triaged change ticket with a plan unless overridden. */
export function ticketOf(over: Partial<TicketView> = {}): TicketView {
	return {
		id: 'TCK-001',
		kind: 'change',
		title: 'Tasks need a due date',
		description: 'Add a due date to every task.',
		status: 'triaged',
		createdAt: '2026-11-22T10:00:00.000Z',
		plan: {
			entry: 'P1',
			affectedIds: ['REQ-001', 'UC-001'],
			files: ['src/tasks/Task.ts'],
			steps: ['Add a requirement for the due date', 'Show the due date in the design']
		},
		chat: [],
		runIds: [],
		steps: [],
		closeBlocked: null,
		notReproduced: false,
		entryRan: false,
		...over
	};
}

/**
 * Records the fields of the next submit of `form` and stops it (no request is sent). Returns the
 * recorded fields once the submit happened, else undefined.
 */
export function captureSubmit(form: HTMLFormElement): () => Record<string, string> | undefined {
	let fields: Record<string, string> | undefined;
	form.addEventListener(
		'submit',
		(e) => {
			e.preventDefault();
			e.stopImmediatePropagation();
			fields = Object.fromEntries(
				[...new FormData(form).entries()].map(([k, v]) => [k, String(v)])
			);
		},
		{ capture: true }
	);
	return () => fields;
}
