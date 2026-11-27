import Anthropic from '@anthropic-ai/sdk';
import type { Effort, ModelId, ModelResponse } from './types';

export type CallModel = (req: {
	model: ModelId;
	system: string;
	messages: Anthropic.Beta.BetaMessageParam[];
	tools: Anthropic.Tool[];
	effort: Effort;
	maxTokens?: number;
	/** Automatic 5 minute breakpoint on the conversation tail. Off for one shot calls whose tail is never reused. */
	cacheTail?: boolean;
}) => Promise<ModelResponse>;

type Req = Parameters<CallModel>[0];

// Created on first use so importing this module never needs a key.
let primary: Anthropic | undefined;
let fallback: { key: string; client: Anthropic } | undefined;

const primaryClient = () => (primary ??= new Anthropic({ maxRetries: 3 }));
function fallbackClient(key: string): Anthropic {
	if (fallback?.key !== key)
		fallback = { key, client: new Anthropic({ apiKey: key, maxRetries: 3 }) };
	return fallback.client;
}

async function send(client: Anthropic, req: Req): Promise<ModelResponse> {
	const base: Anthropic.Beta.MessageCreateParamsNonStreaming = {
		model: req.model,
		max_tokens: req.maxTokens ?? 16000,
		// Tools and system render first and are identical for every run of an agent. A 1 hour
		// breakpoint keeps them cached across review gates, where the developer often takes
		// longer than 5 minutes. The tail gets the 5 minute automatic breakpoint: turns inside a
		// run are seconds apart. Longer TTLs must come first, which this order satisfies.
		system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
		messages: req.messages,
		tools: req.tools,
		...(req.cacheTail === false ? {} : { cache_control: { type: 'ephemeral' } }),
		output_config: { effort: req.effort }
	};
	// Haiku 5.5 has no server side refusal fallback; Opus and Sonnet get the default one.
	if (req.model === 'claude-haiku-5-5') return client.beta.messages.create(base);
	return client.beta.messages.create({
		...base,
		betas: ['server-side-fallback-2026-07-01'],
		fallbacks: 'default'
	});
}

/** The only place that talks to the API. */
export const callModel: CallModel = async (req) => {
	// Project rule: Opus only at medium effort, to keep API spend predictable.
	if (req.model === 'claude-opus-5-5' && req.effort !== 'medium')
		throw new Error(`claude-opus-5-5 runs at medium effort only, got "${req.effort}"`);
	try {
		return await send(primaryClient(), req);
	} catch (e) {
		const key = process.env.ANTHROPIC_API_KEY_FALLBACK;
		if (
			key &&
			(e instanceof Anthropic.RateLimitError || e instanceof Anthropic.AuthenticationError)
		) {
			return send(fallbackClient(key), req);
		}
		throw e;
	}
};
