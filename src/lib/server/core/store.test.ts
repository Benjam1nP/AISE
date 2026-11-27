import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z, ZodError } from 'zod';
import { appendChat, readChat } from './chat';
import { sha256, stableStringify } from './hash';
import { appendRunEvent, backupFile, createRun, listRuns, restoreRun, updateRun } from './runs';
import { initialState, readState, writeState } from './state';
import { isValidProjectName, PathError, ProjectStore } from './store';

let root: string;
let store: ProjectStore;

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'aise-store-'));
	store = new ProjectStore(path.join(root, 'proj'));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const Doc = z.object({ n: z.number() });
const read = (rel: string) => readFile(store.resolve(rel), 'utf8');

describe('project names and paths', () => {
	it('accepts plain names and rejects traversal', () => {
		expect(isValidProjectName('todo@P2')).toBe(true);
		expect(isValidProjectName('todo')).toBe(true);
		expect(isValidProjectName('../x')).toBe(false);
		expect(isValidProjectName('a/b')).toBe(false);
		expect(isValidProjectName('')).toBe(false);
		expect(isValidProjectName('Todo')).toBe(false);
		expect(isValidProjectName('todo@p2')).toBe(false);
		expect(isValidProjectName('todo@P2@P3')).toBe(false);
	});

	it('rejects paths that leave the project folder', () => {
		expect(() => store.resolve('../../etc/passwd')).toThrow(PathError);
		expect(() => store.resolve('../proj2/a.json')).toThrow(PathError);
		expect(() => store.resolve('/etc/passwd')).toThrow(PathError);
		expect(() => store.resolve('a/../../x')).toThrow(PathError);
		expect(() => store.resolve('')).toThrow(PathError);
		expect(() => store.resolve('.')).toThrow(PathError);
		expect(() => store.resolve('a/..')).toThrow(PathError);
	});

	it('resolves paths inside the project folder', () => {
		expect(store.resolve('a/b.json')).toBe(path.join(root, 'proj', 'a', 'b.json'));
		expect(store.resolve('..a.json')).toBe(path.join(root, 'proj', '..a.json'));
		expect(store.resolve('a/../b.json')).toBe(path.join(root, 'proj', 'b.json'));
	});
});

describe('ProjectStore files', () => {
	it('round trips JSON through writeFile and readJson', async () => {
		await store.writeFile('.aise/x.json', JSON.stringify({ n: 1 }));
		expect(await store.readJson('.aise/x.json', Doc)).toEqual({ n: 1 });
		expect(await store.exists('.aise/x.json')).toBe(true);
	});

	it('returns null for a missing file', async () => {
		expect(await store.readJson('missing.json', Doc)).toBeNull();
		expect(await store.exists('missing.json')).toBe(false);
	});

	it('throws the zod error when the JSON does not match the schema', async () => {
		await store.writeFile('x.json', JSON.stringify({ n: 'one' }));
		await expect(store.readJson('x.json', Doc)).rejects.toBeInstanceOf(ZodError);
	});

	it('throws on malformed JSON', async () => {
		await store.writeFile('x.json', '{ not json');
		await expect(store.readJson('x.json', Doc)).rejects.toBeInstanceOf(SyntaxError);
	});

	it('validates on writeJson and pretty prints with a trailing newline', async () => {
		await store.writeJson('x.json', Doc, { n: 1 });
		expect(await read('x.json')).toBe('{\n  "n": 1\n}\n');
		await expect(store.writeJson('x.json', Doc, { n: 'one' } as never)).rejects.toBeInstanceOf(
			ZodError
		);
		expect(await read('x.json')).toBe('{\n  "n": 1\n}\n');
	});
});

describe('hash', () => {
	it('sorts keys at every level', () => {
		expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
		expect(stableStringify({ z: [{ d: 1, c: 2 }], y: null })).toBe(
			'{"y":null,"z":[{"c":2,"d":1}]}'
		);
	});

	it('hashes with sha256 hex', () => {
		expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	});
});

