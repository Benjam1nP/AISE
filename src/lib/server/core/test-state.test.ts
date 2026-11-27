import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codeHash } from './code-state';
import type { TestResult } from './docker/parse';
import { createRun } from './runs';
import type { Requirement } from './schemas/requirements';
import { ProjectStore } from './store';
import {
	coverage,
	findingOpen,
	listTestFiles,
	p5Hash,
	parseTestName,
	readRunFindings,
	readTestChecks,
	runTestChecks,
	testHash,
	writeTestChecks,
	type Finding,
	type TestChecks
} from './test-state';
import type { RunTestsResult, TypecheckResult } from './tools/check';
import type { ToolContext } from './tools/registry';

let root: string;
let store: ProjectStore;

const put = async (rel: string, content: string) => {
	const abs = path.join(store.dir, rel);
	await mkdir(path.dirname(abs), { recursive: true });
	await writeFile(abs, content);
};

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-test-state-'));
	store = new ProjectStore(path.join(root, 'proj'));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('testHash', () => {
	it('is null without files under test/, whatever src/ holds', async () => {
		await put('src/a.ts', 'export {};');
		expect(await listTestFiles(store)).toEqual([]);
		expect(await testHash(store)).toBeNull();
	});

	it('ignores src/ and changes with a test file path or content', async () => {
		await put('test/UC-001.test.ts', 'a');
		const h = await testHash(store);
		expect(await listTestFiles(store)).toEqual(['test/UC-001.test.ts']);
		await put('src/a.ts', 'export {};');
		expect(await testHash(store)).toBe(h);
		await put('test/UC-001.test.ts', 'b');
		const edited = await testHash(store);
		expect(edited).not.toBe(h);
		await put('test/UC-002.test.ts', 'b');
		expect(await testHash(store)).not.toBe(edited);
	});

	it('skips symlinks and the temp files of an atomic write', async () => {
		await put('test/a.test.ts', 'a');
		const h = await testHash(store);
		await put('outside.ts', 'x');
		await symlink(path.join(store.dir, 'outside.ts'), path.join(store.dir, 'test/link.test.ts'));
		await put('test/b.test.ts.0f9c1e3a-1111-4222-8333-444455556666.tmp', 'partial');
		expect(await listTestFiles(store)).toEqual(['test/a.test.ts']);
		expect(await testHash(store)).toBe(h);
	});
});

describe('p5Hash', () => {
	it('changes with a src/ edit and with a test edit', async () => {
		expect(await p5Hash(store)).toBeNull();
		await put('src/a.ts', 'a');
		await put('test/a.test.ts', 'a');
		const h = await p5Hash(store);
		expect(h).toMatch(/^[0-9a-f]{64}$/);
		await put('src/a.ts', 'b');
		const afterCode = await p5Hash(store);
		expect(afterCode).not.toBe(h);
		await put('test/a.test.ts', 'b');
		expect(await p5Hash(store)).not.toBe(afterCode);
	});
});

describe('parseTestName', () => {
	it.each([
		['REQ-003 AC1: Add a task', { kind: 'ac', reqId: 'REQ-003', n: 1, manual: false }],
		['REQ-003 AC12: x', { kind: 'ac', reqId: 'REQ-003', n: 12, manual: false }],
		['REQ-007 AC2: manual: needs a human', { kind: 'ac', reqId: 'REQ-007', n: 2, manual: true }],
		['SEQ-002 scenario: Add and list', { kind: 'scenario', seqId: 'SEQ-002' }],
		['UC-001 Add task', null],
		['REQ-003 AC0: x', null],
		['REQ-3 AC1: x', null],
		['REQ-003 AC1 x', null],
		['REQ-007 AC2: manual:x', { kind: 'ac', reqId: 'REQ-007', n: 2, manual: false }],
		['REQ-007 AC2: manual', { kind: 'ac', reqId: 'REQ-007', n: 2, manual: false }],
		['REQ-001 AC1: first line\nsecond line', { kind: 'ac', reqId: 'REQ-001', n: 1, manual: false }],
		['REQ-001 AC1: manual: a\nb', { kind: 'ac', reqId: 'REQ-001', n: 1, manual: true }],
		['REQ-003 AC1: ', null],
		['REQ-003 AC1:  ', null],
		['SEQ-002 scenario:', null],
		['test/UC-001.test.ts', null],
		['UC-001 Add task > REQ-003 AC1: x', null]
	])('%s', (title, expected) => {
		expect(parseTestName(title)).toEqual(expected);
	});
});

