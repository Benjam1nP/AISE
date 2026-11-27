import { z } from 'zod';
import { codeHash } from '../code-state';
import { traceMarkdown } from '../render/markdown';
import { DesignDoc } from '../schemas/design';
import { RequirementsDoc } from '../schemas/requirements';
import { listRuns } from '../runs';
import type { ProjectStore } from '../store';
import { readTestChecks, testHash } from '../test-state';
import { readTickets } from '../tickets';
import { PAGE } from '../client';
import { traceId, traceMatrix, type Trace, type TraceInput } from '../trace';
import { buildCodeModel } from './code-model';
import { DESIGN_PATH } from './design';
import { defineTool, ToolError, type ToolContext } from './registry';
import { REQUIREMENTS_PATH } from './requirements';

const TRACE_MD = 'docs/trace.md';
const TRACE_ID = /^(REQ|UC|SEQ|DSN|ACT|TCK)-\d{3}$/;

type TestsInfo = { at: string; outOfDate: boolean } | null;

/**
 * The stored artefacts a trace reads, plus when the P5 results were taken and whether code or
 * tests changed since (same hashes as the P5 gate).
 */
async function load(store: ProjectStore): Promise<{ input: TraceInput; tests: TestsInfo }> {
	const reqs = await store.readJson(REQUIREMENTS_PATH, RequirementsDoc);
	const design = await store.readJson(DESIGN_PATH, DesignDoc);
	const checks = await readTestChecks(store);
	const tests: TestsInfo = checks && {
		at: checks.at,
		outOfDate:
			checks.codeHash !== (await codeHash(store)) || checks.testHash !== (await testHash(store))
	};
	return {
		input: {
			requirements: reqs?.requirements ?? [],
			design,
			decls: buildCodeModel(store.dir).decls,
			tests: checks?.result?.tests ?? [],
			page: await store.readText(PAGE)
		},
		tests
	};
}

/** Writes `docs/trace.md` (the matrix as a table) from the stored artefacts, backed up under the run. */
export async function writeTraceDoc({ store, runId, projectName }: ToolContext): Promise<void> {
	const { input, tests } = await load(store);
	await store.writeFile(TRACE_MD, traceMarkdown(traceMatrix(input), projectName, tests), runId);
}

/**
 * A ticket: the ticket itself, the traces of the IDs in its plan (unknown ones skipped) and the
 * runs that belong to it, in the order they started.
 */
async function traceTicket(store: ProjectStore, id: string, input: TraceInput) {
	const all = await readTickets(store);
	const t = all.find((x) => x.id === id);
	if (!t)
		throw new ToolError(
			`${id} is not a ticket. Known tickets: ${all.length ? all.map((x) => x.id).join(', ') : 'none'}.`
		);
	const affected: Trace[] = [];
	for (const x of t.plan?.affectedIds ?? []) {
		const tr = traceId(x, input);
		if (tr) affected.push(tr);
	}
	const runs = (await listRuns(store))
		.filter((r) => r.ticketId === id)
		.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
	return {
		ticket: { id: t.id, kind: t.kind, title: t.title, status: t.status, plan: t.plan },
		affected,
		runs: runs.map((r) => ({
			id: r.id,
			phase: r.phase,
			agent: r.agent,
			status: r.status,
			summary: r.summary
		}))
	};
}

export const trace = defineTool({
	name: 'trace',
	description:
		'Trace query. With an ID (REQ, UC, SEQ, DSN or ACT): the linked requirements, design elements, code locations (file and line of @trace tags) and tests with their last status. With a ticket ID (TCK): the ticket, the traces of the IDs in its plan and the runs it started. Without an ID: one row per requirement with its design elements, files and tests, flagged noDesign or noTest. testsOutOfDate is true when code or tests changed after the stored test run.',
	input: z.strictObject({
		id: z
			.string()
			.regex(TRACE_ID, 'must be a REQ, UC, SEQ, DSN, ACT or TCK ID such as "REQ-001"')
			.optional()
			.describe(
				'ID to trace (a ticket ID traces its plan and runs); leave out for the whole project'
			)
	}),
	async run({ store }, { id }) {
		const { input, tests } = await load(store);
		const meta = { testsAt: tests?.at ?? null, testsOutOfDate: tests?.outOfDate ?? false };
		if (id === undefined) return { requirements: traceMatrix(input), ...meta };
		if (id.startsWith('TCK-')) return { ...(await traceTicket(store, id, input)), ...meta };
		const t = traceId(id, input);
		if (!t) throw new ToolError(`${id} is not in the requirements or the design.`);
		return { ...t, ...meta };
	}
});
