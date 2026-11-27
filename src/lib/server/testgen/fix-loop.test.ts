import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codeAgent } from '../agents/code';
import { emptyUsage } from '../agents/cost';
import type { runAgent } from '../agents/loop';
import { testAgent } from '../agents/test';
import type { AgentDef, RunResult } from '../agents/types';
import { codeHash, writeChecks, type CodeChecks } from '../core/code-state';
import type { TestResult } from '../core/docker/parse';
import type { DriftItem } from '../core/drift';
import { createRun } from '../core/runs';
import { ProjectStore } from '../core/store';
import {
	readRunFindings,
	readTestChecks,
	runTestChecks,
	testHash,
	writeTestChecks,
	type Finding
} from '../core/test-state';
import { executeTool, type ToolContext } from '../core/tools/index';
import { failureOf, FIX_LOOP_COST_LIMIT_USD, fixLoop, type AgentMessage } from './fix-loop';

let root: string;
let store: ProjectStore;
let ctx: ToolContext;

/** Tests of the fake project: title i lives in test/UC-00i.test.ts. */
const T = [1, 2, 3, 4].map((i) => `REQ-00${i} AC1: crit ${i}`);
const F = [1, 2, 3, 4].map((i) => `test/UC-00${i}.test.ts`);
const RETRY = 'The last attempt did not make this test pass.';

const CORRECTED = 'The test agent corrected the test; fix the code for the corrected test.';

/** What the stub runners report: failing titles, typecheck errors, drift items and test files that do not load. */
let world: {
	failing: Set<string>;
	tsc: { file: string; message: string }[];
	drift: DriftItem[];
	suite: Map<string, string>;
};
let log: string[];
let messages: AgentMessage[];
let codeCtxs: ToolContext[];
let testCtxs: ToolContext[];

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-fixloop-'));
	store = new ProjectStore(path.join(root, 'proj'));
	await mkdir(store.resolve('src'), { recursive: true });
	await mkdir(store.resolve('test'), { recursive: true });
	await writeFile(store.resolve('package.json'), '{}');
	await writeFile(store.resolve('tsconfig.json'), '{}');
	await writeFile(store.resolve('src/app.ts'), 'export const v = 0;\n');
	for (const f of F) await writeFile(store.resolve(f), `// ${f}\n`);
	const meta = await createRun(store, 'P5', 'test');
	ctx = { store, runId: meta.id, projectName: 'todo', agent: 'test' };
	world = { failing: new Set(), tsc: [], drift: [], suite: new Map() };
	log = [];
	messages = [];
	codeCtxs = [];
	testCtxs = [];
	await storeP4([]);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const typecheckNow = () => ({
	ok: world.tsc.length === 0,
	errors: world.tsc.map((e) => ({ ...e, line: 3, col: 5 })),
	timedOut: false
});

const testsNow = () => {
	// A file that does not load has no test entries, only its suite entry.
	const tests: TestResult[] = T.flatMap((title, i): TestResult[] =>
		world.suite.has(F[i]!)
			? [
					{
						name: F[i]!,
						title: F[i]!,
						file: F[i]!,
						status: 'failed',
						suite: true,
						error: world.suite.get(F[i]!)!
					}
				]
			: [
					{
						name: `describe ${title}`,
						title,
						file: F[i]!,
						status: world.failing.has(title) ? 'failed' : 'passed',
						...(world.failing.has(title) ? { error: `expected ok (${title})` } : {})
					}
				]
	);
	const failed = tests.filter((t) => t.status === 'failed').length;
	return {
		ok: failed === 0,
		passed: tests.length - failed,
		failed,
		tests,
		timedOut: false,
		logTail: 'LOG TAIL'
	};
};

/** The real P5 checks over stub runners, so findings and test fixes merge as in a real run. */
const testChecks: typeof runTestChecks = async (c) => {
	log.push('testChecks');
	testCtxs.push(c);
	return runTestChecks(c, { typecheck: async () => typecheckNow(), tests: async () => testsNow() });
};

const codeChecks = async (c: ToolContext): Promise<CodeChecks> => {
	log.push('codeChecks');
	codeCtxs.push(c);
	return {
		at: '',
		codeHash: null,
		designHash: null,
		typecheck: typecheckNow(),
		drift: [...world.drift],
		start: null
	};
};

/** Stored P4 checks from before the loop, the baseline; current unless `hash` is given. */
async function storeP4(
	errors: { file: string; message: string }[],
	drift: DriftItem[] = [],
	timedOut = false,
	hash?: string
) {
	await writeChecks(store, {
		at: '',
		codeHash: hash ?? (await codeHash(store)),
		designHash: null,
		typecheck: {
			ok: errors.length === 0 && !timedOut,
			errors: errors.map((e) => ({ ...e, line: 1, col: 1 })),
			timedOut
		},
		drift,
		start: null
	});
}

