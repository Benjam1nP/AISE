import type { ModelId, ModelResponse, Usage } from './types';

/**
 * USD per million tokens, from the claude-api skill pricing table (2026-11-20). Cache read is 0.1x
 * input (0.05x on Opus 5.5 and Sonnet 5.5), a 5 minute cache write 1.25x and a 1 hour write 2x input. Haiku 5.5 doubles to
 * 0.50 / 2.50 for prompts above 100K tokens; gate summaries stay far below that.
 */
export const PRICES: Record<
	ModelId,
	{ in: number; out: number; cacheRead: number; cacheWrite: number }
> = {
	'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
	'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 },
	'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }
};

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export function costUsd(model: ModelId, u: Usage): number {
	const p = PRICES[model];
	return (
		(u.input * p.in + u.output * p.out + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) /
		1_000_000
	);
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
	input: a.input + b.input,
	output: a.output + b.output,
	cacheRead: a.cacheRead + b.cacheRead,
	cacheWrite: a.cacheWrite + b.cacheWrite
});

/** Cost of one response; 1 hour cache writes cost 2x input instead of the 1.25x in `cacheWrite`. */
export function responseCostUsd(model: ModelId, u: ModelResponse['usage']): number {
	const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
	const base = costUsd(model, {
		input: u.input_tokens,
		output: u.output_tokens,
		cacheRead: u.cache_read_input_tokens ?? 0,
		cacheWrite: Math.max(0, (u.cache_creation_input_tokens ?? 0) - write1h)
	});
	return base + (write1h * 2 * PRICES[model].in) / 1_000_000;
}
