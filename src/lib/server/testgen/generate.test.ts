import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyUsage } from '../agents/cost';
import type { runAgent } from '../agents/loop';
import type { RunResult } from '../agents/types';
import type { TestResult } from '../core/docker/parse';
import { createRun } from '../core/runs';
import type { DesignDoc } from '../core/schemas/design';
import type { Requirement, RequirementsDoc } from '../core/schemas/requirements';
import { ProjectStore } from '../core/store';
import { readTestChecks, runTestChecks, type TestChecks } from '../core/test-state';
import { executeTool, type ToolContext } from '../core/tools/index';
import type { GenerateEvent } from '../codegen/generate';
import { generateTests } from './generate';

let root: string;
let ctx: ToolContext;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-testgen-'));
	const store = new ProjectStore(path.join(root, 'proj'));
	await mkdir(store.dir, { recursive: true });
	const meta = await createRun(store, 'P5', 'test');
	ctx = { store, runId: meta.id, projectName: 'todo', agent: 'test' };
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const id = (prefix: string, n: number) => `${prefix}-${String(n).padStart(3, '0')}`;
const pathOf = (n: number) => `test/${id('UC', n)}.test.ts`;
const title = (reqN: number, ac: number) => `${id('REQ', reqN)} AC${ac}: crit ${reqN}.${ac}`;

/** Use case n links requirement n; requirement 1 has two criteria, every other one has one. */
function fixture(n = 2): { reqs: RequirementsDoc; design: DesignDoc } {
	const nums = Array.from({ length: n }, (_, i) => i + 1);
	const requirements: Requirement[] = nums.map((k) => ({
		id: id('REQ', k),
		title: `Title ${k}`,
		text: `Text ${k}`,
		type: 'functional',
		priority: 'must',
		acceptanceCriteria: k === 1 ? ['crit 1.1', 'crit 1.2'] : [`crit ${k}.1`]
	}));
	return {
		reqs: { requirements, openQuestions: [], assumptions: [], outOfScope: [] },
		design: {
			actors: [],
			useCases: nums.map((k) => ({
				id: id('UC', k),
				name: `Case ${k}`,
				description: '',
				actorIds: [],
				reqIds: [id('REQ', k)]
			})),
			classes: [],
			components: [],
			nodes: [],
			links: [],
			sequences: []
		}
	};
}

const emptyDoc = (): DesignDoc => fixture(0).design;

type Call = {
	model: string;
	maxTurns: number | undefined;
	writeOnly: string | undefined;
	agent: string;
	brief: string;
};

/**
 * A fake agent loop: workers (maxTurns 8) write their file through the real write_file, the
 * triage run (30) calls `triage` with the run options.
 */
function fakeRun(
	opts: {
		writes?: (c: Call, n: number) => boolean;
		cost?: number;
		delay?: number;
		workerResult?: Partial<RunResult>;
		triage?: (o: Parameters<typeof runAgent>[0]) => Promise<void>;
		triageResult?: Partial<RunResult>;
	} = {}
) {
	const calls: Call[] = [];
	let running = 0;
	let peak = 0;
	const perPath = new Map<string, number>();
	const run: typeof runAgent = async (o) => {
		const first = o.history[0]!.content;
		const call: Call = {
			model: o.def.model,
			maxTurns: o.maxTurns,
			writeOnly: o.ctx.writeOnly,
			agent: o.ctx.agent,
			brief: typeof first === 'string' ? first : ''
		};
		calls.push(call);
		running++;
		peak = Math.max(peak, running);
		if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
		const isTriage = call.writeOnly === undefined;
		const n = (perPath.get(call.writeOnly ?? 'triage') ?? 0) + 1;
		perPath.set(call.writeOnly ?? 'triage', n);
		if (isTriage) {
			await opts.triage?.(o);
			o.onEvent({ type: 'text', text: 'triaged' });
		} else if (opts.writes?.(call, n) ?? true) {
			const r = await executeTool(
				o.ctx,
				'write_file',
				{ path: call.writeOnly, content: `// attempt ${n}\n` },
				['write_file']
			);
			expect(r.isError).toBe(false);
			o.onEvent({
				type: 'tool',
				name: 'write_file',
				input: { path: call.writeOnly },
				result: r.content,
				isError: r.isError
			});
		}
		running--;
		return {
			status: 'done',
			text: isTriage ? 'triage text' : 'ok',
			usage: { ...emptyUsage(), input: 10 },
			costUsd: opts.cost ?? 0.01,
			turns: 1,
			...(isTriage ? opts.triageResult : opts.workerResult)
		};
	};
	return {
		run,
		calls,
		peak: () => peak,
		workers: (p?: string) =>
			calls.filter((c) => c.writeOnly !== undefined && (p === undefined || c.writeOnly === p)),
		triages: () => calls.filter((c) => c.writeOnly === undefined)
	};
}

