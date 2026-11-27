import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendChat, readChat } from './chat';
import { ProjectStore } from './store';

let root: string;
let store: ProjectStore;

const at = '2026-11-22T10:00:00.000Z';

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-chat-'));
	store = new ProjectStore(path.join(root, 'proj'));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('chat keys', () => {
	it('keeps a ticket chat in its own file, apart from the phase chats', async () => {
		await appendChat(store, 'TCK-001', { role: 'user', text: 'triage this', at });
		expect(await readChat(store, 'TCK-001')).toEqual([{ role: 'user', text: 'triage this', at }]);
		expect(await store.readText('.aise/chat/TCK-001.jsonl')).toContain('triage this');
		expect(await readChat(store, 'P1')).toEqual([]);
	});

	it('refuses keys that are neither a phase nor a ticket ID', async () => {
		for (const key of ['TCK-1', '../P1', 'TCK-001/../P1']) {
			const entry = { role: 'user' as const, text: 'x', at };
			await expect(appendChat(store, key as never, entry)).rejects.toThrow();
			await expect(readChat(store, key as never)).rejects.toThrow();
		}
		expect(await store.exists('.aise/P1.jsonl')).toBe(false);
	});
});

describe('agent handoffs', () => {
	it('reads a line written before from and to existed and one that has them', async () => {
		await store.appendFile(
			'.aise/chat/P5.jsonl',
			JSON.stringify({ role: 'user', text: 'old', at }) + '\n'
		);
		await appendChat(store, 'P5', {
			role: 'assistant',
			text: 'Please fix F-1',
			at,
			auto: true,
			from: 'test',
			to: 'code'
		});
		expect(await readChat(store, 'P5')).toEqual([
			{ role: 'user', text: 'old', at },
			{ role: 'assistant', text: 'Please fix F-1', at, auto: true, from: 'test', to: 'code' }
		]);
	});

	it('refuses an unknown role in from', async () => {
		const entry = { role: 'assistant' as const, text: 'x', at, from: 'deploy' };
		await expect(appendChat(store, 'P5', entry as never)).rejects.toThrow();
	});
});
