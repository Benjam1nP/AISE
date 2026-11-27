import type { z } from 'zod';
import type { ProjectStore } from '../store';
import type { AgentName } from './scope';

/** A failure the agent can fix (bad content); its message goes back to the model as the tool result. */
export class ToolError extends Error {
	override name = 'ToolError';
}

export type ToolContext = {
	store: ProjectStore;
	runId: string;
	projectName: string;
	agent: AgentName;
	/** When set, write_file and delete_file accept only this project relative path (P4 workers). */
	writeOnly?: string;
	/**
	 * Deploy checks this run may still start (P6 deploy agent: 3); `deploy_check` counts it down.
	 * Absent means no limit (MCP, Run deploy check).
	 */
	deployChecks?: { left: number };
	/** True for the steps of a fix loop run; `report_fix_result` needs it. */
	fixLoop?: true;
	/** Finding IDs handed to the code agent this round; `report_fix_result` accepts only these. */
	handedOver?: string[];
};

export type ToolDef<I> = {
	name: string;
	description: string;
	input: z.ZodType<I>;
	run(ctx: ToolContext, input: I): Promise<unknown>;
};

export const defineTool = <I>(d: ToolDef<I>): ToolDef<I> => d;
