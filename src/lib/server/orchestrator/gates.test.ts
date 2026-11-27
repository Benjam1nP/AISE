import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DesignDoc } from '../core/schemas/design';
import type { RequirementsDoc } from '../core/schemas/requirements';
import { checkDeployGate, checkGate, checkTestGate, type DeployGateInput } from './gates';
import { missingEntries } from './p4';
import { designHash, type CodeChecks } from '../core/code-state';
import type { DesignReview } from '../core/tools/coverage';
import type { StartEntry, StartResult } from '../core/tools/start';
import type { TestResult } from '../core/docker/parse';
import type { TestChecks } from '../core/test-state';
import type { DeployCheck } from '../core/deploy-state';
import { changedIds, designDiff, reqHashes } from './staleness';

const fixture = <T>(name: string): T =>
	JSON.parse(readFileSync(new URL(`../../../../test/fixtures/${name}`, import.meta.url), 'utf8'));

const reqs = () => fixture<RequirementsDoc>('todo-requirements.json');
const design = () => DesignDoc.parse(fixture('todo-design.json'));
const failed = (g: ReturnType<typeof checkGate>) => g.checks.filter((c) => !c.ok && !c.advisory);
const main = { entry: 'src/app/main.ts', portVar: 'PORT', port: 8080 };
const started = (entries: StartEntry[] = [{ ...main, ok: true, log: '' }]): StartResult => ({
	ok: entries.every((e) => e.ok),
	entries,
	timedOut: false
});

const checksAt = (codeHash: string, over: Partial<CodeChecks> = {}): CodeChecks => ({
	at: '2026-11-20T10:00:00.000Z',
	codeHash,
	typecheck: { ok: true, errors: [], timedOut: false },
	drift: [],
	designHash: designHash(design()),
	start: started(),
	...over
});

describe('checkGate', () => {
	it('passes P1 and P2 on the fixtures', () => {
		expect(checkGate('P1', reqs(), null).passed).toBe(true);
		expect(checkGate('P2', reqs(), design()).passed).toBe(true);
	});

	it('fails P1 with an open question and lists its ID', () => {
		const r = reqs();
		r.openQuestions = [{ id: 'Q-001', text: 'Do tasks have due dates?', reqIds: [] }];
		const g = checkGate('P1', r, null);
		expect(g.passed).toBe(false);
		expect(failed(g)).toEqual([{ label: 'No open questions', ok: false, detail: 'Q-001' }]);
	});

	it('fails P1 without requirements', () => {
		const g = checkGate('P1', null, null);
		expect(failed(g).map((c) => c.label)).toEqual(['At least one requirement']);
	});

	it('fails P2 with an uncovered must requirement and lists its ID', () => {
		const r = reqs();
		r.requirements.push({ ...r.requirements[0], id: 'REQ-005', title: 'Delete task' });
		const g = checkGate('P2', r, design());
		expect(g.passed).toBe(false);
		expect(failed(g)).toEqual([
			{ label: 'Every must requirement linked', ok: false, detail: 'REQ-005' }
		]);
	});

	describe('acceptance criteria coverage (P2, advisory)', () => {
		const label = 'Acceptance criteria covered';
		const cover = [{ classId: 'DSN-003', method: 'addTask' }];
		const rowsFor = (skip: string[] = []): DesignReview['rows'] =>
			reqs().requirements.flatMap((r) =>
				r.acceptanceCriteria.map((_, i) => ({
					reqId: r.id,
					criterion: i + 1,
					coveredBy: skip.includes(`${r.id} AC${i + 1}`) ? [] : cover
				}))
			);
		const review = (rows: DesignReview['rows'], hash = designHash(design())!): DesignReview => ({
			designHash: hash,
			rows
		});
		const gate = (r: DesignReview | null, d = design()) =>
			checkGate('P2', reqs(), d, null, null, [], r);
		const advisory = (g: ReturnType<typeof checkGate>) => g.checks.find((c) => c.label === label)!;

		it('is met when every criterion has a cover', () => {
			expect(advisory(gate(review(rowsFor())))).toEqual({ label, ok: true, advisory: true });
		});

		it('lists the uncovered criteria and still passes', () => {
			const g = gate(review(rowsFor(['REQ-002 AC2', 'REQ-004 AC1'])));
			expect(advisory(g)).toEqual({
				label,
				ok: false,
				detail: 'REQ-002 AC2, REQ-004 AC1',
				advisory: true
			});
			expect(g.passed).toBe(true);
			expect(failed(g)).toEqual([]);
		});

		it('counts a functional criterion missing from the rows as uncovered', () => {
			const rows = rowsFor().filter((r) => !(r.reqId === 'REQ-001' && r.criterion === 2));
			expect(advisory(gate(review(rows))).detail).toBe('REQ-001 AC2');
		});

		it('reads not run yet without a review and out of date after a design change', () => {
			const none = gate(null);
			expect(advisory(none)).toMatchObject({ ok: false, detail: 'not run yet' });
			const d = design();
			d.classes[0].description = 'changed';
			const old = gate(review(rowsFor()), d);
			expect(advisory(old)).toMatchObject({ ok: false, detail: 'out of date' });
			expect(none.passed && old.passed).toBe(true);
		});

		it('still fails the gate for a blocking check next to an advisory one', () => {
			const d = design();
			d.useCases[0].actorIds = ['ACT-099'];
			const g = gate(review(rowsFor(), designHash(d)!), d);
			expect(g.passed).toBe(false);
			expect(advisory(g).ok).toBe(true);
		});
	});

	it('fails P2 with broken references and without a design', () => {
		const d = design();
		d.useCases[0].actorIds = ['ACT-099'];
		expect(failed(checkGate('P2', reqs(), d))).toEqual([
			{ label: 'Schema and references valid', ok: false, detail: '1 issue' }
		]);
		expect(failed(checkGate('P2', reqs(), null)).map((c) => c.label)).toEqual([
			'Design exists',
			'Schema and references valid',
			'Every must requirement linked'
		]);
	});
});