const req = (id: string, priority: Requirement['priority'], criteria: string[]): Requirement => ({
	id,
	title: id,
	text: id,
	type: 'functional',
	priority,
	acceptanceCriteria: criteria
});
const t = (title: string, status: TestResult['status']): TestResult => ({
	name: `UC-001 x ${title}`,
	title,
	file: 'test/UC-001.test.ts',
	status
});

describe('coverage', () => {
	const reqs = [
		req('REQ-001', 'must', ['a', 'b']),
		req('REQ-002', 'should', ['c']),
		req('REQ-003', 'could', ['d'])
	];

	it('has one row per criterion with the status of its test', () => {
		const rows = coverage(reqs, [
			t('REQ-001 AC1: a', 'passed'),
			t('REQ-001 AC2: b', 'failed'),
			t('REQ-002 AC1: manual: reason', 'todo')
		]);
		expect(rows).toEqual([
			{ reqId: 'REQ-001', n: 1, priority: 'must', status: 'passed' },
			{ reqId: 'REQ-001', n: 2, priority: 'must', status: 'failed' },
			{ reqId: 'REQ-002', n: 1, priority: 'should', status: 'manual' },
			{ reqId: 'REQ-003', n: 1, priority: 'could', status: 'missing' }
		]);
	});

	it('counts a manual todo as manual, never as passed, and a todo without the marker as missing', () => {
		const rows = coverage(reqs, [
			t('REQ-001 AC1: manual: reason', 'todo'),
			t('REQ-001 AC2: b', 'todo'),
			t('REQ-002 AC1: c', 'skipped')
		]);
		expect(rows.map((r) => r.status)).toEqual(['manual', 'missing', 'missing', 'missing']);
	});

	it('ignores tests for a requirement or criterion number that does not exist', () => {
		const rows = coverage(reqs, [
			t('REQ-999 AC9: nope', 'passed'),
			t('REQ-001 AC7: nope', 'passed'),
			t('REQ-002 AC2: nope', 'failed')
		]);
		expect(rows).toHaveLength(4);
		expect(rows.map((r) => r.status)).toEqual(['missing', 'missing', 'missing', 'missing']);
	});

	it('lets a failed test win over a passed one for the same criterion', () => {
		const both = [t('REQ-001 AC1: a', 'passed'), t('REQ-001 AC1: a again', 'failed')];
		expect(coverage(reqs, both)[0]!.status).toBe('failed');
		expect(coverage(reqs, [...both].reverse())[0]!.status).toBe('failed');
	});

	it('lets a passed test win over a manual todo', () => {
		const rows = coverage(reqs, [
			t('REQ-001 AC1: manual: later', 'todo'),
			t('REQ-001 AC1: a', 'passed')
		]);
		expect(rows[0]!.status).toBe('passed');
	});
});

const finding = (over: Partial<Finding> = {}): Finding => ({
	id: 'r-1',
	runId: 'r',
	test: 'REQ-001 AC1: a',
	file: 'test/UC-001.test.ts',
	explanation: 'e',
	proposedFix: 'f',
	...over
});
const result = (tests: TestResult[]): RunTestsResult => ({
	ok: tests.every((x) => x.status !== 'failed'),
	passed: tests.filter((x) => x.status === 'passed').length,
	failed: tests.filter((x) => x.status === 'failed').length,
	tests,
	timedOut: false,
	logTail: ''
});

