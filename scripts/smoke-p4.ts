// Live smoke test for P4 code generation. Not part of CI: it calls the real API (workers on
// Haiku, wiring on Sonnet) and the Docker runner, and costs money, at most about $3 (cost guard).
// Run: npx tsx scripts/smoke-p4.ts   (needs ANTHROPIC_API_KEY in the environment or in .env, and Docker)
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DesignDoc } from '../src/lib/server/core/schemas/design';
import { RequirementsDoc } from '../src/lib/server/core/schemas/requirements';
import { readState, writeState } from '../src/lib/server/core/state';
import { ProjectStore } from '../src/lib/server/core/store';
import { DESIGN_PATH } from '../src/lib/server/core/tools/design';
import { REQUIREMENTS_PATH } from '../src/lib/server/core/tools/requirements';
import { subscribe } from '../src/lib/server/orchestrator/bus';
import { Orchestrator } from '../src/lib/server/orchestrator/orchestrator';

if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.ANTHROPIC_API_KEY) {
	console.error('ANTHROPIC_API_KEY is not set. Put it in .env or export it, then run again.');
	console.error(
		'Usage: npx tsx scripts/smoke-p4.ts   (costs API credit, needs Docker, not run in CI)'
	);
	process.exit(1);
}

const fixture = async (file: string) =>
	JSON.parse(await readFile(path.resolve('test/fixtures', file), 'utf8')) as unknown;

const name = 'todo';
const orch = new Orchestrator({ root: await mkdtemp(path.join(tmpdir(), 'aise-smoke-p4-')) });
await orch.createProject(name);
const store = new ProjectStore(orch.projectDir(name));

// The approved starting point: P1 and P2 done, as after the developer approved both.
await store.writeJson(
	REQUIREMENTS_PATH,
	RequirementsDoc,
	RequirementsDoc.parse(await fixture('todo-requirements.json'))
);
await store.writeJson(DESIGN_PATH, DesignDoc, DesignDoc.parse(await fixture('todo-design.json')));
const state = await readState(store);
const approvedAt = new Date().toISOString();
state.phases.P1 = { status: 'approved', approvedAt };
state.phases.P2 = { status: 'approved', approvedAt };
await writeState(store, state);

const finished = new Promise<{ status: string; error?: string; costUsd: number }>((resolve) => {
	const stop = subscribe(name, (e) => {
		if (e.type === 'codegen_file')
			console.log(`${e.status.padEnd(9)} ${e.path} (attempt ${e.attempt})`);
		else if (e.type === 'tool_call')
			console.log(`wiring tool ${e.name}: ${e.isError ? 'error' : 'ok'}`);
		else if (e.type === 'run_finished') {
			stop();
			resolve(e);
		}
	});
});

const { runId } = await orch.generateCode(name);
console.log(`run ${runId} started`);
const run = await finished;

const snap = await orch.snapshot(name);
console.log(`\nstatus: ${run.status}${run.error ? ` (${run.error})` : ''}`);
console.log('\nP4 gate:');
for (const c of snap.gates.P4.checks)
	console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.label}${c.detail ? ` (${c.detail})` : ''}`);
for (const d of snap.checks?.drift ?? [])
	console.log(`  drift ${d.kind} ${d.name}: ${d.details.join('; ')}`);
for (const e of snap.checks?.typecheck?.errors ?? [])
	console.log(`  tsc ${e.file}(${e.line},${e.col}): ${e.message}`);
console.log(`\nfiles: ${snap.files.length}`);
console.log(`cost: $${run.costUsd.toFixed(4)}`);
console.log(`project dir: ${orch.projectDir(name)}`);
if (run.status !== 'done' || !snap.gates.P4.passed) process.exitCode = 1;