describe('checkGate P4', () => {
	it('passes on clean checks taken at the current code hash', () => {
		const g = checkGate('P4', reqs(), design(), checksAt('h1'), 'h1', []);
		expect(g.passed).toBe(true);
		expect(g.checks.map((c) => c.label)).toEqual([
			'Code exists',
			'App entry exists',
			'Typecheck passes',
			'Code matches the design',
			'App starts'
		]);
	});

	it('shows checks taken at another code hash as out of date, never their old result', () => {
		expect(failed(checkGate('P4', reqs(), design(), checksAt('h1'), 'h2', []))).toEqual([
			{ label: 'Typecheck passes', ok: false, detail: 'out of date' },
			{ label: 'Code matches the design', ok: false, detail: 'out of date' },
			{ label: 'App starts', ok: false, detail: 'out of date' }
		]);
	});

	it('shows checks taken at another design as out of date', () => {
		const d = design();
		d.classes[0].description = 'a different design, whatever the change';
		expect(failed(checkGate('P4', reqs(), d, checksAt('h1'), 'h1', []))).toEqual([
			{ label: 'Typecheck passes', ok: false, detail: 'out of date' },
			{ label: 'Code matches the design', ok: false, detail: 'out of date' },
			{ label: 'App starts', ok: false, detail: 'out of date' }
		]);
	});

	it('shows checks without a design hash, from an older file, as out of date', () => {
		const old = checksAt('h1', { designHash: undefined });
		expect(failed(checkGate('P4', reqs(), design(), old, 'h1', [])).map((c) => c.detail)).toEqual([
			'out of date',
			'out of date',
			'out of date'
		]);
	});

	it('passes checks taken without a design only while there is still none', () => {
		const none = checksAt('h1', { designHash: null });
		expect(
			checkGate('P4', reqs(), null, none, 'h1', [])
				.checks.slice(1)
				.map((c) => c.detail)
		).not.toContain('out of date');
		expect(failed(checkGate('P4', reqs(), design(), none, 'h1', [])).map((c) => c.detail)).toEqual([
			'out of date',
			'out of date',
			'out of date'
		]);
	});

	it('fails without code and without checks', () => {
		expect(failed(checkGate('P4', reqs(), design(), null, null, ['src/app/main.ts']))).toEqual([
			{ label: 'Code exists', ok: false },
			{ label: 'App entry exists', ok: false, detail: 'src/app/main.ts' },
			{ label: 'Typecheck passes', ok: false, detail: 'not run yet' },
			{ label: 'Code matches the design', ok: false, detail: 'not run yet' },
			{ label: 'App starts', ok: false, detail: 'not run yet' }
		]);
	});

	it('fails and names the missing entries, whatever the stored checks say', () => {
		const missing = ['src/app/main.ts', 'src/app/live.ts'];
		expect(failed(checkGate('P4', reqs(), design(), checksAt('h1'), 'h1', missing))).toEqual([
			{ label: 'App entry exists', ok: false, detail: 'src/app/main.ts, src/app/live.ts' }
		]);
	});

	it('shows a timed out typecheck as timed out', () => {
		const checks = checksAt('h1', {
			typecheck: { ok: false, errors: [], timedOut: true },
			start: null
		});
		expect(failed(checkGate('P4', reqs(), design(), checks, 'h1', []))).toEqual([
			{ label: 'Typecheck passes', ok: false, detail: 'timed out' },
			{ label: 'App starts', ok: false, detail: 'not run, typecheck fails' }
		]);
	});

	it('counts typecheck errors and drift items', () => {
		const error = { file: 'src/a.ts', line: 1, col: 1, message: 'bad' };
		const checks = checksAt('h1', {
			typecheck: { ok: false, errors: [error, error], timedOut: false },
			drift: [{ kind: 'missing_in_code', id: 'DSN-001', name: 'Task', details: [] }],
			start: null
		});
		expect(failed(checkGate('P4', reqs(), design(), checks, 'h1', []))).toEqual([
			{ label: 'Typecheck passes', ok: false, detail: '2 errors' },
			{ label: 'Code matches the design', ok: false, detail: '1 difference' },
			{ label: 'App starts', ok: false, detail: 'not run, typecheck fails' }
		]);
	});

	describe('App starts', () => {
		const startGate = (over: Partial<CodeChecks>) =>
			failed(checkGate('P4', reqs(), design(), checksAt('h1', over), 'h1', []));

		it('fails and names every entry that did not answer, with its error', () => {
			const live = { entry: 'src/app/live.ts', portVar: 'LIVE_PORT', port: 8081 };
			const start = started([
				{
					...main,
					ok: false,
					error: 'exited with code 1 before GET /health answered',
					log: 'Error: boom'
				},
				{ ...live, ok: false, error: 'GET /health returned 500', log: '' }
			]);
			expect(startGate({ start })).toEqual([
				{
					label: 'App starts',
					ok: false,
					detail:
						'src/app/main.ts exited with code 1 before GET /health answered, src/app/live.ts GET /health returned 500'
				}
			]);
		});

		it('shows a timed out start as timed out', () => {
			const start = { ...started([{ ...main, ok: false, error: 'x', log: '' }]), timedOut: true };
			expect(startGate({ start })).toEqual([
				{ label: 'App starts', ok: false, detail: 'timed out' }
			]);
		});

		it('says why it did not run: no package.json, no entry, or checks from before it existed', () => {
			expect(startGate({ typecheck: null, start: null })).toEqual([
				{ label: 'Typecheck passes', ok: false, detail: 'no package.json' },
				{ label: 'App starts', ok: false, detail: 'no package.json' }
			]);
			expect(startGate({ start: null })).toEqual([
				{ label: 'App starts', ok: false, detail: 'no app entry' }
			]);
			expect(startGate({ start: undefined })).toEqual([
				{ label: 'App starts', ok: false, detail: 'not run yet' }
			]);
		});
	});
});

