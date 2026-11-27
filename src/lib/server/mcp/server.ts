import { McpServer } from '@modelcontextprotocol/server';
import path from 'node:path';
import type { z } from 'zod';
import { createRun, listRuns, touchedFiles, updateRun } from '../core/runs';
import { ProjectStore } from '../core/store';
import { executeTool, TOOLS, type AgentName } from '../core/tools';
import { RUN_ONLY_TOOLS, TOOLS_BY_AGENT } from '../core/tools/scope';

/**
 * False once the run was discarded or any other kept run started at the same time or later (a UI
 * run, another MCP session): appending to it then would make Discard undo that run's work too.
 */
async function isLatestRun(store: ProjectStore, id: string): Promise<boolean> {
	const runs = await listRuns(store);
	const own = runs.find((r) => r.id === id);
	if (!own || own.status === 'discarded') return false;
	return !runs.some((r) => r.id !== id && r.status !== 'discarded' && r.startedAt >= own.startedAt);
}

export const AGENT_NAMES = Object.keys(TOOLS_BY_AGENT) as AgentName[];

/** Tools that change project files; the first call in a session records a P7 run. */
const WRITE_TOOLS = new Set([
	'write_file',
	'delete_file',
	'write_requirements',
	'update_design',
	'report_coverage'
]);

/** Tools that build and run containers on the host; never advertised as read only. */
const EXEC_TOOLS = new Set(['typecheck', 'run_tests', 'deploy_check']);
/** Registered tools the agent may use over MCP; the test agent's reports, the code agent's `report_fix_result` and the ticket plan and report need an in process run, so they never are. */
export function toolsFor(agent: AgentName): string[] {
	const names = agent === 'mcp' ? Object.keys(TOOLS) : TOOLS_BY_AGENT[agent];
	return names.filter((n) => n in TOOLS && !RUN_ONLY_TOOLS.includes(n));
}

/**
 * One MCP server for one project folder and one agent identity. Every call goes through
 * executeTool, so scopes and validation are the ones the in process agents get.
 */
export function createMcpServer(opts: { projectDir: string; agent: AgentName }): McpServer {
	const { agent } = opts;
	const store = new ProjectStore(opts.projectDir);
	const projectName = path.basename(store.dir);
	const allowed = toolsFor(agent);
	const server = new McpServer({ name: 'aise', version: '0.0.1' });

	// Writes need a run for the backups. The first write creates it and marks it done at once:
	// restart recovery only touches running runs, and Discard restores the files like for any run.
	let sessionRun: string | undefined;
	let writes: Promise<unknown> = Promise.resolve();

	const call = (name: string, args: unknown) => {
		if (!WRITE_TOOLS.has(name)) {
			// Read tools never write; if one ever does, the store refuses the placeholder id.
			const runId = sessionRun ?? 'read-only-session';
			return executeTool({ store, runId, projectName, agent }, name, args, allowed);
		}
		const turn = writes.then(async () => {
			let runId = sessionRun;
			if (runId !== undefined && !(await isLatestRun(store, runId))) runId = undefined;
			if (runId === undefined) {
				runId = (await createRun(store, 'P7', 'mcp')).id;
				await updateRun(store, runId, { status: 'done', finishedAt: new Date().toISOString() });
				sessionRun = runId;
			}
			try {
				return await executeTool({ store, runId, projectName, agent }, name, args, allowed);
			} finally {
				// A write that touched no file (refused, or failed early) leaves nothing to discard.
				if (!(await touchedFiles(store, runId))) {
					await updateRun(store, runId, { status: 'discarded' });
					sessionRun = undefined;
				}
			}
		});
		// One write at a time, and a failed one does not block the next.
		writes = turn.catch(() => {});
		return turn;
	};

	for (const name of allowed) {
		const def = TOOLS[name];
		server.registerTool(
			name,
			{
				description: def.description,
				// executeTool validates again, so the handler passes the parsed arguments on.
				inputSchema: def.input as z.ZodType<unknown>,
				annotations: {
					readOnlyHint: !WRITE_TOOLS.has(name) && !EXEC_TOOLS.has(name),
					openWorldHint: false
				}
			},
			async (args: unknown) => {
				const { content, isError } = await call(name, args);
				return { content: [{ type: 'text' as const, text: content }], isError };
			}
		);
	}
	return server;
}
