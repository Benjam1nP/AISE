// Drives the committed auction showcase (showcases/auction) through P4 and P5 approval, P6 and one
// P7 change ticket, in place, through the same orchestrator calls the UI makes. Costs API credit and
// needs Docker. Not run in CI. Steps run in order; pass one to run only that step.
// Run: npx tsx scripts/run-auction.ts [approve|p6|p7|check] [--override P4] [--anyway]
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DEPLOY_FILES } from '../src/lib/server/core/deploy-state';
import { ProjectStore } from '../src/lib/server/core/store';
import { subscribe, type WorkspaceEvent } from '../src/lib/server/orchestrator/bus';
import { Orchestrator } from '../src/lib/server/orchestrator/orchestrator';

if (existsSync('.env')) process.loadEnvFile('.env');
const STEPS = ['approve', 'p6', 'p7', 'check'] as const;
const USAGE =
	'usage: npx tsx scripts/run-auction.ts [approve|p6|p7|check] [--override P4] [--anyway]';
const args = process.argv.slice(2);
// Phases the walk may approve over a failing gate: --override P4
const at = args.indexOf('--override');
const override = at >= 0 ? args[at + 1] : undefined;
if (at >= 0 && (!override || override.startsWith('--'))) {
	console.error(`--override needs a phase, e.g. --override P4\n${USAGE}`);
	process.exit(1);
}
const overrides = override ? [override] : [];
// --anyway approves P1 over open questions, which then become assumptions; without it the walk stops.
const anyway = args.includes('--anyway');
// The step is the one argument that is neither a flag nor the phase after --override.
const positional = args.filter((a, i) => !a.startsWith('--') && !(at >= 0 && i === at + 1));
const only = positional[0];
if (positional.length > 1 || (only !== undefined && !(STEPS as readonly string[]).includes(only))) {
	console.error(`unknown step: ${positional.join(' ')}\n${USAGE}`);
	process.exit(1);
}
const name = 'auction';
const orch = new Orchestrator({ root: path.resolve('showcases') });
const store = new ProjectStore(orch.projectDir(name));
type Finished = Extract<WorkspaceEvent, { type: 'run_finished' }>;

const spent = async () =>
	Object.values((await orch.snapshot(name)).costByPhase).reduce((s, c) => s + c, 0);

async function stop(reason: string): Promise<never> {
	console.error(`\nstopping: ${reason}\ncost so far: $${(await spent()).toFixed(4)}`);
	process.exit(1);
}

/**
 * Starts a run and waits for its own `run_finished`: a run the orchestrator chains by itself (P5
 * approval starting P6, test generation starting the fix loop) finishes under another run ID.
 * Events that arrive before `start` returns the ID are kept until it is known.
 */
async function watch(label: string, start: () => Promise<{ runId: string }>): Promise<Finished> {
	// Every run_finished is kept until the run ID is known; only the one with that ID counts.
	const ended: Finished[] = [];
	let wake = () => {};
	const off = subscribe(name, (e) => {
		if (e.type === 'tool_call')
			console.log(`${label} tool ${e.name}: ${e.isError ? 'error' : 'ok'}`);
		else if (e.type === 'codegen_file')
			console.log(`${e.status.padEnd(9)} ${e.path} (attempt ${e.attempt})`);
		else if (e.type === 'run_finished') {
			ended.push(e);
			wake();
		}
	});
	const { runId } = await start();
	const finished = new Promise<Finished>((resolve) => {
		wake = () => {
			const own = ended.find((e) => e.runId === runId);
			if (own) resolve(own);
		};
		wake();
	});
	console.log(`${label} run ${runId} started`);
	const run = await finished;
	off();
	console.log(
		`${label} run ${runId}: ${run.status}, $${run.costUsd.toFixed(4)}${run.error ? ` (${run.error})` : ''}`
	);
	if (run.status !== 'done') await stop(`${label} run failed`);
	return run;
}

async function idle(): Promise<void> {
	for (let i = 0; i < 1800; i++) {
		if (!(await orch.snapshot(name)).activeRun) return;
		await new Promise((r) => setTimeout(r, 1000));
	}
	await stop('a run did not finish in 30 minutes');
}

