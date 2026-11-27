import { z } from 'zod';
import { designHash } from '../code-state';
import { ID_PATTERNS } from '../ids';
import { DesignDoc } from '../schemas/design';
import { RequirementsDoc } from '../schemas/requirements';
import type { ProjectStore } from '../store';
import { DESIGN_PATH } from './design';
import { defineTool, ToolError } from './registry';

export const DESIGN_REVIEW_PATH = '.aise/design-review.json';

const Cover = z.union([
	z.strictObject({
		classId: z.string().regex(ID_PATTERNS.DSN).describe('Class that covers the criterion'),
		method: z.string().min(1).describe('Method of that class')
	}),
	z.strictObject({
		sequenceId: z.string().regex(ID_PATTERNS.SEQ).describe('Sequence that covers the criterion'),
		step: z.number().int().min(1).describe('1 based index of the message in the sequence')
	})
]);

const Row = z.strictObject({
	reqId: z.string().regex(ID_PATTERNS.REQ),
	criterion: z.number().int().min(1).describe('1 based index into the requirement criteria'),
	coveredBy: z.array(Cover).describe('Empty when nothing in the design covers the criterion'),
	note: z.string().optional().describe('Why it is covered this way, or why it is not')
});
export type CoverageRow = z.infer<typeof Row>;

/** What `report_coverage` stores: the rows and the hash of the design they describe. */
export const DesignReview = z.strictObject({
	designHash: z.string(),
	rows: z.array(Row)
});
export type DesignReview = z.infer<typeof DesignReview>;

/** The stored review, or null when there is none (or it no longer parses: it is derived and rerun). */
export const readDesignReview = (store: ProjectStore): Promise<DesignReview | null> =>
	store.readJson(DESIGN_REVIEW_PATH, DesignReview).catch(() => null);

export type UncoveredCriterion = { reqId: string; n: number; text: string };

/**
 * Criteria that nothing covers, in requirement order: a functional criterion without a row or with
 * an empty `coveredBy`, and a non functional one with a row that has neither cover nor note.
 * A non functional criterion without a row is left out; those need no row.
 */
export function uncoveredCriteria(
	rows: CoverageRow[],
	reqs: RequirementsDoc
): UncoveredCriterion[] {
	const out: UncoveredCriterion[] = [];
	for (const r of reqs.requirements) {
		r.acceptanceCriteria.forEach((text, i) => {
			const n = i + 1;
			const row = rows.find((w) => w.reqId === r.id && w.criterion === n);
			const covered = row !== undefined && row.coveredBy.length > 0;
			const justified = r.type === 'non-functional' && row !== undefined && !!row.note?.trim();
			const missing = row === undefined ? r.type === 'functional' : !covered && !justified;
			if (missing) out.push({ reqId: r.id, n, text });
		});
	}
	return out;
}

/** Every problem of the rows against the requirements and the design, as `path: message` lines. */
function rowProblems(rows: CoverageRow[], reqs: RequirementsDoc, design: DesignDoc): string[] {
	const problems: string[] = [];
	const seen = new Set<string>();
	rows.forEach((row, i) => {
		const at = `rows[${i}]`;
		const req = reqs.requirements.find((r) => r.id === row.reqId);
		if (!req) {
			problems.push(`${at}.reqId: unknown requirement "${row.reqId}"`);
		} else if (row.criterion > req.acceptanceCriteria.length) {
			problems.push(
				`${at}.criterion: ${row.reqId} has ${req.acceptanceCriteria.length} criteria, not ${row.criterion}`
			);
		} else {
			const key = `${row.reqId} AC${row.criterion}`;
			if (seen.has(key)) problems.push(`${at}: more than one row for ${key}`);
			seen.add(key);
		}
		row.coveredBy.forEach((c, j) => {
			const cat = `${at}.coveredBy[${j}]`;
			if ('classId' in c) {
				const cls = design.classes.find((k) => k.id === c.classId);
				if (!cls) problems.push(`${cat}.classId: unknown class "${c.classId}"`);
				else if (!cls.methods.some((m) => m.name === c.method))
					problems.push(`${cat}.method: ${c.classId} (${cls.name}) has no method "${c.method}"`);
				return;
			}
			const seq = design.sequences.find((s) => s.id === c.sequenceId);
			if (!seq) problems.push(`${cat}.sequenceId: unknown sequence "${c.sequenceId}"`);
			else if (c.step > seq.messages.length)
				problems.push(
					`${cat}.step: ${c.sequenceId} has ${seq.messages.length} messages, not ${c.step}`
				);
		});
	});
	for (const r of reqs.requirements) {
		if (r.type !== 'functional') continue;
		r.acceptanceCriteria.forEach((_, i) => {
			if (!seen.has(`${r.id} AC${i + 1}`))
				problems.push(`rows: no row for ${r.id} AC${i + 1}; every functional criterion needs one`);
		});
	}
	return problems;
}

export const reportCoverage = defineTool({
	name: 'report_coverage',
	description:
		'Report which part of the saved design covers each acceptance criterion; call it after update_design saved cleanly. One row per criterion: reqId, criterion (1 based index into its acceptanceCriteria) and coveredBy, a list of { classId, method } or { sequenceId, step } (step is the 1 based message index). Every criterion of a functional requirement needs a row; leave coveredBy empty when nothing covers it. A non functional row may have an empty coveredBy and a note. Nothing is stored unless every row checks out; all problems are returned at once. Returns the criteria still uncovered.',
	input: z.strictObject({ rows: z.array(Row) }),
	async run({ store, runId }, { rows }) {
		const reqs = await store.readJson('.aise/requirements.json', RequirementsDoc);
		if (!reqs) throw new ToolError('There are no requirements to report coverage against.');
		// a saved design that no longer parses counts as none
		const design = await store.readJson(DESIGN_PATH, DesignDoc).catch(() => null);
		if (!design) throw new ToolError('There is no saved design. Save it with update_design first.');
		const problems = rowProblems(rows, reqs, design);
		if (problems.length > 0) {
			throw new ToolError(
				`The coverage was not saved. Fix these ${problems.length} problems:\n${problems.join('\n')}`
			);
		}
		await store.writeJson(
			DESIGN_REVIEW_PATH,
			DesignReview,
			{ designHash: designHash(design)!, rows },
			runId
		);
		const uncovered = uncoveredCriteria(rows, reqs);
		return {
			ok: true,
			rows: rows.length,
			uncovered: uncovered.map((u) => `${u.reqId} AC${u.n}: ${u.text}`)
		};
	}
});