/**
 * Stored P5 checks as the caller leaves them, current unless `stale`: findings of an earlier run
 * G, `failing` failing.
 */
async function seed(
	failing: string[],
	findings: { id: string; i: number }[] = [],
	{ stale = false } = {}
) {
	world.failing = new Set(failing);
	const stored: Finding[] = findings.map(({ id, i }) => ({
		id,
		runId: 'G',
		test: T[i]!,
		file: F[i]!,
		explanation: `bug behind ${id}\nsecond line`,
		proposedFix: `fix ${id}`
	}));
	await writeTestChecks(store, {
		at: '',
		codeHash: stale ? 'stale' : await codeHash(store),
		testHash: stale ? 'stale' : await testHash(store),
		typecheck: typecheckNow(),
		result: testsNow(),
		findings: stored,
		testFixes: []
	});
}

type Opts = Parameters<typeof runAgent>[0];
type Call = {
	agent: string;
	ctx: ToolContext;
	def: AgentDef;
	maxTurns?: number;
	costLimitUsd?: number;
	brief: string;
};

/** Calls a tool the way the agent loop would: with the step's ctx and def. */
async function tool(o: Opts, name: string, input: unknown) {
	const r = await executeTool(o.ctx, name, input, o.def.tools);
	expect(r.isError, r.content).toBe(false);
	return JSON.parse(r.content) as Record<string, unknown>;
}

let writes = 0;
/** A change under src/ (code agent) or test/ (test agent) with new content, so p5Hash moves. */
const edit = (o: Opts, file = 'src/app.ts') =>
	tool(o, 'write_file', { path: file, content: `// edit ${++writes}\n` });
const reply = (o: Opts, findingId: string, outcome: string, reason = 'because') =>
	tool(o, 'report_fix_result', { findingId, outcome, reason });
const bug = async (o: Opts, i: number) =>
	(
		(await tool(o, 'report_code_bug', {
			test: T[i],
			file: F[i],
			explanation: `triaged ${i}`,
			proposedFix: 'fix it'
		})) as { finding: Finding }
	).finding.id;

/**
 * A fake agent loop: the step with ctx.agent 'code' is the fix, any other the triage; `n` counts
 * the calls of that kind from 1.
 */
function fakeRun(
	opts: {
		triage?: (o: Opts, n: number) => Promise<void>;
		fix?: (o: Opts, n: number) => Promise<void>;
		cost?: number;
		result?: Partial<RunResult>;
	} = {}
) {
	const calls: Call[] = [];
	const run: typeof runAgent = async (o) => {
		const first = o.history[0]!.content;
		const call: Call = {
			agent: o.ctx.agent,
			ctx: o.ctx,
			def: o.def,
			maxTurns: o.maxTurns,
			costLimitUsd: o.costLimitUsd,
			brief: typeof first === 'string' ? first : ''
		};
		calls.push(call);
		log.push(`run ${o.ctx.agent}`);
		const n = calls.filter((c) => c.agent === call.agent).length;
		if (o.ctx.agent === 'code') await opts.fix?.(o, n);
		else await opts.triage?.(o, n);
		o.onEvent({ type: 'text', text: 'step' });
		return {
			status: 'done',
			text: 'ok',
			usage: { ...emptyUsage(), input: 10 },
			costUsd: opts.cost ?? 0.1,
			turns: 1,
			...opts.result
		};
	};
	return {
		run,
		calls,
		fixes: () => calls.filter((c) => c.agent === 'code'),
		triages: () => calls.filter((c) => c.agent !== 'code')
	};
}

const loop = (
	fake: ReturnType<typeof fakeRun>,
	over: Partial<Parameters<typeof fixLoop>[0]> = {}
) =>
	fixLoop({
		ctx,
		agents: { test: testAgent, code: codeAgent },
		run: fake.run,
		codeChecks,
		testChecks,
		onEvent: () => {},
		onMessage: (m) => {
			messages.push(m);
			log.push(`msg ${m.from}>${m.to}`);
		},
		...over
	});

