import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRun } from '../core/runs';
import { ProjectStore } from '../core/store';
import type { ToolContext } from '../core/tools';
import type { CallModel } from './llm';
import { runAgent } from './loop';
import type { AgentDef, AgentEvent, ModelResponse } from './types';

type Block = ModelResponse['content'][number];
type Req = Parameters<CallModel>[0];

const def: AgentDef = {
	name: 'requirements',
	model: 'claude-sonnet-5-5',
	effort: 'medium',
	tools: ['read_requirements'],
	system: 'sys'
};
const usage = {
	input_tokens: 10,
	output_tokens: 5,
	cache_read_input_tokens: 2,
	cache_creation_input_tokens: 1
};

const text = (t: string): Block => ({ type: 'text', text: t, citations: null });
const toolUse = (id: string, name: string, input: unknown = {}): Block => ({
	type: 'tool_use',
	id,
	name,
	input,
	caller: { type: 'direct' }
});
const reply = (
	content: Block[],
	stop_reason: ModelResponse['stop_reason'],
	stop_details: ModelResponse['stop_details'] = null
): ModelResponse => ({ content, stop_reason, stop_details, usage });

/** A fake model that plays the scripted replies in order and records every request. */
function script(replies: Array<ModelResponse | Error>) {
	const requests: Req[] = [];
	let i = 0;
	const call: CallModel = async (req) => {
		// the loop mutates one messages array, so snapshot it
		requests.push({ ...req, messages: [...req.messages] });
		const r = replies[Math.min(i++, replies.length - 1)];
		if (r instanceof Error) throw r;
		return r;
	};
	return { call, requests };
}

