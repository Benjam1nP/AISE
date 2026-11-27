// Live smoke test for P5 test generation. Not part of CI: it generates the to do code first (P4,
// workers on Haiku, wiring on Sonnet, cost guard about $3), then the tests (workers on Haiku,
// triage on Sonnet, cost guard $2), and uses the Docker runner. It costs money.
// Run: npx tsx scripts/smoke-p5.ts   (needs ANTHROPIC_API_KEY in the environment or in .env, and Docker)
// Test generation that leaves an open code bug starts the fix loop by itself (another $3 guard). The
// script waits for it and prints every handoff. Optional --fix-loop: when no loop started and
// findings or unexplained failures remain, starts the loop through the orchestrator.
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DesignDoc } from '../src/lib/server/core/schemas/design';
import { RequirementsDoc } from '../src/lib/server/core/schemas/requirements';
import { readState, writeState } from '../src/lib/server/core/state';
import { ProjectStore } from '../src/lib/server/core/store';
import { coverage } from '../src/lib/server/core/test-state';
import { FIX_LOOP_COST_LIMIT_USD } from '../src/lib/server/testgen/fix-loop';
import { findingOpen, unexplainedFailures } from '../src/lib/test-names';
import { DESIGN_PATH } from '../src/lib/server/core/tools/design';
import { REQUIREMENTS_PATH } from '../src/lib/server/core/tools/requirements';
import { subscribe, type WorkspaceEvent } from '../src/lib/server/orchestrator/bus';
import { Orchestrator } from '../src/lib/server/orchestrator/orchestrator';
import { designHashesOf } from '../src/lib/server/orchestrator/p4';

if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.ANTHROPIC_API_KEY) {
	console.error('ANTHROPIC_API_KEY is not set. Put it in .env or export it, then run again.');
	console.error(
		'Usage: npx tsx scripts/smoke-p5.ts [--fix-loop]   (costs API credit, needs Docker, not run in CI)'
	);
	process.exit(1);
}

const fixture = async (file: string) =>
	JSON.parse(await readFile(path.resolve('test/fixtures', file), 'utf8')) as unknown;

const name = 'todo';
const orch = new Orchestrator({ root: await mkdtemp(path.join(tmpdir(), 'aise-smoke-p5-')) });
await orch.createProject(name);
const store = new ProjectStore(orch.projectDir(name));

// The approved starting point: P1 and P2 done, as after the developer approved both.
const reqs = RequirementsDoc.parse(await fixture('todo-requirements.json'));
const design = DesignDoc.parse(await fixture('todo-design.json'));
await store.writeJson(REQUIREMENTS_PATH, RequirementsDoc, reqs);
await store.writeJson(DESIGN_PATH, DesignDoc, design);
const state = await readState(store);
const approvedAt = new Date().toISOString();
state.phases.P1 = { status: 'approved', approvedAt };
state.phases.P2 = { status: 'approved', approvedAt };
await writeState(store, state);

type Finished = Extract<WorkspaceEvent, { type: 'run_finished' }>;

/** Starts a run through `start`, prints its file progress and waits for its end. */
async function watch(
	label: string,
	start: () => Promise<{ runId: string }>
): Promise<{ run: Finished; files: Map<string, string> }> {
	const files = new Map<string, string>();
	const finished = new Promise<Finished>((resolve) => {
		const stop = subscribe(name, (e) => {
			if (e.type === 'codegen_file') {
				files.set(e.path, e.status);
				console.log(`${e.status.padEnd(9)} ${e.path} (attempt ${e.attempt})`);
			} else if (e.type === 'tool_call')
				console.log(`${label} tool ${e.name}: ${e.isError ? 'error' : 'ok'}`);
			else if (e.type === 'run_finished') {
				stop();
				resolve(e);
			}
		});
	});
	const { runId } = await start();
	console.log(`${label} run ${runId} started`);
	return { run: await finished, files };
}

// P4: the code the tests are written for. The state is written directly, because approving P4
// would start the test run by itself.
console.log('--- P4: generating the code ---');
const code = await watch('code', () => orch.generateCode(name));
const afterCode = await orch.snapshot(name);
if (code.run.status !== 'done' || !afterCode.gates.P4.passed) {
	console.error(`code generation did not pass its gate (${code.run.error ?? code.run.status})`);
	console.error(`project dir: ${orch.projectDir(name)}`);
	process.exit(1);
}
const p4 = await readState(store);
p4.phases.P4 = {
	...p4.phases.P4,
	status: 'approved',
	approvedAt: new Date().toISOString(),
	designHashes: p4.phases.P4.designHashes ?? designHashesOf(design)
};
await writeState(store, p4);

