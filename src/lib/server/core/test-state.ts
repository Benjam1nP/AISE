import { lstat, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { findingOpen } from '../../test-names';
import { codeHash, orMissing, TypecheckSchema, typecheckProject, walk } from './code-state';
import { sha256, stableStringify } from './hash';
import type { TestResult } from './docker/parse';
import type { ProjectStore } from './store';
import {
	runProjectTests,
	runTypecheck,
	type RunTestsResult,
	type TypecheckResult
} from './tools/check';
import type { ToolContext } from './tools/registry';

// The pure rules live in `src/lib/test-names.ts` so the browser can use them; server callers keep this path.
export {
	coverage,
	findingOpen,
	isTest,
	parseTestName,
	unexplainedFailures
} from '../../test-names';
export type { CoverageRow, CoverageStatus, ParsedTestName } from '../../test-names';

const CHECKS_PATH = '.aise/checks/P5.json';
const TEST_ROOT = 'test';

/** Sorted project relative paths of the files under `test/`. Symlinks are skipped, `test/` itself included. */
export async function listTestFiles(store: ProjectStore): Promise<string[]> {
	const s = await lstat(store.resolve(TEST_ROOT)).catch((e) => orMissing(e, null));
	if (!s?.isDirectory()) return [];
	const out: string[] = [];
	await walk(store, TEST_ROOT, out);
	return out.sort();
}

/**
 * sha256 over the paths and contents of the files under `test/`, built like the code hash; null
 * without any. A file deleted between listing and reading is skipped.
 */
export async function testHash(store: ProjectStore): Promise<string | null> {
	const entries: [string, string][] = [];
	for (const f of await listTestFiles(store)) {
		const content = await readFile(store.resolve(f)).catch((e) => orMissing(e, null));
		if (content !== null) entries.push([f, sha256(content)]);
	}
	return entries.length === 0 ? null : sha256(stableStringify(entries));
}

/**
 * The P5 artefact hash: sha256 of the code hash and the test hash, because an Apply fix run
 * changes `src/`. Null when there is neither code nor tests.
 */
export async function p5Hash(store: ProjectStore): Promise<string | null> {
	const [code, test] = [await codeHash(store), await testHash(store)];
	return code === null && test === null ? null : sha256(stableStringify([code, test]));
}

export type Finding = {
	id: string;
	runId: string;
	test: string;
	file: string;
	reqId?: string;
	explanation: string;
	proposedFix: string;
	/** When the first check found its test no longer failing; a resolved finding never reopens. */
	resolvedAt?: string;
};
export type TestFix = { runId: string; test: string; file: string; reason: string };
export type FixOutcome = 'fixed' | 'needs_design_change' | 'test_looks_wrong';
/** What the code agent answered for one handed over finding in a fix loop run. */
export type FixResult = {
	runId: string;
	findingId: string;
	outcome: FixOutcome;
	reason: string;
	at: string;
};

const FindingSchema = z.object({
	id: z.string(),
	runId: z.string(),
	test: z.string(),
	file: z.string(),
	reqId: z.string().optional(),
	explanation: z.string(),
	proposedFix: z.string(),
	resolvedAt: z.string().optional()
}) satisfies z.ZodType<Finding>;
const TestFixSchema = z.object({
	runId: z.string(),
	test: z.string(),
	file: z.string(),
	reason: z.string()
}) satisfies z.ZodType<TestFix>;

const FixResultSchema = z.object({
	runId: z.string(),
	findingId: z.string(),
	outcome: z.enum(['fixed', 'needs_design_change', 'test_looks_wrong']),
	reason: z.string(),
	at: z.string()
}) satisfies z.ZodType<FixResult>;

const RunFindingsSchema = z.object({
	findings: z.array(FindingSchema),
	testFixes: z.array(TestFixSchema),
	// Absent in files written before the fix loop.
	fixResults: z.array(FixResultSchema).default([])
});
export type RunFindings = z.infer<typeof RunFindingsSchema>;

const runFindingsPath = (runId: string) => `.aise/runs/${runId}/findings.json`;

/** What the report tools stored for one run; empty when it reported nothing. */
export async function readRunFindings(store: ProjectStore, runId: string): Promise<RunFindings> {
	return (await store.readJson(runFindingsPath(runId), RunFindingsSchema)) ?? emptyFindings();
}
const emptyFindings = (): RunFindings => ({ findings: [], testFixes: [], fixResults: [] });

/** How many resolved findings the checks keep, the most recently resolved first. */
const MAX_RESOLVED = 50;

const sameTest = (a: { file: string; test: string }, b: { file: string; test: string }) =>
	a.file === b.file && a.test === b.test;

/**
 * Adds a finding to the run's findings file; a later report for the same file and test replaces
 * the earlier one. IDs are `<runId>-<n>` with n above every number used so far. Tools of one
 * agent run one after the other and the write is atomic, so there is no locking.
 */
export async function appendRunFinding(
	store: ProjectStore,
	runId: string,
	report: Omit<Finding, 'id' | 'runId'>
): Promise<Finding> {
	const cur = await readRunFindings(store, runId);
	const used = cur.findings.map((f) => Number(f.id.slice(runId.length + 1)) || 0);
	const added: Finding = { ...report, id: `${runId}-${Math.max(0, ...used) + 1}`, runId };
	cur.findings = [...cur.findings.filter((f) => !sameTest(f, added)), added];
	await store.writeJson(runFindingsPath(runId), RunFindingsSchema, cur);
	return added;
}

/** Adds a test fix to the run's findings file; the same file and test in the same run replaces the earlier one. */
export async function appendRunTestFix(
	store: ProjectStore,
	runId: string,
	report: Omit<TestFix, 'runId'>
): Promise<TestFix> {
	const cur = await readRunFindings(store, runId);
	const added: TestFix = { ...report, runId };
	cur.testFixes = [...cur.testFixes.filter((f) => !sameTest(f, added)), added];
	await store.writeJson(runFindingsPath(runId), RunFindingsSchema, cur);
	return added;
}

/** Adds the code agent's answer for a finding; the same finding in the same run replaces the earlier one. */
export async function appendRunFixResult(
	store: ProjectStore,
	runId: string,
	report: Omit<FixResult, 'runId' | 'at'>
): Promise<FixResult> {
	const cur = await readRunFindings(store, runId);
	const added: FixResult = { ...report, runId, at: new Date().toISOString() };
	cur.fixResults = [...cur.fixResults.filter((f) => f.findingId !== added.findingId), added];
	await store.writeJson(runFindingsPath(runId), RunFindingsSchema, cur);
	return added;
}

export type TestChecks = {
	at: string;
	codeHash: string | null;
	testHash: string | null;
	typecheck: TypecheckResult | null;
	result: RunTestsResult | null;
	findings: Finding[];
	testFixes: TestFix[];
};

const TestResultSchema = z.object({
	name: z.string(),
	title: z.string(),
	file: z.string(),
	status: z.enum(['passed', 'failed', 'skipped', 'todo']),
	line: z.number().optional(),
	suite: z.literal(true).optional(),
	error: z.string().optional()
}) satisfies z.ZodType<TestResult>;

const TestChecksSchema = z.object({
	at: z.string(),
	codeHash: z.string().nullable(),
	testHash: z.string().nullable(),
	typecheck: TypecheckSchema.nullable(),
	result: z
		.object({
			ok: z.boolean(),
			passed: z.number(),
			failed: z.number(),
			tests: z.array(TestResultSchema),
			timedOut: z.boolean(),
			logTail: z.string(),
			noTests: z.boolean().optional()
		})
		.nullable(),
	findings: z.array(FindingSchema),
	testFixes: z.array(TestFixSchema)
}) satisfies z.ZodType<TestChecks>;

/** The stored P5 checks; null before any ran or when the file is unreadable (a stale gate, not a crash). */
export async function readTestChecks(store: ProjectStore): Promise<TestChecks | null> {
	try {
		return await store.readJson(CHECKS_PATH, TestChecksSchema);
	} catch (e) {
		if (e instanceof SyntaxError || e instanceof z.ZodError) return null;
		throw e;
	}
}

export async function writeTestChecks(store: ProjectStore, c: TestChecks): Promise<void> {
	await store.writeJson(CHECKS_PATH, TestChecksSchema, c);
}

/**
 * Typecheck plus tests against the current files, stored in `.aise/checks/P5.json` with the code
 * hash and test hash taken before the checks start, so an edit made during them reads as out of
 * date. The whole typecheck result is stored; the gate looks at errors under `test/` only.
 *
 * Findings: the current run's reports (`readRunFindings`) replace earlier open ones for the same
 * file and test. A finding whose test shows as passed, todo or skipped gets `resolvedAt` at the
 * first check that shows it (a missing or renamed test, or a file that did not load, leaves it
 * open) and stays as resolved history (the 50 most recent); it never reopens. A check without
 * a result or with a timed out run resolves nothing. Test fixes are history:
 * earlier ones stay, the current run's are added (the same run and test replaces itself on a
 * re check), and fixes for a file that no longer exists under `test/` are dropped.
 *
 * Without a package.json typecheck and result are null; see `typecheckProject`. Errors from the
 * runners (Docker down) propagate.
 */
export async function runTestChecks(
	ctx: ToolContext,
	opts: { typecheck?: typeof runTypecheck; tests?: typeof runProjectTests } = {}
): Promise<TestChecks> {
	const { store } = ctx;
	const tests = opts.tests ?? runProjectTests;
	const [code, test] = [await codeHash(store), await testHash(store)];
	const tc = await typecheckProject(ctx, opts.typecheck);
	const result = tc === null ? null : await tests(ctx, undefined);
	const previous = await readTestChecks(store);
	const run = await readRunFindings(store, ctx.runId);
	const files = new Set(await listTestFiles(store));
	const at = new Date().toISOString();
	const checks: TestChecks = {
		at,
		codeHash: code,
		testHash: test,
		typecheck: tc,
		result,
		findings: mergeFindings(previous?.findings ?? [], run.findings, result, at),
		testFixes: [
			...(previous?.testFixes ?? []).filter(
				(f) => !run.testFixes.some((r) => r.runId === f.runId && sameTest(r, f))
			),
			...run.testFixes
		].filter((f) => files.has(f.file))
	};
	await writeTestChecks(store, checks);
	return checks;
}

/** Earlier findings plus the run's reports, resolved where their test no longer fails; see runTestChecks. */
function mergeFindings(
	previous: Finding[],
	reported: Finding[],
	result: RunTestsResult | null,
	at: string
): Finding[] {
	const resolvedBefore = new Map(previous.map((f) => [f.id, f.resolvedAt]));
	const merged = [
		...previous.filter(
			(f) =>
				!reported.some((r) => r.id === f.id) &&
				(f.resolvedAt !== undefined || !reported.some((r) => sameTest(r, f)))
		),
		// A report checked again in the same run keeps the resolution time it already got.
		...reported.map((r) => {
			const resolvedAt = resolvedBefore.get(r.id);
			return resolvedAt === undefined ? r : { ...r, resolvedAt };
		})
	];
	const settled =
		result === null || result.timedOut
			? merged
			: merged.map((f) =>
					f.resolvedAt === undefined && !findingOpen(f, result) ? { ...f, resolvedAt: at } : f
				);
	const keep = new Set(
		settled
			.filter((f) => f.resolvedAt !== undefined)
			.sort((a, b) => b.resolvedAt!.localeCompare(a.resolvedAt!))
			.slice(0, MAX_RESOLVED)
			.map((f) => f.id)
	);
	return settled.filter((f) => f.resolvedAt === undefined || keep.has(f.id));
}
