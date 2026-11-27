// Pure rules about test names, coverage and findings. No node imports: the server reads them
// through `core/test-state.ts` (which re-exports them) and the browser imports this file.
import type { TestResult } from './server/core/docker/parse';
import type { Requirement } from './server/core/schemas/requirements';

export type ParsedTestName =
	{ kind: 'ac'; reqId: string; n: number; manual: boolean } | { kind: 'scenario'; seqId: string };

const AC_TITLE = /^(REQ-\d{3}) AC([1-9]\d*): (\S.*)$/s;
const SCENARIO_TITLE = /^(SEQ-\d{3}) scenario: \S/;
const MANUAL = /^manual:(\s|$)/;

/**
 * Reads the trace IDs back from a test title (spec 5.2): `REQ-003 AC1: text`,
 * `REQ-007 AC2: manual: reason` and `SEQ-002 scenario: name`. Anything else is null. Takes the
 * `it` title, not the full name with its describe titles.
 */
export function parseTestName(title: string): ParsedTestName | null {
	const ac = AC_TITLE.exec(title);
	if (ac) return { kind: 'ac', reqId: ac[1]!, n: Number(ac[2]), manual: MANUAL.test(ac[3]!) };
	const sc = SCENARIO_TITLE.exec(title);
	if (sc) return { kind: 'scenario', seqId: sc[1]! };
	return null;
}

export type CoverageStatus = 'passed' | 'failed' | 'manual' | 'missing';
export type CoverageRow = {
	reqId: string;
	n: number;
	priority: Requirement['priority'];
	status: CoverageStatus;
};

/**
 * One row per acceptance criterion of every requirement. A failed test wins over a passed one,
 * a passed one over a manual todo. A todo is only covered when it carries the manual marker, and
 * then as `manual`, never `passed`. Tests naming a requirement or criterion number that does not
 * exist, and skipped tests, count for nothing.
 */
export function coverage(reqs: Requirement[], tests: TestResult[]): CoverageRow[] {
	const found = new Map<string, Set<CoverageStatus>>();
	for (const t of tests) {
		const p = parseTestName(t.title);
		if (p?.kind !== 'ac') continue;
		const status: CoverageStatus | null =
			t.status === 'passed'
				? 'passed'
				: t.status === 'failed'
					? 'failed'
					: t.status === 'todo' && p.manual
						? 'manual'
						: null;
		if (status === null) continue;
		const key = `${p.reqId}\0${p.n}`;
		found.set(key, (found.get(key) ?? new Set()).add(status));
	}
	return reqs.flatMap((r) =>
		r.acceptanceCriteria.map((_, i) => {
			const seen = found.get(`${r.id}\0${i + 1}`);
			const status = (['failed', 'passed', 'manual'] as const).find((s) => seen?.has(s));
			return { reqId: r.id, n: i + 1, priority: r.priority, status: status ?? 'missing' };
		})
	);
}

/** Whether `t` is the test a report names: same file, and `test` is exactly its title or its full name. */
export const isTest = (t: TestResult, file: string, test: string) =>
	t.file === file && (t.title === test || t.name === test);

/**
 * A finding is open until a check settles it. Its test (same file, exact title or full name) with
 * a status other than failed (passed, todo or skipped) resolves it. So does a check where its file
 * loaded without that test, or is gone: the test was renamed or removed. It stays open while there
 * is no result or its file did not load (only a suite entry), so a real bug is never hidden. Once
 * resolved (`resolvedAt` set) it never reopens; a new failure needs a new report.
 */
export function findingOpen(
	f: { file: string; test: string; resolvedAt?: string },
	result: { tests: TestResult[] } | null
): boolean {
	if (f.resolvedAt !== undefined) return false;
	if (result === null) return true;
	const matches = result.tests.filter((t) => !t.suite && isTest(t, f.file, f.test));
	if (matches.length > 0) return matches.some((t) => t.status === 'failed');
	return result.tests.some((t) => t.suite && t.file === f.file);
}

/**
 * The failing tests in `result` that no open finding explains, the input of Explain failures.
 * A file that did not load (suite failure) is a file problem, never triaged.
 */
export function unexplainedFailures(
	result: { tests: TestResult[] } | null,
	findings: { file: string; test: string; resolvedAt?: string }[]
): TestResult[] {
	const open = findings.filter((f) => findingOpen(f, result));
	return (result?.tests ?? []).filter(
		(t) => t.status === 'failed' && !t.suite && !open.some((f) => isTest(t, f.file, f.test))
	);
}