const test = (
	t: string,
	file: string,
	status: TestResult['status'] = 'passed',
	over: Partial<TestResult> = {}
): TestResult => ({
	name: `describe ${t}`,
	title: t,
	file,
	status,
	...over
});

/** Passing tests for every criterion of the use cases `ucs` (default all), minus `except` titles. */
const passing = (n: number, except: string[] = []): TestResult[] =>
	Array.from({ length: n }, (_, i) => i + 1).flatMap((k) =>
		Array.from({ length: k === 1 ? 2 : 1 }, (_, j) => title(k, j + 1))
			.filter((t) => !except.includes(t))
			.map((t) => test(t, pathOf(k)))
	);

const checksOf = (tests: TestResult[], over: Partial<TestChecks> = {}): TestChecks => ({
	at: '',
	codeHash: null,
	testHash: null,
	typecheck: { ok: true, errors: [], timedOut: false },
	result: {
		ok: !tests.some((t) => t.status === 'failed'),
		passed: tests.filter((t) => t.status === 'passed').length,
		failed: tests.filter((t) => t.status === 'failed').length,
		tests,
		timedOut: false,
		logTail: 'LOG TAIL'
	},
	findings: [],
	testFixes: [],
	...over
});

const tscError = (file: string, message = 'TS2322: wrong type'): Partial<TestChecks> => ({
	typecheck: { ok: false, errors: [{ file, line: 3, col: 5, message }], timedOut: false }
});

const gen = (
	over: Partial<Parameters<typeof generateTests>[0]> & { events?: GenerateEvent[]; n?: number } = {}
) => {
	const events = over.events ?? [];
	const { reqs, design } = fixture(over.n ?? 2);
	return generateTests({
		ctx,
		reqs,
		design,
		onEvent: (e) => events.push(e),
		codeModel: async () => ({ decls: [], routes: [] }),
		...over
	});
};

const statusesOf = (events: GenerateEvent[], file: string) =>
	events.flatMap((e) => (e.type === 'file' && e.path === file ? [e.status] : []));