describe('fixLoop', () => {
	it('ends done after round 1 when the fix makes every test pass', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({
			fix: async (o) => {
				await edit(o);
				await reply(o, 'G-1', 'fixed');
				world.failing.delete(T[0]!);
			}
		});
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(r.checked).toBe(true);
		expect(fake.triages()).toHaveLength(0);
		expect(fake.fixes()).toHaveLength(1);
		expect(log.filter((l) => l.endsWith('Checks'))).toEqual(['codeChecks', 'testChecks']);
		expect(r.costUsd).toBeCloseTo(0.1);
		expect(r.usage.input).toBe(10);
		expect(r.text).toContain('Fix loop: 1 round.');
		expect(r.text).toContain('Fixed: G-1');
	});

	/** Round 1 fixes G-1 but breaks T2; round 2 triage reports it and the fix repairs it. */
	const newFailureScenario = () => {
		let reported = '';
		const fake = fakeRun({
			fix: async (o, n) => {
				await edit(o);
				if (n === 1) {
					await reply(o, 'G-1', 'fixed');
					world.failing = new Set([T[1]!]);
				} else world.failing.clear();
			},
			triage: async (o) => {
				reported = await bug(o, 1);
			}
		});
		return { fake, reported: () => reported };
	};

	it('triages in round 2 a failure the fix of round 1 caused, and hands its report over', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const { fake, reported } = newFailureScenario();
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(r.checked).toBe(true);
		expect(fake.calls.map((c) => c.agent)).toEqual(['code', 'test', 'code']);
		expect(fake.triages()[0]!.brief).toContain(T[1]);
		expect(fake.triages()[0]!.brief).not.toContain(T[0]);
		expect(fake.fixes().map((c) => c.ctx.handedOver)).toEqual([['G-1'], [reported()]]);
		expect(r.turns).toBe(3);
		expect(r.costUsd).toBeCloseTo(0.3);
	});

	it('never hands a needs_design_change finding over again and ends done with it open', async () => {
		await seed(
			[T[0]!, T[1]!],
			[
				{ id: 'G-1', i: 0 },
				{ id: 'G-2', i: 1 }
			]
		);
		const fake = fakeRun({
			fix: async (o, n) => {
				await edit(o);
				if (n === 1) await reply(o, 'G-1', 'needs_design_change', 'Task has no dueDate');
				else world.failing.delete(T[1]!);
			}
		});
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(fake.fixes().map((c) => c.ctx.handedOver)).toEqual([['G-1', 'G-2'], ['G-2']]);
		expect(fake.triages()).toHaveLength(0);
		expect(messages[1]!.text).toContain('G-1 needs a design change: Task has no dueDate');
		expect(r.text).toMatch(/Declined.*G-1/);
		// Nothing left ends the loop in round 2, not after an empty round 3.
		expect(r.text).toContain('Fix loop: 2 rounds.');
	});

	it('sends a test_looks_wrong finding to triage with the reason and never back to the code agent', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({
			// The code agent changes no file: the dispute alone must keep the loop going.
			fix: async (o) => {
				await reply(o, 'G-1', 'test_looks_wrong', 'the criterion says two items.');
			},
			triage: async (o) => {
				await edit(o, F[0]);
				await tool(o, 'report_test_fix', { test: T[0], file: F[0], reason: 'wrong count' });
				world.failing.clear();
			}
		});
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(fake.calls.map((c) => c.agent)).toEqual(['code', 'test']);
		expect(fake.triages()[0]!.brief).toContain(
			'The code agent says this test looks wrong, for this reason:\n```\nthe criterion says two items.\n```'
		);
		expect(messages[1]!.text).toContain('G-1 test looks wrong: the criterion says two items.');
	});

	it('gives the same test a second attempt with the retry line, under a new finding ID, and never a third', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		let r1 = '';
		let r2 = '';
		const fake = fakeRun({
			// T1 never passes; round 1 also breaks T2, which round 2 fixes.
			fix: async (o, n) => {
				await edit(o);
				if (n === 1) world.failing.add(T[1]!);
				else world.failing.delete(T[1]!);
			},
			// Triage reports T2 and reports T1 again, so T1 gets a new ID.
			triage: async (o) => {
				r1 = await bug(o, 1);
				r2 = await bug(o, 0);
			}
		});
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(fake.calls.map((c) => c.agent)).toEqual(['code', 'test', 'code']);
		expect(fake.fixes()[1]!.ctx.handedOver).toEqual([r1, r2]);
		const [first, second] = fake.fixes().map((c) => c.brief);
		expect(first).not.toContain(RETRY);
		expect(second).toContain(`Finding ${r2}\n${RETRY}`);
		expect(second).not.toContain(`Finding ${r1}\n${RETRY}`);
	});

	it('stops when a triage step changes a test file an earlier triage of the loop changed', async () => {
		await seed([T[0]!]);
		const fake = fakeRun({
			// T1 stays failing and unexplained, so round 2 triages again.
			triage: async (o) => {
				await edit(o, F[0]);
			}
		});
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(r.checked).toBe(false);
		expect(fake.triages()).toHaveLength(2);
		expect(fake.fixes()).toHaveLength(0);
		expect(fake.triages()[0]!.brief).not.toContain('Do not change these test files again');
		expect(fake.triages()[1]!.brief).toContain(`Do not change these test files again:\n- ${F[0]}`);
		expect(messages.at(-1)).toEqual({
			from: 'checks',
			to: 'test',
			text: `${F[0]} was changed twice by triage; it needs the developer.`,
			findingIds: []
		});
		// No checks after the second triage: the orchestrator's final checks run them.
		expect(log.at(-2)).toBe('run test');
	});

	/** Each fix breaks the next test; triage reports it, so every round has work. */
	const endlessScenario = () =>
		fakeRun({
			fix: async (o, n) => {
				await edit(o);
				world.failing.add(T[n]!);
			},
			triage: async (o, n) => {
				await bug(o, n);
			}
		});

	it('stops after 3 rounds, or after maxRounds', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = endlessScenario();
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(r.checked).toBe(true);
		expect(fake.calls.map((c) => c.agent)).toEqual(['code', 'test', 'code', 'test', 'code']);
		expect(r.text).toContain('Fix loop: 3 rounds.');

		log = [];
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const one = endlessScenario();
		expect((await loop(one, { maxRounds: 1 })).status).toBe('done');
		expect(one.calls.map((c) => c.agent)).toEqual(['code']);
	});

	it('stops when a round changed no file under src/ or test/', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({ fix: async (o) => void (await reply(o, 'G-1', 'fixed')) });
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(r.checked).toBe(true);
		// G-1 has an attempt left; only the unchanged hash ends the loop.
		expect(fake.fixes()).toHaveLength(1);
	});

	it('stops at the cost limit before the next step', async () => {
		expect(FIX_LOOP_COST_LIMIT_USD).toBe(3);
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({ cost: 3, fix: async (o) => void (await edit(o)) });
		const r = await loop(fake);
		expect(r.status).toBe('failed');
		expect(r.error).toBe('Cost limit of $3.00 exceeded ($3.00 spent); the fix loop stopped.');
		expect(r.checked).toBe(false);
		expect(log).not.toContain('codeChecks');
	});

	it('gives each step its own ctx and def, and the checks the loop ctx', async () => {
		// The orchestrator's ctx agent must not leak into the triage step.
		ctx = { ...ctx, agent: 'code' };
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const { fake, reported } = newFailureScenario();
		await loop(fake);
		const [triage] = fake.triages();
		expect(triage!.ctx).toEqual({ ...ctx, agent: 'test' });
		expect(triage!.def).toBe(testAgent);
		expect(triage!.maxTurns).toBe(30);
		const fixes = fake.fixes();
		expect(fixes.map((c) => c.ctx)).toEqual([
			{ ...ctx, agent: 'code', fixLoop: true, handedOver: ['G-1'] },
			{ ...ctx, agent: 'code', fixLoop: true, handedOver: [reported()] }
		]);
		for (const c of fixes) {
			expect(c.def).toEqual({ ...codeAgent, tools: [...codeAgent.tools, 'report_fix_result'] });
			expect(c.maxTurns).toBe(40);
		}
		expect([...codeCtxs, ...testCtxs].every((c) => c === ctx)).toBe(true);
	});

	it('hands typecheck errors and drift a fix left to the next round and ends failed when they stay', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({
			fix: async (o, n) => {
				await edit(o);
				if (n === 1) {
					world.failing.clear();
					world.tsc = [{ file: 'src/app.ts', message: 'TS2322: wrong type' }];
					world.drift = [{ kind: 'changed', name: 'Task', file: 'src/task.ts', details: ['id'] }];
				}
			}
		});
		const r = await loop(fake);
		expect(r.status).toBe('failed');
		expect(r.error).toBe('The fix loop left the code with typecheck errors or drift');
		expect(r.checked).toBe(true);
		const fixes = fake.fixes();
		expect(fixes).toHaveLength(3);
		expect(fixes[0]!.brief).not.toContain('Your last change left these problems');
		expect(fixes[1]!.ctx.handedOver).toEqual([]);
		expect(fixes[1]!.brief).toContain('Your last change left typecheck errors or drift');
		expect(fixes[1]!.brief).toContain('src/app.ts(3,5): TS2322: wrong type');
		expect(fixes[1]!.brief).toContain('Task');
	});

	it('emits the handoffs in order: test to code, code to test, checks to test', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({
			fix: async (o) => {
				await edit(o);
				world.failing.delete(T[0]!);
			}
		});
		await loop(fake);
		expect(log).toEqual([
			'msg test>code',
			'run code',
			'msg code>test',
			'codeChecks',
			'testChecks',
			'msg checks>test'
		]);
		expect(messages).toEqual([
			{ from: 'test', to: 'code', text: 'Please fix G-1: bug behind G-1', findingIds: ['G-1'] },
			// No reply from the code agent counts as fixed.
			{ from: 'code', to: 'test', text: 'G-1 fixed', findingIds: ['G-1'] },
			{ from: 'checks', to: 'test', text: 'Round 1: 4 passed, 0 failed', findingIds: [] }
		]);
	});

	it('ends failed when an agent step fails with an error', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({ result: { status: 'failed', reason: 'error', error: 'API down' } });
		const r = await loop(fake);
		expect(r.status).toBe('failed');
		expect(r.error).toBe('API down');
		expect(log).not.toContain('codeChecks');
	});

	it('ends failed when a check times out or throws', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fix = async (o: Opts) => void (await edit(o));
		const r = await loop(fakeRun({ fix }), {
			testChecks: async (c) => ({
				...(await testChecks(c)),
				result: { ...testsNow(), timedOut: true }
			})
		});
		expect(r).toMatchObject({ status: 'failed', error: 'Typecheck or test run timed out' });
		expect(r.checked).toBe(true);

		const thrown = await loop(fakeRun({ fix }), {
			codeChecks: async () => {
				throw new Error('Docker is not running');
			}
		});
		expect(thrown).toMatchObject({ status: 'failed', error: 'Docker is not running' });
		expect(thrown.checked).toBe(false);
	});

	it('ignores typecheck errors under test/ and test files that did not load before the loop', async () => {
		world.tsc = [{ file: F[0]!, message: 'TS2304: Cannot find name x' }];
		world.suite.set(F[2]!, 'Cannot find module ./gone');
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const r = await loop(fixAll());
		expect(r.status).toBe('done');
		expect(r.text).toContain('Fix loop: 1 round.');
	});

	it('stops at once when a fix breaks a test file, without another agent step', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({
			fix: async (o) => {
				await edit(o);
				world.failing.clear();
				world.suite.set(F[1]!, 'Cannot find module ../src/store');
				world.tsc = [{ file: F[2]!, message: 'TS2305: no export save' }];
			}
		});
		const r = await loop(fake);
		expect(r).toMatchObject({
			status: 'failed',
			error: 'The fix loop left test files that no longer load or type check',
			checked: true
		});
		expect(fake.calls).toHaveLength(1);
		expect(messages.at(-1)).toEqual({
			from: 'checks',
			to: 'test',
			text: `New problems in test files: ${F[1]}, ${F[2]}. The code agent cannot change test/, so the fix loop stops here.`,
			findingIds: []
		});
	});

	it('stops at once when triage breaks a test file', async () => {
		await seed([T[0]!]);
		const fake = fakeRun({
			triage: async (o) => {
				await edit(o, F[3]);
				await bug(o, 0);
				world.suite.set(F[3]!, 'SyntaxError: Unexpected token');
			}
		});
		const r = await loop(fake);
		expect(r).toMatchObject({
			status: 'failed',
			error: 'The fix loop left test files that no longer load or type check'
		});
		expect(fake.calls.map((c) => c.agent)).toEqual(['test']);
		expect(messages.at(-1)!.text).toBe(
			`New problems in test files: ${F[3]}. Triage left them; the fix loop stops here.`
		);
	});

	it('does not start an agent step with less than $0.10 left', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		// T2 breaks each round, so there is always more to do.
		const fake = fakeRun({
			fix: async (o, n) => {
				await edit(o);
				world.failing.add(T[n]!);
			},
			triage: async (o, n) => void (await bug(o, n))
		});
		const r = await loop(fake, { costLimitUsd: 0.15 });
		expect(r).toMatchObject({
			status: 'failed',
			error: 'Cost limit of $0.15 exceeded ($0.10 spent); the fix loop stopped.'
		});
		expect(fake.calls).toHaveLength(1);
		expect(log).toContain('testChecks');

		// The same before a fix step: G-1 keeps failing, so round 2 would retry it.
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fix = fakeRun({ fix: async (o) => void (await edit(o)) });
		expect((await loop(fix, { costLimitUsd: 0.15 })).status).toBe('failed');
		expect(fix.calls).toHaveLength(1);
	});

	it('gives a finding whose test file does not load the suite error as its output', () => {
		const f = {
			id: 'G-1',
			runId: 'G',
			test: T[0]!,
			file: F[0]!,
			explanation: 'x',
			proposedFix: 'y'
		};
		world.suite.set(F[0]!, 'Cannot find module ../src/store');
		expect(failureOf(f, testsNow())).toBe('Cannot find module ../src/store');
		world.suite.clear();
		world.failing.add(T[0]!);
		expect(failureOf(f, testsNow())).toBe(`expected ok (${T[0]})`);
	});

	it('runs the test checks once at the start when the stored ones are out of date', async () => {
		// The stale file shows nothing; the fresh checks show a file that does not load, the baseline.
		world.suite.set(F[2]!, 'Cannot find module ./gone');
		await seed([T[0]!], [{ id: 'G-1', i: 0 }], { stale: true });
		world.suite.set(F[2]!, 'Cannot find module ./gone');
		const fake = fixAll();
		const r = await loop(fake);
		expect(log[0]).toBe('testChecks');
		expect(r.status).toBe('done');
		expect(fake.fixes().map((c) => c.ctx.handedOver)).toEqual([['G-1']]);
	});

	it('runs the test checks once at the start when the stored ones timed out', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const stored = (await readTestChecks(store))!;
		await writeTestChecks(store, { ...stored, result: { ...stored.result!, timedOut: true } });
		const r = await loop(fixAll());
		expect(log[0]).toBe('testChecks');
		expect(r.status).toBe('done');
	});

	it('gives each agent step what is left of the cost limit and stops on its cost guard', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const { fake } = newFailureScenario();
		await loop(fake);
		const limits = fake.calls.map((c) => c.costLimitUsd!);
		expect(limits[0]).toBeCloseTo(3);
		expect(limits[1]).toBeCloseTo(2.9);
		expect(limits[2]).toBeCloseTo(2.8);

		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const stopped = await loop(
			fakeRun({
				cost: 0.5,
				fix: async (o) => void (await edit(o)),
				result: { status: 'failed', reason: 'cost_limit', error: 'cost' }
			})
		);
		expect(stopped).toMatchObject({
			status: 'failed',
			error: 'Cost limit of $3.00 exceeded ($0.50 spent); the fix loop stopped.'
		});
	});

	it('ignores typecheck errors and drift the code had before the loop, whatever their line', async () => {
		const drift: DriftItem = {
			kind: 'changed',
			name: 'Task',
			file: 'src/task.ts',
			details: ['id']
		};
		await writeChecks(store, {
			at: '',
			codeHash: null,
			designHash: null,
			typecheck: {
				ok: false,
				errors: [{ file: 'src/old.ts', line: 1, col: 1, message: 'TS1: old' }],
				timedOut: false
			},
			drift: [drift],
			start: null
		});
		world.tsc = [{ file: 'src/old.ts', message: 'TS1: old' }];
		world.drift = [drift];
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({
			fix: async (o) => {
				await edit(o);
				world.failing.clear();
			}
		});
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(r.text).toContain('Fix loop: 1 round.');
		expect(fake.fixes()).toHaveLength(1);
	});

	it('hands a disputed finding back to the code agent when triage corrected its test and it still fails', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({
			fix: async (o, n) => {
				if (n === 1) await reply(o, 'G-1', 'test_looks_wrong', 'expects 3 items');
				else {
					await edit(o);
					world.failing.clear();
				}
			},
			triage: async (o) => {
				await edit(o, F[0]);
				await tool(o, 'report_test_fix', { test: T[0], file: F[0], reason: 'wrong count' });
			}
		});
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(fake.calls.map((c) => c.agent)).toEqual(['code', 'test', 'code']);
		expect(fake.fixes().map((c) => c.ctx.handedOver)).toEqual([['G-1'], ['G-1']]);
		expect(fake.fixes()[1]!.brief).toContain(`Finding G-1\n${CORRECTED}`);
		expect(fake.fixes()[1]!.brief).not.toContain(RETRY);
		// Round 2 has no reply; the stored one from round 1 must not count again.
		expect(messages.filter((m) => m.from === 'code').map((m) => m.text)).toEqual([
			'G-1 test looks wrong: expects 3 items',
			'G-1 fixed'
		]);
	});

	it('keeps a disputed finding from the code agent when triage corrected its test and reported the bug again', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		let again = '';
		const fake = fakeRun({
			fix: async (o) => void (await reply(o, 'G-1', 'test_looks_wrong', 'expects 3 items')),
			triage: async (o) => {
				await edit(o, F[0]);
				await tool(o, 'report_test_fix', { test: T[0], file: F[0], reason: 'wrong count' });
				again = await bug(o, 0);
			}
		});
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(fake.calls.map((c) => c.agent)).toEqual(['code', 'test']);
		expect(r.text).toContain(`Declined by the code agent: ${again}.`);
	});

	it('lets triage correct a disputed test in a file an earlier triage changed, and hands it back', async () => {
		await seed([T[0]!]);
		const fake = fakeRun({
			triage: async (o, n) => {
				await edit(o, F[0]);
				if (n === 1) await bug(o, 0);
				else await tool(o, 'report_test_fix', { test: T[0], file: F[0], reason: 'wrong count' });
			},
			fix: async (o, n) => {
				const id = fake.fixes()[n - 1]!.ctx.handedOver![0]!;
				if (n === 1) await reply(o, id, 'test_looks_wrong', 'expects 3 items');
				else {
					await edit(o);
					world.failing.clear();
				}
			}
		});
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(fake.calls.map((c) => c.agent)).toEqual(['test', 'code', 'test', 'code']);
		expect(fake.triages()[1]!.brief).not.toContain('Do not change these test files again');
		expect(fake.fixes()[1]!.brief).toContain(CORRECTED);
	});

	it('records a second unreported triage change to a file an earlier triage reported', async () => {
		await seed([T[0]!]);
		const fake = fakeRun({
			triage: async (o, n) => {
				await edit(o, F[1]);
				if (n === 1) {
					await tool(o, 'report_test_fix', { test: T[1], file: F[1], reason: 'wrong count' });
					await bug(o, 0);
				}
			},
			fix: async (o) => {
				const id = fake.fixes()[0]!.ctx.handedOver![0]!;
				await reply(o, id, 'test_looks_wrong', 'expects 3 items');
			}
		});
		await loop(fake);
		expect(fake.triages()).toHaveLength(2);
		expect((await readRunFindings(store, ctx.runId)).testFixes).toEqual([
			expect.objectContaining({ file: F[1], reason: 'wrong count' }),
			expect.objectContaining({ file: F[1], reason: 'changed during triage without a report' })
		]);
	});

	it('triages a dispute once', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({
			fix: async (o) => void (await reply(o, 'G-1', 'test_looks_wrong', 'expects 3 items'))
		});
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(fake.calls.map((c) => c.agent)).toEqual(['code', 'test']);
	});

	it('ends done when every test passes, even with a dispute waiting', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({
			fix: async (o) => {
				await edit(o);
				await reply(o, 'G-1', 'test_looks_wrong', 'expects 3 items');
				world.failing.clear();
			}
		});
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(r.checked).toBe(true);
		expect(fake.triages()).toHaveLength(0);
	});

	it('says when the fix step stopped early instead of calling its findings fixed', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({
			fix: async (o) => void (await edit(o)),
			result: { status: 'failed', reason: 'turn_limit', error: 'Turn limit reached' }
		});
		const r = await loop(fake);
		expect(messages[1]!.text).toBe('The code agent stopped early (turn limit); G-1 has no reply.');
		expect(r.text).toContain('The code agent stopped early in round 1 (turn limit).');
	});

	it('ends failed when the triage step fails with an error', async () => {
		await seed([T[0]!]);
		const fake = fakeRun({ result: { status: 'failed', reason: 'error', error: 'API down' } });
		const r = await loop(fake);
		expect(r).toMatchObject({ status: 'failed', error: 'API down', checked: false });
		expect(fake.triages()).toHaveLength(1);
		expect(log).not.toContain('testChecks');
	});

	it('stops at the cost limit after a triage step', async () => {
		await seed([T[0]!]);
		const fake = fakeRun({ cost: 3, triage: async (o) => void (await bug(o, 0)) });
		const r = await loop(fake);
		expect(r.status).toBe('failed');
		expect(r.error).toBe('Cost limit of $3.00 exceeded ($3.00 spent); the fix loop stopped.');
		expect(log).not.toContain('testChecks');
		expect(fake.fixes()).toHaveLength(0);
	});

	it('ends failed when the test checks after triage time out', async () => {
		await seed([T[0]!]);
		const fake = fakeRun({ triage: async (o) => void (await bug(o, 0)) });
		const r = await loop(fake, {
			testChecks: async (c) => ({
				...(await testChecks(c)),
				result: { ...testsNow(), timedOut: true }
			})
		});
		expect(r).toMatchObject({ status: 'failed', error: 'Typecheck or test run timed out' });
		// The checks just ran; the final checks need not wait for the timeout again.
		expect(r.checked).toBe(true);
		expect(fake.fixes()).toHaveLength(0);
	});

	it('ends failed without the test checks when the code typecheck times out', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({ fix: async (o) => void (await edit(o)) });
		const r = await loop(fake, {
			codeChecks: async (c) => ({
				...(await codeChecks(c)),
				typecheck: { ok: false, errors: [], timedOut: true }
			})
		});
		expect(r).toMatchObject({
			status: 'failed',
			error: 'Typecheck or test run timed out',
			checked: true
		});
		expect(log).not.toContain('testChecks');
	});

	it('records a test file triage changed without a report', async () => {
		await seed([T[0]!]);
		const fake = fakeRun({
			triage: async (o) => {
				await edit(o, F[1]);
				await bug(o, 0);
			},
			fix: async (o) => {
				await edit(o);
				world.failing.clear();
			}
		});
		await loop(fake);
		expect((await readTestChecks(store))?.testFixes).toEqual([
			expect.objectContaining({ file: F[1], reason: 'changed during triage without a report' })
		]);
	});

	it('is not checked when triage ran after a checked round', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({
			fix: async (o) => {
				await edit(o);
				world.failing = new Set([T[1]!]);
			},
			triage: async (o) => {
				await edit(o, F[1]);
				await tool(o, 'report_test_fix', { test: T[1], file: F[1], reason: 'wrong route' });
				world.failing.clear();
			}
		});
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(r.checked).toBe(false);
		expect(r.text).toContain('Fix loop: 2 rounds.');
		expect(fake.calls.map((c) => c.agent)).toEqual(['code', 'test']);
	});

	/** One fix round that makes every test pass; the stub problems stay as set. */
	const fixAll = () =>
		fakeRun({
			fix: async (o) => {
				await edit(o);
				world.failing.clear();
			}
		});

	it('keeps a baseline drift item whose details changed out of the new problems', async () => {
		const item = (details: string[]): DriftItem => ({
			kind: 'changed',
			name: 'Task',
			file: 'src/task.ts',
			details
		});
		await storeP4([], [item(['id missing', 'title missing'])]);
		world.drift = [item(['title missing'])];
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fixAll();
		const r = await loop(fake);
		expect(r.status).toBe('done');
		expect(fake.fixes()).toHaveLength(1);
	});

	it('counts a second identical typecheck error in the same file as new', async () => {
		const old = { file: 'src/old.ts', message: 'TS1: old' };
		await storeP4([old]);
		world.tsc = [old];
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({
			fix: async (o, n) => {
				await edit(o);
				world.failing.clear();
				if (n === 1) world.tsc = [old, old];
			}
		});
		const r = await loop(fake);
		expect(r.error).toBe('The fix loop left the code with typecheck errors or drift');
		expect(fake.fixes()[1]!.ctx.handedOver).toEqual([]);
		expect(fake.fixes()[1]!.brief.split('src/old.ts(3,5): TS1: old')).toHaveLength(2);
	});

	it('takes the P4 baseline from code checks at the start when the stored ones are out of date or timed out', async () => {
		const old = { file: 'src/old.ts', message: 'TS1: old' };
		world.tsc = [old];
		await storeP4([], [], false, 'stale');
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const stale = await loop(fixAll());
		expect(log[0]).toBe('codeChecks');
		expect(stale.status).toBe('done');

		log = [];
		await storeP4([], [], true);
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const timedOut = await loop(fixAll());
		expect(log[0]).toBe('codeChecks');
		expect(timedOut.status).toBe('done');
	});

	it('ends failed when the code checks at the start time out', async () => {
		await storeP4([], [], false, 'stale');
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fixAll();
		const r = await loop(fake, {
			codeChecks: async (c) => ({
				...(await codeChecks(c)),
				typecheck: { ok: false, errors: [], timedOut: true }
			})
		});
		expect(r).toMatchObject({
			status: 'failed',
			error: 'Typecheck or test run timed out',
			checked: true
		});
		expect(fake.calls).toHaveLength(0);
	});

	it('reads a repeated test_looks_wrong with the same reason as a new reply', async () => {
		await seed([T[0]!], [{ id: 'G-1', i: 0 }]);
		const fake = fakeRun({
			fix: async (o, n) => {
				// The stored reply carries a millisecond time; make sure the second one differs.
				if (n === 2) await new Promise((r) => setTimeout(r, 5));
				await reply(o, 'G-1', 'test_looks_wrong', 'expects 3 items');
			},
			triage: async (o) => {
				await edit(o, F[0]);
				await tool(o, 'report_test_fix', { test: T[0], file: F[0], reason: 'wrong count' });
			}
		});
		await loop(fake);
		expect(fake.fixes()).toHaveLength(2);
		expect(messages.filter((m) => m.from === 'code').map((m) => m.text)).toEqual([
			'G-1 test looks wrong: expects 3 items',
			'G-1 test looks wrong: expects 3 items'
		]);
		// Disputed again, so a second triage follows.
		expect(fake.triages()).toHaveLength(2);
	});

	it('lists the replies and names the findings without one when the fix step stopped early', async () => {
		await seed(
			[T[0]!, T[1]!],
			[
				{ id: 'G-1', i: 0 },
				{ id: 'G-2', i: 1 }
			]
		);
		const fake = fakeRun({
			fix: async (o) => {
				await edit(o);
				await reply(o, 'G-1', 'needs_design_change', 'Task has no dueDate');
			},
			result: { status: 'failed', reason: 'max_tokens', error: 'max tokens' }
		});
		await loop(fake);
		expect(messages[1]!.text).toBe(
			'The code agent stopped early (max tokens); G-2 has no reply.\nG-1 needs a design change: Task has no dueDate'
		);
	});
});
