import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runnerDir } from '../core/docker/image';
import { createRun } from '../core/runs';
import { ProjectStore } from '../core/store';
import type { DesignDoc } from '../core/schemas/design';
import { NO_TSCONFIG, TSCONFIG } from '../core/tools/check';
import type { ToolContext } from '../core/tools/registry';
import { scaffold } from './scaffold';

let root: string;
let ctx: ToolContext;
const runnerPkg = JSON.parse(readFileSync(path.join(runnerDir(), 'package.json'), 'utf8')) as {
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
};
const runnerLock = JSON.parse(
	readFileSync(path.join(runnerDir(), 'package-lock.json'), 'utf8')
) as { packages: Record<string, unknown> };

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-scaffold-'));
	const store = new ProjectStore(path.join(root, 'proj'));
	await mkdir(store.dir, { recursive: true });
	const meta = await createRun(store, 'P4', 'code');
	ctx = { store, runId: meta.id, projectName: 'todo', agent: 'code' };
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const read = async (rel: string) => readFile(ctx.store.resolve(rel), 'utf8');

describe('scaffold', () => {
	it('writes package.json with the project name, the start script and the runner dependencies', async () => {
		expect(await scaffold(ctx)).toEqual(['package.json', 'package-lock.json', 'tsconfig.json']);
		const pkg = JSON.parse(await read('package.json'));
		expect(pkg).toEqual({
			name: 'todo',
			private: true,
			type: 'module',
			scripts: {
				start: 'tsx src/app/main.ts',
				test: 'vitest run',
				typecheck: 'tsc --noEmit'
			},
			dependencies: runnerPkg.dependencies,
			devDependencies: runnerPkg.devDependencies
		});
	});

	it('adds one start script per extra service node next to start', async () => {
		const service = (id: string, name: string) => ({
			id,
			name,
			kind: 'service' as const,
			reqIds: []
		});
		const design: DesignDoc = {
			actors: [],
			useCases: [],
			classes: [],
			components: [],
			nodes: [
				service('DSN-001', 'Api'),
				service('DSN-002', 'Live Updates'),
				service('DSN-003', 'Mailer')
			],
			links: [],
			sequences: []
		};
		await scaffold(ctx, design);
		const { scripts } = JSON.parse(await read('package.json'));
		expect(Object.entries(scripts)).toEqual([
			['start', 'tsx src/app/main.ts'],
			['start:live-updates', 'tsx src/app/live-updates.ts'],
			['start:mailer', 'tsx src/app/mailer.ts'],
			['test', 'vitest run'],
			['typecheck', 'tsc --noEmit']
		]);
	});

	it('writes the runner lockfile with the root package matching package.json', async () => {
		ctx = { ...ctx, projectName: 'team@todo' };
		await scaffold(ctx);
		const lock = JSON.parse(await read('package-lock.json'));
		expect(lock.name).toBe('team-todo');
		expect(lock.version).toBeUndefined();
		expect(lock.packages['']).toEqual({
			name: 'team-todo',
			dependencies: runnerPkg.dependencies,
			devDependencies: runnerPkg.devDependencies
		});
		expect({ ...lock.packages, '': null }).toEqual({ ...runnerLock.packages, '': null });
	});

	it('replaces @ in the package name with -, since npm names take no @ outside a scope', async () => {
		ctx = { ...ctx, projectName: 'team@todo' };
		await scaffold(ctx);
		expect(JSON.parse(await read('package.json')).name).toBe('team-todo');
	});

	it('writes tsconfig.json equal to the NO_TSCONFIG example', async () => {
		await scaffold(ctx);
		const tsconfig = await read('tsconfig.json');
		expect(JSON.parse(tsconfig)).toEqual(TSCONFIG);
		expect(NO_TSCONFIG).toContain(tsconfig.trim());
	});

	it('leaves an existing package.json untouched and writes only the missing tsconfig.json', async () => {
		await writeFile(ctx.store.resolve('package.json'), '{"name":"mine"}');
		expect(await scaffold(ctx)).toEqual(['tsconfig.json']);
		expect(await read('package.json')).toBe('{"name":"mine"}');
		// The runner lock would not match a package.json someone else wrote.
		expect(await ctx.store.exists('package-lock.json')).toBe(false);
	});

	it('writes nothing when both files exist', async () => {
		await writeFile(ctx.store.resolve('package.json'), '{}');
		await writeFile(ctx.store.resolve('tsconfig.json'), '{}');
		expect(await scaffold(ctx)).toEqual([]);
		expect(await read('tsconfig.json')).toBe('{}');
	});
});
