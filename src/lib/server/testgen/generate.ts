import path from 'node:path';
import { addUsage, emptyUsage } from '../agents/cost';
import { runAgent } from '../agents/loop';
import { testAgent, triageBrief } from '../agents/test';
import { testWorkerBrief, testWorkerDef } from '../agents/test-worker';
import type { RunResult, Usage } from '../agents/types';
import { normPath, pool, readOrNull } from '../codegen/shared';
import type { FileStatus, GenerateEvent } from '../codegen/generate';
import {
	appendRunTestFix,
	listTestFiles,
	parseTestName,
	readRunFindings,
	runTestChecks,
	type TestChecks,
	type TestFix
} from '../core/test-state';
import type { DesignDoc } from '../core/schemas/design';
import type { RequirementsDoc } from '../core/schemas/requirements';
import { buildCodeModel, type CodeModel } from '../core/tools/code-model';
import type { ToolContext } from '../core/tools/index';
import { planTests, type TestFilePlan } from './plan';

const CONCURRENCY = 4;
const WORKER_TURNS = 8;
const TRIAGE_TURNS = 30;
const ATTEMPTS = 3;
const DEFAULT_COST_LIMIT_USD = 2;
const TIMED_OUT = 'Typecheck or test run timed out';
const NO_PROJECT = 'The project has no package.json; generate the code first.';

const timedOut = (c: TestChecks) => c.typecheck?.timedOut === true || c.result?.timedOut === true;

/**
 * Problems of one test file in a check result: its tsc errors, a suite level failure (the file did
 * not load), a file without any test (it does not exist or is empty), and, when it loaded, every
 * criterion that has no test and every sequence that has no scenario test. A test counts for a
 * criterion when its title parses to that requirement and number and it passed, failed or is a
 * manual todo; a scenario test counts when it passed or failed. Assertion failures are no problem here; they go to triage.
 */
function problemsOf(plan: TestFilePlan, checks: TestChecks): string[] {
	const tsc = (checks.typecheck?.errors ?? [])
		.filter((e) => normPath(e.file) === plan.path)
		.map((e) => `${plan.path}(${e.line},${e.col}): ${e.message}`);
	const own = (checks.result?.tests ?? []).filter((t) => normPath(t.file) === plan.path);
	const suite = own
		.filter((t) => t.suite)
		.map((t) => `${plan.path} failed to load: ${t.error ?? 'no message'}`);
	if (suite.length > 0) return [...tsc, ...suite];
	if (own.length === 0)
		return [...tsc, `${plan.path} has no tests: the file does not exist or is empty.`];

	const missing = plan.criteria
		.filter(
			(c) =>
				!own.some((t) => {
					const p = parseTestName(t.title);
					if (p?.kind !== 'ac' || p.reqId !== c.reqId || p.n !== c.n) return false;
					return (
						t.status === 'passed' || t.status === 'failed' || (t.status === 'todo' && p.manual)
					);
				})
		)
		.map(
			(c) =>
				`No test for ${c.reqId} AC${c.n}. Add it with the exact title '${c.reqId} AC${c.n}: ${c.text}' (a todo needs the form '${c.reqId} AC${c.n}: manual: <reason>').`
		);
	const noScenario = plan.sequenceIds
		.filter(
			(id) =>
				!own.some((t) => {
					const p = parseTestName(t.title);
					return (
						p?.kind === 'scenario' &&
						p.seqId === id &&
						(t.status === 'passed' || t.status === 'failed')
					);
				})
		)
		.map(
			(id) =>
				`No scenario test for ${id}. Add it with a title of the form '${id} scenario: <sequence name>'.`
		);
	return [...tsc, ...missing, ...noScenario];
}

const CHANGED_WITHOUT_REPORT = 'changed during triage without a report';

/** Path to content of every file under `test/`. */
export async function snapshotTests(ctx: ToolContext): Promise<Map<string, string | null>> {
	const out = new Map<string, string | null>();
	for (const f of await listTestFiles(ctx.store)) out.set(f, await readOrNull(ctx, f));
	return out;
}

/**
 * Review focus 6: triage may not change a test silently. Every test file it changed, added or
 * deleted without a `report_test_fix` for that file in this step (any not in `earlier`) gets one
 * here. A record for a
 * deleted file is dropped again by `runTestChecks`, which keeps fixes of existing files only.
 */