describe('findingOpen', () => {
	it('is open while its test fails and until it shows as passed, todo or skipped', () => {
		const f = finding();
		expect(findingOpen(f, result([t(f.test, 'failed')]))).toBe(true);
		for (const status of ['passed', 'todo', 'skipped'] as const) {
			expect(findingOpen(f, result([t(f.test, status)]))).toBe(false);
		}
	});

	it('resolves when its file loaded without its test or is gone; stays open on a suite failure or no result', () => {
		const f = finding();
		expect(findingOpen(f, result([t('other', 'failed')]))).toBe(false);
		expect(findingOpen(f, result([t('other', 'passed')]))).toBe(false);
		expect(findingOpen(f, result([]))).toBe(false);
		expect(findingOpen(f, result([{ ...t(f.file, 'failed'), suite: true }]))).toBe(true);
		expect(findingOpen(f, null)).toBe(true);
	});

	it('accepts the exact title or the full name, nothing shorter', () => {
		const f = finding({ test: 'UC-001 x REQ-001 AC1: a' });
		expect(findingOpen(f, result([t('REQ-001 AC1: a', 'passed')]))).toBe(false);
		const suffix = finding({ test: 'AC1: a' });
		expect(findingOpen(suffix, result([t('REQ-001 AC1: a', 'failed')]))).toBe(false);
	});

	it('ignores a test of the same name in another file', () => {
		const f = finding();
		const other = { ...t(f.test, 'passed'), file: 'test/UC-002.test.ts' };
		expect(findingOpen(f, result([other, t(f.test, 'failed')]))).toBe(true);
		expect(findingOpen(f, result([other, t(f.test, 'passed')]))).toBe(false);
	});
});

describe('checks file', () => {
	const checks: TestChecks = {
		at: '2026-11-20T10:00:00.000Z',
		codeHash: 'c',
		testHash: null,
		typecheck: { ok: true, errors: [], timedOut: false },
		result: result([{ ...t('REQ-001 AC1: a', 'failed'), line: 3, error: 'boom' }]),
		findings: [finding({ reqId: 'REQ-001' }), finding({ id: 'r-2', resolvedAt: 'y' })],
		testFixes: [{ runId: 'r', test: 'x', file: 'test/a.test.ts', reason: 'why' }]
	};

	it('round trips and reads null when missing or unreadable', async () => {
		expect(await readTestChecks(store)).toBeNull();
		await writeTestChecks(store, checks);
		expect(await readTestChecks(store)).toEqual(checks);
		await put('.aise/checks/P5.json', '{broken');
		expect(await readTestChecks(store)).toBeNull();
		await put('.aise/checks/P5.json', '{"at":1}');
		expect(await readTestChecks(store)).toBeNull();
	});
});