describe('missingEntries', () => {
	it('checks main.ts and the entry of every extra service node', () => {
		const d = design();
		expect(missingEntries([], d)).toEqual(['src/app/main.ts']);
		expect(missingEntries(['src/app/main.ts'], d)).toEqual([]);
		expect(missingEntries([], null)).toEqual(['src/app/main.ts']);
		d.nodes.push({ id: 'DSN-020', name: 'Live', kind: 'service', reqIds: [] });
		expect(missingEntries(['src/app/main.ts'], d)).toEqual(['src/app/live.ts']);
		expect(missingEntries(['src/app/main.ts', 'src/app/live.ts'], d)).toEqual([]);
	});
});

const pass = (title: string): TestResult => ({
	name: `UC-001 Add task ${title}`,
	title,
	file: 'test/UC-001.test.ts',
	status: 'passed'
});
/** Every criterion of the to-do fixture covered and passing. */
const allTests = (): TestResult[] => [
	pass('REQ-001 AC1: added'),
	pass('REQ-001 AC2: empty title'),
	pass('REQ-002 AC1: list'),
	pass('REQ-002 AC2: order'),
	{ ...pass('REQ-003 AC1: manual: needs a restart'), status: 'todo' },
	pass('REQ-004 AC1: done')
];
const testChecksAt = (over: Partial<TestChecks> = {}): TestChecks => {
	const tests = over.result?.tests ?? allTests();
	const failedCount = tests.filter((t) => t.status === 'failed').length;
	return {
		at: '2026-11-21T10:00:00.000Z',
		codeHash: 'c1',
		testHash: 't1',
		typecheck: { ok: true, errors: [], timedOut: false },
		result: {
			ok: failedCount === 0,
			passed: tests.length - failedCount,
			failed: failedCount,
			tests,
			timedOut: false,
			logTail: ''
		},
		findings: [],
		testFixes: [],
		...over
	};
};
const p5 = (checks: TestChecks | null, over: { codeHash?: string; testHash?: string } = {}) =>
	checkTestGate(reqs(), {
		checks,
		codeHash: over.codeHash ?? 'c1',
		testHash: over.testHash ?? 't1',
		testFiles: ['test/UC-001.test.ts']
	});

