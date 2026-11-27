import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, readlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ensureRunnerImage } from '../../src/lib/server/core/docker/image';
import { ProjectStore } from '../../src/lib/server/core/store';
import { executeTool, TOOLS } from '../../src/lib/server/core/tools';
import { runProjectTests, runTypecheck } from '../../src/lib/server/core/tools/check';
import type { ToolContext } from '../../src/lib/server/core/tools/registry';

const FIXTURES = path.resolve('test/docker/fixtures');
const sh = promisify(execFile);
const dirs: string[] = [];

/** Copy of a fixture in a temp folder, so the repo checkout is never written to. */
async function project(name: string): Promise<ToolContext> {
	const root = await mkdtemp(path.join(tmpdir(), 'aise-docker-'));
	dirs.push(root);
	await cp(path.join(FIXTURES, name), root, { recursive: true });
	return { store: new ProjectStore(root), runId: 'run-1', projectName: name, agent: 'code' };
}

/** Every entry below `dir` (files with a content hash, folders, symlinks with their target). */
async function snapshot(dir: string, rel = ''): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
		const p = path.posix.join(rel, e.name);
		const abs = path.join(dir, p);
		if (e.isSymbolicLink()) out[p] = `-> ${await readlink(abs)}`;
		else if (e.isDirectory()) {
			out[p] = 'dir';
			Object.assign(out, await snapshot(dir, p));
		} else
			out[p] = createHash('sha256')
				.update(await readFile(abs))
				.digest('hex');
	}
	return out;
}

/** Names of runner containers (`aise-<12 hex>`), running or stopped. Compose containers do not match. */
async function runnerContainers(): Promise<string[]> {
	const { stdout } = await sh('docker', [
		'ps',
		'-a',
		'--filter',
		'name=^aise-[0-9a-f]{12}$',
		'--format',
		'{{.Names}}'
	]);
	return stdout.split('\n').filter(Boolean).sort();
}

const exists = (p: string) =>
	stat(p).then(
		() => true,
		() => false
	);

beforeAll(async () => {
	await ensureRunnerImage(); // the first build installs the packages and takes minutes
}, 600_000);

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('typecheck', () => {
	it('passes a clean project and writes nothing', async () => {
		const ctx = await project('ok');
		const before = await snapshot(ctx.store.dir);
		expect(await runTypecheck(ctx)).toEqual({ ok: true, errors: [], timedOut: false });
		expect(await snapshot(ctx.store.dir)).toEqual(before);
		expect(await exists(path.join(ctx.store.dir, 'node_modules'))).toBe(false);
	});

	it('passes when tsconfig sets incremental, which would write tsbuildinfo to the read only mount', async () => {
		const ctx = await project('incremental');
		const before = await snapshot(ctx.store.dir);
		expect(await runTypecheck(ctx)).toEqual({ ok: true, errors: [], timedOut: false });
		expect(await snapshot(ctx.store.dir)).toEqual(before);
	});

	it('reports the error with file and line', async () => {
		const r = await runTypecheck(await project('type-error'));
		expect(r.ok).toBe(false);
		expect(r.errors).toHaveLength(1);
		expect(r.errors[0]).toMatchObject({ file: 'src/a.ts', line: 2 });
		expect(r.errors[0]!.message).toContain("Type 'string' is not assignable to type 'number'");
	});
});

