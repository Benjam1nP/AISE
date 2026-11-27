import type Anthropic from '@anthropic-ai/sdk';
import type { AgentName } from '../core/tools/scope';

export type ModelId = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';
export type Effort = 'low' | 'medium' | 'high';

export type AgentDef = {
	name: AgentName;
	model: ModelId;
	effort: Effort;
	tools: string[];
	system: string;
};

export type AgentEvent =
	| { type: 'text'; text: string }
	| { type: 'tool'; name: string; input: unknown; result: string; isError: boolean };

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type RunResult = {
	status: 'done' | 'failed';
	text: string;
	error?: string;
	/** Why a failed run stopped; `error` is an exception such as an API or tool failure. */
	reason?: 'turn_limit' | 'refused' | 'max_tokens' | 'cost_limit' | 'error';
	usage: Usage;
	costUsd: number;
	turns: number;
};

/** The part of a Messages API response the agent loop reads; beta and non beta messages both fit. */
export type ModelResponse = {
	content: Anthropic.Beta.BetaContentBlockParam[];
	stop_reason: Anthropic.Beta.BetaStopReason | null;
	stop_details: { category: string | null } | null;
	usage: {
		input_tokens: number;
		output_tokens: number;
		cache_read_input_tokens?: number | null;
		cache_creation_input_tokens?: number | null;
		cache_creation?: { ephemeral_1h_input_tokens?: number | null } | null;
	};
};
