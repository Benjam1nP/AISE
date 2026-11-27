// Live smoke test for P7 ticket maintenance. Not part of CI: one change ticket ("Tasks need a due
// date") goes end to end on the to do fixture project: triage by the maintenance agent (Opus,
// medium effort), plan approval, the entry run in P1, then Update and approve of P2, P4 and P5 in
// walk order, Run tests, and the change report. It uses the Docker runner and costs money: the
// script stops when the total cost of the project passes the $6 guard.
// Run: npx tsx scripts/smoke-p7.ts   (needs ANTHROPIC_API_KEY in the environment or in .env, and Docker)
// Free dry run: npx tsx scripts/smoke-p7.ts --setup-only   (sets the project up and runs the checks, no LLM)
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DesignDoc } from '../src/lib/server/core/schemas/design';
import { RequirementsDoc } from '../src/lib/server/core/schemas/requirements';
import { reqHashes } from '../src/lib/server/core/staleness';
import { readState, writeState } from '../src/lib/server/core/state';
import { ProjectStore } from '../src/lib/server/core/store';
import { DESIGN_PATH } from '../src/lib/server/core/tools/design';
import { REQUIREMENTS_PATH } from '../src/lib/server/core/tools/requirements';
import { subscribe, type WorkspaceEvent } from '../src/lib/server/orchestrator/bus';
import { Orchestrator } from '../src/lib/server/orchestrator/orchestrator';
import { designHashesOf } from '../src/lib/server/orchestrator/p4';
import { testHashesOf } from '../src/lib/server/orchestrator/p5';

const COST_GUARD_USD = 6;
const setupOnly = process.argv.includes('--setup-only');

if (existsSync('.env')) process.loadEnvFile('.env');
if (!setupOnly && !process.env.ANTHROPIC_API_KEY) {
	console.error('ANTHROPIC_API_KEY is not set. Put it in .env or export it, then run again.');
	console.error(
		'Usage: npx tsx scripts/smoke-p7.ts   (costs API credit, needs Docker, not run in CI)'
	);
	process.exit(1);
}

const name = 'todo';
const orch = new Orchestrator({ root: await mkdtemp(path.join(tmpdir(), 'aise-smoke-p7-')) });
await orch.createProject(name);
const dir = orch.projectDir(name);
const store = new ProjectStore(dir);

// The starting point: the P4 fixture code (package.json, tsconfig, src/, and its design) and the P5
// fixture (its requirements and the tests), all of one to do slice, so nothing drifts at the start.
await cp(path.resolve('test/fixtures/p4'), dir, { recursive: true });
await cp(path.resolve('test/fixtures/p5'), dir, { recursive: true });
const base = RequirementsDoc.parse(
	JSON.parse(await readFile(path.join(dir, REQUIREMENTS_PATH), 'utf8'))
);
// The fixture code and design trace REQ-002 (completing a task), which its requirements file lacks.
// A could requirement keeps the P5 gate as it is, because only must criteria need a test.
const reqs = RequirementsDoc.parse({
	...base,
	requirements: [
		...base.requirements,
		{
			id: 'REQ-002',
			title: 'Complete task',
			text: 'The system shall let a user mark a task as done.',
			type: 'functional',
			priority: 'could',
			acceptanceCriteria: ['A task marked as done shows the status done in the task list.']
		}
	]
});
const design = DesignDoc.parse(JSON.parse(await readFile(path.join(dir, DESIGN_PATH), 'utf8')));
await store.writeJson(REQUIREMENTS_PATH, RequirementsDoc, reqs);
await store.writeJson(DESIGN_PATH, DesignDoc, design);

// P1, P2, P4 and P5 approved with the hashes of what they were made from, as after the developer
// approved each, so the change of P1 makes the later phases stale.
const state = await readState(store);
const approvedAt = new Date().toISOString();
state.phases.P1 = { status: 'approved', approvedAt };
state.phases.P2 = { status: 'approved', approvedAt, reqHashes: reqHashes(reqs) };
state.phases.P4 = { status: 'approved', approvedAt, designHashes: designHashesOf(design) };
state.phases.P5 = { status: 'approved', approvedAt, ...testHashesOf(reqs, design) };
await writeState(store, state);

