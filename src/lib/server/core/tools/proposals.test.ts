import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { designHash } from '../code-state';
import { createRun } from '../runs';
import { DesignDoc } from '../schemas/design';
import { ProjectStore } from '../store';
import { executeTool } from './index';
import {
	p3Status,
	PROPOSALS_PATH,
	readDesignProposals,
	resolveProposal,
	type DesignProposals,
	type Proposal
} from './proposals';
import type { ToolContext } from './registry';
import { TOOLS_BY_AGENT } from './scope';

const fixture = (name: string): unknown =>
	JSON.parse(
		readFileSync(new URL(`../../../../../test/fixtures/${name}`, import.meta.url), 'utf8')
	);
const design = DesignDoc.parse(fixture('todo-design.json'));

let root: string;
let ctx: ToolContext;
const report = (proposals: unknown[]) =>
	executeTool(ctx, 'report_design_proposals', { proposals }, TOOLS_BY_AGENT.review);
const item = (over: Record<string, unknown> = {}) => ({
	kind: 'missing_method',
	title: 'Add a delete method',
	change: 'Give TaskService a deleteTask(id: string) method.',
	elementIds: ['DSN-001'],
	reqIds: ['REQ-001'],
	...over
});
const open = (id: string): Proposal => ({ id, ...item(), status: 'open' }) as Proposal;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-proposals-'));
	const store = new ProjectStore(path.join(root, 'proj'));
	await store.writeFile(
		'.aise/requirements.json',
		JSON.stringify(fixture('todo-requirements.json'))
	);
	await store.writeFile('.aise/design.json', JSON.stringify(design));
	const meta = await createRun(store, 'P3', 'review');
	ctx = { store, runId: meta.id, projectName: 'todo', agent: 'review' };
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('report_design_proposals', () => {
	it('stores open proposals with fresh IDs and the design hash', async () => {
		const r = await report([
			item(),
			item({ kind: 'uncovered_criterion', elementIds: ['SEQ-001', 'UC-001', 'ACT-001'] })
		]);
		expect(r.isError).toBe(false);
		const doc = await readDesignProposals(ctx.store);
		expect(doc?.designHash).toBe(designHash(design));
		expect(doc?.proposals.map((p) => [p.id, p.status])).toEqual([
			['PRP-001', 'open'],
			['PRP-002', 'open']
		]);
	});

	it('refuses unknown IDs and more than five proposals, naming every problem', async () => {
		const r = await report([
			item({ elementIds: ['DSN-099'] }),
			item({ reqIds: ['REQ-042'] }),
			item(),
			item(),
			item(),
			item()
		]);
		expect(r.isError).toBe(true);
		expect(r.content).toContain('at most 5');
		expect(r.content).toContain('proposals[0].elementIds: unknown design element "DSN-099"');
		expect(r.content).toContain('proposals[1].reqIds: unknown requirement "REQ-042"');
		expect(await ctx.store.exists(PROPOSALS_PATH)).toBe(false);
	});

	it('replaces open proposals, keeps resolved ones and never reuses a number', async () => {
		const before: DesignProposals = {
			designHash: 'old',
			proposals: [
				{ ...open('PRP-001'), status: 'accepted', resolvedAt: '2026-11-27T10:00:00.000Z' },
				open('PRP-002'),
				{ ...open('PRP-003'), status: 'rejected', resolvedAt: '2026-11-27T10:00:00.000Z' },
				open('PRP-004')
			]
		};
		await ctx.store.writeFile(PROPOSALS_PATH, JSON.stringify(before));
		expect((await report([])).isError).toBe(false);
		let doc = await readDesignProposals(ctx.store);
		expect(doc?.proposals.map((p) => p.id)).toEqual(['PRP-001', 'PRP-003']);
		expect(doc?.lastId).toBe('PRP-004');
		await report([item()]);
		doc = await readDesignProposals(ctx.store);
		expect(doc?.proposals.map((p) => `${p.id} ${p.status}`)).toEqual([
			'PRP-001 accepted',
			'PRP-003 rejected',
			'PRP-005 open'
		]);
	});
});

describe('p3Status', () => {
	const doc = (proposals: Proposal[], hash = 'h'): DesignProposals => ({
		designHash: hash,
		proposals
	});
	const accepted = { ...open('PRP-001'), status: 'accepted' as const };

	it('follows the proposals of the latest review', () => {
		expect(p3Status(null, 'h')).toBe('not_started');
		expect(p3Status(doc([accepted, open('PRP-002')]), 'h')).toBe('awaiting_approval');
		expect(p3Status(doc([accepted]), 'h')).toBe('approved');
		expect(p3Status(doc([]), 'h')).toBe('approved');
		expect(p3Status(doc([open('PRP-002')]), 'changed')).toBe('stale');
	});
});

describe('resolveProposal', () => {
	it('sets the status and resolvedAt, and clears resolvedAt when reopened', () => {
		const d: DesignProposals = { designHash: 'h', proposals: [open('PRP-001'), open('PRP-002')] };
		const at = '2026-11-27T10:00:00.000Z';
		const r = resolveProposal(d, 'PRP-002', 'rejected', at);
		expect(r.proposals[1]).toMatchObject({ status: 'rejected', resolvedAt: at });
		expect(r.proposals[0].status).toBe('open');
		expect(resolveProposal(r, 'PRP-002', 'open', at).proposals[1]).not.toHaveProperty('resolvedAt');
	});
});