describe('run_tests', () => {
	it('passes a clean project', async () => {
		const ctx = await project('ok');
		const r = await runProjectTests(ctx, undefined);
		expect(r).toMatchObject({ ok: true, passed: 1, failed: 0, timedOut: false });
		expect(r.tests).toEqual([
			{
				name: 'counts up',
				title: 'counts up',
				file: 'test/counter.spec.ts',
				status: 'passed',
				line: 4
			}
		]);
	});

	it('skips test files under .aise, such as a run backup of an older test', async () => {
		const ctx = await project('ok');
		const backup = '.aise/runs/20261123-090952-P5/backup/test/counter.spec.ts';
		await ctx.store.writeFile(backup, "import '../src/missing.js';\n");
		const r = await runProjectTests(ctx, undefined);
		expect(r).toMatchObject({ ok: true, passed: 1, failed: 0 });
		expect(r.tests.map((t) => t.file)).toEqual(['test/counter.spec.ts']);
	});

	it('leaves the project as it was: no node_modules, no cache, no report', async () => {
		const ctx = await project('ok');
		const before = await snapshot(ctx.store.dir);
		await runProjectTests(ctx, undefined);
		expect(await snapshot(ctx.store.dir)).toEqual(before);
		expect(await exists(path.join(ctx.store.dir, 'node_modules'))).toBe(false);
	});

	it('mounts the project read only: test code cannot plant .aise, compose.yaml or symlinks', async () => {
		const ctx = await project('writes-project');
		const before = await snapshot(ctx.store.dir);
		const r = await runProjectTests(ctx, undefined);
		expect(r).toMatchObject({ ok: true, passed: 4, failed: 0 });
		expect(await snapshot(ctx.store.dir)).toEqual(before);
		expect(Object.keys(before).some((p) => /^(\.aise|compose\.yaml)/.test(p))).toBe(false);
	});

	it('runs three calls on one project in parallel and returns every result', async () => {
		const ctx = await project('failing-test');
		const results = await Promise.all([1, 2, 3].map(() => runProjectTests(ctx, undefined)));
		for (const r of results) expect(r).toMatchObject({ ok: false, passed: 1, failed: 1 });
	});

	it('is not a pass when every test is skipped', async () => {
		const r = await runProjectTests(await project('skipped'), undefined);
		expect(r).toMatchObject({ ok: false, passed: 0, failed: 0, noTests: true });
	});

	it('counts a failing test and explains it', async () => {
		const r = await runProjectTests(await project('failing-test'), undefined);
		expect(r).toMatchObject({ ok: false, passed: 1, failed: 1, timedOut: false });
		const failed = r.tests.find((t) => t.status === 'failed');
		expect(failed?.error).toContain('expected 1 to be 2');
	});

	it('reports a failing afterAll as a failed entry although every assertion passed', async () => {
		const r = await runProjectTests(await project('after-all-throws'), undefined);
		expect(r).toMatchObject({ ok: false, passed: 1, failed: 1, timedOut: false });
		expect(r.tests.filter((t) => t.status === 'failed')).toHaveLength(1);
		expect(r.logTail).toContain('teardown failed');
	});

	it('applies the filter', async () => {
		const r = await runProjectTests(await project('ok'), 'no-such-file');
		expect(r.ok).toBe(false);
		expect(r.tests).toEqual([]);
	});

	it('kills a test that never finishes and leaves no container', async () => {
		const ctx = await project('hangs');
		const before = await runnerContainers();
		const started = Date.now();
		const r = await runProjectTests(ctx, undefined, { timeoutMs: 10_000 });
		expect(r).toMatchObject({ ok: false, timedOut: true, tests: [] });
		expect(Date.now() - started).toBeLessThan(60_000);
		// --rm removes the container a moment after the kill
		await expect.poll(runnerContainers, { timeout: 15_000 }).toEqual(before);
	});
});

describe('through the registry', () => {
	it('typecheck and run_tests return JSON results', async () => {
		const ctx = await project('failing-test');
		const names = Object.keys(TOOLS);
		const tc = await executeTool(ctx, 'typecheck', {}, names);
		expect(JSON.parse(tc.content)).toEqual({ ok: true, errors: [], timedOut: false });
		const rt = await executeTool(ctx, 'run_tests', { filter: 'a.spec' }, names);
		expect(rt.isError).toBe(false);
		expect(JSON.parse(rt.content)).toMatchObject({ ok: false, passed: 1, failed: 1 });
	});
});
