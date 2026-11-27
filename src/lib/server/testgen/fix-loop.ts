import { addUsage, emptyUsage } from '../agents/cost';
import type { runAgent } from '../agents/loop';
import { fixLoopBrief, triageBrief, type FixItem } from '../agents/test';
import type { AgentDef, AgentEvent, RunResult, Usage } from '../agents/types';
import type { AgentRole } from '../core/chat';
import { codeHash, readChecks, type CodeChecks, type runCodeChecks } from '../core/code-state';
import type { DriftItem } from '../core/drift';
import {
	findingOpen,
	isTest,
	p5Hash,
	readRunFindings,
	readTestChecks,
	testHash,
	unexplainedFailures,
	type Finding,
	type FixOutcome,
	type runTestChecks,
	type TestChecks
} from '../core/test-state';
import type { ToolContext } from '../core/tools/index';
import { FIX_LOOP_BROKEN_CODE, FIX_LOOP_BROKEN_TESTS } from '../../fix-loop-errors';
import { isTestError } from '../orchestrator/gates';
import { recordUnreportedFixes, snapshotTests } from './generate';

export const FIX_LOOP_COST_LIMIT_USD = 3;
export const FIX_LOOP_ROUNDS = 3;
/** Fix attempts per test (file plus test name) in one loop. */
export const MAX_FIX_ATTEMPTS = 2;

const TRIAGE_TURNS = 30;
const FIX_TURNS = 40;
const TIMED_OUT = 'Typecheck or test run timed out';
/** Do not start an agent step with less than this left of the cost limit. */
const MIN_STEP_USD = 0.1;

/** One handoff between two agents of the loop, shown in the live run and the P5 chat. */
export type AgentMessage = { from: AgentRole; to: AgentRole; text: string; findingIds: string[] };

/** A re-report of the same test gets a new finding ID, so attempts and refusals count per test. */
const keyOf = (f: { file: string; test: string }) => `${f.file}\n${f.test}`;

const firstLine = (s: string) => s.trim().split('\n')[0]!.trim();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const list = (items: string[]) => (items.length > 0 ? items.join(', ') : 'none');

/**
 * The failure message of the test a finding names in `result`, for the code agent's brief; the
 * error of its file's suite entry when the file did not load.
 */
export function failureOf(f: Finding, result: TestChecks['result']): string {
	const t =
		result?.tests.find((t) => t.status === 'failed' && isTest(t, f.file, f.test)) ??
		result?.tests.find((t) => t.suite && t.file === f.file);
	return t?.error ?? 'no message';
}

const timedOut = (c: TestChecks) => c.typecheck?.timedOut === true || c.result?.timedOut === true;

const driftLine = (d: DriftItem) =>
	`${d.kind.replaceAll('_', ' ')}: ${d.name}${d.file ? ` (${d.file})` : ''}${d.details.length > 0 ? `: ${d.details.join('; ')}` : ''}`;

type Problem = { key: string; text: string; file?: string };
/** New problems the code agent can fix: typecheck errors outside test/ and drift items. */
type Broken = { typecheck: string[]; drift: string[] };

/**
 * The problems of code checks the code agent can fix: typecheck errors outside test/ (an error
 * without a file counts as a test error, as in the gate) and drift items. Keys leave out the line,
 * and for drift the details, so a problem that moved or shrank is still the same problem.
 */
function problemsOf(c: CodeChecks | null | undefined): { typecheck: Problem[]; drift: Problem[] } {
	const errors = (c?.typecheck?.errors ?? []).filter((e) => !isTestError(e.file));
	return {
		typecheck: errors.map((e) => ({
			key: `tsc\n${e.file}\n${e.message}`,
			text: `${e.file}(${e.line},${e.col}): ${e.message}`
		})),
		drift: (c?.drift ?? []).map((d) => ({
			key: `drift\n${d.kind}\n${d.name}\n${d.file ?? ''}`,
			text: driftLine(d)
		}))
	};
}

/**
 * The problems of the P5 checks a src/ change can cause: test files that do not load (suite
 * entries) and typecheck errors under test/ (an error without a file is never counted).
 */