export async function recordUnreportedFixes(
	ctx: ToolContext,
	before: Map<string, string | null>,
	earlier: TestFix[] = []
): Promise<void> {
	const after = await snapshotTests(ctx);
	// Only reports of this step count: a file an earlier step of the run reported may change again.
	const old = new Set(earlier.map((f) => JSON.stringify(f)));
	const reported = new Set(
		(await readRunFindings(ctx.store, ctx.runId)).testFixes
			.filter((f) => !old.has(JSON.stringify(f)))
			.map((f) => f.file)
	);
	for (const file of new Set([...before.keys(), ...after.keys()])) {
		if (before.get(file) === after.get(file) || reported.has(file)) continue;
		await appendRunTestFix(ctx.store, ctx.runId, {
			test: path.posix.basename(file),
			file,
			reason: CHANGED_WITHOUT_REPORT
		});
	}
}

/**
 * Writes the test files in parallel rounds, then triages failing tests (spec 5.3 and 5.4). A
 * round gives every file that is not ok one worker; after it one typecheck and test run decide
 * which files are ok. Only structural problems retry a file: a tsc error, a file that does not
 * load, a criterion without a test. Assertion failures never do; they go to the test agent once
 * after the rounds. Attempts 1 and 2 are Haiku, attempt 3 Sonnet. The run is `done` when the
 * pipeline finished, even with failed files or failing tests; it is `failed` for an
 * infrastructure error (an API error, Docker, a timeout) or the cost guard.
 *
 * Plans without criteria and sequences get no worker (an empty file fails the suite) and no
 * entry in `files`. Triage streams as `wiring` events, so P4 consumers keep working.
 *
 * Every return ends with the checks run on the final files and the file statuses recomputed from
 * them, except when the checks themselves threw: then `checked` is false.
 */
