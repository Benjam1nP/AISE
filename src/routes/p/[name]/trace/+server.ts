import { error, json } from '@sveltejs/kit';
import { getOrchestrator } from '#lib/server/index.ts';
import { ProjectStore } from '#lib/server/core/store.ts';
import { traceAll } from '#lib/server/core/trace.ts';
import { loadTraceInput } from '#lib/server/core/tools/trace.ts';
import type { RequestHandler } from './$types';

/**
 * The trace of every REQ, UC, SEQ, DSN and ACT ID, for the links between the tabs. Built on
 * request and not in the snapshot: it needs the code model, which parses the code.
 */
export const GET: RequestHandler = async ({ params }) => {
	const orch = getOrchestrator();
	if (!(await orch.listProjects()).includes(params.name)) {
		error(404, `No project named "${params.name}"`);
	}
	const { input, tests } = await loadTraceInput(new ProjectStore(orch.projectDir(params.name)));
	return json({ traces: traceAll(input), testsOutOfDate: tests?.outOfDate ?? false });
};
