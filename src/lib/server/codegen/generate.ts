import { codeAgent, dbFile, wiringBrief } from '../agents/code';
import { workerBrief, workerDef } from '../agents/code-worker';
import { addUsage, emptyUsage } from '../agents/cost';
import { runAgent } from '../agents/loop';
import type { AgentEvent, RunResult, Usage } from '../agents/types';
import { runCodeChecks, type CodeChecks } from '../core/code-state';
import type { DesignDoc } from '../core/schemas/design';
import type { RequirementsDoc } from '../core/schemas/requirements';
import type { ToolContext } from '../core/tools/index';
import { planCode, type FilePlan } from './plan';
import { scaffold } from './scaffold';
import { normPath, pool, readOrNull } from './shared';

export type FileStatus =
	'planned' | 'writing' | 'checking' | 'retrying' | 'escalated' | 'ok' | 'failed';

export type GenerateEvent =
	| { type: 'file'; path: string; status: FileStatus; attempt: number }
	| { type: 'wiring'; event: AgentEvent }
	// a tool call or text of a class worker: for the run log, not for the live stream
	| { type: 'worker'; path: string; attempt: number; event: AgentEvent };

/**
 * The progress entry of the wiring step. A folder path, so it never equals a class file; it is
 * sent as a `file` event but kept out of the returned `files`.
 */
export const WIRING_PATH = 'src/app/';

const CONCURRENCY = 4;
const WORKER_TURNS = 6;
const WIRING_TURNS = 40;
const ATTEMPTS = 3;
const DEFAULT_COST_LIMIT_USD = 3;
const TIMED_OUT = 'Typecheck timed out';

const timedOut = (c: CodeChecks) => c.typecheck?.timedOut === true;

/** Problems of one class file in a check result: its tsc errors and the drift items of its class. */
function problemsOf(plan: FilePlan, checks: CodeChecks): string[] {
	const tsc = (checks.typecheck?.errors ?? [])
		.filter((e) => normPath(e.file) === plan.path)
		.map((e) => `${plan.path}(${e.line},${e.col}): ${e.message}`);
	const drift = checks.drift
		.filter((d) => d.id === plan.classId)
		.map((d) => `design drift (${d.kind}) ${d.name}: ${d.details.join('; ')}`);
	return [...tsc, ...drift];
}

/**
 * Writes the class files in parallel rounds, then the wiring (spec 5.3 and 5.4). A round gives
 * every file that is not ok one worker; after it one typecheck and drift check decide which files
 * are ok. Attempts 1 and 2 are Haiku, attempt 3 Sonnet. The run is `done` when the pipeline
 * finished, even with failed files; it is `failed` for an infrastructure error (an API error, a
 * typecheck error or timeout) or the cost guard.
 *
 * Every return, failed or not, ends with the project checks run once on the final code and the
 * file statuses recomputed from them, except when the checks themselves threw: then `checked` is
 * false and the caller must run them.
 */
export async function generateCode(opts: {
	ctx: ToolContext;
	design: DesignDoc;
	reqs: RequirementsDoc;
	onEvent: (e: GenerateEvent) => void;
	run?: typeof runAgent;
	checks?: typeof runCodeChecks;
	costLimitUsd?: number;
}): Promise<RunResult & { files: Record<string, FileStatus>; checked: boolean }> {
	const { ctx, design, reqs, onEvent } = opts;
	const run = opts.run ?? runAgent;
	const checks = opts.checks ?? runCodeChecks;
	const limit = opts.costLimitUsd ?? DEFAULT_COST_LIMIT_USD;

	const files: Record<string, FileStatus> = {};
	let plans: FilePlan[] = [];
	let usage: Usage = emptyUsage();
	let cost = 0;
	let turns = 0;
	let text = '';
	let attemptNo = 0;
	// The latest check result, whether code may have changed since, and whether `checks` threw.
	let last: CodeChecks | undefined;
	let dirty = true;
	let checksThrew = false;
	let wiringStatus: FileStatus | undefined;

	const add = (r: RunResult) => {
		usage = addUsage(usage, r.usage);
		cost += r.costUsd;
		turns += r.turns;
	};
	const setStatus = (p: FilePlan, status: FileStatus, attempt = attemptNo) => {
		files[p.path] = status;
		onEvent({ type: 'file', path: p.path, status, attempt });
	};
	const setWiring = (status: FileStatus) => {
		wiringStatus = status;
		onEvent({ type: 'file', path: WIRING_PATH, status, attempt: 1 });
	};
	const check = async (): Promise<CodeChecks> => {
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
			// A wiring step that never finished must not stay planned or writing.
			if (wiringStatus !== undefined && wiringStatus !== 'ok' && wiringStatus !== 'failed')
				setWiring('failed');
		}
		// The progress list must match the gate; a timed out typecheck says nothing about the files.
		if (fresh && !timedOut(fresh)) {
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
		plans = planCode(design);
		for (const p of plans) setStatus(p, 'planned', 0);
		setWiring('planned');
		await scaffold(ctx, design);

		const problems = new Map<string, string[]>();
		let pending = plans;
		let infra: string | undefined;

		for (let attempt = 1; attempt <= ATTEMPTS && pending.length > 0; attempt++) {
			attemptNo = attempt;
			const escalate = attempt === ATTEMPTS;
			const def = workerDef(escalate ? 'claude-sonnet-5-5' : 'claude-haiku-5-5', attempt > 1);
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
									errors: problems.get(p.path) ?? []
								};
					const r = await run({
						def,
						ctx: { ...ctx, writeOnly: p.path },
						history: [{ role: 'user', content: workerBrief(design, reqs, p, retry) }],
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
			const next: FilePlan[] = [];
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
					`Cost limit of $${limit.toFixed(2)} exceeded ($${cost.toFixed(2)} spent); stopped before the remaining files and the wiring.`
				);
			}
		}

		const failing = plans
			.filter((p) => files[p.path] === 'failed')
			.map((p) => `${p.path}: ${(problems.get(p.path) ?? []).slice(0, 3).join(' | ')}`);
		dirty = true;
		setWiring('writing');
		const wiring = await run({
			def: codeAgent,
			ctx,
			history: [
				{
					role: 'user',
					content: wiringBrief(plans, failing, dbFile(design, ctx.projectName), design)
				}
			],
			onEvent: (event) => onEvent({ type: 'wiring', event }),
			maxTurns: WIRING_TURNS
		});
		add(wiring);
		text = wiring.text;
		setWiring(wiring.status === 'failed' ? 'failed' : 'ok');
		if (wiring.status === 'failed' && wiring.reason === 'error')
			return await finish('failed', wiring.error ?? 'wiring failed');
		return await finish('done');
	} catch (e) {
		return await finish('failed', e instanceof Error ? e.message : String(e));
	}
}