console.log('--- setup: running the code and test checks (Docker) ---');
await orch.checkCode(name);
await orch.checkTests(name);
const start = await orch.snapshot(name);
for (const p of ['P2', 'P4', 'P5'] as const) {
	const g = start.gates[p];
	console.log(`${p} gate: ${g.passed ? 'passed' : 'FAILED'}`);
	for (const c of g.checks)
		console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.label}${c.detail ? ` (${c.detail})` : ''}`);
}
console.log(`project dir: ${dir}`);
if (setupOnly) process.exit(start.gates.P4.passed && start.gates.P5.passed ? 0 : 1);
if (!start.gates.P4.passed || !start.gates.P5.passed) {
	console.error('the starting point does not pass its gates; stopping before any paid run');
	process.exit(1);
}

type Finished = Extract<WorkspaceEvent, { type: 'run_finished' }>;

/** Total cost of the project so far, from the runs on disk (includes runs started by approvals). */
async function spent(): Promise<number> {
	const { costByPhase } = await orch.snapshot(name);
	return Object.values(costByPhase).reduce((sum, c) => sum + c, 0);
}

/** Prints the result and stops the script. */
async function stop(reason: string): Promise<never> {
	console.error(`\nstopping: ${reason}`);
	console.error(`cost so far: $${(await spent()).toFixed(4)}`);
	console.error(`project dir: ${dir}`);
	process.exit(1);
}

/** Stops when the cost guard is passed; runs between steps never start past it. */
async function guard(): Promise<void> {
	const total = await spent();
	console.log(`cost so far: $${total.toFixed(4)} of $${COST_GUARD_USD}`);
	if (total > COST_GUARD_USD) await stop(`the $${COST_GUARD_USD} cost guard is passed`);
}

/** Starts a run through `start`, prints its tool calls and waits for its end; a failed run stops the script. */
async function watch(label: string, start: () => Promise<{ runId: string }>): Promise<Finished> {
	const finished = new Promise<Finished>((resolve) => {
		const stopListening = subscribe(name, (e) => {
			if (e.type === 'tool_call')
				console.log(`${label} tool ${e.name}: ${e.isError ? 'error' : 'ok'}`);
			else if (e.type === 'codegen_file')
				console.log(`${e.status.padEnd(9)} ${e.path} (attempt ${e.attempt})`);
			else if (e.type === 'run_finished') {
				stopListening();
				resolve(e);
			}
		});
	});
	const { runId } = await start();
	console.log(`${label} run ${runId} started`);
	const run = await finished;
	if (run.status !== 'done') await stop(`${label} run failed (${run.error ?? run.status})`);
	await guard();
	return run;
}

/** Waits until no run is active; an approval may start one by itself. */
async function idle(): Promise<void> {
	for (let i = 0; i < 1800; i++) {
		if (!(await orch.snapshot(name)).activeRun) return;
		await new Promise((r) => setTimeout(r, 1000));
	}
	await stop('a run did not finish in 30 minutes');
}

const ticketOf = async (id: string) => {
	const t = (await orch.snapshot(name)).tickets.find((x) => x.id === id);
	if (!t) await stop(`ticket ${id} is gone`);
	return t!;
};

console.log('\n--- triage ---');
let ticketId = '';
await watch('triage', async () => {
	const r = await orch.createTicket(name, {
		kind: 'requirement',
		title: 'Tasks need a due date',
		description:
			'A task can have an optional due date. The task list shows it, and adding a task with a malformed date is rejected with an error message.'
	});
	ticketId = r.ticketId;
	return r;
});
const triaged = await ticketOf(ticketId);
console.log(`\n${triaged.id} is ${triaged.status}`);
if (triaged.status !== 'triaged' || !triaged.plan) await stop('triage wrote no plan');
console.log(`plan: entry ${triaged.plan!.entry}, affected ${triaged.plan!.affectedIds.join(', ')}`);
console.log(`files: ${triaged.plan!.files.join(', ') || 'none'}`);
for (const [i, s] of triaged.plan!.steps.entries()) console.log(`  ${i + 1}. ${s}`);

console.log('\n--- approve the plan: the entry run ---');
await watch(`entry ${triaged.plan!.entry}`, () => orch.approvePlan(name, ticketId));

// The walk: the first phase that is not approved is approved when it waits for it, and updated when
// it is stale, until every phase is approved. A gate that fails stops the script, never an override.
console.log('\n--- the walk ---');
const ORDER = ['P1', 'P2', 'P4', 'P5'] as const;
for (let step = 0; step < 12; step++) {
	await idle();
	const { state: s } = await orch.snapshot(name);
	const phase = ORDER.find((p) => s.phases[p].status !== 'approved');
	if (!phase) break;
	const status = s.phases[phase].status;
	console.log(`\n${phase} is ${status}`);
	if (status === 'awaiting_approval') {
		try {
			await orch.approve(name, phase, phase === 'P1' ? { anyway: true } : {});
		} catch (e) {
			await stop(`approving ${phase} failed: ${e instanceof Error ? e.message : String(e)}`);
		}
		console.log(`${phase} approved`);
	} else if (status === 'stale' && phase !== 'P1') {
		await watch(`update ${phase}`, () => orch.updateStale(name, phase));
	} else {
		await stop(`${phase} is ${status}; the walk cannot go on`);
	}
}
await idle();

console.log('\n--- run the tests, then close ---');
await orch.checkTests(name);
const before = await ticketOf(ticketId);
if (before.closeBlocked) await stop(`the ticket cannot close: ${before.closeBlocked}`);
await watch('report', () => orch.closeTicket(name, ticketId));

const done = await ticketOf(ticketId);
console.log(`\n${done.id} is ${done.status}`);
const report = done.report;
if (!report) await stop('no change report was written');
console.log(`\nchange report:\n${report!.text}`);
console.log('\nsteps:');
for (const s of report!.steps)
	console.log(`  ${s.phase} ${s.agent} ${s.status}: ${s.summary ?? ''} [${s.files.join(', ')}]`);
console.log(`\nchanged IDs: ${report!.changedIds.join(', ') || 'none'}`);
console.log('files:');
for (const f of report!.files) console.log(`  ${f.path} (${f.diff.split('\n').length} diff lines)`);
const t = report!.tests;
console.log(
	t
		? `tests: ${t.passed} passed, ${t.failed} failed${t.outOfDate ? ' (out of date)' : ''}`
		: 'tests: none recorded'
);
console.log(`\ncost: $${(await spent()).toFixed(4)} of $${COST_GUARD_USD}`);
console.log(`project dir: ${dir}`);
if (done.status !== 'done') process.exitCode = 1;
