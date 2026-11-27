import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRun } from '../runs';
import { ProjectStore } from '../store';
import { readRunFindings } from '../test-state';
import { executeTool } from './index';
import type { ToolContext } from './registry';

let root: string;
let ctx: ToolContext;
const run = (input: unknown, c: ToolContext = ctx) =>
	executeTool(c, 'report_fix_result', input, ['report_fix_result']);
const stored = () => readRunFindings(ctx.store, ctx.runId);

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-fixresult-'));
	const store = new ProjectStore(path.join(root, 'proj'));
	const meta = await createRun(store, 'P5', 'test');
	ctx = {
		store,
		runId: meta.id,
		projectName: 'todo',
		agent: 'code',
		fixLoop: true,
		handedOver: ['R-1', 'R-2']
	};
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const result = {
	findingId: 'R-1',
	outcome: 'needs_design_change',
	reason: 'no due date attribute'
};

describe('report_fix_result', () => {
	it('stores the outcome for a finding handed to the code agent', async () => {
		const r = await run(result);
		expect(r.isError).toBe(false);
		const { fixResults } = await stored();
		expect(fixResults).toEqual([{ ...result, runId: ctx.runId, at: expect.any(String) }]);
	});

	it('replaces an earlier result for the same finding', async () => {
		await run(result);
		await run({ ...result, outcome: 'fixed', reason: 'added the check' });
		await run({ ...result, findingId: 'R-2', outcome: 'test_looks_wrong', reason: 'x' });
		const { fixResults } = await stored();
		expect(fixResults.map((f) => [f.findingId, f.outcome])).toEqual([
			['R-1', 'fixed'],
			['R-2', 'test_looks_wrong']
		]);
	});

	it('refuses other agents, a missing fixLoop flag and findings not handed over, storing nothing', async () => {
		const refused: [string, ToolContext, unknown][] = [
			['test agent', { ...ctx, agent: 'test' }, result],
			['mcp', { ...ctx, agent: 'mcp' }, result],
			['no fixLoop', { ...ctx, fixLoop: undefined }, result],
			['unknown id', ctx, { ...result, findingId: 'R-9' }],
			['no handedOver', { ...ctx, handedOver: undefined }, result]
		];
		for (const [label, c, input] of refused) {
			const r = await run(input, c);
			expect(r.isError, label).toBe(true);
		}
		expect(await ctx.store.exists(`.aise/runs/${ctx.runId}/findings.json`)).toBe(false);
	});

	it('validates the input', async () => {
		for (const bad of [
			{ ...result, outcome: 'done' },
			{ ...result, reason: '' },
			{ ...result, reason: 'x'.repeat(301) },
			{ ...result, extra: 1 }
		])
			expect((await run(bad)).isError).toBe(true);
		expect(await ctx.store.exists(`.aise/runs/${ctx.runId}/findings.json`)).toBe(false);
	});

	it('is never offered to an MCP session, whatever its agent', async () => {
		const { toolsFor } = await import('../../mcp/server');
		const { TOOLS_BY_AGENT } = await import('./scope');
		for (const agent of Object.keys(TOOLS_BY_AGENT) as (keyof typeof TOOLS_BY_AGENT)[])
			expect(toolsFor(agent)).not.toContain('report_fix_result');
	});

	it('reads a findings file written before fixResults existed', async () => {
		await ctx.store.writeFile(
			`.aise/runs/${ctx.runId}/findings.json`,
			JSON.stringify({ findings: [], testFixes: [] })
		);
		expect((await stored()).fixResults).toEqual([]);
	});
});
