import type Anthropic from '@anthropic-ai/sdk';
import { executeTool, anthropicTools, type ToolContext } from '../core/tools';
import { addUsage, emptyUsage, responseCostUsd } from './cost';
import { callModel, type CallModel } from './llm';
import type { AgentDef, AgentEvent, ModelResponse, RunResult, Usage } from './types';

type Block = ModelResponse['content'][number];

export const textOf = (content: Block[]) =>
	content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');

export const usageOf = (u: ModelResponse['usage']): Usage => ({
	input: u.input_tokens,
	output: u.output_tokens,
	cacheRead: u.cache_read_input_tokens ?? 0,
	cacheWrite: u.cache_creation_input_tokens ?? 0
});

/** Drives one agent until it stops asking for tools, fails, or runs out of turns. */
export async function runAgent(opts: {
	def: AgentDef;
	ctx: ToolContext;
	history: Anthropic.MessageParam[];
	onEvent: (e: AgentEvent) => void;
	call?: CallModel;
	maxTurns?: number;
	/** Stops the run, failed, once its cost passes this many USD (P6: $1). */
	costLimitUsd?: number;
}): Promise<RunResult> {
	const { def, ctx, onEvent } = opts;
	const call = opts.call ?? callModel;
	const maxTurns = opts.maxTurns ?? 30;
	const tools = anthropicTools(def.tools);
	const messages: Anthropic.Beta.BetaMessageParam[] = [...opts.history];
	let usage = emptyUsage();
	let cost = 0;
	let turns = 0;
	let text = '';

	const failed = (reason: NonNullable<RunResult['reason']>, error: string): RunResult => ({
		status: 'failed',
		text,
		reason,
		error,
		usage,
		costUsd: cost,
		turns
	});
	const result = (status: RunResult['status']): RunResult => ({
		status,
		text,
		usage,
		costUsd: cost,
		turns
	});

	try {
		while (turns < maxTurns) {
			const response = await call({
				model: def.model,
				system: def.system,
				messages,
				tools,
				effort: def.effort
			});
			turns++;
			usage = addUsage(usage, usageOf(response.usage));
			cost += responseCostUsd(def.model, response.usage);
			if (opts.costLimitUsd !== undefined && cost > opts.costLimitUsd)
				return failed('cost_limit', `cost limit ($${opts.costLimitUsd}) reached`);
			messages.push({
				role: 'assistant',
				content: response.content
			});
			text = textOf(response.content);
			for (const b of response.content)
				if (b.type === 'text') onEvent({ type: 'text', text: b.text });

			if (response.stop_reason === 'refusal') {
				return failed(
					'refused',
					`model refused (${response.stop_details?.category ?? 'no category'})`
				);
			}
			if (response.stop_reason === 'max_tokens')
				return failed('max_tokens', 'response hit max_tokens');
			if (response.stop_reason !== 'tool_use') return result('done');

			const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
			for (const block of response.content) {
				if (block.type !== 'tool_use') continue;
				const r = await executeTool(ctx, block.name, block.input, def.tools);
				onEvent({
					type: 'tool',
					name: block.name,
					input: block.input,
					result: r.content,
					isError: r.isError
				});
				results.push({
					type: 'tool_result',
					tool_use_id: block.id,
					content: r.content,
					is_error: r.isError
				});
			}
			messages.push({ role: 'user', content: results });
		}
		return failed('turn_limit', `turn limit (${maxTurns}) reached`);
	} catch (e) {
		return failed('error', e instanceof Error ? e.message : String(e));
	}
}
