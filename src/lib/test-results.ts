import type { TestResult } from '#lib/server/core/docker/parse.ts';
import type { DesignDoc } from '#lib/server/core/schemas/design.ts';
import type { Requirement } from '#lib/server/core/schemas/requirements.ts';
import { coverage, parseTestName } from '#lib/test-names.ts';

export type RowStatus = 'passed' | 'failed' | 'manual' | 'skipped' | 'todo';
export type TestRow = {
	key: string;
	file: string;
	line?: number;
	status: RowStatus;
	/** `REQ-003 AC1` or `SEQ-002`; empty for a test that does not follow the naming contract. */
	label: string;
	/** The criterion, scenario or title without its label. */
	text: string;
	/** First line of the failure message. */
	error?: string;
};
export type TestGroup = { key: string; heading: string; rows: TestRow[] };

/** The label and text of a test title, and whether it is a manual todo. */
export function describeTitle(title: string): { label: string; text: string; manual: boolean } {
	const p = parseTestName(title);
	if (!p) return { label: '', text: title, manual: false };
	// Both title forms are `<label>: <text>`; a manual criterion starts its text with `manual: `.
	const text = title.slice(title.indexOf(': ') + 2);
	if (p.kind === 'scenario') return { label: p.seqId, text, manual: false };
	return {
		label: `${p.reqId} AC${p.n}`,
		text: p.manual ? text.replace(/^manual:\s*/, '') : text,
		manual: p.manual
	};
}

function rowOf(t: TestResult, i: number): TestRow {
	const d = describeTitle(t.title);
	const status: RowStatus = t.status === 'todo' ? (d.manual ? 'manual' : 'todo') : t.status;
	const error = t.error?.split('\n').find((l) => l.trim() !== '');
	return {
		key: `${t.file}:${t.name}:${i}`,
		file: t.file,
		...(t.line ? { line: t.line } : {}),
		status,
		label: d.label,
		text: d.text,
		...(error ? { error } : {})
	};
}

/** The describe titles of a test: its full name without its own title. */
const prefixOf = (t: TestResult) =>
	t.name.endsWith(t.title) ? t.name.slice(0, t.name.length - t.title.length).trim() : '';

/**
 * Tests grouped by their describe titles (`UC-001 Add task`), or by file when a test has none.
 * Groups follow the order of the use cases in the design, any other group after them.
 */
export function groupTests(tests: TestResult[], design: DesignDoc | null): TestGroup[] {
	const groups = new Map<string, TestGroup>();
	tests.forEach((t, i) => {
		const heading = prefixOf(t) || t.file;
		const key = `${t.file}\0${heading}`;
		const g = groups.get(key) ?? { key, heading, rows: [] };
		g.rows.push(rowOf(t, i));
		groups.set(key, g);
	});
	const order = (g: TestGroup) => {
		const at = design?.useCases.findIndex((u) => g.heading.startsWith(u.id)) ?? -1;
		return at < 0 ? Number.MAX_SAFE_INTEGER : at;
	};
	return [...groups.values()].sort((a, b) => order(a) - order(b));
}

export type MissingCriterion = {
	reqId: string;
	n: number;
	text: string;
	priority: Requirement['priority'];
};

/** Acceptance criteria no passed, failed or manual test names, with their text. */
export function missingCriteria(reqs: Requirement[], tests: TestResult[]): MissingCriterion[] {
	const text = new Map(
		reqs.flatMap((r) => r.acceptanceCriteria.map((c, i) => [`${r.id}\0${i + 1}`, c] as const))
	);
	return coverage(reqs, tests)
		.filter((row) => row.status === 'missing')
		.map((row) => ({
			reqId: row.reqId,
			n: row.n,
			priority: row.priority,
			text: text.get(`${row.reqId}\0${row.n}`)!
		}));
}