describe('checkGate P5', () => {
	it('passes on current checks with every must criterion covered', () => {
		expect(p5(testChecksAt())).toEqual({
			passed: true,
			checks: [
				{ label: 'Tests exist', ok: true },
				{ label: 'Every must criterion has a test', ok: true },
				{ label: 'Tests type check', ok: true },
				{ label: 'All tests pass', ok: true }
			]
		});
	});

	it('fails without test files and shows not run yet without checks', () => {
		const g = checkTestGate(reqs(), {
			checks: null,
			codeHash: 'c1',
			testHash: null,
			testFiles: []
		});
		expect(failed(g)).toEqual([
			{ label: 'Tests exist', ok: false },
			{ label: 'Every must criterion has a test', ok: false, detail: 'not run yet' },
			{ label: 'Tests type check', ok: false, detail: 'not run yet' },
			{ label: 'All tests pass', ok: false, detail: 'not run yet' }
		]);
	});

	it('lists missing must criteria only; a should criterion and a manual todo do not count as missing', () => {
		const tests = allTests().filter(
			(t) => !t.title.startsWith('REQ-001 AC2') && !t.title.startsWith('REQ-004')
		);
		expect(failed(p5(testChecksAt({ result: { ...testChecksAt().result!, tests } })))).toEqual([
			{ label: 'Every must criterion has a test', ok: false, detail: 'REQ-001 AC2' }
		]);
	});

	it('is out of date when the code or the tests changed since the checks (Review Focus 3)', () => {
		const stale = [
			{ label: 'Every must criterion has a test', ok: false, detail: 'out of date' },
			{ label: 'Tests type check', ok: false, detail: 'out of date' },
			{ label: 'All tests pass', ok: false, detail: 'out of date' }
		];
		expect(failed(p5(testChecksAt(), { codeHash: 'c2' }))).toEqual(stale);
		expect(failed(p5(testChecksAt(), { testHash: 't2' }))).toEqual(stale);
	});

	it('counts only tsc errors under test/ and a global one', () => {
		const err = (file: string) => ({ file, line: 1, col: 1, message: 'bad' });
		const tc = (errors: ReturnType<typeof err>[]) => ({ ok: false, errors, timedOut: false });
		expect(failed(p5(testChecksAt({ typecheck: tc([err('src/a.ts')]) })))).toEqual([]);
		expect(
			failed(p5(testChecksAt({ typecheck: tc([err('test/UC-001.test.ts'), err('src/a.ts')]) })))
		).toEqual([{ label: 'Tests type check', ok: false, detail: '1 error' }]);
		expect(failed(p5(testChecksAt({ typecheck: tc([err('')]) })))).toEqual([
			{ label: 'Tests type check', ok: false, detail: '1 error' }
		]);
	});

	it('fails on failing tests, a timeout and a missing package.json', () => {
		const tests = allTests();
		tests[0] = { ...tests[0]!, status: 'failed', error: 'expected open' };
		const base = testChecksAt({
			result: { ...testChecksAt().result!, ok: false, passed: 4, failed: 1, tests }
		});
		expect(failed(p5(base))).toEqual([{ label: 'All tests pass', ok: false, detail: '1 failed' }]);
		const timedOut = testChecksAt({
			typecheck: { ok: false, errors: [], timedOut: true },
			result: { ...testChecksAt().result!, ok: false, timedOut: true }
		});
		expect(failed(p5(timedOut)).map((c) => c.detail)).toEqual(['timed out', 'timed out']);
		expect(
			failed(p5(testChecksAt({ typecheck: null, result: null }))).map((c) => c.detail)
		).toEqual([
			'REQ-001 AC1, REQ-001 AC2, REQ-002 AC1, REQ-002 AC2, REQ-003 AC1',
			'no package.json',
			'no package.json'
		]);
	});
});

