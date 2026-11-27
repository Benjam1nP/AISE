import { chmod, lstat, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { runInRunner } from '../docker/run';
import { parseTsc, parseVitestJson, tail, type TestResult, type TscError } from '../docker/parse';
import { defineTool, ToolError, type ToolContext } from './registry';

export type TypecheckResult = { ok: boolean; errors: TscError[]; timedOut: boolean };
export type RunTestsResult = {
	ok: boolean;
	passed: number;
	failed: number;
	tests: TestResult[];
	timedOut: boolean;
	logTail: string;
	/** Set when the run exited 0 but no test passed or failed (none found, or all skipped). */
	noTests?: boolean;
};

/** `runInRunner` and the timeout can be replaced so tests need no Docker and the hang test is short. */
export type CheckOpts = { timeoutMs?: number; run?: typeof runInRunner };

const TIMEOUT_MS = 120_000;
/** Test code can write the report file, so it is size capped and must be a regular file. */
const MAX_REPORT_BYTES = 20 * 1024 * 1024;
const BIN = '/opt/aise/node_modules/.bin';

async function requirePackageJson(ctx: ToolContext): Promise<void> {
	const s = await stat(path.join(ctx.store.dir, 'package.json')).catch(() => null);
	if (!s?.isFile())
		throw new ToolError('No package.json in the project. Generate code first (P4).');
}

/** The tsconfig.json for generated projects; the scaffold writes it, the code agent may too. */
export const TSCONFIG = {
	compilerOptions: {
		target: 'ES2022',
		module: 'NodeNext',
		moduleResolution: 'NodeNext',
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		types: ['node']
	},
	include: ['src', 'test']
};

/** What the code agent should write when the project has no tsconfig.json yet. */
export const NO_TSCONFIG = `No tsconfig.json in the project; tsc needs one. Write it with write_file, for example:
${JSON.stringify(TSCONFIG, null, '\t')}`;

/**
 * `tsc --noEmit` in the runner image, project mounted read only, no network. `--incremental false`
 * because a tsconfig with `incremental` would write a tsbuildinfo file into the read only mount.
 */
export async function runTypecheck(
	ctx: ToolContext,
	{ timeoutMs = TIMEOUT_MS, run = runInRunner }: CheckOpts = {}
): Promise<TypecheckResult> {
	await requirePackageJson(ctx);
	const tsconfig = await stat(path.join(ctx.store.dir, 'tsconfig.json')).catch(() => null);
	if (!tsconfig?.isFile()) throw new ToolError(NO_TSCONFIG);
	const r = await run(
		ctx.store.dir,
		[`${BIN}/tsc`, '--noEmit', '--incremental', 'false', '-p', '.'],
		{ timeoutMs }
	);
	const out = r.stdout + r.stderr;
	const errors = parseTsc(out);
	// tsc failed without a line we understand (crash, bad flag): show the agent the raw output.
	if (r.code !== 0 && !r.timedOut && errors.length === 0)
		errors.push({ file: '', line: 0, col: 0, message: tail(out) });
	return { ok: r.code === 0 && errors.length === 0 && !r.timedOut, errors, timedOut: r.timedOut };
}

/** Errors Vitest attaches to a test file rather than a test (afterAll, import failure), for the log. */
function suiteErrors(report: string): string[] {
	const files = (
		JSON.parse(report) as { testResults?: { name: string; status?: string; message?: string }[] }
	).testResults;
	return (files ?? [])
		.filter((f) => f.status === 'failed' && f.message)
		.map((f) => `${f.name.replace('/opt/aise/app/', '')}: ${f.message}`);
}

/** The report text, or null when it is missing, not a regular file (a symlink the test planted), or too big. */
async function readReport(file: string): Promise<string | null> {
	const info = await lstat(file).catch(() => null);
	if (!info?.isFile() || info.size > MAX_REPORT_BYTES) return null;
	return readFile(file, 'utf8');
}

/**
 * Vitest in the runner image, no network. The project is mounted read only, because test code is
 * generated code; the JSON report goes to a fresh folder outside the project that is removed again.
 */
export async function runProjectTests(
	ctx: ToolContext,
	filter: string | undefined,
	{ timeoutMs = TIMEOUT_MS, run = runInRunner }: CheckOpts = {}
): Promise<RunTestsResult> {
	await requirePackageJson(ctx);
	const outDir = await mkdtemp(path.join(tmpdir(), 'aise-out-'));
	// A root host runs the container as the image's node user (never as root), which cannot write a 0700 root folder.
	if (process.getuid?.() === 0) await chmod(outDir, 0o777);
	try {
		const r = await run(
			ctx.store.dir,
			[
				`${BIN}/vitest`,
				'run',
				'--reporter=json',
				'--outputFile=/opt/aise/out/report.json',
				// Without this Vitest writes node_modules/.vite into the mounted project.
				'--no-cache',
				// The bundling config loader writes to node_modules/.vite-temp, which the read only image blocks.
				'--configLoader',
				'runner',
				// Adds `location.line` to every test in the report.
				'--includeTaskLocation',
				// Run backups keep older test files under .aise/runs; they are history, not tests.
				'--exclude',
				'**/.aise/**',
				...(filter ? [filter] : [])
			],
			{ timeoutMs, outDir }
		);
		const log = tail(r.stdout + r.stderr);
		const report = await readReport(path.join(outDir, 'report.json'));
		if (report === null || r.timedOut)
			return { ok: false, passed: 0, failed: 0, tests: [], timedOut: r.timedOut, logTail: log };
		const parsed = parseVitestJson(report);
		// Success is the exit code, never the parsed lists: a throwing afterAll or an unhandled
		// rejection exits 1 with zero failed assertions. A run without any passed test is no pass.
		const clean = r.code === 0 && parsed.failed === 0;
		const ok = clean && parsed.passed > 0;
		const logTail = ok ? log : [log, ...suiteErrors(report)].filter(Boolean).join('\n');
		return { ok, ...parsed, timedOut: false, logTail, ...(clean && !ok ? { noTests: true } : {}) };
	} finally {
		await rm(outDir, { recursive: true, force: true });
	}
}

export const typecheck = defineTool({
	name: 'typecheck',
	description:
		'Type check the project with tsc in a Docker container (no network, read only). Returns ok and the errors as file, line, col, message.',
	input: z.strictObject({}),
	run: (ctx) => runTypecheck(ctx)
});

export const runTests = defineTool({
	name: 'run_tests',
	description:
		'Run the project tests with Vitest in a Docker container (no network). Optional filter limits the run to test files whose path contains it. Returns passed and failed counts, every test with its status and failure message, and the log tail.',
	input: z.strictObject({ filter: z.string().optional() }),
	run(ctx, { filter }) {
		// A leading dash would be read as a Vitest option (--root, --config, ...).
		if (filter?.startsWith('-')) throw new ToolError('filter must not start with "-".');
		return runProjectTests(ctx, filter);
	}
});
