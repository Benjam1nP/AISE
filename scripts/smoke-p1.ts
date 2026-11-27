// Live smoke test for the requirements agent. Not part of CI: it calls the real API and costs money.
// Run: npx tsx scripts/smoke-p1.ts   (needs ANTHROPIC_API_KEY in the environment or in .env)
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requirementsAgent } from '../src/lib/server/agents/requirements';
import { runAgent } from '../src/lib/server/agents/loop';
import { createRun } from '../src/lib/server/core/runs';
import { RequirementsDoc } from '../src/lib/server/core/schemas/requirements';
import { ProjectStore } from '../src/lib/server/core/store';

if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.ANTHROPIC_API_KEY) {
	console.error('ANTHROPIC_API_KEY is not set. Put it in .env or export it, then run again.');
	process.exit(1);
}

const dir = await mkdtemp(path.join(tmpdir(), 'aise-smoke-'));
const projectDir = path.join(dir, 'todo');
const store = new ProjectStore(projectDir);
const meta = await createRun(store, 'P1', 'requirements');

const result = await runAgent({
	def: requirementsAgent,
	ctx: { store, runId: meta.id, projectName: 'todo' },
	history: [{ role: 'user', content: 'A to-do app for one person' }],
	onEvent: (e) => {
		if (e.type === 'tool') console.log(`tool ${e.name}: ${e.isError ? 'error' : 'ok'}`);
	}
});

const doc = await store.readJson('.aise/requirements.json', RequirementsDoc);

console.log(`\nstatus: ${result.status}${result.error ? ` (${result.error})` : ''}`);
console.log(`\nreply:\n${result.text}`);
console.log(`\nproject dir: ${projectDir}`);
console.log(`requirements: ${doc?.requirements.length ?? 0}`);
console.log(`open questions: ${doc?.openQuestions.length ?? 0}`);
console.log(`turns: ${result.turns}`);
console.log(`usage: ${JSON.stringify(result.usage)}`);
console.log(`cost: $${result.costUsd.toFixed(4)}`);
if (result.status !== 'done') process.exitCode = 1;
