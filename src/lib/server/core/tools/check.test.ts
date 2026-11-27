import { mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockerResult } from '../docker/run';
import { ProjectStore } from '../store';
import { createRun } from '../runs';
import { NO_TSCONFIG, runProjectTests, runTypecheck } from './check';
import { executeTool, TOOLS } from './index';
import type { ToolContext } from './registry';

let root: string;
let ctx: ToolContext;
const run = vi.fn<(...a: unknown[]) => Promise<DockerResult>>();
const done = (over: Partial<DockerResult> = {}): DockerResult => ({
	code: 0,
	stdout: '',
	stderr: '',
	timedOut: false,
	...over
});

beforeEach(async () => {
	run.mockReset();
	root = await mkdtemp(path.join(tmpdir(), 'aise-check-'));
	ctx = { store: new ProjectStore(root), runId: 'run-1', projectName: 'todo', agent: 'code' };
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const NO_PACKAGE = 'No package.json in the project. Generate code first (P4).';

describe('without package.json', () => {
	it('typecheck gives the ToolError and never touches Docker', async () => {
		await expect(runTypecheck(ctx, { run })).rejects.toThrow(NO_PACKAGE);
		expect(run).not.toHaveBeenCalled();
	});

	it('run_tests gives the ToolError, never touches Docker and leaves no .aise folder', async () => {
		await expect(runProjectTests(ctx, undefined, { run })).rejects.toThrow(NO_PACKAGE);
		expect(run).not.toHaveBeenCalled();
		await expect(stat(path.join(root, '.aise'))).rejects.toThrow();
	});

	it('both tools turn it into an error result for the agent', async () => {
		for (const name of ['typecheck', 'run_tests']) {
			const r = await executeTool(ctx, name, {}, Object.keys(TOOLS));
			expect(r).toEqual({ content: NO_PACKAGE, isError: true });
		}
	});
});

describe('registry and input', () => {
	it('registers both tools', () => {
		expect(Object.keys(TOOLS)).toEqual(expect.arrayContaining(['typecheck', 'run_tests']));
	});

	it('run_tests refuses a filter that would be read as a Vitest option', async () => {
		await writeFile(path.join(root, 'package.json'), '{}');
		const r = await executeTool(ctx, 'run_tests', { filter: '--root=/' }, Object.keys(TOOLS));
		expect(r.isError).toBe(true);
		expect(r.content).toMatch(/must not start with/);
	});
});

describe('without tsconfig.json', () => {
	it('typecheck says how to write one and never touches Docker', async () => {
		await writeFile(path.join(root, 'package.json'), '{}');
		await expect(runTypecheck(ctx, { run })).rejects.toThrow(NO_TSCONFIG);
		expect(run).not.toHaveBeenCalled();
	});

	it('the code agent may write the tsconfig.json it suggests', async () => {
		const tsconfig = NO_TSCONFIG.slice(NO_TSCONFIG.indexOf('{'));
		expect(JSON.parse(tsconfig)).toHaveProperty('compilerOptions');
		const meta = await createRun(ctx.store, 'P4', 'code');
		const w = await executeTool(
			{ ...ctx, runId: meta.id },
			'write_file',
			{ path: 'tsconfig.json', content: tsconfig },
			Object.keys(TOOLS)
		);
		expect(w.isError).toBe(false);
	});
});

describe('runner commands', () => {
	beforeEach(async () => {
		await writeFile(path.join(root, 'package.json'), '{}');
		await writeFile(path.join(root, 'tsconfig.json'), '{}');
	});

	const passedReport = (status = 'passed') =>
		JSON.stringify({
			testResults: [
				{
					name: '/opt/aise/app/test/a.spec.ts',
					status: 'passed',
					assertionResults: [{ fullName: 'a', status }]
				}
			]
		});
	/** A fake runner that writes `report` (or nothing) into the out folder it was given. */
	const writes = (report: string | null, over: Partial<DockerResult> = {}) =>
		run.mockImplementation(async (_dir, _cmd, opts) => {
			const outDir = (opts as { outDir?: string }).outDir!;
			if (report !== null) await writeFile(path.join(outDir, 'report.json'), report);
			return done(over);
		});
	const outDirOf = (call: number) => (run.mock.calls[call]![2] as { outDir: string }).outDir;

	it('typecheck runs tsc read only without network and without incremental build info', async () => {
		run.mockResolvedValue(done());
		await runTypecheck(ctx, { run, timeoutMs: 5 });
		expect(run).toHaveBeenCalledWith(
			root,
			['/opt/aise/node_modules/.bin/tsc', '--noEmit', '--incremental', 'false', '-p', '.'],
			{ timeoutMs: 5 }
		);
	});

	it('typecheck shows raw output when tsc fails without a parsable error', async () => {
		run.mockResolvedValue(done({ code: 1, stderr: 'boom' }));
		const r = await runTypecheck(ctx, { run });
		expect(r.ok).toBe(false);
		expect(r.errors).toEqual([{ file: '', line: 0, col: 0, message: 'boom' }]);
	});

	it('typecheck is not ok when tsc exits 1 with no output', async () => {
		run.mockResolvedValue(done({ code: 1 }));
		expect((await runTypecheck(ctx, { run })).ok).toBe(false);
	});

	it('run_tests mounts the project read only and sends the report to a separate out folder', async () => {
		writes(null, { code: 1 });
		const r = await runProjectTests(ctx, 'cart', { run });
		expect(run).toHaveBeenCalledWith(
			root,
			[
				'/opt/aise/node_modules/.bin/vitest',
				'run',
				'--reporter=json',
				'--outputFile=/opt/aise/out/report.json',
				'--no-cache',
				'--configLoader',
				'runner',
				'--includeTaskLocation',
				'--exclude',
				'**/.aise/**',
				'cart'
			],
			{ timeoutMs: 120_000, outDir: expect.any(String) }
		);
		expect(r).toMatchObject({ ok: false, passed: 0, failed: 0, tests: [], timedOut: false });
	});

	it('run_tests never writes into the project folder', async () => {
		writes(passedReport());
		await runProjectTests(ctx, undefined, { run });
		await expect(stat(path.join(root, '.aise'))).rejects.toThrow();
		expect(path.relative(root, outDirOf(0)).startsWith('..')).toBe(true);
	});

	it('run_tests removes its out folder afterwards, also when the run throws', async () => {
		writes(passedReport());
		await runProjectTests(ctx, undefined, { run });
		await expect(stat(outDirOf(0))).rejects.toThrow();
		run.mockRejectedValue(new Error('docker exploded'));
		await expect(runProjectTests(ctx, undefined, { run })).rejects.toThrow('docker exploded');
		await expect(stat(outDirOf(1))).rejects.toThrow();
	});

	it('run_tests uses a different out folder for each call', async () => {
		writes(passedReport());
		await Promise.all([
			runProjectTests(ctx, undefined, { run }),
			runProjectTests(ctx, undefined, { run })
		]);
		expect(outDirOf(0)).not.toBe(outDirOf(1));
	});

	it('run_tests is not ok when the exit code is 1 although the report shows no failure', async () => {
		writes(passedReport(), { code: 1 });
		const r = await runProjectTests(ctx, undefined, { run });
		expect(r).toMatchObject({ ok: false, passed: 1, failed: 0 });
		expect(r.noTests).toBeUndefined();
	});

	it('run_tests is ok when the exit code is 0 and a test passed', async () => {
		writes(passedReport());
		const r = await runProjectTests(ctx, undefined, { run });
		expect(r).toMatchObject({ ok: true, passed: 1 });
		expect(r.noTests).toBeUndefined();
	});

	it('run_tests is not ok and says noTests when nothing passed or failed', async () => {
		writes(passedReport('skipped'));
		const r = await runProjectTests(ctx, undefined, { run });
		expect(r).toMatchObject({ ok: false, passed: 0, failed: 0, noTests: true });
		writes(JSON.stringify({ testResults: [] }));
		expect(await runProjectTests(ctx, undefined, { run })).toMatchObject({
			ok: false,
			noTests: true
		});
	});

	it('run_tests ignores a report that is a symlink', async () => {
		const secret = path.join(root, 'secret.json');
		await writeFile(secret, passedReport());
		run.mockImplementation(async (_d, _c, opts) => {
			await symlink(secret, path.join((opts as { outDir: string }).outDir, 'report.json'));
			return done();
		});
		const r = await runProjectTests(ctx, undefined, { run });
		expect(r).toMatchObject({ ok: false, passed: 0, tests: [] });
	});

	it('run_tests ignores a report over 20 MB', async () => {
		writes(passedReport() + ' '.repeat(20 * 1024 * 1024));
		const r = await runProjectTests(ctx, undefined, { run });
		expect(r).toMatchObject({ ok: false, passed: 0, tests: [] });
	});
});
