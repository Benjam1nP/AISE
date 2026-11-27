import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { docker } from './run';
import { tail } from './parse';

const IMAGE = 'aise-runner';
const BUILD_TIMEOUT_MS = 600_000;

/**
 * The `runner/` folder: AISE_RUNNER_DIR when set, else `runner/` at the repo root found from this
 * source file (dev server, tsx, MCP server started from any folder), else `runner/` in the working
 * directory (the bundled build, where this file's location says nothing about the repo).
 */
export function runnerDir(): string {
	if (process.env.AISE_RUNNER_DIR) return process.env.AISE_RUNNER_DIR;
	const fromSource = path.resolve(import.meta.dirname, '../../../../../runner');
	if (existsSync(path.join(fromSource, 'package.json'))) return fromSource;
	return path.resolve('runner');
}

/** `aise-runner:<12 hex>`, derived from the files that define the image, so edits rebuild it. */
export async function runnerTag(dir = runnerDir()): Promise<string> {
	const hash = createHash('sha256');
	for (const f of ['Dockerfile', 'package.json', 'package-lock.json'])
		hash.update(await readFile(path.join(dir, f)));
	return `${IMAGE}:${hash.digest('hex').slice(0, 12)}`;
}

const building = new Map<string, Promise<string>>();

/** Returns the runner image tag, building it (and tagging it `aise-runner:latest`) when missing. */
export async function ensureRunnerImage(): Promise<string> {
	const dir = runnerDir();
	const tag = await runnerTag(dir);
	const inspect = await docker(['image', 'inspect', tag], { timeoutMs: 30_000 });
	if (inspect.code === 0) return tag;

	let pending = building.get(tag);
	if (!pending) {
		pending = build(dir, tag).finally(() => building.delete(tag));
		building.set(tag, pending);
	}
	return pending;
}

async function build(dir: string, tag: string): Promise<string> {
	const r = await docker(['build', '-t', tag, '-t', `${IMAGE}:latest`, dir], {
		timeoutMs: BUILD_TIMEOUT_MS
	});
	if (r.code !== 0)
		throw new Error(
			`Building the runner image failed${r.timedOut ? ' (timed out)' : ''}:\n${tail(r.stderr || r.stdout)}`
		);
	return tag;
}