export async function generateTests(opts: {
	ctx: ToolContext;
	reqs: RequirementsDoc;
	design: DesignDoc;
	onEvent: (e: GenerateEvent) => void;
	run?: typeof runAgent;
	checks?: typeof runTestChecks;
	codeModel?: (ctx: ToolContext) => Promise<CodeModel>;
	costLimitUsd?: number;
}): Promise<RunResult & { files: Record<string, FileStatus>; checked: boolean }> {
	const { reqs, design, onEvent } = opts;
	// the test scope: reads everything but src/, writes only test/
	const ctx: ToolContext = { ...opts.ctx, agent: 'test' };
	delete ctx.writeOnly;
	const run = opts.run ?? runAgent;
	const checks = opts.checks ?? runTestChecks;
	const codeModel = opts.codeModel ?? (async (c: ToolContext) => buildCodeModel(c.store.dir));
	const limit = opts.costLimitUsd ?? DEFAULT_COST_LIMIT_USD;

	const files: Record<string, FileStatus> = {};
	let plans: TestFilePlan[] = [];
	let usage: Usage = emptyUsage();
	let cost = 0;
	let turns = 0;
	let text = '';
	let attemptNo = 0;
	// The latest check result, whether files may have changed since, and whether `checks` threw.
	let last: TestChecks | undefined;
	let dirty = true;
	let checksThrew = false;

	const add = (r: RunResult) => {
		usage = addUsage(usage, r.usage);
		cost += r.costUsd;
		turns += r.turns;
	};
	const setStatus = (p: TestFilePlan, status: FileStatus, attempt = attemptNo) => {
		files[p.path] = status;
		onEvent({ type: 'file', path: p.path, status, attempt });
	};
	const check = async (): Promise<TestChecks> => {
		try {
			last = await checks(ctx);
		} catch (e) {
			checksThrew = true;
			throw e;
		}
		dirty = false;
		return last;
	};

	const finish = async (status: RunResult['status'], error?: string) => {
		if (!checksThrew && dirty) {
			try {
				await check();
			} catch (e) {
				if (status === 'done') {
					status = 'failed';
					error = e instanceof Error ? e.message : String(e);
				}
			}
		}
		const fresh = last !== undefined && !dirty && !checksThrew ? last : undefined;
		if (status === 'done' && fresh && timedOut(fresh)) {
			status = 'failed';
			error = TIMED_OUT;
		}
		if (status === 'failed') {
			for (const p of plans)
				if (files[p.path] !== 'ok' && files[p.path] !== 'failed') setStatus(p, 'failed');
		}
		// The progress list must match the gate; a timed out run or a missing project says nothing about the files.
		if (fresh && !timedOut(fresh) && fresh.result !== null) {
			for (const p of plans) {
				const now = problemsOf(p, fresh).length === 0 ? 'ok' : 'failed';
				if (files[p.path] !== now) setStatus(p, now);
			}
		}
		return {
			status,
			text,
			...(error === undefined ? {} : { error }),
			usage,
			costUsd: cost,
			turns,
			files,
			checked: fresh !== undefined
		};
	};

	try {
		plans = planTests(reqs, design).filter((p) => p.criteria.length + p.sequenceIds.length > 0);
		for (const p of plans) setStatus(p, 'planned', 0);
		const model = await codeModel(ctx);

		const problems = new Map<string, string[]>();
		let pending = plans;
		let infra: string | undefined;

		for (let attempt = 1; attempt <= ATTEMPTS && pending.length > 0; attempt++) {
			attemptNo = attempt;
			const escalate = attempt === ATTEMPTS;
			const def = testWorkerDef(escalate ? 'claude-sonnet-5-5' : 'claude-haiku-5-5');
			const started = attempt === 1 ? 'writing' : escalate ? 'escalated' : 'retrying';
			const ran = new Set<string>();
			const wrote = new Set<string>();
			await pool(pending, CONCURRENCY, async (p) => {
				// no new worker once something failed or the cost limit is passed
				if (infra !== undefined || cost > limit) return;
				ran.add(p.path);
				dirty = true;
				setStatus(p, started);
				try {
					const retry =
						attempt === 1
							? undefined
							: {
									content: (await readOrNull(ctx, p.path)) ?? '(the file does not exist yet)',
									problems: problems.get(p.path) ?? []
								};
					const r = await run({
						def,
						ctx: { ...ctx, writeOnly: p.path },
						history: [{ role: 'user', content: testWorkerBrief(reqs, design, model, p, retry) }],
						onEvent: (e) => {
							if (e.type === 'tool' && e.name === 'write_file' && !e.isError) wrote.add(p.path);
							if (e.type === 'tool') onEvent({ type: 'worker', path: p.path, attempt, event: e });
						},
						maxTurns: WORKER_TURNS
					});
					add(r);
					if (r.status === 'failed' && r.reason === 'error') infra = r.error ?? 'worker failed';
				} catch (e) {
					infra = e instanceof Error ? e.message : String(e);
				}
			});
			if (infra !== undefined) return await finish('failed', infra);

			for (const p of pending) if (ran.has(p.path)) setStatus(p, 'checking');
			const result = await check();
			if (timedOut(result)) return await finish('failed', TIMED_OUT);
			if (result.result === null) return await finish('failed', NO_PROJECT);
			const next: TestFilePlan[] = [];
			for (const p of pending) {
				if (!ran.has(p.path)) {
					next.push(p); // skipped by the cost limit, which ends the run below
					continue;
				}
				const found = problemsOf(p, result);
				if (!wrote.has(p.path))
					found.push('You did not write the file. Write it with one write_file call.');
				problems.set(p.path, found);
				if (found.length === 0) setStatus(p, 'ok');
				else if (escalate) setStatus(p, 'failed');
				else next.push(p);
			}
			pending = next;
			if (cost > limit) {
				return await finish(
					'failed',
					`Cost limit of $${limit.toFixed(2)} exceeded ($${cost.toFixed(2)} spent); stopped before the remaining files and the triage.`
				);
			}
		}

		// Triage: only failures of loaded tests; a file that did not load is a file problem.
		const failures = (last?.result?.tests ?? []).filter((t) => t.status === 'failed' && !t.suite);
		if (failures.length > 0) {
			dirty = true;
			const before = await snapshotTests(ctx);
			const triage = await run({
				def: testAgent,
				ctx,
				history: [{ role: 'user', content: triageBrief(failures, last?.result?.logTail ?? '') }],
				onEvent: (event) => onEvent({ type: 'wiring', event }),
				maxTurns: TRIAGE_TURNS
			});
			add(triage);
			text = triage.text;
			await recordUnreportedFixes(ctx, before);
			if (triage.status === 'failed' && triage.reason === 'error')
				return await finish('failed', triage.error ?? 'triage failed');
		}
		return await finish('done');
	} catch (e) {
		return await finish('failed', e instanceof Error ? e.message : String(e));
	}
}