// Runs after the test generation (the fix loop) and the handoffs between the agents.
const started: string[] = [];
const finishedRuns = new Map<string, Finished>();
subscribe(name, (e) => {
	if (e.type === 'run_started') started.push(e.runId);
	else if (e.type === 'run_finished') finishedRuns.set(e.runId, e);
	else if (e.type === 'agent_message') console.log(`\n${e.from} to ${e.to}\n${e.text}`);
	else if (e.type === 'tool_call' && started.indexOf(e.runId) > 0)
		console.log(`loop tool ${e.name}: ${e.isError ? 'error' : 'ok'}`);
});

/** Waits until no run is active; a follow up run keeps the claim, so there is no gap in between. */
async function idle(): Promise<void> {
	while ((await orch.snapshot(name)).activeRun !== null)
		await new Promise((resolve) => setTimeout(resolve, 2000));
}

console.log('\n--- P5: generating the tests ---');
const { run, files } = await watch('test', () => orch.generateTests(name));
const snap = await orch.snapshot(name);
console.log(`\nstatus: ${run.status}${run.error ? ` (${run.error})` : ''}`);

console.log('\nper file status:');
for (const [file, status] of [...files].sort()) console.log(`  ${status.padEnd(9)} ${file}`);

console.log('\nP5 gate:');
for (const c of snap.gates.P5.checks)
	console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.label}${c.detail ? ` (${c.detail})` : ''}`);

const checks = snap.testChecks;
const tests = checks?.result?.tests ?? [];
console.log(
	`\ntests: ${checks?.result?.passed ?? 0} passed, ${checks?.result?.failed ?? 0} failed`
);
for (const t of tests.filter((x) => x.status === 'failed'))
	console.log(
		`  FAIL ${t.file}:${t.line ?? '?'} ${t.name}\n       ${(t.error ?? '').split('\n')[0]}`
	);
for (const r of coverage(reqs.requirements, tests).filter((x) => x.status !== 'passed'))
	console.log(`  coverage ${r.reqId} AC${r.n} (${r.priority}): ${r.status}`);

console.log(`\nfindings (code bugs): ${checks?.findings.length ?? 0}`);
for (const f of checks?.findings ?? [])
	console.log(`  ${f.id} ${f.test}\n    why: ${f.explanation}\n    fix: ${f.proposedFix}`);
console.log(`\ntest fixes (tests the triage corrected): ${checks?.testFixes.length ?? 0}`);
for (const f of checks?.testFixes ?? []) console.log(`  ${f.file} ${f.test}: ${f.reason}`);

for (const e of checks?.typecheck?.errors ?? [])
	console.log(`  tsc ${e.file}(${e.line},${e.col}): ${e.message}`);
console.log(`\ntest files: ${snap.files.filter((f) => f.startsWith('test/')).length}`);
console.log(`cost: code $${code.run.costUsd.toFixed(4)}, tests $${run.costUsd.toFixed(4)}`);
console.log(`project dir: ${orch.projectDir(name)}`);

// Test generation that leaves an open code bug starts the fix loop by itself on the same claim, so
// wait until no run is active. --fix-loop starts the loop by hand when none started and something
// is still open or unexplained. Everything goes through the orchestrator: one loop at a time.
await idle();
const loopRuns = started.slice(1);
if (process.argv.includes('--fix-loop')) {
	const now = (await orch.snapshot(name)).testChecks;
	const open = (now?.findings ?? []).filter((f) => findingOpen(f, now?.result ?? null));
	const unexplained = unexplainedFailures(now?.result ?? null, now?.findings ?? []);
	if (loopRuns.length > 0) {
		console.log('\n--- fix loop: started by itself after the test generation ---');
	} else if (open.length === 0 && unexplained.length === 0) {
		console.log('\n--- fix loop: nothing to fix ---');
	} else {
		console.log(
			`\n--- fix loop: ${open.length} open findings, ${unexplained.length} unexplained failures (cost guard $${FIX_LOOP_COST_LIMIT_USD}) ---`
		);
		try {
			await orch.fixLoop(name);
			await idle();
		} catch (e) {
			console.error(`the fix loop did not start: ${e instanceof Error ? e.message : String(e)}`);
			process.exitCode = 1;
		}
	}
}
if (started.length > 1) {
	console.log('\nfix loop runs:');
	for (const id of started.slice(1)) {
		const r = finishedRuns.get(id);
		console.log(
			`  ${id}: ${r?.status ?? 'unknown'}${r?.error ? ` (${r.error})` : ''}, $${(r?.costUsd ?? 0).toFixed(4)}`
		);
		if (r?.status !== 'done') process.exitCode = 1;
	}
	const after = (await orch.snapshot(name)).testChecks;
	console.log(
		`tests after the loop: ${after?.result?.passed ?? 0} passed, ${after?.result?.failed ?? 0} failed`
	);
}
// A failing test with a finding is a result worth showing, not a failed smoke run.
if (run.status !== 'done') process.exitCode = 1;