let root: string;
let ctx: ToolContext;
let events: AgentEvent[];
const history: Anthropic.MessageParam[] = [{ role: 'user', content: 'build a todo app' }];
const run = (call: CallModel, maxTurns?: number) =>
	runAgent({ def, ctx, history, onEvent: (e) => events.push(e), call, maxTurns });

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-loop-'));
	const store = new ProjectStore(path.join(root, 'proj'));
	const meta = await createRun(store, 'P1', 'requirements');
	ctx = { store, runId: meta.id, projectName: 'todo', agent: 'requirements' };
	events = [];
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('runAgent', () => {
	it('runs a tool and finishes on end_turn', async () => {
		const { call, requests } = script([
			reply([text('Looking.'), toolUse('t1', 'read_requirements')], 'tool_use'),
			reply([text('Done')], 'end_turn')
		]);
		const r = await run(call);
		expect(r).toMatchObject({ status: 'done', text: 'Done', turns: 2 });
		expect(r.usage).toEqual({ input: 20, output: 10, cacheRead: 4, cacheWrite: 2 });
		expect(r.costUsd).toBeGreaterThan(0);
		expect(events.filter((e) => e.type === 'tool')).toEqual([
			{ type: 'tool', name: 'read_requirements', input: {}, result: 'null', isError: false }
		]);
		expect(events.filter((e) => e.type === 'text')).toHaveLength(2);

		expect(requests[0]).toMatchObject({ model: def.model, system: 'sys', effort: 'medium' });
		expect(requests[0].tools.map((t) => t.name)).toEqual(['read_requirements']);
		const last = requests[1].messages.at(-1)!;
		expect(last.role).toBe('user');
		expect(last.content).toEqual([
			{ type: 'tool_result', tool_use_id: 't1', content: 'null', is_error: false }
		]);
		expect(requests[1].messages.at(-2)).toEqual({
			role: 'assistant',
			content: [text('Looking.'), toolUse('t1', 'read_requirements')]
		});
	});

	it('answers several tool_use blocks in one user message', async () => {
		const { call, requests } = script([
			reply([toolUse('a', 'read_requirements'), toolUse('b', 'read_requirements')], 'tool_use'),
			reply([text('ok')], 'end_turn')
		]);
		await run(call);
		const last = requests[1].messages.at(-1)!;
		expect(last.role).toBe('user');
		expect((last.content as Array<{ tool_use_id: string }>).map((b) => b.tool_use_id)).toEqual([
			'a',
			'b'
		]);
	});

	it('returns an error result for an unknown tool and continues', async () => {
		const { call, requests } = script([
			reply([toolUse('x', 'nope')], 'tool_use'),
			reply([text('fine')], 'end_turn')
		]);
		const r = await run(call);
		expect(r.status).toBe('done');
		const content = requests[1].messages.at(-1)!.content as Array<{ is_error: boolean }>;
		expect(content[0].is_error).toBe(true);
		expect(events.find((e) => e.type === 'tool')).toMatchObject({ isError: true });
	});

	it('stops at the turn limit', async () => {
		const { call } = script([reply([toolUse('t', 'read_requirements')], 'tool_use')]);
		const r = await run(call, 3);
		expect(r).toMatchObject({
			status: 'failed',
			reason: 'turn_limit',
			error: 'turn limit (3) reached',
			turns: 3
		});
	});

	it('fails on refusal with the category', async () => {
		const { call } = script([reply([], 'refusal', { category: 'cyber' })]);
		const r = await run(call);
		expect(r).toMatchObject({ status: 'failed', reason: 'refused' });
		expect(r.error).toContain('cyber');
	});

	it('fails on max_tokens', async () => {
		const { call } = script([reply([text('cut')], 'max_tokens')]);
		const r = await run(call);
		expect(r).toMatchObject({
			status: 'failed',
			reason: 'max_tokens',
			error: 'response hit max_tokens'
		});
	});

	it('fails when the model call throws and keeps the usage so far', async () => {
		const { call } = script([
			reply([toolUse('t', 'read_requirements')], 'tool_use'),
			new Error('boom')
		]);
		const r = await run(call);
		expect(r).toMatchObject({ status: 'failed', reason: 'error', error: 'boom', turns: 1 });
		expect(r.usage).toEqual({ input: 10, output: 5, cacheRead: 2, cacheWrite: 1 });
	});

	it('fails when a tool throws unexpectedly and keeps the usage so far', async () => {
		await ctx.store.writeFile('.aise/requirements.json', '{ not json', ctx.runId);
		const { call } = script([reply([toolUse('t', 'read_requirements')], 'tool_use')]);
		const r = await run(call);
		expect(r).toMatchObject({ status: 'failed', reason: 'error' });
		expect(r.error).toBeTruthy();
		expect(r.usage.input).toBe(10);
	});

	describe('cost limit', () => {
		// 150k output tokens on Sonnet 5.5 cost $1.50, over a $1 limit
		const expensiveToolUse = () => ({
			...reply([toolUse('t1', 'read_requirements')], 'tool_use'),
			usage: { ...usage, output_tokens: 150_000 }
		});

		it('fails with cost_limit before the tools of the turn that passed the limit run', async () => {
			const { call, requests } = script([
				expensiveToolUse(),
				reply([text('never reached')], 'end_turn')
			]);
			const r = await runAgent({
				def,
				ctx,
				history,
				onEvent: (e) => events.push(e),
				call,
				costLimitUsd: 1
			});
			expect(r).toMatchObject({
				status: 'failed',
				reason: 'cost_limit',
				error: 'cost limit ($1) reached',
				turns: 1
			});
			expect(r.costUsd).toBeGreaterThan(1);
			expect(requests).toHaveLength(1);
			expect(events.filter((e) => e.type === 'tool')).toEqual([]);
		});

		it('goes on past the same cost when no limit is set', async () => {
			const { call } = script([expensiveToolUse(), reply([text('done')], 'end_turn')]);
			const r = await run(call);
			expect(r).toMatchObject({ status: 'done', text: 'done', turns: 2 });
			expect(events.filter((e) => e.type === 'tool')).toHaveLength(1);
		});

		it('lets a run finish when its cost stays under the limit', async () => {
			const { call } = script([
				reply([toolUse('t1', 'read_requirements')], 'tool_use'),
				reply([text('done')], 'end_turn')
			]);
			const r = await runAgent({
				def,
				ctx,
				history,
				onEvent: (e) => events.push(e),
				call,
				costLimitUsd: 1
			});
			expect(r).toMatchObject({ status: 'done', text: 'done', turns: 2 });
		});
	});
});