describe('state and chat', () => {
	it('starts every phase as not_started and round trips', async () => {
		const s = await readState(store);
		expect(s).toEqual(initialState());
		expect(s.phases.P7.status).toBe('not_started');
		s.phases.P1 = { status: 'approved', approvedAt: '2026-11-04T10:00:00.000Z' };
		await writeState(store, s);
		expect((await readState(store)).phases.P1.status).toBe('approved');
	});

	it('appends and reads chat entries per phase', async () => {
		expect(await readChat(store, 'P1')).toEqual([]);
		await appendChat(store, 'P1', { role: 'user', text: 'hi', at: '2026-11-04T10:00:00.000Z' });
		await appendChat(store, 'P1', {
			role: 'assistant',
			text: 'a\nb',
			at: '2026-11-04T10:00:01.000Z',
			runId: 'r'
		});
		const chat = await readChat(store, 'P1');
		expect(chat.map((e) => e.text)).toEqual(['hi', 'a\nb']);
		expect(await readChat(store, 'P2')).toEqual([]);
	});
});

describe('runs', () => {
	it('restores overwritten files and deletes created files', async () => {
		await store.writeFile('a.json', '{"v":"old"}');
		const run = await createRun(store, 'P1', 'requirements');
		expect(run.status).toBe('running');

		await store.writeFile('a.json', '{"v":"new"}', run.id);
		await store.writeFile('a.json', '{"v":"newer"}', run.id);
		await store.writeFile('dir/b.json', '{"v":"b"}', run.id);
		expect(await read('a.json')).toBe('{"v":"newer"}');

		await restoreRun(store, run.id);
		expect(await read('a.json')).toBe('{"v":"old"}');
		expect(await store.exists('dir/b.json')).toBe(false);
		const [meta] = await listRuns(store);
		expect(meta.status).toBe('discarded');
	});

	it('decides the first write from disk, across store instances', async () => {
		const run = await createRun(store, 'P1', 'requirements');
		await store.writeFile('b.json', '1', run.id);
		const again = new ProjectStore(store.dir);
		await again.writeFile('b.json', '2', run.id);
		await restoreRun(again, run.id);
		expect(await store.exists('b.json')).toBe(false);
	});

	it('records every file created by concurrent writes in one run', async () => {
		const run = await createRun(store, 'P2', 'design');
		const files = ['docs/a.md', 'docs/b.md', 'docs/c.md'];
		await Promise.all(files.map((f) => store.writeFile(f, f, run.id)));
		await store.writeFile('docs/a.md', 'again', run.id);
		const created = JSON.parse(await read(`.aise/runs/${run.id}/backup/created.json`));
		expect([...created].sort()).toEqual(files);
		await restoreRun(store, run.id);
		for (const f of files) expect(await store.exists(f)).toBe(false);
	});

	it('keeps backing up after a failed backup in the same run', async () => {
		const run = await createRun(store, 'P1', 'requirements');
		const [bad, good] = await Promise.allSettled([
			store.writeFile('created.json', '[]', run.id),
			store.writeFile('ok.json', '1', run.id)
		]);
		expect(bad.status).toBe('rejected');
		expect(good.status).toBe('fulfilled');
		await restoreRun(store, run.id);
		expect(await store.exists('ok.json')).toBe(false);
	});

	it('gives distinct ids to runs created in the same second', async () => {
		const runs = await Promise.all([1, 2, 3].map(() => createRun(store, 'P2', 'design')));
		const ids = runs.map((r) => r.id);
		expect(new Set(ids).size).toBe(3);
		for (const id of ids) expect(id).toMatch(/^\d{8}-\d{6}-P2(-\d+)?$/);
	});

	it('updates, lists and logs runs', async () => {
		const a = await createRun(store, 'P1', 'requirements');
		const b = await createRun(store, 'P2', 'design');
		await updateRun(store, a.id, { status: 'done', costUsd: 0.5 });
		await appendRunEvent(store, a.id, { type: 'tool', name: 'write_requirements' });
		await appendRunEvent(store, a.id, { type: 'text' });
		const runs = await listRuns(store);
		expect(runs.map((r) => r.id)).toEqual([a.id, b.id].sort());
		expect(runs.find((r) => r.id === a.id)?.costUsd).toBe(0.5);
		const events = (await read(`.aise/runs/${a.id}/events.jsonl`)).trim().split('\n');
		expect(events.map((l) => JSON.parse(l).type)).toEqual(['tool', 'text']);
	});

	it('rejects run ids that are not run ids', async () => {
		await expect(updateRun(store, '../../x', { status: 'done' })).rejects.toBeInstanceOf(PathError);
		await expect(backupFile(store, '../x', 'a.json')).rejects.toBeInstanceOf(PathError);
		const run = await createRun(store, 'P1', 'requirements');
		await expect(store.writeFile('created.json', '[]', run.id)).rejects.toBeInstanceOf(PathError);
	});
});
