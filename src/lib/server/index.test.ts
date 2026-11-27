import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const g = globalThis as typeof globalThis & { __aiseOrchestrator?: unknown };
let root: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-index-'));
	vi.stubEnv('AISE_PROJECTS_DIR', root);
	delete g.__aiseOrchestrator;
});

afterEach(async () => {
	delete g.__aiseOrchestrator;
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

it('keeps one orchestrator and one event bus when the module is evaluated again (Vite dev)', async () => {
	vi.resetModules();
	const first = await import('./index');
	vi.resetModules();
	const second = await import('./index');
	expect(second).not.toBe(first);
	expect(second.getOrchestrator()).toBe(first.getOrchestrator());

	const bus = await import('./orchestrator/bus');
	const seen: unknown[] = [];
	const off = first.subscribe('todo', (e) => seen.push(e));
	bus.publish('todo', { type: 'changed' });
	off();
	expect(seen).toEqual([{ type: 'changed' }]);
});
