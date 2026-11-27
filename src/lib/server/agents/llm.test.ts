import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callModel } from './llm';

// callModel is exercised against a stubbed fetch: no network, no real key.
const ok = {
	id: 'msg_1',
	type: 'message',
	role: 'assistant',
	model: 'm',
	content: [{ type: 'text', text: 'hi' }],
	stop_reason: 'end_turn',
	stop_details: null,
	usage: { input_tokens: 1, output_tokens: 1 }
};
const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', 'retry-after-ms': '1' }
	});
const err = (status: number, type: string) =>
	json(status, { type: 'error', error: { type, message: type } });

type Seen = { key: string | null; beta: string | null; body: Record<string, unknown> };
let seen: Seen[];
let responses: Array<() => Response>;

const req = (model: 'claude-opus-5-5' | 'claude-haiku-5-5') => ({
	model,
	system: 's',
	messages: [{ role: 'user' as const, content: 'x' }],
	tools: [],
	effort: 'medium' as const
});

beforeEach(() => {
	seen = [];
	vi.stubEnv('ANTHROPIC_API_KEY', 'primary-key');
	vi.stubEnv('ANTHROPIC_API_KEY_FALLBACK', '');
	vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
		const h = new Headers(init.headers);
		seen.push({
			key: h.get('authorization')?.replace('Bearer ', '') ?? null,
			beta: h.get('anthropic-beta'),
			body: JSON.parse(String(init.body))
		});
		return responses.shift()!();
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('callModel', () => {
	it('sends fallbacks, caching and effort for Opus', async () => {
		responses = [() => json(200, ok)];
		await callModel(req('claude-opus-5-5'));
		expect(seen[0].beta).toContain('server-side-fallback-2026-07-01');
		expect(seen[0].body).toMatchObject({
			model: 'claude-opus-5-5',
			max_tokens: 16000,
			fallbacks: 'default',
			system: [{ type: 'text', text: 's', cache_control: { type: 'ephemeral', ttl: '1h' } }],
			cache_control: { type: 'ephemeral' },
			output_config: { effort: 'medium' }
		});
	});

	it('leaves out the tail breakpoint when cacheTail is false', async () => {
		responses = [() => json(200, ok)];
		await callModel({ ...req('claude-haiku-5-5'), cacheTail: false });
		expect(seen[0].body).not.toHaveProperty('cache_control');
	});

	it('refuses Opus above medium effort without calling the API', async () => {
		await expect(callModel({ ...req('claude-opus-5-5'), effort: 'high' })).rejects.toThrow(
			/medium effort only/
		);
		expect(seen).toHaveLength(0);
	});

	it('sends no fallbacks for Haiku', async () => {
		responses = [() => json(200, ok)];
		await callModel(req('claude-haiku-5-5'));
		expect(seen[0].body).not.toHaveProperty('fallbacks');
		expect(seen[0].beta ?? '').not.toContain('server-side-fallback');
	});

	it('retries once with the fallback key after a rate limit that survives retries', async () => {
		vi.stubEnv('ANTHROPIC_API_KEY_FALLBACK', 'second-key');
		responses = [
			...Array.from({ length: 4 }, () => () => err(429, 'rate_limit_error')),
			() => json(200, ok)
		];
		await callModel(req('claude-opus-5-5'));
		expect(seen.map((s) => s.key)).toEqual([...Array(4).fill('primary-key'), 'second-key']);
	});

	it('rethrows when no fallback key is set', async () => {
		responses = Array.from({ length: 4 }, () => () => err(429, 'rate_limit_error'));
		await expect(callModel(req('claude-opus-5-5'))).rejects.toMatchObject({ status: 429 });
		expect(seen).toHaveLength(4);
	});
});