describe('staleness', () => {
	it('splits changed design IDs into changed, added and removed', () => {
		const stored = { 'DSN-001': 'a', 'DSN-002': 'b', 'DSN-003': 'c' };
		const current = { 'DSN-001': 'a', 'DSN-002': 'x', 'DSN-004': 'd' };
		expect(designDiff(stored, current)).toEqual({
			changed: ['DSN-002'],
			added: ['DSN-004'],
			removed: ['DSN-003']
		});
	});

	it('reports changed, added and removed requirement IDs, sorted', () => {
		const before = reqs();
		const after = reqs();
		after.requirements[1].acceptanceCriteria.push('Done tasks are listed last.');
		after.requirements = after.requirements.filter((r) => r.id !== 'REQ-003');
		after.requirements.push({ ...after.requirements[0], id: 'REQ-005' });
		expect(changedIds(reqHashes(before), reqHashes(after))).toEqual([
			'REQ-002',
			'REQ-003',
			'REQ-005'
		]);
	});

	it('ignores key order', () => {
		const r = reqs();
		const reordered = { ...r, requirements: r.requirements.map((q) => ({ ...q, id: q.id })) };
		reordered.requirements[0] = Object.fromEntries(
			Object.entries(r.requirements[0]).reverse()
		) as RequirementsDoc['requirements'][number];
		expect(changedIds(reqHashes(r), reqHashes(reordered))).toEqual([]);
	});
});

const deployCheckAt = (over: Partial<DeployCheck> = {}): DeployCheck => ({
	at: '2026-11-22T10:00:00.000Z',
	filesHash: 'h1',
	passed: true,
	services: [{ url: 'http://localhost:8080/health', status: 200 }],
	logTail: '',
	durationMs: 1000,
	...over
});
const p6 = (over: Partial<DeployGateInput> = {}) =>
	checkDeployGate({
		files: ['Dockerfile', 'compose.yaml', 'RUN.md'],
		problems: [],
		check: deployCheckAt(),
		checkHash: 'h1',
		...over
	});