async function gates(...phases: ('P4' | 'P5' | 'P6')[]) {
	const snap = await orch.snapshot(name);
	for (const p of phases) {
		const g = snap.gates[p];
		console.log(`${p} gate: ${g.passed ? 'passed' : 'FAILED'}`);
		for (const c of g.checks)
			console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.label}${c.detail ? ` (${c.detail})` : ''}`);
	}
	return snap;
}

async function approve(phase: 'P4' | 'P5' | 'P6') {
	await idle();
	const s = (await orch.snapshot(name)).state.phases[phase].status;
	if (s === 'approved') return console.log(`${phase} already approved`);
	try {
		await orch.approve(name, phase);
	} catch (e) {
		await stop(`approving ${phase} failed: ${e instanceof Error ? e.message : String(e)}`);
	}
	console.log(`${phase} approved`);
}

if (!only || only === 'approve') {
	console.log('--- P4 and P5: checks, then approve ---');
	await orch.checkCode(name);
	await orch.checkTests(name);
	const snap = await gates('P4', 'P5');
	if (!snap.gates.P4.passed || !snap.gates.P5.passed) await stop('P4 or P5 gate fails');
	await approve('P4');
	await approve('P5');
	await idle();
}

if (!only || only === 'p6') {
	console.log('\n--- P6 ---');
	// Approving P5 starts the deployment by itself; generate only when that did not happen.
	if ((await orch.snapshot(name)).state.phases.P6.status === 'not_started')
		await watch('deploy', () => orch.generateDeployment(name));
	const snap = await gates('P6');
	for (const f of DEPLOY_FILES)
		console.log(`\n=== ${f} ===\n${await store.readText(f).catch(() => '(not written)')}`);
	const c = snap.deployCheck;
	if (c) {
		console.log(`\ndeploy check ${c.passed ? 'passed' : 'FAILED'} in ${c.durationMs} ms`);
		for (const s of c.services) console.log(`  ${s.url} -> ${s.status ?? 'no answer'}`);
		if (!c.passed) console.log(c.logTail);
	}
	if (!snap.gates.P6.passed) await stop('P6 gate fails');
	await approve('P6');
}

if (!only || only === 'p7') {
	console.log('\n--- P7 ticket ---');
	// Resume an open ticket when one exists, so a stopped walk goes on where it stopped.
	const open = (await orch.snapshot(name)).tickets.find(
		(t) => t.status !== 'done' && t.status !== 'rejected'
	);
	let ticketId = open?.id ?? '';
	const ticket = async () => (await orch.snapshot(name)).tickets.find((t) => t.id === ticketId)!;
	if (!open) {
		await watch('triage', async () => {
			const r = await orch.createTicket(name, {
				kind: 'requirement',
				title: 'Sellers can set a reserve price',
				description:
					'When listing an item a seller can set an optional reserve price, at least the starting price. If the auction closes with a highest bid below the reserve, the item is unsold and no winner is announced. Bidders see whether the reserve is met, never its amount.'
			});
			ticketId = r.ticketId;
			return r;
		});
		const triaged = await ticket();
		if (triaged.status !== 'triaged' || !triaged.plan) await stop(`triage left ${triaged.status}`);
		console.log(
			`plan: entry ${triaged.plan!.entry}, affected ${triaged.plan!.affectedIds.join(', ')}`
		);
		for (const [i, s] of triaged.plan!.steps.entries()) console.log(`  ${i + 1}. ${s}`);
		await watch(`entry ${triaged.plan!.entry}`, () => orch.approvePlan(name, ticketId));
	} else if (open.status === 'triaged') {
		// Stopped after triage: the plan was never approved, so the entry run has not happened.
		await idle();
		if (!open.plan) await stop(`${open.id} is triaged without a plan`);
		await watch(`entry ${open.plan!.entry}`, () => orch.approvePlan(name, open.id));
	} else if (open.status !== 'in_progress') {
		await stop(`${open.id} is ${open.status}; answer its questions in the UI, then run p7 again`);
	}

	const ORDER = ['P1', 'P2', 'P4', 'P5', 'P6'] as const;
	const pending = async () => {
		await idle();
		const { state: s } = await orch.snapshot(name);
		return ORDER.find((p) => s.phases[p].status !== 'approved');
	};
	for (let step = 0; step < 15; step++) {
		const phase = await pending();
		if (!phase) break;
		const { state: s, requirements } = await orch.snapshot(name);
		const status = s.phases[phase].status;
		console.log(`\n${phase} is ${status}`);
		if (status === 'awaiting_approval') {
			try {
				// P4 may only fail on tests that call a changed signature; P5 updates them next, so
				// that P4 approval is an override, recorded in the state like one made in the UI.
				const questions = requirements?.openQuestions ?? [];
				if (phase === 'P1' && questions.length > 0 && !anyway) {
					for (const q of questions) console.log(`  ${q.id} ${q.text}`);
					await stop('P1 has open questions; answer them in the UI, or pass --anyway to assume');
				}
				const opts =
					phase === 'P1' ? { anyway } : overrides.includes(phase) ? { override: true } : {};
				await orch.approve(name, phase, opts);
			} catch (e) {
				await gates('P4', 'P5', 'P6');
				await stop(`approving ${phase} failed: ${e instanceof Error ? e.message : String(e)}`);
			}
			console.log(`${phase} approved`);
		} else if (status === 'stale' && phase !== 'P1') {
			await watch(`update ${phase}`, () => orch.updateStale(name, phase));
		} else await stop(`${phase} is ${status}; the walk cannot go on`);
	}
	const left = await pending();
	if (left) await stop(`${left} is still not approved after 15 steps`);
	await orch.checkTests(name);
	const before = await ticket();
	if (before.closeBlocked) await stop(`ticket cannot close: ${before.closeBlocked}`);
	await watch('report', () => orch.closeTicket(name, ticketId));
	const done = await ticket();
	console.log(`\n${done.id} is ${done.status}\n${done.report?.text ?? 'no report'}`);
	const t = done.report?.tests;
	if (t) console.log(`tests: ${t.passed} passed, ${t.failed} failed`);
}

// P6 is not marked stale when only code changes, so the walk keeps the old deploy check; rerun all
// checks at the end so the stored results describe the final code.
if (!only || only === 'check') {
	console.log('\n--- final checks ---');
	await orch.checkCode(name);
	await orch.checkTests(name);
	await orch.checkDeploy(name);
	const c = (await gates('P4', 'P5', 'P6')).deployCheck;
	if (c)
		console.log(
			`deploy check at ${c.at} ${c.passed ? 'passed' : 'FAILED'}: ${c.services
				.map((s) => `${s.url} ${s.status ?? 'no answer'}`)
				.join(', ')}`
		);
}

console.log(`\ntotal project cost: $${(await spent()).toFixed(4)}`);
