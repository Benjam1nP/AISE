import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceEvent } from './server/orchestrator/bus';
import { WIRING_PATH } from './server/codegen/generate';
import {
	applyCodegen,
	agentLabel,
	applyEvent,
	codegenProgress,
	failureReason,
	formatUsd,
	orbMood,
	WIRING_ROW,
	type LiveRun
} from './live-run';
import { WorkspaceStream } from './workspace-stream.svelte';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));

const started = { type: 'run_started', runId: 'r1', phase: 'P1' } as const;
const text = (runId: string, t: string) => ({ type: 'agent_text', runId, text: t }) as const;
const message = (runId: string, t: string) =>
	({
		type: 'agent_message',
		runId,
		from: 'test',
		to: 'code',
		text: t,
		findingIds: ['F-1'],
		seq: 1
	}) as WorkspaceEvent;
const tool = (runId: string) =>
	({ type: 'tool_call', runId, name: 'read', input: {}, result: 'ok', isError: false }) as const;

describe('applyEvent', () => {
	it('starts a live run and collects text and tool calls in order', () => {
		let live = applyEvent(null, started);
		live = applyEvent(live, text('r1', 'hello'));
		live = applyEvent(live, tool('r1'));
		expect(live?.phase).toBe('P1');
		expect(live?.items.map((i) => i.kind)).toEqual(['text', 'tool']);
	});

	it('folds an agent message into a message item between the other items', () => {
		let live = applyEvent(null, started);
		live = applyEvent(live, text('r1', 'hello'));
		live = applyEvent(live, message('r1', 'Please fix F-1'));
		expect(live?.items).toEqual([
			{ kind: 'text', text: 'hello' },
			{ kind: 'message', from: 'test', to: 'code', text: 'Please fix F-1', seq: 1 }
		]);
	});

	it('joins a run mid way with a message and replaces the run when another one reports', () => {
		expect(applyEvent(null, message('r9', 'late'))).toEqual({
			runId: 'r9',
			phase: null,
			items: [{ kind: 'message', from: 'test', to: 'code', text: 'late', seq: 1 }]
		});
		const old: LiveRun = { runId: 'r1', phase: 'P5', items: [{ kind: 'text', text: 'x' }] };
		const next = applyEvent(old, message('r2', 'new'));
		expect(next?.runId).toBe('r2');
		expect(next?.items).toHaveLength(1);
	});

	it('joins a run mid way (after a reload) without a phase', () => {
		const live = applyEvent(null, text('r9', 'late'));
		expect(live).toEqual({ runId: 'r9', phase: null, items: [{ kind: 'text', text: 'late' }] });
	});

	it('replaces the live run when a different run reports', () => {
		const old: LiveRun = { runId: 'r1', phase: 'P1', items: [{ kind: 'text', text: 'x' }] };
		expect(applyEvent(old, tool('r2'))?.runId).toBe('r2');
		expect(applyEvent(old, tool('r2'))?.items).toHaveLength(1);
	});

	it('leaves the live run alone for finish and change events', () => {
		const live: LiveRun = { runId: 'r1', phase: 'P1', items: [] };
		expect(applyEvent(live, { type: 'changed' })).toBe(live);
		expect(
			applyEvent(live, { type: 'run_finished', runId: 'r1', status: 'done', costUsd: 0 })
		).toBe(live);
	});
});

describe('orbMood', () => {
	it('works while waiting, searches after a tool call, composes while text streams', () => {
		expect(orbMood([])).toBe('working');
		expect(orbMood([{ kind: 'text', text: 'a' }])).toBe('composing');
		const t = tool('r1');
		expect(
			orbMood([
				{ kind: 'text', text: 'a' },
				{ kind: 'tool', ...t }
			])
		).toBe('searching');
		expect(
			orbMood([
				{ kind: 'tool', ...t },
				{ kind: 'text', text: 'b' }
			])
		).toBe('composing');
		expect(
			orbMood([{ kind: 'message', from: 'test', to: 'code', text: 'Please fix F-1', seq: 1 }])
		).toBe('composing');
	});
});

describe('wording', () => {
	it('explains a failed run in plain words', () => {
		expect(failureReason('server restarted')).toMatch(/server restarted/);
		expect(failureReason('rate limit')).toContain('rate limit');
		expect(failureReason(undefined)).toMatch(/stopped/);
	});

	it('formats cost with three decimals', () => {
		expect(formatUsd(0.0123)).toBe('$0.012');
		expect(formatUsd(0)).toBe('$0.000');
	});
});

describe('codegen progress', () => {
	const file = (runId: string, path: string, status: 'writing' | 'ok') =>
		({ type: 'codegen_file', runId, path, status, attempt: 1 }) as const;

	it('collects file states of one run and starts over for the next run', () => {
		let live = applyCodegen(null, file('r1', 'src/A.ts', 'writing'));
		live = applyCodegen(live, file('r1', 'src/A.ts', 'ok'));
		live = applyCodegen(live, file('r1', 'src/B.ts', 'writing'));
		expect(live?.files).toEqual({ 'src/A.ts': 'ok', 'src/B.ts': 'writing' });
		expect(applyCodegen(live, file('r2', 'src/C.ts', 'writing'))?.files).toEqual({
			'src/C.ts': 'writing'
		});
		expect(applyCodegen(live, started)).toBeNull();
	});

	it('uses the row name the pipeline sends for the wiring step', () => {
		expect(WIRING_ROW).toBe(WIRING_PATH);
	});

	it('shows the snapshot updated by the live events of the active run only', () => {
		const live = { runId: 'r1', files: { 'src/A.ts': 'ok' as const } };
		const snapshot = { 'src/A.ts': 'writing' as const, 'src/B.ts': 'planned' as const };
		expect(codegenProgress(snapshot, live, 'r1')).toEqual({
			'src/A.ts': 'ok',
			'src/B.ts': 'planned'
		});
		expect(codegenProgress(snapshot, live, 'r2')).toEqual(snapshot);
		expect(codegenProgress(null, live, 'r1')).toEqual({ 'src/A.ts': 'ok' });
		expect(codegenProgress(null, live, 'r2')).toBeNull();
		expect(codegenProgress(null, null, 'r1')).toBeNull();
	});
});

describe('WorkspaceStream codegen state', () => {
	it('drops the file states heard before a reconnect, so the reloaded snapshot wins', () => {
		class FakeSource {
			static last: FakeSource;
			onmessage: ((m: { data: string }) => void) | null = null;
			onerror: (() => void) | null = null;
			onopen: (() => void) | null = null;
			constructor() {
				FakeSource.last = this;
			}
			close() {}
		}
		vi.stubGlobal('EventSource', FakeSource);
		const stream = new WorkspaceStream();
		stream.connect('todo');
		const src = FakeSource.last;
		src.onmessage?.({
			data: JSON.stringify({
				type: 'codegen_file',
				runId: 'r1',
				path: 'src/A.ts',
				status: 'writing',
				attempt: 1
			})
		});
		expect(stream.codegen?.files).toEqual({ 'src/A.ts': 'writing' });
		src.onerror?.();
		src.onopen?.();
		expect(stream.codegen).toBeNull();
		vi.unstubAllGlobals();
	});
});

describe('agentLabel', () => {
	it('names the three roles', () => {
		expect(agentLabel('test')).toBe('Test agent');
		expect(agentLabel('code')).toBe('Code agent');
		expect(agentLabel('checks')).toBe('Checks');
	});
});