describe('checkDeployGate', () => {
	it('passes with the files, no problems and a current passed check', () => {
		expect(p6()).toEqual({
			passed: true,
			checks: [
				{ label: 'Deployment files exist', ok: true },
				{ label: 'Consistent with the design', ok: true },
				{ label: 'Deploy check passed', ok: true }
			]
		});
	});

	it('names the missing files', () => {
		expect(failed(p6({ files: ['compose.yaml'] }))).toEqual([
			{ label: 'Deployment files exist', ok: false, detail: 'Dockerfile, RUN.md' }
		]);
	});

	it('shows the problems, or that the plan cannot be made', () => {
		expect(failed(p6({ problems: ['service "a" is missing', 'service "b" lacks X_URL'] }))).toEqual(
			[
				{
					label: 'Consistent with the design',
					ok: false,
					detail: 'service "a" is missing; service "b" lacks X_URL'
				}
			]
		);
		expect(failed(p6({ problems: null }))).toEqual([
			{ label: 'Consistent with the design', ok: false, detail: 'no design or package.json' }
		]);
	});

	it('shows not run yet without a check and out of date after a file change', () => {
		const notRun = [{ label: 'Deploy check passed', ok: false, detail: 'not run yet' }];
		expect(failed(p6({ check: null }))).toEqual(notRun);
		const stale = [{ label: 'Deploy check passed', ok: false, detail: 'out of date' }];
		expect(failed(p6({ checkHash: 'h2' }))).toEqual(stale);
		expect(failed(p6({ check: deployCheckAt({ filesHash: null }), checkHash: null }))).toEqual(
			stale
		);
	});

	it('fails a passed check that did not probe every planned service, naming the missing ones', () => {
		const services = [
			{ name: 'api-server', healthUrl: 'http://localhost:8080/health' },
			{ name: 'live-update-server', healthUrl: 'http://localhost:8081/health' }
		];
		expect(failed(p6({ services }))).toEqual([
			{ label: 'Deploy check passed', ok: false, detail: 'not probed: live-update-server' }
		]);
		const both = deployCheckAt({
			services: services.map((s) => ({ url: s.healthUrl, status: 200 }))
		});
		expect(p6({ services, check: both }).passed).toBe(true);
	});

	it('names the service of every url without a 2xx status, else the first log line', () => {
		const services = [
			{ name: 'api-server', healthUrl: 'http://localhost:8080/health' },
			{ name: 'live-update-server', healthUrl: 'http://localhost:8081/health' }
		];
		const bad = deployCheckAt({
			passed: false,
			services: [
				{ url: 'http://localhost:8080/health', status: 204 },
				{ url: 'http://localhost:8081/health', status: 503 },
				{ url: 'http://localhost:8082/health', status: null }
			]
		});
		expect(failed(p6({ check: bad, services }))).toEqual([
			{
				label: 'Deploy check passed',
				ok: false,
				detail: 'live-update-server 503, http://localhost:8082/health no answer'
			}
		]);
		const refused = deployCheckAt({
			passed: false,
			services: [],
			logTail: '\nDocker is not running\nmore'
		});
		expect(failed(p6({ check: refused }))[0].detail).toBe('Docker is not running');
		expect(failed(p6({ check: deployCheckAt({ passed: false }) }))[0].detail).toBe('failed');
	});

	it('shows the message a refused check stored, not only that the urls gave no answer', () => {
		// the shape deploy_check writes for Docker down or a refusal: every url null, the message as log
		const down = deployCheckAt({
			passed: false,
			services: [
				{ url: 'http://localhost:8080/health', status: null },
				{ url: 'http://localhost:8081/health', status: 200 }
			],
			logTail: 'Docker is not running\nstart Docker Desktop'
		});
		const services = [
			{ name: 'api-server', healthUrl: 'http://localhost:8080/health' },
			{ name: 'live-update-server', healthUrl: 'http://localhost:8081/health' }
		];
		expect(failed(p6({ check: down, services }))[0].detail).toBe(
			'api-server no answer (Docker is not running)'
		);
	});
});