function testProblemsOf(c: TestChecks): Problem[] {
	const suites = (c.result?.tests ?? [])
		.filter((t) => t.suite)
		.map((t) => ({
			key: `suite\n${t.file}`,
			text: `${t.file} failed to load: ${t.error ?? 'no message'}`,
			file: t.file
		}));
	const errors = (c.typecheck?.errors ?? [])
		.filter((e) => e.file !== '' && isTestError(e.file))
		.map((e) => ({
			key: `tsc\n${e.file}\n${e.message}`,
			text: `${e.file}(${e.line},${e.col}): ${e.message}`,
			file: e.file
		}));
	return [...suites, ...errors];
}

/** How often each problem key occurs. */
function countKeys(ps: Problem[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const p of ps) out.set(p.key, (out.get(p.key) ?? 0) + 1);
	return out;
}

/** The problems beyond those in `baseline`, counted per key, so a second identical one is new. */
function fresh(ps: Problem[], baseline: Map<string, number>): Problem[] {
	const left = new Map(baseline);
	return ps.filter((p) => {
		const n = left.get(p.key) ?? 0;
		left.set(p.key, n - 1);
		return n <= 0;
	});
}
const texts = (ps: Problem[]) => ps.map((p) => p.text);

const STOP_REASONS: Record<NonNullable<RunResult['reason']>, string> = {
	turn_limit: 'turn limit',
	refused: 'refused',
	max_tokens: 'max tokens',
	cost_limit: 'cost limit',
	error: 'error'
};
const stopReason = (r: RunResult) => (r.reason ? STOP_REASONS[r.reason] : 'failed');

const BROKEN_ASK = 'the problems your last change left';

function askText(items: FixItem[], broken: boolean): string {
	const ids = items.map((i) => i.finding.id);
	const head =
		items.length === 0
			? `Please fix ${BROKEN_ASK}.`
			: items.length === 1
				? `Please fix ${ids[0]}: ${firstLine(items[0]!.finding.explanation)}`
				: `Please fix ${ids.join(', ')}:\n${items.map((i) => `${i.finding.id}: ${firstLine(i.finding.explanation)}`).join('\n')}`;
	return items.length > 0 && broken ? `${head}\nAlso fix ${BROKEN_ASK}.` : head;
}

function replyLine(id: string, outcome: FixOutcome, reason: string | undefined): string {
	if (outcome === 'fixed') return `${id} fixed`;
	const what = outcome === 'needs_design_change' ? 'needs a design change' : 'test looks wrong';
	return `${id} ${what}: ${reason?.trim() ?? ''}`;
}

/**
 * The fix loop (spec "One round" and "Stop rules"): per round the test agent triages the failures
 * no open finding explains and any test the code agent disputed, the code agent gets the open code
 * bug findings it has not declined and has attempts left for (plus the typecheck errors and drift
 * its last change left), then the P4 and the P5 checks run. Each step gets its own ctx.agent; the
 * checks run with the loop ctx, so findings merge under the loop run ID. Every handoff goes to
 * `onMessage`.
 *
 * Baselines: the stored P5 and P4 checks when their hashes match the current files, else the
 * checks run once at the start (no LLM; a timeout there ends the loop `failed`). Problems beyond
 * them, counted per key, are problems the loop caused. Typecheck errors outside test/ and drift
 * items (P4) go to the code agent in the next round. A test file that no longer loads or has new
 * typecheck errors under test/ (P5) ends the loop at once, `failed`, with a message naming the
 * files: the code agent cannot change test/. Errors without a file are never counted, as in the
 * gate.
 *
 * Ends `done` when no test fails and there is no new code problem, a round changed no file under
 * src/ or test/ (unless a dispute waits for triage), nothing is left to hand over, a triage step
 * changed a test file an earlier triage of this loop changed (except the file of a disputed test
 * it was asked to correct), or after `maxRounds`; any of these
 * ends `failed` instead while a new code problem remains. A disputed finding goes back to the code
 * agent once triage corrected its test file without reporting it again. Ends `failed` for an
 * agent step error, a check that timed out or threw, and the cost guard: each agent step gets
 * what is left of the limit, no step starts with less than $0.10 left, and the loop stops when a
 * step hit its limit or the total reached it. `checked` is true when the last step was the code
 * and test checks, or a check that just timed out, so the caller's final checks do not wait for
 * the timeout again.
 */
