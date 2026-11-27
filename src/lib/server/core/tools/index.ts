import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { runTests, typecheck } from './check';
import { codeModel } from './code-model';
import { reportCoverage } from './coverage';
import { deployCheck } from './deploy';
import { detectDriftTool } from './drift';
import { readDesign, updateDesign } from './design';
import { reportFixResult } from './fix-result';
import { reportCodeBug, reportTestFix } from './findings';
import { deleteFile, listFiles, readFile, writeFile } from './files';
import { readRequirements, writeRequirements } from './requirements';
import { startApp } from './start';
import { readTicketsTool, writeTicketPlan, writeTicketReport } from './tickets';
import { trace } from './trace';
import { ToolError, type ToolContext, type ToolDef } from './registry';

export { ToolError, type ToolContext, type ToolDef } from './registry';
export type { AgentName } from './scope';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: Record<string, ToolDef<any>> = Object.fromEntries(
	[
		readRequirements,
		writeRequirements,
		readDesign,
		updateDesign,
		reportCoverage,
		listFiles,
		readFile,
		writeFile,
		deleteFile,
		codeModel,
		detectDriftTool,
		deployCheck,
		typecheck,
		runTests,
		startApp,
		reportCodeBug,
		reportTestFix,
		reportFixResult,
		trace,
		readTicketsTool,
		writeTicketPlan,
		writeTicketReport
	].map((t) => [t.name, t])
);

/** Tool definitions for the Messages API, sorted by name so the prompt prefix stays cacheable. */
export function anthropicTools(names: string[]): Anthropic.Tool[] {
	return [...names].sort().map((name) => {
		const def = TOOLS[name];
		if (!def) throw new Error(`Unknown tool "${name}"`);
		// io: 'input' because defaulted fields are optional for the caller
		const schema = z.toJSONSchema(def.input, { io: 'input' });
		delete schema.$schema;
		return {
			name: def.name,
			description: def.description,
			input_schema: { ...schema, type: 'object' }
		};
	});
}

/** `path: message` with array indices in brackets, the same form validateDesign uses. */
const issueLine = (i: z.core.$ZodIssue) =>
	`${
		i.path.reduce<string>(
			(s, p) => (typeof p === 'number' ? `${s}[${p}]` : s ? `${s}.${String(p)}` : String(p)),
			''
		) || '(input)'
	}: ${i.message}`;

/**
 * Runs one tool call for an agent. Bad input and ToolError become error results the model can act
 * on; anything else is a bug or an I/O failure and is rethrown for the agent loop to handle.
 */
export async function executeTool(
	ctx: ToolContext,
	name: string,
	rawInput: unknown,
	allowed: string[]
): Promise<{ content: string; isError: boolean }> {
	const def = allowed.includes(name) ? TOOLS[name] : undefined;
	if (!def) return { content: `Tool "${name}" is not available to this agent.`, isError: true };

	const parsed = def.input.safeParse(rawInput);
	if (!parsed.success) {
		return { content: parsed.error.issues.map(issueLine).join('\n'), isError: true };
	}
	try {
		const result = await def.run(ctx, parsed.data);
		return { content: JSON.stringify(result, null, 2), isError: false };
	} catch (e) {
		if (e instanceof ToolError) return { content: e.message, isError: true };
		throw e;
	}
}
