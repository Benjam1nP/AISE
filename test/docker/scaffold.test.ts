import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scaffold } from '../../src/lib/server/codegen/scaffold';
import { docker } from '../../src/lib/server/core/docker/run';
import { createRun } from '../../src/lib/server/core/runs';
import { ProjectStore } from '../../src/lib/server/core/store';

const TAG = 'aise-scaffold-npm-ci:test';
let root: string | undefined;

afterEach(async () => {
	if (root) await rm(root, { recursive: true, force: true });
	root = undefined;
	await docker(['image', 'rm', '-f', TAG], { timeoutMs: 30_000 });
});

describe('scaffolded project', () => {
	// Plain `npm install` crashes on these packages (#18), so a P6 Dockerfile needs the lockfile.
	it('installs with npm ci in node:22-slim', async () => {
		root = await mkdtemp(path.join(tmpdir(), 'aise-scaffold-'));
		const store = new ProjectStore(path.join(root, 'proj'));
		await mkdir(store.dir, { recursive: true });
		const meta = await createRun(store, 'P4', 'code');
		await scaffold({ store, runId: meta.id, projectName: 'team@todo', agent: 'code' });
		await writeFile(
			store.resolve('Dockerfile'),
			'FROM node:22-slim\nWORKDIR /app\nCOPY package.json package-lock.json ./\nRUN npm ci --no-audit --no-fund\n'
		);

		const r = await docker(['build', '--no-cache', '-t', TAG, store.dir], { timeoutMs: 600_000 });
		expect(r.stderr + r.stdout).not.toContain('npm error');
		expect(r.code).toBe(0);
	}, 620_000);
});