describe('runTestChecks', () => {
	let ctx: ToolContext;
	const okTc: TypecheckResult = { ok: true, errors: [], timedOut: false };
	beforeEach(async () => {
		const meta = await createRun(store, 'P5', 'test');
		ctx = { store, runId: meta.id, projectName: 'p', agent: 'test' };
	});

	it('has no typecheck and no result without a package.json, and does not call the runners', async () => {
		await put('test/a.test.ts', 'a');
		const boom = () => Promise.reject(new Error('must not run'));
		const c = await runTestChecks(ctx, { typecheck: boom, tests: boom });
		expect(c.typecheck).toBeNull();
		expect(c.result).toBeNull();
		expect(c.testHash).toBe(await testHash(store));
		expect(await readTestChecks(store)).toEqual(c);
	});

	it('stores the hashes taken before the run and both results', async () => {
		await put('package.json', '{}');
		await put('tsconfig.json', '{}');
		await put('src/a.ts', 'a');
		await put('test/a.test.ts', 'a');
		const before = { code: await codeHash(store), test: await testHash(store) };
		const r = result([t('REQ-001 AC1: a', 'passed')]);
		const tc: TypecheckResult = {
			ok: false,
			errors: [{ file: 'src/a.ts', line: 1, col: 1, message: 'TS1: x' }],
			timedOut: false
		};
		const c = await runTestChecks(ctx, {
			typecheck: async () => {
				await put('test/a.test.ts', 'edited during the run');
				await put('src/a.ts', 'edited during the run');
				return tc;
			},
			tests: async () => r
		});
		expect(c.typecheck).toEqual(tc);
		expect(c.result).toEqual(r);
		expect(c.testHash).toBe(before.test);
		expect(c.testHash).not.toBe(await testHash(store));
		expect(c.codeHash).toBe(before.code);
		expect(c.codeHash).not.toBe(await codeHash(store));
	});

	it('reports a missing tsconfig.json as a failed typecheck without calling tsc', async () => {
		await put('package.json', '{}');
		await put('test/a.test.ts', 'a');
		const c = await runTestChecks(ctx, {
			typecheck: () => Promise.reject(new Error('no')),
			tests: async () => result([t('REQ-001 AC1: a', 'passed')])
		});
		expect(c.typecheck?.ok).toBe(false);
		expect(c.typecheck?.errors[0]?.message).toContain('tsconfig.json');
	});

	const A = 'test/a.test.ts';
	const checksWith = (findings: Finding[], testFixes: TestChecks['testFixes']): TestChecks => ({
		at: 'x',
		codeHash: null,
		testHash: null,
		typecheck: null,
		result: null,
		findings,
		testFixes
	});
	const reportInRun = (r: { findings?: Finding[]; testFixes?: TestChecks['testFixes'] }) =>
		put(
			`.aise/runs/${ctx.runId}/findings.json`,
			JSON.stringify({ findings: [], testFixes: [], ...r })
		);
	const check = (tests: TestResult[]) =>
		runTestChecks(ctx, { typecheck: async () => okTc, tests: async () => result(tests) });
	const scaffold = async () => {
		await put('package.json', '{}');
		await put('tsconfig.json', '{}');
		await put(A, 'a');
	};

	it('keeps an earlier finding open while its test fails and resolves it the first check it passes or its loaded file lacks it', async () => {
		await scaffold();
		const fails = finding({ id: 'old-1', runId: 'old', test: 'B', file: A });
		const fixed = finding({ id: 'old-2', runId: 'old', test: 'C', file: A });
		const gone = finding({ id: 'old-3', runId: 'old', test: 'D', file: A });
		await writeTestChecks(store, checksWith([fails, fixed, gone], []));
		const c = await check([
			{ ...t('B', 'failed'), file: A },
			{ ...t('C', 'passed'), file: A }
		]);
		// D is gone from a file that loaded (renamed or removed): nothing left to fix, so resolved.
		expect(c.findings).toEqual([
			fails,
			{ ...fixed, resolvedAt: c.at },
			{ ...gone, resolvedAt: c.at }
		]);
		// The first resolution time stays; a resolved finding never reopens when its test fails again.
		const again = await check([
			{ ...t('B', 'failed'), file: A },
			{ ...t('C', 'failed'), file: A }
		]);
		expect(again.findings).toEqual([fails, c.findings[1], c.findings[2]]);
		expect(findingOpen(again.findings[1]!, again.result)).toBe(false);
	});

	it('resolves nothing when the tests did not run or timed out', async () => {
		const open = finding({ id: 'old-1', runId: 'old', test: 'B', file: A });
		await put(A, 'a');
		await writeTestChecks(store, checksWith([open], []));
		expect((await runTestChecks(ctx)).findings).toEqual([open]);
		await scaffold();
		const timedOut = await runTestChecks(ctx, {
			typecheck: async () => okTc,
			tests: async () => ({ ...result([]), timedOut: true })
		});
		expect(timedOut.findings).toEqual([open]);
	});

	it('keeps at most the 50 most recently resolved findings', async () => {
		await scaffold();
		const resolved = Array.from({ length: 52 }, (_, i) =>
			finding({
				id: `old-${i}`,
				runId: 'old',
				test: `T${i}`,
				file: A,
				resolvedAt: `2026-11-21T10:00:${String(i).padStart(2, '0')}.000Z`
			})
		);
		const open = finding({ id: 'old-open', runId: 'old', test: 'B', file: A });
		await writeTestChecks(store, checksWith([...resolved, open], []));
		const c = await check([{ ...t('B', 'failed'), file: A }]);
		expect(c.findings).toHaveLength(51);
		expect(c.findings).toContainEqual(open);
		expect(c.findings.map((f) => f.id)).not.toContain('old-0');
		expect(c.findings.map((f) => f.id)).not.toContain('old-1');
		expect(c.findings.map((f) => f.id)).toContain('old-51');
	});

	it('a run report for a test with a resolved finding adds a new open one and keeps the resolved one', async () => {
		await scaffold();
		const old = finding({ id: 'old-1', runId: 'old', test: 'A', file: A, resolvedAt: 'x' });
		await writeTestChecks(store, checksWith([old], []));
		const fresh = finding({ id: `${ctx.runId}-1`, runId: ctx.runId, test: 'A', file: A });
		await reportInRun({ findings: [fresh] });
		const c = await check([{ ...t('A', 'failed'), file: A }]);
		expect(c.findings).toEqual([old, fresh]);
		// Checked again in the same run, the run's report stays one entry.
		expect((await check([{ ...t('A', 'failed'), file: A }])).findings).toEqual([old, fresh]);
	});

	it('a report of the current run, once resolved, stays resolved when the run checks again', async () => {
		await scaffold();
		const fresh = finding({ id: `${ctx.runId}-1`, runId: ctx.runId, test: 'A', file: A });
		await reportInRun({ findings: [fresh] });
		const first = await check([{ ...t('A', 'passed'), file: A }]);
		expect(first.findings).toEqual([{ ...fresh, resolvedAt: first.at }]);
		const second = await check([{ ...t('A', 'failed'), file: A }]);
		expect(second.findings).toEqual(first.findings);
	});

	it('lets the current run replace an earlier finding for the same file and test', async () => {
		await scaffold();
		const old = finding({ id: 'old-1', runId: 'old', test: 'A', file: A, explanation: 'old' });
		const sameNameElsewhere = finding({
			id: 'old-2',
			runId: 'old',
			test: 'A',
			file: 'test/b.test.ts'
		});
		await put('test/b.test.ts', 'b');
		await writeTestChecks(store, checksWith([old, sameNameElsewhere], []));
		const fresh = finding({
			id: `${ctx.runId}-1`,
			runId: ctx.runId,
			test: 'A',
			file: A,
			explanation: 'new'
		});
		await reportInRun({ findings: [fresh] });
		const c = await check([
			{ ...t('A', 'failed'), file: A },
			{ ...t('A', 'failed'), file: 'test/b.test.ts' }
		]);
		expect(c.findings).toEqual([sameNameElsewhere, fresh]);
	});

	it('keeps test fixes as history, appends the current run once, and drops fixes of deleted files', async () => {
		await scaffold();
		const fix = (runId: string, test: string, file = A) => ({
			runId,
			test,
			file,
			reason: `${runId} ${test}`
		});
		await writeTestChecks(
			store,
			checksWith(
				[],
				[
					fix('old', 'A'),
					fix('old', 'B'),
					fix(ctx.runId, 'A'),
					fix('old', 'C', 'test/deleted.test.ts')
				]
			)
		);
		await reportInRun({ testFixes: [{ ...fix(ctx.runId, 'A'), reason: 'again' }] });
		const c = await check([]);
		expect(c.testFixes.map((f) => [f.runId, f.test, f.reason])).toEqual([
			['old', 'A', 'old A'],
			['old', 'B', 'old B'],
			[ctx.runId, 'A', 'again']
		]);
		const again = await check([]);
		expect(again.testFixes).toEqual(c.testFixes);
		expect(await readTestChecks(store)).toEqual(again);
	});

	it('readRunFindings is empty for a run without reports', async () => {
		expect(await readRunFindings(store, ctx.runId)).toEqual({
			findings: [],
			testFixes: [],
			fixResults: []
		});
	});
});