describe('generateTests', () => {
	it('writes one file per use case, checks once and skips triage when every file is ok', async () => {
		const fake = fakeRun({ cost: 0.5 });
		const events: GenerateEvent[] = [];
		let checks = 0;
		let models = 0;
		const r = await gen({
			run: fake.run,
			checks: async () => (checks++, checksOf(passing(2))),
			codeModel: async () => (models++, { decls: [], routes: [] }),
			events
		});
		expect(r.status).toBe('done');
		expect(r.files).toEqual({ [pathOf(1)]: 'ok', [pathOf(2)]: 'ok' });
		expect(r.checked).toBe(true);
		const workers = fake.workers();
		expect(workers.map((c) => c.writeOnly).sort()).toEqual([pathOf(1), pathOf(2)]);
		expect(
			workers.every((c) => c.model === 'claude-haiku-5-5' && c.maxTurns === 8 && c.agent === 'test')
		).toBe(true);
		expect(fake.triages()).toHaveLength(0);
		expect(checks).toBe(1);
		expect(models).toBe(1);
		expect(statusesOf(events, pathOf(1))).toEqual(['planned', 'writing', 'checking', 'ok']);
		expect(events.some((e) => e.type === 'worker' && e.path === pathOf(1))).toBe(true);
		expect(r.costUsd).toBeCloseTo(1);
		expect(r.usage.input).toBe(20);
		expect(r.turns).toBe(2);
	});

	it('runs at most 4 workers at once', async () => {
		const fake = fakeRun({ delay: 5 });
		const r = await gen({ n: 8, run: fake.run, checks: async () => checksOf(passing(8)) });
		expect(r.status).toBe('done');
		expect(fake.workers()).toHaveLength(8);
		expect(fake.peak()).toBe(4);
	});

	it('gives a plan without criteria and sequences no worker, no event and no status', async () => {
		const fake = fakeRun();
		const events: GenerateEvent[] = [];
		const { reqs, design } = fixture(1);
		design.useCases.push({
			id: 'UC-009',
			name: 'Empty',
			description: '',
			actorIds: [],
			reqIds: []
		});
		const r = await generateTests({
			ctx,
			reqs,
			design,
			onEvent: (e) => events.push(e),
			run: fake.run,
			checks: async () => checksOf(passing(1)),
			codeModel: async () => ({ decls: [], routes: [] })
		});
		expect(r.status).toBe('done');
		expect(r.files).toEqual({ [pathOf(1)]: 'ok' });
		expect(fake.workers().map((c) => c.writeOnly)).toEqual([pathOf(1)]);
		expect(events.some((e) => e.type === 'file' && e.path.includes('UC-009'))).toBe(false);
	});

	it('a planned file that was never written is not ok, even without criteria to miss', async () => {
		const { reqs, design } = fixture(1);
		design.useCases.push({
			id: 'UC-009',
			name: 'Only scenarios',
			description: '',
			actorIds: [],
			reqIds: []
		});
		design.sequences.push({ id: 'SEQ-001', name: 'Flow', useCaseId: 'UC-009', messages: [] });
		const fake = fakeRun({ writes: (c) => c.writeOnly !== 'test/UC-009.test.ts' });
		const r = await generateTests({
			ctx,
			reqs,
			design,
			onEvent: () => {},
			run: fake.run,
			checks: async () => checksOf(passing(1)),
			codeModel: async () => ({ decls: [], routes: [] })
		});
		expect(r.files).toEqual({ [pathOf(1)]: 'ok', 'test/UC-009.test.ts': 'failed' });
	});

	it('a file needs the scenario test of each of its sequences', async () => {
		const { reqs, design } = fixture(1);
		design.sequences.push({ id: 'SEQ-001', name: 'Flow', useCaseId: 'UC-001', messages: [] });
		design.sequences.push({ id: 'SEQ-002', name: 'Other', useCaseId: 'UC-001', messages: [] });
		const scenario = (n: number) => test(`SEQ-00${n} scenario: x`, pathOf(1));
		const fake = fakeRun();
		let round = 0;
		const r = await generateTests({
			ctx,
			reqs,
			design,
			onEvent: () => {},
			run: fake.run,
			checks: async () =>
				round++ === 0
					? checksOf([...passing(1), scenario(1)])
					: checksOf([...passing(1), scenario(1), scenario(2)]),
			codeModel: async () => ({ decls: [], routes: [] })
		});
		expect(r.files).toEqual({ [pathOf(1)]: 'ok' });
		expect(fake.workers(pathOf(1))).toHaveLength(2);
		expect(fake.workers(pathOf(1))[1]!.brief).toContain('SEQ-002');
	});

	it('retries a file with a suite level failure; a plain assertion failure does not retry', async () => {
		const fake = fakeRun();
		let round = 0;
		const r = await gen({
			run: fake.run,
			checks: async () => {
				round++;
				if (round > 1) return checksOf(passing(2));
				// UC-001 did not load; UC-002 loaded and its test fails on an assertion
				return checksOf([
					test('UC-001 Case 1', pathOf(1), 'failed', { suite: true, error: 'SyntaxError: boom' }),
					test(title(2, 1), pathOf(2), 'failed', { error: 'expected 1 to be 2' })
				]);
			}
		});
		expect(r.status).toBe('done');
		expect(fake.workers(pathOf(1))).toHaveLength(2);
		expect(fake.workers(pathOf(1))[1]!.brief).toContain('SyntaxError: boom');
		expect(fake.workers(pathOf(2))).toHaveLength(1);
		expect(r.files).toEqual({ [pathOf(1)]: 'ok', [pathOf(2)]: 'ok' });
	});

	it('never counts a file with a suite failure as ok, even when its other tests pass', async () => {
		const fake = fakeRun();
		const r = await gen({
			run: fake.run,
			checks: async () =>
				checksOf([
					...passing(2),
					test('UC-002 Case 2', pathOf(2), 'failed', { suite: true, error: 'afterAll threw' })
				])
		});
		expect(r.files).toEqual({ [pathOf(1)]: 'ok', [pathOf(2)]: 'failed' });
		expect(fake.workers(pathOf(2))).toHaveLength(3);
	});

	it('retries a file whose test for a criterion is missing, with the title in the brief', async () => {
		const fake = fakeRun();
		let round = 0;
		const r = await gen({
			run: fake.run,
			checks: async () =>
				round++ === 0 ? checksOf(passing(2, [title(1, 2)])) : checksOf(passing(2))
		});
		expect(r.files).toEqual({ [pathOf(1)]: 'ok', [pathOf(2)]: 'ok' });
		expect(fake.workers(pathOf(1))).toHaveLength(2);
		expect(fake.workers(pathOf(2))).toHaveLength(1);
		const retry = fake.workers(pathOf(1))[1]!.brief;
		expect(retry).toContain('This is a retry');
		expect(retry).toContain('// attempt 1');
		expect(retry).toContain(title(1, 2));
	});

	it('does not count a title for another requirement in the file for the criterion', async () => {
		const fake = fakeRun();
		let round = 0;
		const r = await gen({
			run: fake.run,
			checks: async () =>
				round++ === 0
					? // UC-001 has no REQ-001 AC1, but a stray REQ-002 AC1 title
						checksOf([...passing(2, [title(1, 1)]), test(title(2, 1), pathOf(1))])
					: checksOf(passing(2))
		});
		expect(r.files).toEqual({ [pathOf(1)]: 'ok', [pathOf(2)]: 'ok' });
		expect(fake.workers(pathOf(1))).toHaveLength(2);
		expect(fake.workers(pathOf(1))[1]!.brief).toContain(`No test for REQ-001 AC1`);
	});

	it('routes a tsc error printed with backslashes to its test file', async () => {
		const fake = fakeRun();
		let round = 0;
		await gen({
			run: fake.run,
			checks: async () =>
				round++ === 0
					? checksOf(passing(2), tscError(pathOf(1).replaceAll('/', '\\')))
					: checksOf(passing(2))
		});
		expect(fake.workers(pathOf(1))).toHaveLength(2);
		expect(fake.workers(pathOf(2))).toHaveLength(1);
	});

	it('counts a manual todo for a criterion, but not a todo without the manual marker or a skipped test', async () => {
		const manual = `${id('REQ', 1)} AC2: manual: needs a browser`;
		const fake = fakeRun();
		let round = 0;
		const r = await gen({
			run: fake.run,
			checks: async () => {
				const base = passing(2, [title(1, 2)]);
				if (round++ === 0)
					return checksOf([
						...base,
						test(title(1, 2), pathOf(1), 'todo'),
						test(title(2, 1), pathOf(2), 'skipped')
					]);
				return checksOf([...base, test(manual, pathOf(1), 'todo')]);
			}
		});
		expect(r.files).toEqual({ [pathOf(1)]: 'ok', [pathOf(2)]: 'ok' });
		expect(fake.workers(pathOf(1))).toHaveLength(2);
	});

	it('escalates attempt 3 to Sonnet, marks a file failed after 3 attempts and still ends done', async () => {
		const fake = fakeRun();
		const events: GenerateEvent[] = [];
		const r = await gen({
			run: fake.run,
			checks: async () => checksOf(passing(2), tscError(`./${pathOf(1)}`)),
			events
		});
		expect(r.status).toBe('done');
		expect(r.files).toEqual({ [pathOf(1)]: 'failed', [pathOf(2)]: 'ok' });
		const calls = fake.workers(pathOf(1));
		expect(calls.map((c) => c.model)).toEqual([
			'claude-haiku-5-5',
			'claude-haiku-5-5',
			'claude-sonnet-5-5'
		]);
		expect(calls[1]!.brief).toContain('TS2322: wrong type');
		expect(fake.workers(pathOf(2))).toHaveLength(1);
		expect(statusesOf(events, pathOf(1))).toEqual([
			'planned',
			'writing',
			'checking',
			'retrying',
			'checking',
			'escalated',
			'checking',
			'failed'
		]);
		expect(fake.triages()).toHaveLength(0);
	});

	it('retries a file the worker never wrote', async () => {
		const fake = fakeRun({ writes: (c, n) => !(c.writeOnly === pathOf(1) && n === 1) });
		const r = await gen({ run: fake.run, checks: async () => checksOf(passing(2)) });
		expect(r.files).toEqual({ [pathOf(1)]: 'ok', [pathOf(2)]: 'ok' });
		expect(fake.workers(pathOf(1))).toHaveLength(2);
		expect(fake.workers(pathOf(1))[1]!.brief).toContain('did not write the file');
	});

	it('runs triage once after the rounds when a test fails, streamed as wiring events, then checks again', async () => {
		const fake = fakeRun();
		const events: GenerateEvent[] = [];
		let checks = 0;
		const r = await gen({
			run: fake.run,
			checks: async () => {
				checks++;
				return checksOf([
					...passing(2, [title(2, 1)]),
					test(title(2, 1), pathOf(2), 'failed', { error: 'expected 1 to be 2' })
				]);
			},
			events
		});
		expect(r.status).toBe('done');
		expect(r.files).toEqual({ [pathOf(1)]: 'ok', [pathOf(2)]: 'ok' });
		const [triage] = fake.triages();
		expect(fake.triages()).toHaveLength(1);
		expect(triage).toMatchObject({ model: 'claude-sonnet-5-5', maxTurns: 30, agent: 'test' });
		expect(triage!.brief).toMatch(/^Mode triage/);
		expect(triage!.brief).toContain(title(2, 1));
		expect(triage!.brief).toContain('LOG TAIL');
		expect(events).toContainEqual({ type: 'wiring', event: { type: 'text', text: 'triaged' } });
		expect(checks).toBe(2);
		expect(r.text).toBe('triage text');
		expect(r.costUsd).toBeCloseTo(0.03);
		expect(r.usage.input).toBe(30); // two workers and the triage run
		expect(r.turns).toBe(3);
	});

	it('does not triage a suite level failure', async () => {
		const fake = fakeRun();
		await gen({
			run: fake.run,
			checks: async () =>
				checksOf([
					...passing(2),
					test('UC-002 Case 2', pathOf(2), 'failed', { suite: true, error: 'boom' })
				])
		});
		expect(fake.triages()).toHaveLength(0);
	});

	it('puts a test fix reported during triage into the final checks, with its finding', async () => {
		await writeFile(ctx.store.resolve('package.json'), '{}');
		await writeFile(ctx.store.resolve('tsconfig.json'), '{}');
		const failing = [
			...passing(2, [title(2, 1)]),
			test(title(2, 1), pathOf(2), 'failed', { error: 'expected 1 to be 2' })
		];
		const fake = fakeRun({
			triage: async (o) => {
				const fix = await executeTool(
					o.ctx,
					'report_test_fix',
					{ test: title(1, 1), file: pathOf(1), reason: 'wrong import path' },
					['report_test_fix']
				);
				expect(fix.isError).toBe(false);
				const bug = await executeTool(
					o.ctx,
					'report_code_bug',
					{
						test: title(2, 1),
						file: pathOf(2),
						reqId: 'REQ-002',
						explanation: 'returns 1',
						proposedFix: 'return 2'
					},
					['report_code_bug']
				);
				expect(bug.isError).toBe(false);
			}
		});
		const r = await gen({
			run: fake.run,
			checks: (c) =>
				runTestChecks(c, {
					typecheck: async () => ({ ok: true, errors: [], timedOut: false }),
					tests: async () => ({
						ok: false,
						passed: 2,
						failed: 1,
						tests: failing,
						timedOut: false,
						logTail: ''
					})
				})
		});
		expect(r.status).toBe('done');
		const stored = await readTestChecks(ctx.store);
		expect(stored?.testFixes).toEqual([
			{ runId: ctx.runId, test: title(1, 1), file: pathOf(1), reason: 'wrong import path' }
		]);
		expect(stored?.findings).toHaveLength(1);
		expect(stored?.findings[0]).toMatchObject({ test: title(2, 1), reqId: 'REQ-002' });
	});

	it('records a test file that triage rewrote without a report as a test fix, and leaves reported ones alone', async () => {
		await writeFile(ctx.store.resolve('package.json'), '{}');
		await writeFile(ctx.store.resolve('tsconfig.json'), '{}');
		const failing = [
			...passing(2, [title(2, 1)]),
			test(title(2, 1), pathOf(2), 'failed', { error: 'expected 1 to be 2' })
		];
		const fake = fakeRun({
			triage: async (o) => {
				// UC-001 is rewritten and reported, UC-002 is rewritten silently, UC-003 is added silently
				for (const [file, content] of [
					[pathOf(1), '// reported rewrite\n'],
					[pathOf(2), '// silent rewrite\n'],
					[pathOf(3), '// silent new file\n']
				] as const)
					await executeTool(o.ctx, 'write_file', { path: file, content }, ['write_file']);
				await executeTool(
					o.ctx,
					'report_test_fix',
					{ test: title(1, 1), file: pathOf(1), reason: 'wrong import path' },
					['report_test_fix']
				);
			}
		});
		await gen({
			run: fake.run,
			checks: (c) =>
				runTestChecks(c, {
					typecheck: async () => ({ ok: true, errors: [], timedOut: false }),
					tests: async () => ({
						ok: false,
						passed: 2,
						failed: 1,
						tests: failing,
						timedOut: false,
						logTail: ''
					})
				})
		});
		const fixes = (await readTestChecks(ctx.store))?.testFixes ?? [];
		expect(fixes.map((f) => [f.file, f.reason]).sort()).toEqual([
			[pathOf(1), 'wrong import path'],
			[pathOf(2), 'changed during triage without a report'],
			[pathOf(3), 'changed during triage without a report']
		]);
		expect(fixes.find((f) => f.file === pathOf(2))!.test).toBe('UC-002.test.ts');
	});

	it('records nothing when triage leaves every test file as it is', async () => {
		await writeFile(ctx.store.resolve('package.json'), '{}');
		await writeFile(ctx.store.resolve('tsconfig.json'), '{}');
		const failing = [
			...passing(2, [title(2, 1)]),
			test(title(2, 1), pathOf(2), 'failed', { error: 'x' })
		];
		await gen({
			run: fakeRun().run,
			checks: (c) =>
				runTestChecks(c, {
					typecheck: async () => ({ ok: true, errors: [], timedOut: false }),
					tests: async () => ({
						ok: false,
						passed: 2,
						failed: 1,
						tests: failing,
						timedOut: false,
						logTail: ''
					})
				})
		});
		expect((await readTestChecks(ctx.store))?.testFixes).toEqual([]);
	});

	it('skips triage and ends failed with the reason when the cost limit is passed', async () => {
		const fake = fakeRun({ cost: 1.5 });
		let checks = 0;
		const r = await gen({
			run: fake.run,
			costLimitUsd: 2,
			checks: async () => (
				checks++,
				checksOf([
					...passing(2, [title(2, 1)]),
					test(title(2, 1), pathOf(2), 'failed', { error: 'expected 1 to be 2' })
				])
			)
		});
		expect(r.status).toBe('failed');
		expect(r.error).toMatch(/Cost limit of \$2\.00 exceeded/);
		expect(fake.triages()).toHaveLength(0);
		expect(fake.workers()).toHaveLength(2);
		expect(r.checked).toBe(true);
		expect(checks).toBe(1);
	});

	it('starts no new worker once the cost limit is passed', async () => {
		const fake = fakeRun({ cost: 1 });
		const r = await gen({
			n: 8,
			run: fake.run,
			costLimitUsd: 2,
			checks: async () => checksOf(passing(8))
		});
		expect(r.status).toBe('failed');
		expect(fake.workers().length).toBeLessThan(8);
		expect(fake.triages()).toHaveLength(0);
	});

	it('ends failed with checked false when the checks throw (Docker down)', async () => {
		const fake = fakeRun();
		const r = await gen({
			run: fake.run,
			checks: async () => {
				throw new Error('Cannot connect to the Docker daemon');
			}
		});
		expect(r.status).toBe('failed');
		expect(r.error).toBe('Cannot connect to the Docker daemon');
		expect(r.checked).toBe(false);
		expect(r.files).toEqual({ [pathOf(1)]: 'failed', [pathOf(2)]: 'failed' });
		expect(fake.triages()).toHaveLength(0);
	});

	it('ends failed when the test run or typecheck timed out', async () => {
		const fake = fakeRun();
		const r = await gen({
			run: fake.run,
			checks: async () => {
				const c = checksOf(passing(2));
				return { ...c, result: { ...c.result!, timedOut: true } };
			}
		});
		expect(r.status).toBe('failed');
		expect(r.error).toMatch(/timed out/i);
	});

	it('ends failed when a worker fails with an error', async () => {
		const fake = fakeRun({
			workerResult: { status: 'failed', reason: 'error', error: 'API down' }
		});
		const r = await gen({ run: fake.run, checks: async () => checksOf(passing(2)) });
		expect(r.status).toBe('failed');
		expect(r.error).toBe('API down');
	});

	it('ends failed when the triage run fails with an error, done when it only hits the turn limit', async () => {
		const failing = checksOf([
			...passing(2, [title(2, 1)]),
			test(title(2, 1), pathOf(2), 'failed', { error: 'x' })
		]);
		const errored = await gen({
			run: fakeRun({ triageResult: { status: 'failed', reason: 'error', error: 'API down' } }).run,
			checks: async () => failing
		});
		expect(errored.status).toBe('failed');
		expect(errored.error).toBe('API down');
		const limited = await gen({
			run: fakeRun({ triageResult: { status: 'failed', reason: 'turn_limit' } }).run,
			checks: async () => failing
		});
		expect(limited.status).toBe('done');
	});

	it('plans nothing and writes nothing for a project without use cases or requirements', async () => {
		const fake = fakeRun();
		const r = await generateTests({
			ctx,
			reqs: fixture(0).reqs,
			design: emptyDoc(),
			onEvent: () => {},
			run: fake.run,
			checks: async () => checksOf([]),
			codeModel: async () => ({ decls: [], routes: [] })
		});
		expect(r.status).toBe('done');
		expect(r.files).toEqual({});
		expect(fake.calls).toHaveLength(0);
	});
});
