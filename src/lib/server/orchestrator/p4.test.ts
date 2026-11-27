import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRun } from '../core/runs';
import { ProjectStore } from '../core/store';
import type { DeploymentNode, DesignDoc } from '../core/schemas/design';
import { staleEntries, syncStartScripts, writeReadme } from './p4';

const service = (id: string, name: string): DeploymentNode => ({
	id,
	name,
	kind: 'service',
	reqIds: []
});

const design = (nodes: DeploymentNode[]): DesignDoc => ({
	actors: [],
	useCases: [],
	classes: [],
	components: [],
	nodes,
	links: [],
	sequences: []
});

let root: string;
let store: ProjectStore;
let runId: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-p4-'));
	store = new ProjectStore(path.join(root, 'proj'));
	runId = (await createRun(store, 'P4', 'code')).id;
	await store.writeFile('src/app/main.ts', '');
	await store.writeFile('src/app/worker.ts', '');
	await store.writeFile(
		'package.json',
		JSON.stringify({
			scripts: { start: 'tsx src/app/main.ts', 'start:worker': 'tsx src/app/worker.ts' }
		})
	);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('syncStartScripts after a service node is removed', () => {
	const single = design([service('DSN-020', 'API')]);

	it('keeps the stale script while the entry file exists, so the next brief names it', async () => {
		await store.writeFile('.aise/design.json', JSON.stringify(single));
		await syncStartScripts(store, runId);
		expect(await staleEntries(store, single)).toEqual(['src/app/worker.ts']);
	});

	it('drops the stale script once the entry file is deleted', async () => {
		await store.writeFile('.aise/design.json', JSON.stringify(single));
		await store.deleteFile('src/app/worker.ts');
		await syncStartScripts(store, runId);
		expect(await staleEntries(store, single)).toEqual([]);
		const pkg = JSON.parse((await store.readText('package.json'))!);
		expect(pkg.scripts).toEqual({ start: 'tsx src/app/main.ts' });
	});
});

describe('writeReadme links RUN.md only while it exists', () => {
	it('adds the link when RUN.md is written and drops it when RUN.md is deleted', async () => {
		await store.writeFile('.aise/design.json', JSON.stringify(design([])));
		await writeReadme(store, runId, 'To-do');
		expect(await store.readText('README.md')).not.toContain('RUN.md');
		await store.writeFile('RUN.md', '# Run\n');
		await writeReadme(store, runId, 'To-do');
		expect(await store.readText('README.md')).toContain('[RUN.md](RUN.md)');
		await store.deleteFile('RUN.md');
		await writeReadme(store, runId, 'To-do');
		expect(await store.readText('README.md')).not.toContain('RUN.md');
	});
});