export async function fixLoop(opts: {
	ctx: ToolContext;
	agents: { test: AgentDef; code: AgentDef };
	run: typeof runAgent;
	codeChecks: typeof runCodeChecks;
	testChecks: typeof runTestChecks;
	onEvent: (e: AgentEvent) => void;
	onMessage: (m: AgentMessage) => void;
	costLimitUsd?: number;
	maxRounds?: number;
}): Promise<RunResult & { checked: boolean }> {
	const { ctx, agents, run, onEvent, onMessage } = opts;
	const { store } = ctx;
	const limit = opts.costLimitUsd ?? FIX_LOOP_COST_LIMIT_USD;
	const maxRounds = opts.maxRounds ?? FIX_LOOP_ROUNDS;
	// report_fix_result is not in the code agent's row; executeTool allows only def.tools.
	const codeDef: AgentDef = { ...agents.code, tools: [...agents.code.tools, 'report_fix_result'] };

	const attempts = new Map<string, number>();
	const declined = new Set<string>();
	const disputed = new Map<string, { finding: Finding; reason: string }>();
	const triaged = new Set<string>();
	const handed = new Set<string>();
	const notes: string[] = [];
	// Findings handed back after triage corrected the disputed test.
	const corrected = new Set<string>();
	// Problems the code and the tests had before the loop are not the code agent's to fix here.
	let baseline = new Map<string, number>();
	let testBaseline = new Map<string, number>();

	let usage: Usage = emptyUsage();
	let cost = 0;
	let turns = 0;
	let rounds = 0;
	let checks: TestChecks | null = null;
	let code: CodeChecks | undefined;
	let checked = false;

	const costError = () =>
		`Cost limit of $${limit.toFixed(2)} exceeded ($${cost.toFixed(2)} spent); the fix loop stopped.`;

	const summary = () => {
		const broken = brokenNow();
		const open = checks ? checks.findings.filter((f) => findingOpen(f, checks!.result)) : [];
		const resolved = new Set(
			(checks?.findings ?? []).filter((f) => f.resolvedAt !== undefined).map((f) => f.id)
		);
		const ids = (fs: Finding[]) => fs.map((f) => f.id);
		return [
			`Fix loop: ${plural(rounds, 'round', 'rounds')}.`,
			`Fixed: ${list([...handed].filter((id) => resolved.has(id)))}.`,
			`Open: ${list(ids(open.filter((f) => !declined.has(keyOf(f)))))}.`,
			`Declined by the code agent: ${list(ids(open.filter((f) => declined.has(keyOf(f)))))}.`,
			`Test files changed by triage: ${list([...triaged])}.`,
			...(broken === undefined ? [] : [`New problems left: ${problemCounts(broken)}.`]),
			...notes
		].join(' ');
	};

	/** The code problems the loop caused so far; undefined when there are none. */
	const brokenNow = (): Broken | undefined => {
		if (code === undefined) return undefined;
		const p4 = problemsOf(code);
		const broken = {
			typecheck: texts(fresh(p4.typecheck, baseline)),
			drift: texts(fresh(p4.drift, baseline))
		};
		return broken.typecheck.length + broken.drift.length > 0 ? broken : undefined;
	};

	const finish = (status: RunResult['status'], error?: string) => {
		if (status === 'done' && brokenNow() !== undefined) {
			status = 'failed';
			error = FIX_LOOP_BROKEN_CODE;
		}
		return {
			status,
			text: summary(),
			...(error === undefined ? {} : { error }),
			usage,
			costUsd: cost,
			turns,
			checked
		};
	};

	const step = async (stepCtx: ToolContext, def: AgentDef, brief: string, maxTurns: number) => {
		const r = await run({
			def,
			ctx: stepCtx,
			history: [{ role: 'user', content: brief }],
			onEvent,
			maxTurns,
			costLimitUsd: limit - cost
		});
		usage = addUsage(usage, r.usage);
		cost += r.costUsd;
		turns += r.turns;
		return r;
	};
	const stepError = (r: RunResult) =>
		r.status === 'failed' && r.reason === 'error' ? (r.error ?? 'agent step failed') : null;
	// The step's own guard stops it at what is left of the loop's limit.
	const overBudget = (r: RunResult) => r.reason === 'cost_limit' || cost >= limit;
	/**
	 * Test files that stopped loading or gained typecheck errors after a step: the loop stops at
	 * once and names them, with the step that left them.
	 */
	const brokeTests = (c: TestChecks, by: 'triage' | 'fix') => {
		const files = [...new Set(fresh(testProblemsOf(c), testBaseline).map((p) => p.file ?? ''))];
		if (files.length === 0) return null;
		const why =
			by === 'fix'
				? 'The code agent cannot change test/, so the fix loop stops here.'
				: 'Triage left them; the fix loop stops here.';
		onMessage({
			from: 'checks',
			to: 'test',
			text: `New problems in test files: ${files.join(', ')}. ${why}`,
			findingIds: []
		});
		return finish('failed', FIX_LOOP_BROKEN_TESTS);
	};
	// A check that timed out just ran; the caller's final checks need not wait for it again.
	const timeout = () => {
		checked = true;
		return finish('failed', TIMED_OUT);
	};

	const green = (c: TestChecks) =>
		c.result !== null &&
		!c.result.tests.some((t) => t.status === 'failed') &&
		brokenNow() === undefined;

	/** Open findings whose test file exists, not declined, with attempts left; one per test. */
	const handover = async (c: TestChecks): Promise<FixItem[]> => {
		const items: FixItem[] = [];
		const seen = new Set<string>();
		for (const f of c.findings) {
			const key = keyOf(f);
			const n = attempts.get(key) ?? 0;
			if (!findingOpen(f, c.result) || declined.has(key) || seen.has(key)) continue;
			if (n >= MAX_FIX_ATTEMPTS) continue;
			const content = await store.readText(f.file);
			if (content === null) continue;
			seen.add(key);
			items.push({
				finding: f,
				content,
				output: failureOf(f, c.result),
				retry: n > 0,
				...(corrected.has(key) ? { corrected: true } : {})
			});
		}
		return items;
	};

	try {
		// Baselines only from checks of the current files; else run them once, without an LLM.
		const hashes = { code: await codeHash(store), test: await testHash(store) };
		checks = await readTestChecks(store);
		if (checks?.codeHash !== hashes.code || checks.testHash !== hashes.test || timedOut(checks)) {
			checks = await opts.testChecks(ctx);
			if (timedOut(checks)) return timeout();
		}
		testBaseline = countKeys(testProblemsOf(checks));
		let p4 = await readChecks(store);
		if (p4?.codeHash !== hashes.code || p4.typecheck?.timedOut === true) {
			p4 = await opts.codeChecks(ctx);
			if (p4.typecheck?.timedOut) return timeout();
		}
		const { typecheck, drift } = problemsOf(p4);
		baseline = countKeys([...typecheck, ...drift]);

		for (let round = 1; round <= maxRounds; round++) {
			rounds = round;
			const hashBefore = await p5Hash(store);

			const failures = unexplainedFailures(checks.result, checks.findings);
			if (failures.length > 0 || disputed.size > 0) {
				const triageCtx: ToolContext = { ...ctx, agent: 'test' };
				const before = await snapshotTests(triageCtx);
				const run0 = await readRunFindings(store, ctx.runId);
				const known = new Set(run0.findings.map((f) => f.id));
				// The file of a disputed test may change again: triage must be free to correct it.
				const open = new Set([...disputed.values()].map((d) => d.finding.file));
				const brief = triageBrief(failures, checks.result?.logTail ?? '', {
					keep: [...triaged].filter((f) => !open.has(f)),
					disputed: [...disputed.values()]
				});
				if (limit - cost < MIN_STEP_USD) return finish('failed', costError());
				checked = false;
				const triage = await step(triageCtx, agents.test, brief, TRIAGE_TURNS);
				await recordUnreportedFixes(triageCtx, before, run0.testFixes);
				const error = stepError(triage);
				if (error !== null) return finish('failed', error);
				if (overBudget(triage)) return finish('failed', costError());

				// The guard reads the files, not the reports: whatever the brief said.
				const after = await snapshotTests(triageCtx);
				const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
					(f) => before.get(f) !== after.get(f)
				);
				const twice = changed.filter((f) => triaged.has(f) && !open.has(f));
				for (const f of changed) triaged.add(f);
				if (twice.length > 0) {
					onMessage({
						from: 'checks',
						to: 'test',
						text:
							twice.length === 1
								? `${twice[0]} was changed twice by triage; it needs the developer.`
								: `${twice.join(', ')} were changed twice by triage; they need the developer.`,
						findingIds: []
					});
					return finish('done');
				}
				// A disputed test triage corrected goes back to the code agent if it still fails; one
				// triage reported again stays open and declined: it is the developer's now.
				const reported = (await readRunFindings(store, ctx.runId)).findings.filter(
					(f) => !known.has(f.id)
				);
				for (const [key, { finding }] of disputed) {
					const again = reported.some((f) => keyOf(f) === key);
					if (!again && changed.includes(finding.file)) {
						declined.delete(key);
						corrected.add(key);
					}
				}
				disputed.clear();
				checks = await opts.testChecks(ctx);
				if (timedOut(checks)) return timeout();
				const stop = brokeTests(checks, 'triage');
				if (stop !== null) return stop;
			}

			const items = await handover(checks);
			const broken = brokenNow();
			if (items.length > 0 || broken !== undefined) {
				if (limit - cost < MIN_STEP_USD) return finish('failed', costError());
				const ids = items.map((i) => i.finding.id);
				onMessage({
					from: 'test',
					to: 'code',
					text: askText(items, broken !== undefined),
					findingIds: ids
				});
				const fixCtx: ToolContext = { ...ctx, agent: 'code', fixLoop: true, handedOver: ids };
				// A finding handed back after a dispute has its old reply stored; only a new one counts.
				const earlier = new Map(
					(await readRunFindings(store, ctx.runId)).fixResults.map((x) => [x.findingId, x.at])
				);
				checked = false;
				const fix = await step(fixCtx, codeDef, fixLoopBrief(items, broken), FIX_TURNS);
				for (const { finding: f } of items) {
					attempts.set(keyOf(f), (attempts.get(keyOf(f)) ?? 0) + 1);
					corrected.delete(keyOf(f));
					handed.add(f.id);
				}
				const error = stepError(fix);
				if (error !== null) return finish('failed', error);

				const replies = (await readRunFindings(store, ctx.runId)).fixResults.filter(
					(x) => earlier.get(x.findingId) !== x.at
				);
				const lines: string[] = [];
				const silent: string[] = [];
				for (const { finding: f } of items) {
					const reply = replies.find((x) => x.findingId === f.id);
					// No reply counts as fixed; the checks decide.
					if (reply === undefined) {
						if (fix.status === 'failed') silent.push(f.id);
						else lines.push(replyLine(f.id, 'fixed', undefined));
						continue;
					}
					if (reply.outcome !== 'fixed') declined.add(keyOf(f));
					if (reply.outcome === 'test_looks_wrong')
						disputed.set(keyOf(f), { finding: f, reason: reply.reason });
					lines.push(replyLine(f.id, reply.outcome, reply.reason));
				}
				if (fix.status === 'failed') {
					const why = stopReason(fix);
					notes.push(`The code agent stopped early in round ${round} (${why}).`);
					const none =
						silent.length === 0
							? ''
							: `; ${silent.join(', ')} ${silent.length === 1 ? 'has' : 'have'} no reply`;
					lines.unshift(`The code agent stopped early (${why})${none}.`);
				}
				onMessage({
					from: 'code',
					to: 'test',
					text: lines.length > 0 ? lines.join('\n') : `Worked on ${BROKEN_ASK}.`,
					findingIds: ids
				});
				if (overBudget(fix)) return finish('failed', costError());

				code = await opts.codeChecks(ctx);
				if (code.typecheck?.timedOut) return timeout();
				checks = await opts.testChecks(ctx);
				checked = true;
				onMessage({
					from: 'checks',
					to: 'test',
					text: roundText(round, checks, brokenNow()),
					findingIds: []
				});
				if (timedOut(checks)) return timeout();
				const stop = brokeTests(checks, 'fix');
				if (stop !== null) return stop;
				if (green(checks)) return finish('done');
			}

			// A dispute changes no file but still waits for the next triage.
			if (disputed.size === 0 && (await p5Hash(store)) === hashBefore) return finish('done');
			const unexplained = unexplainedFailures(checks.result, checks.findings);
			if (
				unexplained.length === 0 &&
				disputed.size === 0 &&
				brokenNow() === undefined &&
				(await handover(checks)).length === 0
			)
				return finish('done');
		}
		return finish('done');
	} catch (e) {
		return finish('failed', e instanceof Error ? e.message : String(e));
	}
}

function roundText(round: number, checks: TestChecks, broken: Broken | undefined): string {
	const r = checks.result;
	const tests =
		r === null
			? `Round ${round}: no test result`
			: `Round ${round}: ${r.passed} passed, ${r.failed} failed`;
	return broken === undefined ? tests : `${tests}; the checks show ${problemCounts(broken)}`;
}

function problemCounts(b: Broken): string {
	return [
		plural(b.typecheck.length, 'new typecheck error', 'new typecheck errors'),
		plural(b.drift.length, 'new drift item', 'new drift items')
	].join(' and ');
}
