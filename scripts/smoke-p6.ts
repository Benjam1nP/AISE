// Live smoke test for P6 deployment. Not part of CI: it runs the deploy agent (Sonnet, medium
// effort, cost guard $1, at most 3 deploy checks) on the to do design and the code of
// test/fixtures/p4, and starts real containers through Docker. It costs money.
// Run: npx tsx scripts/smoke-p6.ts   (needs ANTHROPIC_API_KEY in the environment or in .env, and Docker)
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEPLOY_FILES } from '../src/lib/server/core/deploy-state';
import { DesignDoc } from '../src/lib/server/core/schemas/design';
import { RequirementsDoc } from '../src/lib/server/core/schemas/requirements';
import { readState, writeState } from '../src/lib/server/core/state';
import { ProjectStore } from '../src/lib/server/core/store';
import { DESIGN_PATH } from '../src/lib/server/core/tools/design';
import { REQUIREMENTS_PATH } from '../src/lib/server/core/tools/requirements';
import { subscribe, type WorkspaceEvent } from '../src/lib/server/orchestrator/bus';
import { Orchestrator } from '../src/lib/server/orchestrator/orchestrator';
import { designHashesOf } from '../src/lib/server/orchestrator/p4';
import { testHashesOf } from '../src/lib/server/orchestrator/p5';

if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.ANTHROPIC_API_KEY) {
	console.error('ANTHROPIC_API_KEY is not set. Put it in .env or export it, then run again.');
	console.error(
		'Usage: npx tsx scripts/smoke-p6.ts   (costs API credit, needs Docker, not run in CI)'
	);
	process.exit(1);
}

const fixture = async (file: string) =>
	JSON.parse(await readFile(path.resolve('test/fixtures', file), 'utf8')) as unknown;

const name = 'todo';
const orch = new Orchestrator({ root: await mkdtemp(path.join(tmpdir(), 'aise-smoke-p6-')) });
await orch.createProject(name);
const dir = orch.projectDir(name);
const store = new ProjectStore(dir);

// The approved starting point: the P4 fixture code (src, package.json, tsconfig.json) and the
// to do requirements and design, with P1, P2, P4 and P5 approved as after the developer did so.
// The state is written directly, so no earlier phase runs and costs credit.
await cp(path.resolve('test/fixtures/p4'), dir, { recursive: true });
const reqs = RequirementsDoc.parse(await fixture('todo-requirements.json'));
const design = DesignDoc.parse(await fixture('todo-design.json'));
await store.writeJson(REQUIREMENTS_PATH, RequirementsDoc, reqs);
await store.writeJson(DESIGN_PATH, DesignDoc, design);
const state = await readState(store);
const approvedAt = new Date().toISOString();
state.phases.P1 = { status: 'approved', approvedAt };
state.phases.P2 = { status: 'approved', approvedAt };
state.phases.P4 = { status: 'approved', approvedAt, designHashes: designHashesOf(design) };
state.phases.P5 = { status: 'approved', approvedAt, ...testHashesOf(reqs, design) };
await writeState(store, state);

type Finished = Extract<WorkspaceEvent, { type: 'run_finished' }>;
const finished = new Promise<Finished>((resolve) => {
	const stop = subscribe(name, (e) => {
		if (e.type === 'tool_call') console.log(`deploy tool ${e.name}: ${e.isError ? 'error' : 'ok'}`);
		else if (e.type === 'run_finished') {
			stop();
			resolve(e);
		}
	});
});

const { runId } = await orch.generateDeployment(name);
console.log(`run ${runId} started`);
const run = await finished;

const snap = await orch.snapshot(name);
console.log(`\nstatus: ${run.status}${run.error ? ` (${run.error})` : ''}`);

for (const file of DEPLOY_FILES) {
	console.log(`\n=== ${file} ===`);
	console.log(await store.readText(file).catch(() => '(not written)'));
}

const check = snap.deployCheck;
console.log('\ndeploy check:');
if (!check) console.log('  none stored');
else {
	console.log(`  ${check.passed ? 'passed' : 'FAILED'} in ${check.durationMs} ms at ${check.at}`);
	for (const s of check.services) console.log(`  ${s.url} -> ${s.status ?? 'no answer'}`);
	if (!check.passed) console.log(`  log tail:\n${check.logTail}`);
}

console.log('\nP6 gate:');
for (const c of snap.gates.P6.checks)
	console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.label}${c.detail ? ` (${c.detail})` : ''}`);

console.log(`\ncost: $${run.costUsd.toFixed(4)}`);
console.log(`project dir: ${dir}`);
if (run.status !== 'done' || !snap.gates.P6.passed) process.exitCode = 1;
