import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { runnerDir } from '../core/docker/image';
import { startScripts } from '../core/nodes';
import type { DesignDoc } from '../core/schemas/design';
import { TSCONFIG } from '../core/tools/check';
import { executeTool, type ToolContext } from '../core/tools/index';

type RunnerPackage = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

type RunnerLock = { version?: string; packages: Record<string, unknown> };

const readRunner = async <T>(file: string): Promise<T> =>
	JSON.parse(await readFile(path.join(runnerDir(), file), 'utf8')) as T;

/**
 * package.json of a generated project, with the runner's dependency versions and one
 * `start:<node kebab>` script per service node besides the primary.
 */
async function generatedPackageJson(name: string, design: DesignDoc | null): Promise<string> {
	const runner = await readRunner<RunnerPackage>('package.json');
	const pkg = {
		name,
		private: true,
		type: 'module',
		scripts: {
			...startScripts(design),
			test: 'vitest run',
			typecheck: 'tsc --noEmit'
		},
		dependencies: runner.dependencies ?? {},
		devDependencies: runner.devDependencies ?? {}
	};
	return `${JSON.stringify(pkg, null, '\t')}\n`;
}

/**
 * The runner's lockfile with its root entry matching the generated package.json, so `npm ci`
 * works in a P6 Dockerfile (plain `npm install` crashes on these packages, see #18). The code
 * agent may only use runner packages, so the locked tree covers every dependency it can add.
 */
async function generatedLock(name: string): Promise<string> {
	const runner = await readRunner<RunnerPackage>('package.json');
	const runnerLock = await readRunner<RunnerLock>('package-lock.json');
	const lock: RunnerLock & { name: string } = {
		...runnerLock,
		name,
		packages: {
			...runnerLock.packages,
			'': {
				name,
				dependencies: runner.dependencies ?? {},
				devDependencies: runner.devDependencies ?? {}
			}
		}
	};
	delete lock.version; // package.json has none
	return `${JSON.stringify(lock, null, '\t')}\n`;
}

async function exists(ctx: ToolContext, rel: string): Promise<boolean> {
	return stat(ctx.store.resolve(rel)).then(
		() => true,
		() => false
	);
}

/** Writes through write_file, so the scope checks and the run's backups apply. */
async function writeScaffold(ctx: ToolContext, rel: string, content: string): Promise<void> {
	const r = await executeTool(ctx, 'write_file', { path: rel, content }, ['write_file']);
	if (r.isError) throw new Error(`Cannot scaffold ${rel}: ${r.content}`);
}

/**
 * Writes package.json (with the runner lockfile) and tsconfig.json when missing; existing files are left alone.
 * Returns the paths written. Typecheck needs both from the first round on. The design gives the
 * start scripts of extra service nodes.
 */
export async function scaffold(
	ctx: ToolContext,
	design: DesignDoc | null = null
): Promise<string[]> {
	const written: string[] = [];
	if (!(await exists(ctx, 'package.json'))) {
		// npm names take no @ outside a scope, so the project name's @ becomes a dash.
		const name = ctx.projectName.replaceAll('@', '-');
		await writeScaffold(ctx, 'package.json', await generatedPackageJson(name, design));
		// Written by the store, not write_file: agents may not write lockfiles. The run's backup still applies.
		await ctx.store.writeFile('package-lock.json', await generatedLock(name), ctx.runId);
		written.push('package.json', 'package-lock.json');
	}
	if (!(await exists(ctx, 'tsconfig.json'))) {
		await writeScaffold(ctx, 'tsconfig.json', `${JSON.stringify(TSCONFIG, null, '\t')}\n`);
		written.push('tsconfig.json');
	}
	return written;
}
